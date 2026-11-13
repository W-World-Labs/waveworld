import { createHash } from 'node:crypto';
import type {
  JobRecord,
  PathEvidenceSource,
  PathExperimentSpecV1,
  PathModelCapability,
} from '../../types/task';
import { getSqlite } from './db';
import { fingerprintJobSpec } from './job-fingerprint';
import { getEvidence } from './evidence';
import { listArtifacts, readArtifactBytes, saveArtifact, type StoredArtifact } from './artifacts';
import { getAgentCapabilities } from './auth-agent';

export const AUDIT_MANIFEST_SCHEMA = 'waveworld.audit-manifest/v1' as const;

export interface AuditManifest {
  schema: typeof AUDIT_MANIFEST_SCHEMA;
  job: { id: string; specFingerprint: string; spec: JobRecord['spec']; result: NonNullable<JobRecord['result']>; createdAt: string; finishedAt: string | null };
  compute: {
    agentId: string | null;
    agentBuildId: string;
    modelImplementationSha256: string;
    dependencyLockSha256: string;
    backend: NonNullable<JobRecord['result']>['backend'];
    model: unknown;
    engine: unknown;
  };
  evidence: Array<{ path: string; source: PathEvidenceSource; record: ReturnType<typeof getEvidence>; artifact: { id: string; sha256: string; bytes: number } | null }>;
  artifacts: Array<{ id: string; kind: string; contentType: string; bytes: number; sha256: string }>;
}

export interface AuditManifestEnvelope {
  manifestSha256: string;
  manifest: AuditManifest;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function sha(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function evidenceSources(job: JobRecord): Array<{ path: string; source: PathEvidenceSource }> {
  const raw = job.spec.experiment;
  if (!raw || typeof raw !== 'object') return [];
  const experiment = raw as PathExperimentSpecV1;
  const out: Array<{ path: string; source: PathEvidenceSource }> = [];
  experiment.materials?.forEach((item, i) => out.push({ path: `experiment.materials[${i}].source`, source: item.source }));
  experiment.steps?.forEach((step, i) =>
    step.hypothesis?.sources?.forEach((source, j) =>
      out.push({ path: `experiment.steps[${i}].hypothesis.sources[${j}]`, source }),
    ),
  );
  Object.entries(experiment.parameters ?? {}).forEach(([key, item]) =>
    out.push({ path: `experiment.parameters.${key}.source`, source: item.source }),
  );
  if (experiment.analysis?.calibration?.evidence) {
    out.push({ path: 'experiment.analysis.calibration.evidence', source: experiment.analysis.calibration.evidence });
  }
  return out;
}

function verifiedArtifact(meta: StoredArtifact): { id: string; kind: string; contentType: string; bytes: number; sha256: string } {
  const loaded = readArtifactBytes(meta.id);
  if (!loaded) throw new Error(`artifact ${meta.id} missing or content hash mismatch`);
  const digest = sha(loaded.data);
  if (meta.sha256 && digest !== meta.sha256) throw new Error(`artifact ${meta.id} hash mismatch`);
  return { id: meta.id, kind: meta.kind, contentType: meta.contentType, bytes: loaded.data.byteLength, sha256: digest };
}

export function buildAuditManifest(job: JobRecord): AuditManifest {
  if (job.kind !== 'path-experiment' || job.status !== 'succeeded' || !job.result) throw new Error('audit manifest requires a succeeded path-experiment job');
  const artifacts = listArtifacts({ jobId: job.id }).filter((item) => item.kind !== 'path-experiment-audit-manifest').map(verifiedArtifact);
  const evidence = evidenceSources(job).map(({ path, source }) => {
    if (!source.evidenceId) return { path, source, record: null, artifact: null };
    const record = getEvidence(source.evidenceId);
    if (!record) throw new Error(`${path}: evidence ${source.evidenceId} not found`);
    if (!source.sha256 || record.sha256.toLowerCase() !== source.sha256.toLowerCase()) throw new Error(`${path}: evidence digest mismatch`);
    const stored = readArtifactBytes(record.artifactId);
    if (!stored) throw new Error(`${path}: evidence artifact missing or tampered`);
    const digest = sha(stored.data);
    if (digest !== record.sha256.toLowerCase()) throw new Error(`${path}: evidence artifact digest mismatch`);
    return { path, source, record, artifact: { id: record.artifactId, sha256: digest, bytes: stored.data.byteLength } };
  });
  const execution = verifiedExecutionProvenance(job);
  const pathSpec = job.spec.experiment as PathExperimentSpecV1 | undefined;
  const resultExperiment = job.result.experiment as { provenance?: unknown } | undefined;
  return {
    schema: AUDIT_MANIFEST_SCHEMA,
    job: { id: job.id, specFingerprint: job.specFingerprint ?? fingerprintJobSpec(job.spec), spec: job.spec, result: job.result, createdAt: job.createdAt, finishedAt: job.finishedAt },
    compute: {
      agentId: job.agentId,
      ...execution,
      backend: job.result.backend!,
      model: pathSpec?.model ?? job.spec.model ?? null,
      engine: resultExperiment?.provenance ?? null,
    },
    evidence,
    artifacts,
  };
}

const SHA256 = /^[a-f0-9]{64}$/;

function verifiedExecutionProvenance(job: JobRecord): {
  agentBuildId: string; modelImplementationSha256: string; dependencyLockSha256: string;
} {
  const result = job.result!;
  const provenance = result.backend?.provenance;
  const engine = (result.experiment as { provenance?: {
    agentBuildId?: string
    modelImplementationSha256?: string
    dependencyLockSha256?: string
  } } | undefined)?.provenance;
  const incomplete = !provenance?.agentBuildId?.trim()
    || !SHA256.test(provenance.modelImplementationSha256 ?? '')
    || !SHA256.test(provenance.dependencyLockSha256 ?? '');
  if (incomplete) {
    if (process.env.NODE_ENV === 'production') throw new Error('production path result lacks executable build provenance');
    return {
      agentBuildId: provenance?.agentBuildId ?? 'development-unverified',
      modelImplementationSha256: provenance?.modelImplementationSha256 ?? 'development-unverified',
      dependencyLockSha256: provenance?.dependencyLockSha256 ?? 'development-unverified',
    };
  }
  // `incomplete` above proves all fields, but preserve an explicit narrowed
  // value for TypeScript and for the comparisons below.
  const verified = provenance as {
    agentBuildId: string; modelImplementationSha256: string; dependencyLockSha256: string;
  };
  const pathSpec = job.spec.experiment as PathExperimentSpecV1 | undefined;
  const pinnedImplementation = pathSpec?.model?.checksum;
  if (pinnedImplementation && pinnedImplementation !== verified.modelImplementationSha256) {
    throw new Error('result execution provenance does not match JobSpec model checksum');
  }
  if (engine?.agentBuildId && engine.agentBuildId !== verified.agentBuildId
    || engine?.modelImplementationSha256 && engine.modelImplementationSha256 !== verified.modelImplementationSha256
    || engine?.dependencyLockSha256 && engine.dependencyLockSha256 !== verified.dependencyLockSha256) {
    throw new Error('backend and engine execution provenance mismatch');
  }
  if (!job.agentId) throw new Error('path result has no executing agent');
  const capabilities = getAgentCapabilities(job.agentId);
  const model = capabilities?.pathModels?.find(
    (item: PathModelCapability) =>
      item.id === pathSpec?.model?.id && item.version === pathSpec?.model?.version,
  );
  if (capabilities) {
    if (capabilities.agentBuildId !== verified.agentBuildId
      || capabilities.dependencyLockSha256 !== verified.dependencyLockSha256
      || model?.implementationSha256 !== verified.modelImplementationSha256) {
      throw new Error('result execution provenance does not match registered Agent capability');
    }
  } else if (process.env.NODE_ENV === 'production') {
    throw new Error('executing Agent capability record is unavailable');
  }
  return verified;
}

function ensureAuditTable(): void {
  getSqlite().exec(`CREATE TABLE IF NOT EXISTS job_audits (job_id TEXT PRIMARY KEY, status TEXT NOT NULL, artifact_id TEXT, manifest_sha256 TEXT, error TEXT, updated_at TEXT NOT NULL)`);
}

export function getAuditManifestStatus(jobId: string): { status: 'ready' | 'failed'; artifactId: string | null; manifestSha256: string | null; error: string | null } | null {
  ensureAuditTable();
  const row = getSqlite().prepare(`SELECT status, artifact_id, manifest_sha256, error FROM job_audits WHERE job_id=?`).get(jobId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return { status: row.status as 'ready' | 'failed', artifactId: row.artifact_id == null ? null : String(row.artifact_id), manifestSha256: row.manifest_sha256 == null ? null : String(row.manifest_sha256), error: row.error == null ? null : String(row.error) };
}

export function recordAuditFailure(jobId: string, error: unknown): void {
  ensureAuditTable();
  getSqlite().prepare(`INSERT INTO job_audits (job_id,status,artifact_id,manifest_sha256,error,updated_at) VALUES (?, 'failed', NULL, NULL, ?, ?) ON CONFLICT(job_id) DO UPDATE SET status='failed', artifact_id=NULL, manifest_sha256=NULL, error=excluded.error, updated_at=excluded.updated_at`).run(jobId, error instanceof Error ? error.message : String(error), new Date().toISOString());
}

/** Idempotent compensation entry point: safe to retry after the job has succeeded. */
export function createAuditManifestArtifact(job: JobRecord): { artifact: StoredArtifact; envelope: AuditManifestEnvelope } {
  ensureAuditTable();
  const prior = getSqlite().prepare(`SELECT artifact_id FROM job_audits WHERE job_id=? AND status='ready'`).get(job.id) as { artifact_id?: string } | undefined;
  if (prior?.artifact_id) {
    const loaded = readArtifactBytes(prior.artifact_id);
    if (loaded) {
      try {
        return { artifact: loaded.meta, envelope: verifyAuditManifestArtifact(prior.artifact_id) };
      } catch {
        // A ready record from an older schema is not sufficient. Rebuild from
        // the current immutable Job/Result, which will enforce provenance.
      }
    }
  }
  const manifest = buildAuditManifest(job);
  const envelope: AuditManifestEnvelope = { manifestSha256: sha(canonicalJson(manifest)), manifest };
  const artifact = saveArtifact({ jobId: job.id, projectId: job.projectId, ownerUserId: job.createdBy, kind: 'path-experiment-audit-manifest', contentType: 'application/vnd.waveworld.audit+json', data: Buffer.from(canonicalJson(envelope), 'utf8') });
  getSqlite().prepare(`INSERT INTO job_audits (job_id,status,artifact_id,manifest_sha256,error,updated_at) VALUES (?, 'ready', ?, ?, NULL, ?) ON CONFLICT(job_id) DO UPDATE SET status='ready', artifact_id=excluded.artifact_id, manifest_sha256=excluded.manifest_sha256, error=NULL, updated_at=excluded.updated_at`).run(job.id, artifact.id, envelope.manifestSha256, new Date().toISOString());
  return { artifact, envelope };
}

export function verifyAuditManifestArtifact(artifactId: string): AuditManifestEnvelope {
  const loaded = readArtifactBytes(artifactId);
  if (!loaded) throw new Error('audit manifest artifact missing or tampered');
  const envelope = JSON.parse(loaded.data.toString('utf8')) as AuditManifestEnvelope;
  if (envelope.manifest?.schema !== AUDIT_MANIFEST_SCHEMA) throw new Error('unsupported audit manifest schema');
  if (envelope.manifestSha256 !== sha(canonicalJson(envelope.manifest))) throw new Error('audit manifest payload hash mismatch');
  const compute = envelope.manifest.compute;
  const resultProvenance = envelope.manifest.job?.result?.backend?.provenance;
  if (!compute?.agentBuildId || !compute.modelImplementationSha256 || !compute.dependencyLockSha256) {
    throw new Error('audit manifest lacks executable build provenance');
  }
  if (process.env.NODE_ENV === 'production'
    && (!SHA256.test(compute.modelImplementationSha256) || !SHA256.test(compute.dependencyLockSha256))) {
    throw new Error('production audit manifest has unverified executable provenance');
  }
  if (resultProvenance
    && (resultProvenance.agentBuildId !== compute.agentBuildId
      || resultProvenance.modelImplementationSha256 !== compute.modelImplementationSha256
      || resultProvenance.dependencyLockSha256 !== compute.dependencyLockSha256)) {
    throw new Error('audit manifest provenance does not match embedded result');
  }
  for (const item of envelope.manifest.evidence) {
    if (!item.artifact) continue;
    const evidenceArtifact = readArtifactBytes(item.artifact.id);
    if (!evidenceArtifact || sha(evidenceArtifact.data) !== item.artifact.sha256) throw new Error(`evidence artifact ${item.artifact.id} hash mismatch`);
  }
  for (const item of envelope.manifest.artifacts) {
    const artifact = readArtifactBytes(item.id);
    if (!artifact || sha(artifact.data) !== item.sha256) throw new Error(`artifact ${item.id} hash mismatch`);
  }
  return envelope;
}

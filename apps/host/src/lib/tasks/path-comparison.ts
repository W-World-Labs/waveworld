import { createHash, randomUUID } from 'node:crypto';
import type { HostUser } from '../../../../../apps/host/src/lib/user-auth';
import type { JobRecord, PathEvidenceSource, PathExperimentSpecV1 } from '../../types/task';
import { userMayAccessJob } from '../../../../../apps/host/src/lib/job-sharing';
import { getSqlite } from './db';
import { getJob } from './service';
import { createAuditManifestArtifact, canonicalJson, verifyAuditManifestArtifact } from './audit-manifest';
import { readArtifactBytes, saveArtifact, type StoredArtifact } from './artifacts';
import { HttpError } from './http';

export const PATH_COMPARISON_SCHEMA = 'waveworld.path-comparison/v1' as const;
export const PATH_COMPARISON_COMPUTE_VERSION_V1 = 'waveworld.path-comparison-engine/1' as const;
export const PATH_COMPARISON_COMPUTE_VERSION = 'waveworld.path-comparison-engine/2' as const;

export interface PathComparisonSpec {
  schema: typeof PATH_COMPARISON_SCHEMA;
  /** Ordered inputs. The first job is the baseline for deltas. */
  jobIds: string[];
}

export interface PathComparisonMetricValue {
  jobId: string;
  value: number;
  absoluteDelta: number;
  relativeDelta: number | null;
}

export interface PathScientificSnapshot {
  jobId: string;
  model: PathExperimentSpecV1['model'];
  materials: PathExperimentSpecV1['materials'];
  steps: Array<PathExperimentSpecV1['steps'][number] & { order: number }>;
  parameters: PathExperimentSpecV1['parameters'];
  /** Every scientific source in the path, addressed independently of array order. */
  evidenceAnchors: Array<{ path: string; source: PathEvidenceSource }>;
}

export interface PathFieldDifference {
  path: string;
  value: unknown;
}

export interface PathChangedField {
  path: string;
  baselineValue: unknown;
  value: unknown;
}

export interface PathScientificDifference {
  baselineJobId: string;
  jobId: string;
  added: PathFieldDifference[];
  removed: PathFieldDifference[];
  changed: PathChangedField[];
}

export interface PathComparisonResult {
  baselineJobId: string;
  /** Canonical scientific inputs for complete, path-level inspection. */
  snapshots: PathScientificSnapshot[];
  /** Deterministic field-level changes for every job relative to the baseline. */
  differences: PathScientificDifference[];
  metrics: Array<{ key: string; unit: string | null; values: PathComparisonMetricValue[] }>;
  uncertainty: Array<{
    key: string;
    unit: string | null;
    intervals: Array<{
      jobId: string;
      p10: number;
      p50: number;
      p90: number;
      overlapsBaseline: boolean;
      overlapWidth: number;
    }>;
  }>;
}

export type LegacyPathComparisonResult = Omit<PathComparisonResult, 'snapshots' | 'differences'>;

/** Protocol-friendly aliases for clients that do not need the Path prefix. */
export type ComparisonSpec = PathComparisonSpec;
export type ComparisonResult = PathComparisonResult;

export interface PathComparisonManifest {
  schema: typeof PATH_COMPARISON_SCHEMA;
  computeVersion: typeof PATH_COMPARISON_COMPUTE_VERSION | typeof PATH_COMPARISON_COMPUTE_VERSION_V1;
  fingerprint: string;
  createdAt: string;
  createdBy: string;
  spec: PathComparisonSpec;
  inputs: Array<{
    jobId: string;
    specFingerprint: string;
    resultSha256: string;
    auditArtifactId: string;
    auditManifestSha256: string;
  }>;
  result: PathComparisonResult | LegacyPathComparisonResult;
}

export interface PathComparisonEnvelope {
  manifestSha256: string;
  manifest: PathComparisonManifest;
}

export interface StoredPathComparison {
  id: string;
  fingerprint: string;
  createdBy: string;
  jobIds: string[];
  artifact: StoredArtifact;
  envelope: PathComparisonEnvelope;
  createdAt: string;
}

function sha(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fingerprintInputs(inputs: PathComparisonManifest['inputs']): Array<Omit<PathComparisonManifest['inputs'][number], 'auditArtifactId'>> {
  return inputs.map(({ auditArtifactId: _artifactLocation, ...contentIdentity }) => contentIdentity);
}

function ensureTable(): void {
  getSqlite().exec(`
    CREATE TABLE IF NOT EXISTS path_comparisons (
      id TEXT PRIMARY KEY,
      fingerprint TEXT NOT NULL,
      created_by TEXT NOT NULL,
      job_ids TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (created_by, fingerprint)
    );
    CREATE INDEX IF NOT EXISTS path_comparisons_creator_created
      ON path_comparisons (created_by, created_at);
  `);
}

type Scalar = { value: number; unit: string | null };

function scalarOutputs(job: JobRecord): Map<string, Scalar> {
  const outputs = job.result?.experiment?.outputs ?? {};
  const result = new Map<string, Scalar>();
  for (const [key, output] of Object.entries(outputs)) {
    if (typeof output.value === 'number' && Number.isFinite(output.value)) {
      result.set(key, { value: output.value, unit: output.unit?.trim() || null });
    }
  }
  return result;
}

function commonScalarKeys(outputs: Map<string, Scalar>[]): string[] {
  if (!outputs.length) return [];
  return [...outputs[0].keys()].filter((key) => {
    const first = outputs[0].get(key)!;
    return outputs.every((item) => item.has(key) && item.get(key)!.unit === first.unit);
  }).sort();
}

function evidenceAnchors(experiment: PathExperimentSpecV1): PathScientificSnapshot['evidenceAnchors'] {
  const anchors: PathScientificSnapshot['evidenceAnchors'] = [];
  for (const material of experiment.materials) anchors.push({ path: `/materials/${pointer(material.id)}/source`, source: material.source });
  for (const step of experiment.steps) {
    step.hypothesis.sources.forEach((source, index) => anchors.push({ path: `/steps/${pointer(step.id)}/hypothesis/sources/${index}`, source }));
  }
  for (const [name, parameter] of Object.entries(experiment.parameters)) anchors.push({ path: `/parameters/${pointer(name)}/source`, source: parameter.source });
  if (experiment.analysis?.calibration?.evidence) anchors.push({ path: '/analysis/calibration/evidence', source: experiment.analysis.calibration.evidence });
  return anchors.sort((a, b) => a.path.localeCompare(b.path) || canonicalJson(a.source).localeCompare(canonicalJson(b.source)));
}

function scientificSnapshot(job: JobRecord): PathScientificSnapshot {
  const experiment = job.spec.experiment!;
  return {
    jobId: job.id,
    model: experiment.model,
    materials: [...experiment.materials].sort((a, b) => a.id.localeCompare(b.id)),
    // Preserve causal path order explicitly while using stable ids as diff keys.
    steps: experiment.steps.map((step, order) => ({ ...step, order })).sort((a, b) => a.id.localeCompare(b.id)),
    parameters: Object.fromEntries(Object.entries(experiment.parameters).sort(([a], [b]) => a.localeCompare(b))),
    evidenceAnchors: evidenceAnchors(experiment),
  };
}

function pointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Flatten with semantic ids/paths for arrays so reordering does not create noisy index diffs. */
function scientificFields(value: unknown, path = ''): Map<string, unknown> {
  const fields = new Map<string, unknown>();
  const visit = (item: unknown, current: string): void => {
    if (Array.isArray(item)) {
      item.forEach((entry, index) => {
        const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : null;
        const identity = typeof record?.id === 'string' ? record.id : typeof record?.path === 'string' ? record.path : String(index);
        visit(entry, `${current}/${pointer(identity)}`);
      });
    } else if (item && typeof item === 'object') {
      for (const key of Object.keys(item as Record<string, unknown>).sort()) {
        // jobId identifies the containing snapshot, not scientific content.
        if (!current && key === 'jobId') continue;
        visit((item as Record<string, unknown>)[key], `${current}/${pointer(key)}`);
      }
    } else {
      fields.set(current || '/', item);
    }
  };
  visit(value, path);
  return fields;
}

function scientificDifference(baseline: PathScientificSnapshot, candidate: PathScientificSnapshot): PathScientificDifference {
  const left = scientificFields(baseline);
  const right = scientificFields(candidate);
  const added: PathFieldDifference[] = [];
  const removed: PathFieldDifference[] = [];
  const changed: PathChangedField[] = [];
  for (const path of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    if (!left.has(path)) added.push({ path, value: right.get(path) });
    else if (!right.has(path)) removed.push({ path, value: left.get(path) });
    else if (canonicalJson(left.get(path)) !== canonicalJson(right.get(path))) changed.push({ path, baselineValue: left.get(path), value: right.get(path) });
  }
  return { baselineJobId: baseline.jobId, jobId: candidate.jobId, added, removed, changed };
}

function buildResult(jobs: JobRecord[]): PathComparisonResult {
  const all = jobs.map(scalarOutputs);
  const baselineJobId = jobs[0].id;
  const quantilePattern = /^uq\.(.+)\.(p10|p50|p90)$/;
  const common = commonScalarKeys(all);
  const metrics = common.filter((key) => !quantilePattern.test(key)).map((key) => {
    const baseline = all[0].get(key)!;
    return {
      key,
      unit: baseline.unit,
      values: jobs.map((job, index) => {
        const value = all[index].get(key)!.value;
        const absoluteDelta = value - baseline.value;
        return {
          jobId: job.id,
          value,
          absoluteDelta,
          relativeDelta: baseline.value === 0 ? null : absoluteDelta / baseline.value,
        };
      }),
    };
  });

  const uqBaseKeys = [...new Set(common.flatMap((key) => {
    const match = key.match(quantilePattern);
    return match ? [match[1]] : [];
  }))].filter((key) => ['p10', 'p50', 'p90'].every((q) => common.includes(`uq.${key}.${q}`))).sort();
  const uncertainty = uqBaseKeys.map((key) => {
    const unit = all[0].get(`uq.${key}.p50`)!.unit;
    const baselineLow = all[0].get(`uq.${key}.p10`)!.value;
    const baselineHigh = all[0].get(`uq.${key}.p90`)!.value;
    return {
      key,
      unit,
      intervals: jobs.map((job, index) => {
        const p10 = all[index].get(`uq.${key}.p10`)!.value;
        const p50 = all[index].get(`uq.${key}.p50`)!.value;
        const p90 = all[index].get(`uq.${key}.p90`)!.value;
        if (!(p10 <= p50 && p50 <= p90)) throw new HttpError(409, `job ${job.id} has invalid UQ quantile order for ${key}`);
        const overlapWidth = Math.max(0, Math.min(baselineHigh, p90) - Math.max(baselineLow, p10));
        return { jobId: job.id, p10, p50, p90, overlapsBaseline: Math.max(baselineLow, p10) <= Math.min(baselineHigh, p90), overlapWidth };
      }),
    };
  });
  if (!metrics.length && !uncertainty.length) throw new HttpError(409, 'path jobs have no common numeric metrics with matching units');
  const snapshots = jobs.map(scientificSnapshot);
  const differences = snapshots.map((snapshot) => scientificDifference(snapshots[0], snapshot));
  return { baselineJobId, snapshots, differences, metrics, uncertainty };
}

function comparisonFingerprint(inputs: PathComparisonManifest['inputs'], result: PathComparisonResult): string {
  return sha(canonicalJson({
    schema: PATH_COMPARISON_SCHEMA,
    computeVersion: PATH_COMPARISON_COMPUTE_VERSION,
    inputs: fingerprintInputs(inputs),
    result,
  }));
}

function readStored(row: Record<string, unknown>): StoredPathComparison {
  const artifactId = String(row.artifact_id);
  const loaded = readArtifactBytes(artifactId);
  if (!loaded) throw new Error(`comparison artifact ${artifactId} missing or tampered`);
  const envelope = JSON.parse(loaded.data.toString('utf8')) as PathComparisonEnvelope;
  if (envelope.manifestSha256 !== sha(canonicalJson(envelope.manifest))) throw new Error('comparison manifest hash mismatch');
  return {
    id: String(row.id),
    fingerprint: String(row.fingerprint),
    createdBy: String(row.created_by),
    jobIds: JSON.parse(String(row.job_ids)) as string[],
    artifact: loaded.meta,
    envelope,
    createdAt: String(row.created_at),
  };
}

export async function createPathComparison(input: { user: HostUser; jobIds: string[] }): Promise<{ comparison: StoredPathComparison; reused: boolean }> {
  const jobIds = input.jobIds.map((id) => id.trim());
  if (jobIds.length < 2 || jobIds.length > 20) throw new HttpError(400, 'jobIds must contain 2–20 jobs');
  if (jobIds.some((id) => !id) || new Set(jobIds).size !== jobIds.length) throw new HttpError(400, 'jobIds must be non-empty and unique');
  const jobs: JobRecord[] = [];
  for (const id of jobIds) {
    const job = getJob(id);
    if (!job || !await userMayAccessJob(input.user, job, 'read')) throw new HttpError(404, `path job ${id} not found`);
    if (job.kind !== 'path-experiment' || job.status !== 'succeeded' || !job.result?.experiment) throw new HttpError(409, `job ${id} is not a succeeded path-experiment`);
    jobs.push(job);
  }

  const inputs = jobs.map((job) => {
    const { artifact, envelope } = createAuditManifestArtifact(job);
    verifyAuditManifestArtifact(artifact.id);
    return {
      jobId: job.id,
      specFingerprint: envelope.manifest.job.specFingerprint,
      resultSha256: sha(canonicalJson(job.result)),
      auditArtifactId: artifact.id,
      auditManifestSha256: envelope.manifestSha256,
    };
  });
  // Artifact ids are storage locations, not scientific content identity. Keeping
  // them out makes retries stable even if an identical audit is re-materialized.
  const result = buildResult(jobs);
  const fingerprint = comparisonFingerprint(inputs, result);
  ensureTable();
  const prior = getSqlite().prepare(`SELECT * FROM path_comparisons WHERE created_by=? AND fingerprint=?`).get(input.user.id, fingerprint) as Record<string, unknown> | undefined;
  if (prior) return { comparison: readStored(prior), reused: true };

  const createdAt = new Date().toISOString();
  const manifest: PathComparisonManifest = {
    schema: PATH_COMPARISON_SCHEMA,
    computeVersion: PATH_COMPARISON_COMPUTE_VERSION,
    fingerprint,
    createdAt,
    createdBy: input.user.id,
    spec: { schema: PATH_COMPARISON_SCHEMA, jobIds },
    inputs,
    result,
  };
  const envelope: PathComparisonEnvelope = { manifestSha256: sha(canonicalJson(manifest)), manifest };
  const commonProjectId = jobs[0].projectId && jobs.every((job) => job.projectId === jobs[0].projectId) ? jobs[0].projectId : null;
  const artifact = saveArtifact({
    projectId: commonProjectId,
    ownerUserId: input.user.id,
    kind: 'path-experiment-comparison',
    contentType: 'application/vnd.waveworld.path-comparison+json',
    data: Buffer.from(canonicalJson(envelope), 'utf8'),
  });
  const id = randomUUID();
  getSqlite().prepare(`INSERT INTO path_comparisons (id,fingerprint,created_by,job_ids,artifact_id,created_at) VALUES (?,?,?,?,?,?)`)
    .run(id, fingerprint, input.user.id, JSON.stringify(jobIds), artifact.id, createdAt);
  const row = getSqlite().prepare(`SELECT * FROM path_comparisons WHERE id=?`).get(id) as Record<string, unknown>;
  return { comparison: readStored(row), reused: false };
}

export async function getPathComparison(input: { user: HostUser; id: string }): Promise<StoredPathComparison | null> {
  ensureTable();
  const row = getSqlite().prepare(`SELECT * FROM path_comparisons WHERE id=?`).get(input.id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const jobIds = JSON.parse(String(row.job_ids)) as string[];
  for (const id of jobIds) {
    const job = getJob(id);
    if (!job || !await userMayAccessJob(input.user, job, 'read')) return null;
  }
  return readStored(row);
}

/** Resolve an existing comparison for the exact ordered job set without creating a new artifact. */
export async function findPathComparison(input: { user: HostUser; jobIds: string[] }): Promise<StoredPathComparison | null> {
  ensureTable();
  const rows = getSqlite().prepare(`SELECT * FROM path_comparisons WHERE created_by=? ORDER BY created_at DESC LIMIT 200`).all(input.user.id) as Record<string, unknown>[];
  const wanted = JSON.stringify(input.jobIds);
  const row = rows.find((candidate) => String(candidate.job_ids) === wanted);
  if (!row) return null;
  for (const id of input.jobIds) {
    const job = getJob(id);
    if (!job || !await userMayAccessJob(input.user, job, 'read')) return null;
  }
  return readStored(row);
}

export function verifyPathComparisonArtifact(artifactId: string): PathComparisonEnvelope {
  const loaded = readArtifactBytes(artifactId);
  if (!loaded) throw new Error('comparison artifact missing or tampered');
  const envelope = JSON.parse(loaded.data.toString('utf8')) as PathComparisonEnvelope;
  if (envelope.manifestSha256 !== sha(canonicalJson(envelope.manifest))) throw new Error('comparison manifest payload hash mismatch');
  if (envelope.manifest.schema !== PATH_COMPARISON_SCHEMA) throw new Error('unsupported comparison schema');
  if (envelope.manifest.computeVersion !== PATH_COMPARISON_COMPUTE_VERSION
    && envelope.manifest.computeVersion !== PATH_COMPARISON_COMPUTE_VERSION_V1) throw new Error('unsupported comparison compute version');
  const auditedJobs: JobRecord[] = [];
  for (const input of envelope.manifest.inputs) {
    const audit = verifyAuditManifestArtifact(input.auditArtifactId);
    if (audit.manifestSha256 !== input.auditManifestSha256) throw new Error(`job ${input.jobId} audit hash mismatch`);
    if (audit.manifest.job.id !== input.jobId) throw new Error(`job ${input.jobId} audit identity mismatch`);
    if (audit.manifest.job.specFingerprint !== input.specFingerprint) throw new Error(`job ${input.jobId} spec fingerprint mismatch`);
    if (sha(canonicalJson(audit.manifest.job.result)) !== input.resultSha256) throw new Error(`job ${input.jobId} result hash mismatch`);
    auditedJobs.push({ id: input.jobId, spec: audit.manifest.job.spec, result: audit.manifest.job.result } as JobRecord);
  }
  if (envelope.manifest.computeVersion === PATH_COMPARISON_COMPUTE_VERSION_V1) {
    // engine/1 artifacts predate scientific snapshots. Preserve their original
    // content identity exactly: verified input spec/result/audit hashes only.
    const expected = sha(canonicalJson({
      schema: PATH_COMPARISON_SCHEMA,
      computeVersion: PATH_COMPARISON_COMPUTE_VERSION_V1,
      inputs: fingerprintInputs(envelope.manifest.inputs),
    }));
    if (expected !== envelope.manifest.fingerprint) throw new Error('comparison fingerprint mismatch');
    return envelope;
  }
  const rebuiltResult = buildResult(auditedJobs);
  if (canonicalJson(rebuiltResult) !== canonicalJson(envelope.manifest.result)) throw new Error('comparison result or scientific path snapshot mismatch');
  const expected = comparisonFingerprint(envelope.manifest.inputs, rebuiltResult);
  if (expected !== envelope.manifest.fingerprint) throw new Error('comparison fingerprint mismatch');
  return envelope;
}

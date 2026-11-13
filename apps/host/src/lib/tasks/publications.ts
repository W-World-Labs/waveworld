import { createHash, randomBytes } from 'node:crypto';
import type { JobRecord } from '../../types/task';
import { getSqlite } from './db';
import { HttpError } from './http';
import { getJob } from './service';
import { getEvidence } from './evidence';
import { getAuditManifestStatus, verifyAuditManifestArtifact, canonicalJson } from './audit-manifest';
import { readArtifactBytes, saveArtifact, type StoredArtifact } from './artifacts';

export const PUBLICATION_BUNDLE_SCHEMA = 'waveworld.publication-bundle/v1' as const;

type EmbeddedEntry = {
  path: string;
  contentType: string;
  bytes: number;
  sha256: string;
  contentBase64: string;
};

type PublicationEvidence = {
  evidenceId: string;
  sha256: string;
  title: string;
  kind: string;
  disposition: 'embedded' | 'external' | 'excluded';
  entryPath?: string;
  locator?: { doi?: string; url?: string; citation?: string; sourceLocator?: string };
  reason?: string;
};

export interface PublicationManifest {
  schema: typeof PUBLICATION_BUNDLE_SCHEMA;
  publication: { publicId: string; version: number; title: string; public: boolean; createdAt: string; createdBy: string; projectId: string | null };
  jobs: Array<{ id: string; specFingerprint: string | null; auditArtifactId: string; auditManifestSha256: string; specPath: string; resultPath: string; auditPath: string; artifactPaths: string[] }>;
  evidence: PublicationEvidence[];
  entries: Array<Omit<EmbeddedEntry, 'contentBase64'>>;
}

export interface PublicationBundle {
  manifestSha256: string;
  manifest: PublicationManifest;
  entries: EmbeddedEntry[];
}

export interface PublicationRecord {
  publicId: string;
  version: number;
  title: string;
  public: boolean;
  projectId: string | null;
  ownerUserId: string;
  bundleArtifactId: string;
  bundleSha256: string;
  manifestSha256: string;
  createdAt: string;
}

export type EvidencePublicationPolicy = { mode: 'embed' | 'external' | 'exclude'; reason?: string };

function sha(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function ensurePublicationTables(): void {
  getSqlite().exec(`
    CREATE TABLE IF NOT EXISTS publications (
      public_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 0,
      project_id TEXT,
      owner_user_id TEXT NOT NULL,
      bundle_artifact_id TEXT NOT NULL,
      bundle_sha256 TEXT NOT NULL,
      manifest_sha256 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (public_id, version)
    );
    CREATE INDEX IF NOT EXISTS publications_owner_created ON publications(owner_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS publications_project_created ON publications(project_id, created_at DESC);
    CREATE TRIGGER IF NOT EXISTS publications_immutable_update BEFORE UPDATE ON publications
      BEGIN SELECT RAISE(ABORT, 'publication records are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS publications_immutable_delete BEFORE DELETE ON publications
      BEGIN SELECT RAISE(ABORT, 'publication records are immutable'); END;
  `);
}

function rowToRecord(row: Record<string, unknown>): PublicationRecord {
  return {
    publicId: String(row.public_id), version: Number(row.version), title: String(row.title), public: Number(row.is_public) === 1,
    projectId: row.project_id == null ? null : String(row.project_id), ownerUserId: String(row.owner_user_id),
    bundleArtifactId: String(row.bundle_artifact_id), bundleSha256: String(row.bundle_sha256), manifestSha256: String(row.manifest_sha256), createdAt: String(row.created_at),
  };
}

function addEntry(entries: Map<string, EmbeddedEntry>, path: string, contentType: string, data: Buffer): string {
  const digest = sha(data);
  const prior = entries.get(path);
  if (prior && prior.sha256 !== digest) throw new Error(`publication entry collision: ${path}`);
  entries.set(path, { path, contentType, bytes: data.byteLength, sha256: digest, contentBase64: data.toString('base64') });
  return path;
}

function jsonEntry(entries: Map<string, EmbeddedEntry>, path: string, value: unknown): string {
  return addEntry(entries, path, 'application/json', Buffer.from(canonicalJson(value), 'utf8'));
}

function verifiedArtifactEntry(entries: Map<string, EmbeddedEntry>, path: string, artifactId: string): string {
  const loaded = readArtifactBytes(artifactId);
  if (!loaded) throw new HttpError(409, `artifact ${artifactId} is missing or has failed digest verification`);
  return addEntry(entries, path, loaded.meta.contentType, loaded.data);
}

function externalLocator(record: NonNullable<ReturnType<typeof getEvidence>>, sourceLocator?: string): PublicationEvidence['locator'] | undefined {
  const doi = typeof record.metadata.doi === 'string' && record.metadata.doi ? record.metadata.doi : undefined;
  const url = typeof record.metadata.url === 'string' && record.metadata.url ? record.metadata.url : undefined;
  const citation = typeof record.metadata.citation === 'string' && record.metadata.citation ? record.metadata.citation : undefined;
  const locator = sourceLocator?.trim() || undefined;
  return doi || url || citation || locator ? { doi, url, citation, sourceLocator: locator } : undefined;
}

/** Build once and persist once. There is deliberately no update/delete operation. */
export function createPublication(input: {
  jobIds: string[]; title: string; public?: boolean; ownerUserId: string;
  evidencePolicies?: Record<string, EvidencePublicationPolicy>;
}): PublicationRecord {
  ensurePublicationTables();
  const jobIds = [...new Set(input.jobIds ?? [])];
  if (!jobIds.length || jobIds.length > 20) throw new HttpError(400, 'jobIds must contain 1–20 unique jobs');
  if (!input.title?.trim() || input.title.trim().length > 240) throw new HttpError(400, 'title must contain 1–240 characters');
  const jobs = jobIds.map((id) => getJob(id));
  if (jobs.some((job) => !job)) throw new HttpError(404, 'one or more jobs were not found');
  const concrete = jobs as JobRecord[];
  for (const job of concrete) {
    if (job.kind !== 'path-experiment' || job.status !== 'succeeded' || !job.result) throw new HttpError(409, `job ${job.id} is not a succeeded path-experiment`);
  }
  const projectIds = new Set(concrete.map((job) => job.projectId ?? null));
  if (projectIds.size !== 1) throw new HttpError(409, 'all publication jobs must share the same project scope');
  const projectId = concrete[0].projectId ?? null;
  const publicId = `pub_${randomBytes(18).toString('base64url')}`;
  const version = 1;
  const createdAt = new Date().toISOString();
  const entries = new Map<string, EmbeddedEntry>();
  const publicationJobs: PublicationManifest['jobs'] = [];
  const evidence = new Map<string, PublicationEvidence>();

  for (const job of concrete) {
    const audit = getAuditManifestStatus(job.id);
    if (!audit || audit.status !== 'ready' || !audit.artifactId || !audit.manifestSha256) throw new HttpError(409, `job ${job.id} does not have a ready audit manifest`);
    const envelope = verifyAuditManifestArtifact(audit.artifactId);
    if (envelope.manifestSha256 !== audit.manifestSha256) throw new HttpError(409, `job ${job.id} audit record digest mismatch`);
    const root = `jobs/${job.id}`;
    const specPath = jsonEntry(entries, `${root}/spec.json`, job.spec);
    const resultPath = jsonEntry(entries, `${root}/result.json`, job.result);
    const auditPath = verifiedArtifactEntry(entries, `${root}/audit.json`, audit.artifactId);
    const artifactPaths = envelope.manifest.artifacts.map((artifact) => verifiedArtifactEntry(entries, `${root}/artifacts/${artifact.id}`, artifact.id));
    publicationJobs.push({ id: job.id, specFingerprint: envelope.manifest.job.specFingerprint, auditArtifactId: audit.artifactId, auditManifestSha256: audit.manifestSha256, specPath, resultPath, auditPath, artifactPaths });

    for (const item of envelope.manifest.evidence) {
      if (!item.source.evidenceId || evidence.has(item.source.evidenceId)) continue;
      const record = getEvidence(item.source.evidenceId);
      if (!record) throw new HttpError(409, `evidence ${item.source.evidenceId} no longer exists`);
      const requested = input.evidencePolicies?.[record.id];
      const redistributionAllowed = record.metadata.redistributionAllowed === true;
      const locator = externalLocator(record, item.source.locator);
      if (requested?.mode === 'embed') {
        if (!redistributionAllowed) throw new HttpError(409, `evidence ${record.id} cannot be embedded without metadata.redistributionAllowed=true`);
        const entryPath = verifiedArtifactEntry(entries, `evidence/${record.id}/content`, record.artifactId);
        evidence.set(record.id, { evidenceId: record.id, sha256: record.sha256, title: record.title, kind: record.kind, disposition: 'embedded', entryPath, locator });
      } else if (requested?.mode === 'exclude') {
        if (!requested.reason?.trim()) throw new HttpError(400, `evidence ${record.id} exclusion requires a reason`);
        evidence.set(record.id, { evidenceId: record.id, sha256: record.sha256, title: record.title, kind: record.kind, disposition: 'excluded', locator, reason: requested.reason.trim() });
      } else if (requested?.mode === 'external' || locator) {
        if (!locator) throw new HttpError(400, `evidence ${record.id} external disposition requires a locator`);
        evidence.set(record.id, { evidenceId: record.id, sha256: record.sha256, title: record.title, kind: record.kind, disposition: 'external', locator, reason: requested?.reason?.trim() || 'Source bytes are not redistributed by this publication.' });
      } else {
        evidence.set(record.id, { evidenceId: record.id, sha256: record.sha256, title: record.title, kind: record.kind, disposition: 'excluded', reason: 'No redistribution permission or stable external locator was recorded.' });
      }
    }
  }

  const entryList = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
  const manifest: PublicationManifest = {
    schema: PUBLICATION_BUNDLE_SCHEMA,
    publication: { publicId, version, title: input.title.trim(), public: input.public === true, createdAt, createdBy: input.ownerUserId, projectId },
    jobs: publicationJobs,
    evidence: [...evidence.values()].sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)),
    entries: entryList.map(({ contentBase64: _content, ...meta }) => meta),
  };
  const bundle: PublicationBundle = { manifestSha256: sha(canonicalJson(manifest)), manifest, entries: entryList };
  const bytes = Buffer.from(canonicalJson(bundle), 'utf8');
  // Verify the exact serialized payload before making it durable.
  verifyPublicationBundle(bytes);
  const artifact = saveArtifact({ projectId, ownerUserId: input.ownerUserId, kind: 'research-publication-bundle', contentType: 'application/vnd.waveworld.publication+json', data: bytes });
  const record: PublicationRecord = { publicId, version, title: manifest.publication.title, public: manifest.publication.public, projectId, ownerUserId: input.ownerUserId, bundleArtifactId: artifact.id, bundleSha256: artifact.sha256!, manifestSha256: bundle.manifestSha256, createdAt };
  getSqlite().prepare(`INSERT INTO publications (public_id,version,title,is_public,project_id,owner_user_id,bundle_artifact_id,bundle_sha256,manifest_sha256,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(publicId, version, record.title, record.public ? 1 : 0, projectId, record.ownerUserId, record.bundleArtifactId, record.bundleSha256, record.manifestSha256, createdAt);
  return record;
}

export function verifyPublicationBundle(input: Buffer | Uint8Array | string): PublicationBundle {
  let bundle: PublicationBundle;
  try { bundle = JSON.parse(typeof input === 'string' ? input : Buffer.from(input).toString('utf8')) as PublicationBundle; }
  catch { throw new Error('publication bundle is not valid JSON'); }
  if (!bundle || bundle.manifest?.schema !== PUBLICATION_BUNDLE_SCHEMA || !Array.isArray(bundle.entries)) throw new Error('unsupported publication bundle schema');
  if (sha(canonicalJson(bundle.manifest)) !== bundle.manifestSha256) throw new Error('publication manifest digest mismatch');
  const expected = new Map(bundle.manifest.entries.map((entry) => [entry.path, entry]));
  if (expected.size !== bundle.manifest.entries.length || bundle.entries.length !== expected.size) throw new Error('publication entry set is not one-to-one');
  const seen = new Set<string>();
  for (const entry of bundle.entries) {
    if (seen.has(entry.path)) throw new Error(`duplicate publication entry: ${entry.path}`);
    seen.add(entry.path);
    const metadata = expected.get(entry.path);
    if (!metadata || metadata.sha256 !== entry.sha256 || metadata.bytes !== entry.bytes || metadata.contentType !== entry.contentType) throw new Error(`publication entry metadata mismatch: ${entry.path}`);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(entry.contentBase64) || entry.contentBase64.length % 4 !== 0) throw new Error(`invalid base64 entry: ${entry.path}`);
    const data = Buffer.from(entry.contentBase64, 'base64');
    if (data.byteLength !== entry.bytes || sha(data) !== entry.sha256) throw new Error(`publication entry digest mismatch: ${entry.path}`);
  }
  for (const item of bundle.manifest.evidence) {
    if (item.disposition === 'embedded' && (!item.entryPath || !seen.has(item.entryPath))) throw new Error(`embedded evidence entry missing: ${item.evidenceId}`);
    if (item.disposition === 'external' && !item.locator) throw new Error(`external evidence locator missing: ${item.evidenceId}`);
    if (item.disposition === 'excluded' && !item.reason) throw new Error(`evidence exclusion reason missing: ${item.evidenceId}`);
  }
  return bundle;
}

export function getPublication(publicId: string, version = 1): PublicationRecord | null {
  ensurePublicationTables();
  if (!/^pub_[A-Za-z0-9_-]{10,80}$/.test(publicId) || !Number.isSafeInteger(version) || version < 1) return null;
  const row = getSqlite().prepare(`SELECT * FROM publications WHERE public_id=? AND version=?`).get(publicId, version) as Record<string, unknown> | undefined;
  return row ? rowToRecord(row) : null;
}

export function listPublicationsForUser(userId: string, projectIds: string[] = []): PublicationRecord[] {
  ensurePublicationTables();
  const rows = getSqlite().prepare(`SELECT * FROM publications WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 200`).all(userId) as Record<string, unknown>[];
  for (let offset = 0; offset < projectIds.length; offset += 800) {
    const chunk = [...new Set(projectIds)].slice(offset, offset + 800);
    if (!chunk.length) continue;
    rows.push(...getSqlite().prepare(`SELECT * FROM publications WHERE project_id IN (${chunk.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT 200`).all(...chunk) as Record<string, unknown>[]);
  }
  return [...new Map(rows.map((row) => { const record = rowToRecord(row); return [`${record.publicId}:${record.version}`, record]; })).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
}

export function readPublicationBundle(record: PublicationRecord): { artifact: StoredArtifact; data: Buffer; bundle: PublicationBundle } {
  const loaded = readArtifactBytes(record.bundleArtifactId);
  if (!loaded || sha(loaded.data) !== record.bundleSha256) throw new HttpError(409, 'publication bundle is missing or has failed digest verification');
  const bundle = verifyPublicationBundle(loaded.data);
  if (bundle.manifestSha256 !== record.manifestSha256 || bundle.manifest.publication.publicId !== record.publicId || bundle.manifest.publication.version !== record.version) throw new HttpError(409, 'publication record does not match bundle manifest');
  return { artifact: loaded.meta, data: loaded.data, bundle };
}

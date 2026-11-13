import { createHash } from 'node:crypto';
import { getSqlite } from './db';
import { readArtifactBytes, saveArtifact } from './artifacts';
import { HttpError } from './http';
import type { JobSpecV1, PathEvidenceSource } from '../../types/task';

export type EvidenceKind = 'measured' | 'literature';

export type EvidenceImportInput = (
  | {
      kind: 'measured'; title: string; format: 'csv' | 'json'; contentBase64: string;
      contentType?: string; metadata?: Record<string, unknown>;
    }
  | {
      kind: 'literature'; title: string; doi?: string; url?: string; citation?: string;
      metadata?: Record<string, unknown>;
    }) & { projectId?: string };

export interface EvidenceRecord {
  id: string;
  kind: EvidenceKind;
  title: string;
  artifactId: string;
  sha256: string;
  contentType: string;
  bytes: number;
  metadata: Record<string, unknown>;
  ownerUserId: string | null;
  projectId: string | null;
  createdAt: string;
}

export const CALIBRATION_CSV_EXTRACTOR = 'waveworld.calibration-csv' as const;
export const CALIBRATION_CSV_EXTRACTOR_VERSION = '1' as const;
type CalibrationObservations = { time: number[]; T1?: number[]; singletO2?: number[] };

function observationsDigest(value: CalibrationObservations): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

/** Stable v1 CSV semantics. Any parser change must use a new version. */
export function extractCalibrationCsvV1(data: Buffer): {
  observations: CalibrationObservations;
  columns: { time: string; T1?: string; singletO2?: string };
  observationsSha256: string;
} {
  const text = data.toString('utf8');
  if (Buffer.from(text, 'utf8').compare(data) !== 0) throw new HttpError(400, 'calibration evidence must be valid UTF-8 CSV');
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  if (rows.length < 2) throw new HttpError(400, 'calibration evidence CSV needs a header and data row');
  const rawHeader = rows[0].split(',').map((cell) => cell.trim());
  const header = rawHeader.map((cell) => cell.toLowerCase());
  const timeIndex = header.indexOf('time');
  const t1Index = header.indexOf('t1');
  const oxygenIndex = header.findIndex((name) => name === 'singleto2' || name === 'singlet_o2' || name === '1o2');
  if (timeIndex < 0 || (t1Index < 0 && oxygenIndex < 0)) throw new HttpError(400, 'calibration evidence CSV requires time and T1 or singletO2 columns');
  if (new Set(header).size !== header.length) throw new HttpError(400, 'calibration evidence CSV headers must be unique');
  const time: number[] = []; const T1: number[] = []; const singletO2: number[] = [];
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const cells = rows[rowIndex].split(',').map((cell) => cell.trim());
    const t = Number(cells[timeIndex]);
    const triplet = t1Index >= 0 ? Number(cells[t1Index]) : undefined;
    const oxygen = oxygenIndex >= 0 ? Number(cells[oxygenIndex]) : undefined;
    if (!Number.isFinite(t) || t < 0 || (triplet !== undefined && !Number.isFinite(triplet)) || (oxygen !== undefined && !Number.isFinite(oxygen))) throw new HttpError(400, `calibration evidence CSV row ${rowIndex + 1} contains invalid numeric data`);
    time.push(t); if (triplet !== undefined) T1.push(triplet); if (oxygen !== undefined) singletO2.push(oxygen);
  }
  const observations: CalibrationObservations = { time, ...(t1Index >= 0 ? { T1 } : {}), ...(oxygenIndex >= 0 ? { singletO2 } : {}) };
  return { observations, columns: { time: rawHeader[timeIndex], ...(t1Index >= 0 ? { T1: rawHeader[t1Index] } : {}), ...(oxygenIndex >= 0 ? { singletO2: rawHeader[oxygenIndex] } : {}) }, observationsSha256: observationsDigest(observations) };
}

/** Reject incomplete new evidence without changing historical v1 replay semantics. */
function assertCalibrationMeasurementsPresent(data: Buffer, columns: ReturnType<typeof extractCalibrationCsvV1>['columns']): void {
  const rows = data.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  const header = rows[0].split(',').map((cell) => cell.trim());
  const required = Object.values(columns).map((name) => header.indexOf(name));
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const cells = rows[rowIndex].split(',').map((cell) => cell.trim());
    // Number('') is zero, but absent observations cannot support a new calibration.
    if (required.some((index) => !cells[index])) throw new HttpError(400, `calibration evidence CSV row ${rowIndex + 1} contains invalid numeric data`);
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export function prepareEvidenceImport(input: EvidenceImportInput): {
  kind: EvidenceKind; title: string; contentType: string; data: Buffer; metadata: Record<string, unknown>; sha256: string;
} {
  if (!input || (input.kind !== 'measured' && input.kind !== 'literature')) throw new HttpError(400, 'kind must be measured or literature');
  if (typeof input.title !== 'string' || !input.title.trim()) throw new HttpError(400, 'title required');
  let data: Buffer;
  let contentType: string;
  let metadata: Record<string, unknown>;
  if (input.kind === 'measured') {
    if (input.format !== 'csv' && input.format !== 'json') throw new HttpError(400, 'measured format must be csv or json');
    if (typeof input.contentBase64 !== 'string' || !input.contentBase64) throw new HttpError(400, 'contentBase64 required');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.contentBase64) || input.contentBase64.length % 4 !== 0) throw new HttpError(400, 'contentBase64 is invalid');
    data = Buffer.from(input.contentBase64, 'base64');
    if (!data.length) throw new HttpError(400, 'imported data is empty');
    contentType = input.contentType ?? (input.format === 'csv' ? 'text/csv' : 'application/json');
    if (input.format === 'json') {
      try { JSON.parse(data.toString('utf8')); } catch { throw new HttpError(400, 'measured JSON is invalid'); }
    }
    metadata = { ...(input.metadata ?? {}), format: input.format };
  } else {
    if (!input.doi && !input.url && !input.citation) throw new HttpError(400, 'literature requires doi, url, or citation');
    metadata = { ...(input.metadata ?? {}), doi: input.doi, url: input.url, citation: input.citation };
    data = Buffer.from(JSON.stringify(canonical({ kind: input.kind, title: input.title.trim(), ...metadata })), 'utf8');
    contentType = 'application/vnd.waveworld.literature+json';
  }
  return { kind: input.kind, title: input.title.trim(), contentType, data, metadata, sha256: createHash('sha256').update(data).digest('hex') };
}

function ensureEvidenceTable(): void {
  const sqlite = getSqlite();
  sqlite.exec(`CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, artifact_id TEXT NOT NULL, sha256 TEXT NOT NULL, content_type TEXT NOT NULL, metadata TEXT NOT NULL, owner_user_id TEXT, project_id TEXT, created_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS evidence_sha256 ON evidence (sha256);`);
  try { sqlite.exec(`ALTER TABLE evidence ADD COLUMN project_id TEXT`); } catch { /* exists */ }
  sqlite.exec(`CREATE INDEX IF NOT EXISTS evidence_project ON evidence (project_id, created_at)`);
}

export function importEvidence(input: EvidenceImportInput, ownerUserId?: string | null): EvidenceRecord {
  ensureEvidenceTable();
  const prepared = prepareEvidenceImport(input);
  const projectId = input.projectId?.trim() || null;
  const artifact = saveArtifact({ ownerUserId: ownerUserId ?? null, projectId, kind: `evidence-${prepared.kind}`, contentType: prepared.contentType, data: prepared.data });
  const record: EvidenceRecord = { id: crypto.randomUUID(), kind: prepared.kind, title: prepared.title, artifactId: artifact.id, sha256: prepared.sha256, contentType: prepared.contentType, bytes: artifact.bytes, metadata: prepared.metadata, ownerUserId: ownerUserId ?? null, projectId, createdAt: new Date().toISOString() };
  getSqlite().prepare(`INSERT INTO evidence (id, kind, title, artifact_id, sha256, content_type, metadata, owner_user_id, project_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(record.id, record.kind, record.title, record.artifactId, record.sha256, record.contentType, JSON.stringify(record.metadata), record.ownerUserId, record.projectId, record.createdAt);
  return record;
}

export function getEvidence(id: string): EvidenceRecord | null {
  ensureEvidenceTable();
  if (!/^[A-Za-z0-9-]{1,128}$/.test(id)) return null;
  const row = getSqlite().prepare(`SELECT e.*, a.bytes AS bytes FROM evidence e JOIN artifacts a ON a.id = e.artifact_id WHERE e.id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToEvidence(row);
}

function rowToEvidence(row: Record<string, unknown>): EvidenceRecord {
  return { id: String(row.id), kind: row.kind as EvidenceKind, title: String(row.title), artifactId: String(row.artifact_id), sha256: String(row.sha256), contentType: String(row.content_type), bytes: Number(row.bytes), metadata: JSON.parse(String(row.metadata)), ownerUserId: row.owner_user_id == null ? null : String(row.owner_user_id), projectId: row.project_id == null ? null : String(row.project_id), createdAt: String(row.created_at) };
}

/** List only personal evidence owned by the user plus evidence in readable projects. */
export function listEvidence(input: { ownerUserId: string; projectIds?: string[]; limit?: number }): EvidenceRecord[] {
  ensureEvidenceTable();
  const requestedLimit = Number(input.limit ?? 100);
  const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.floor(requestedLimit))) : 100;
  const projectIds = [...new Set((input.projectIds ?? []).filter(Boolean))];
  const sqlite = getSqlite();
  const rows = sqlite.prepare(`SELECT e.*, a.bytes AS bytes FROM evidence e JOIN artifacts a ON a.id = e.artifact_id WHERE e.project_id IS NULL AND e.owner_user_id = ? ORDER BY e.created_at DESC LIMIT ?`).all(input.ownerUserId, limit) as Record<string, unknown>[];
  // Stay below SQLite's bound-variable limit even for principals in many projects.
  for (let offset = 0; offset < projectIds.length; offset += 800) {
    const chunk = projectIds.slice(offset, offset + 800);
    const placeholders = chunk.map(() => '?').join(',');
    rows.push(...sqlite.prepare(`SELECT e.*, a.bytes AS bytes FROM evidence e JOIN artifacts a ON a.id = e.artifact_id WHERE e.project_id IN (${placeholders}) ORDER BY e.created_at DESC LIMIT ?`).all(...chunk, limit) as Record<string, unknown>[]);
  }
  return rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit).map(rowToEvidence);
}

/**
 * Resolve every evidence anchor in a path specification before queueing it.
 * This prevents a spec from claiming an imported source whose immutable digest
 * does not match the Host record.
 */
export function validateJobEvidenceReferences(spec: JobSpecV1, userId?: string | null, context: { projectId?: string | null; canEditProject?: boolean } = {}): void {
  if (spec.kind !== 'path-experiment' || !spec.experiment) return;
  const sources: Array<{ path: string; source: PathEvidenceSource }> = [];
  spec.experiment.materials.forEach((item, index) => sources.push({ path: `experiment.materials[${index}].source`, source: item.source }));
  spec.experiment.steps.forEach((step, stepIndex) => step.hypothesis.sources.forEach((source, sourceIndex) => sources.push({ path: `experiment.steps[${stepIndex}].hypothesis.sources[${sourceIndex}]`, source })));
  Object.entries(spec.experiment.parameters).forEach(([name, parameter]) => sources.push({ path: `experiment.parameters.${name}.source`, source: parameter.source }));
  if (spec.experiment.analysis?.calibration?.evidence) sources.push({ path: 'experiment.analysis.calibration.evidence', source: spec.experiment.analysis.calibration.evidence });
  for (const { path, source } of sources) {
    if (!source.evidenceId) continue;
    const evidence = getEvidence(source.evidenceId);
    if (!evidence) throw new HttpError(400, `${path}.evidenceId not found`);
    if (evidence.sha256.toLowerCase() !== source.sha256?.toLowerCase()) {
      throw new HttpError(400, `${path}.sha256 does not match evidence record`);
    }
    if (evidence.projectId) {
      if (!context.projectId || evidence.projectId !== context.projectId) throw new HttpError(403, `${path}.evidenceId belongs to a different project`);
      if (!context.canEditProject) throw new HttpError(403, `${path}.evidenceId requires project editor access`);
    } else if (userId && evidence.ownerUserId && evidence.ownerUserId !== userId) {
      throw new HttpError(403, `${path}.evidenceId belongs to another user`);
    }
    if (source.kind !== evidence.kind) {
      throw new HttpError(400, `${path}.kind does not match evidence record`);
    }
  }
  const calibration = spec.experiment.analysis?.calibration;
  if (calibration?.evidence) {
    const source = calibration.evidence;
    if (!source.evidenceId) throw new HttpError(400, 'experiment.analysis.calibration.evidence requires evidenceId and sha256');
    if (source.locator !== 'columns=time,T1|singletO2' || source.transform !== 'CSV numeric parse v1') throw new HttpError(400, 'experiment.analysis.calibration.evidence requires the supported CSV v1 column mapping and transform');
    const evidence = getEvidence(source.evidenceId);
    if (!evidence || evidence.kind !== 'measured' || evidence.metadata.format !== 'csv') throw new HttpError(400, 'experiment.analysis.calibration.evidence must reference imported measured CSV evidence');
    const artifact = readArtifactBytes(evidence.artifactId);
    if (!artifact) throw new HttpError(400, 'experiment.analysis.calibration.evidence artifact is missing or tampered');
    const derived = extractCalibrationCsvV1(artifact.data);
    assertCalibrationMeasurementsPresent(artifact.data, derived.columns);
    if (JSON.stringify(canonical(calibration.observations)) !== JSON.stringify(canonical(derived.observations))) throw new HttpError(400, 'experiment.analysis.calibration.observations do not match the evidence-derived observations');
    calibration.evidenceDerivation = {
      extractor: CALIBRATION_CSV_EXTRACTOR,
      version: CALIBRATION_CSV_EXTRACTOR_VERSION,
      columns: derived.columns,
      sourceSha256: evidence.sha256.toLowerCase(),
      observationsSha256: derived.observationsSha256,
    };
  }
}

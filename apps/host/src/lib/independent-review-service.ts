import { createHash, randomBytes } from 'node:crypto';
import type { HostUser } from './user-auth';
import { getSqlite } from './tasks/db';

const REVIEW_SCHEMA = 'waveworld.golden-case-independent-review/v1' as const;
const RECORD_SCHEMA = 'waveworld.independent-review-record/v1' as const;
const REQUIRED_ATTESTATION = 'I did not implement or prepare this golden case or its publication bundle.';

type ReviewPayload = {
  schema?: string;
  status?: string;
  reviewer?: { productionAccountId?: string; nonImplementerAttestation?: string; giteaAccount?: string };
  execution?: {
    startedAt?: string; finishedAt?: string; productionBuildId?: string;
    isolatedWorkingDirectoryDescription?: string; publicationId?: string;
    bundleSha256?: string; genericVerifierSha256?: string; goldenVerifierSha256?: string;
  };
  positiveVerification?: { genericVerifierExitCode?: number; goldenVerifierExitCode?: number; completeLogArtifactOrIssueUrl?: string };
  tamperExercise?: {
    changedField?: string; resignedTamperedBundleSha256?: string; genericVerifierExitCode?: number;
    goldenVerifierExitCode?: number; goldenVerifierError?: string;
  };
  answers?: Record<string, string>;
  usability?: { manualSteps?: string[]; failuresOrConfusion?: string[]; elapsedMinutes?: number; recommendation?: string };
  giteaIssue46CommentUrl?: string;
};

export type IndependentReviewRecord = {
  id: string; publicId: string; version: number; reviewerUserId: string; reviewerName: string;
  reviewerWorkspaceId: string; publicationOwnerUserId: string; status: string;
  bundleSha256: string; manifestSha256: string; payloadSha256: string; recordSha256: string;
  semanticDecision: string; createdAt: string;
};

const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

function ensureTables() {
  getSqlite().exec(`
    CREATE TABLE IF NOT EXISTS independent_reviews (
      id TEXT PRIMARY KEY,
      public_id TEXT NOT NULL,
      publication_version INTEGER NOT NULL,
      reviewer_user_id TEXT NOT NULL,
      reviewer_name TEXT NOT NULL,
      reviewer_workspace_id TEXT NOT NULL,
      publication_owner_user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      bundle_sha256 TEXT NOT NULL,
      manifest_sha256 TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL,
      server_verification_json TEXT NOT NULL,
      record_sha256 TEXT NOT NULL,
      semantic_decision TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (public_id, publication_version, reviewer_user_id)
    );
    CREATE INDEX IF NOT EXISTS independent_reviews_publication ON independent_reviews(public_id, publication_version, created_at);
    CREATE TRIGGER IF NOT EXISTS independent_reviews_immutable_update BEFORE UPDATE ON independent_reviews
      BEGIN SELECT RAISE(ABORT, 'independent review records are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS independent_reviews_immutable_delete BEFORE DELETE ON independent_reviews
      BEGIN SELECT RAISE(ABORT, 'independent review records are immutable'); END;
  `);
  return getSqlite();
}

function nonEmpty(value: unknown, label: string, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || value.includes('REQUIRED')) {
    throw Object.assign(new Error(`${label} is required`), { status: 400 });
  }
  return value.trim();
}

function digest(value: unknown, label: string): string {
  const text = nonEmpty(value, label, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(text)) throw Object.assign(new Error(`${label} must be a SHA-256 hex digest`), { status: 400 });
  return text;
}

function validatePayload(payload: ReviewPayload, user: HostUser, publication: { publicId: string; bundleSha256: string }) {
  if (payload.schema !== REVIEW_SCHEMA) throw Object.assign(new Error('unsupported independent review schema'), { status: 400 });
  if (payload.status !== 'completed') throw Object.assign(new Error('review status must be completed'), { status: 400 });
  if (payload.reviewer?.productionAccountId !== user.id) throw Object.assign(new Error('productionAccountId must match the authenticated reviewer'), { status: 403 });
  if (payload.reviewer?.nonImplementerAttestation?.trim() !== REQUIRED_ATTESTATION) throw Object.assign(new Error('exact non-implementer attestation is required'), { status: 400 });
  nonEmpty(payload.reviewer?.giteaAccount, 'reviewer.giteaAccount', 200);
  const started = Date.parse(nonEmpty(payload.execution?.startedAt, 'execution.startedAt', 80));
  const finished = Date.parse(nonEmpty(payload.execution?.finishedAt, 'execution.finishedAt', 80));
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started || finished > Date.now() + 300_000) {
    throw Object.assign(new Error('review execution timestamps are invalid'), { status: 400 });
  }
  const serverBuildId = nonEmpty(process.env.WAVEWORLD_BUILD_ID, 'server WAVEWORLD_BUILD_ID', 80);
  if (nonEmpty(payload.execution?.productionBuildId, 'execution.productionBuildId', 80) !== serverBuildId) throw Object.assign(new Error('productionBuildId does not match this server'), { status: 409 });
  if (payload.execution?.publicationId !== publication.publicId) throw Object.assign(new Error('publicationId does not match request'), { status: 400 });
  if (digest(payload.execution?.bundleSha256, 'execution.bundleSha256') !== publication.bundleSha256) throw Object.assign(new Error('reviewed bundle digest does not match publication'), { status: 409 });
  digest(payload.execution?.genericVerifierSha256, 'execution.genericVerifierSha256');
  digest(payload.execution?.goldenVerifierSha256, 'execution.goldenVerifierSha256');
  nonEmpty(payload.execution?.isolatedWorkingDirectoryDescription, 'execution.isolatedWorkingDirectoryDescription');
  if (payload.positiveVerification?.genericVerifierExitCode !== 0 || payload.positiveVerification?.goldenVerifierExitCode !== 0) throw Object.assign(new Error('both positive offline verifiers must exit zero'), { status: 400 });
  nonEmpty(payload.positiveVerification?.completeLogArtifactOrIssueUrl, 'positiveVerification.completeLogArtifactOrIssueUrl');
  nonEmpty(payload.tamperExercise?.changedField, 'tamperExercise.changedField');
  digest(payload.tamperExercise?.resignedTamperedBundleSha256, 'tamperExercise.resignedTamperedBundleSha256');
  if (payload.tamperExercise?.genericVerifierExitCode !== 0 || !Number.isInteger(payload.tamperExercise?.goldenVerifierExitCode) || payload.tamperExercise!.goldenVerifierExitCode === 0) throw Object.assign(new Error('tamper exercise must pass generic verification and fail semantic verification'), { status: 400 });
  nonEmpty(payload.tamperExercise?.goldenVerifierError, 'tamperExercise.goldenVerifierError');
  for (const key of ['datasetAndConditions', 'hypothesisDecision', 'workflowVersusModelFailure', 'claimBoundary', 'cpuGpuInterpretation']) nonEmpty(payload.answers?.[key], `answers.${key}`);
  if (!Array.isArray(payload.usability?.manualSteps) || !payload.usability.manualSteps.length || payload.usability.manualSteps.some((item) => !String(item).trim())) throw Object.assign(new Error('usability.manualSteps is required'), { status: 400 });
  if (!Array.isArray(payload.usability?.failuresOrConfusion) || !payload.usability.failuresOrConfusion.length) throw Object.assign(new Error('usability.failuresOrConfusion is required'), { status: 400 });
  if (typeof payload.usability?.elapsedMinutes !== 'number' || !Number.isFinite(payload.usability.elapsedMinutes) || payload.usability.elapsedMinutes <= 0) throw Object.assign(new Error('usability.elapsedMinutes must be positive'), { status: 400 });
  if (!['accept', 'reject', 'accept-with-limitations'].includes(payload.usability?.recommendation ?? '')) throw Object.assign(new Error('invalid usability.recommendation'), { status: 400 });
  const issueUrl = nonEmpty(payload.giteaIssue46CommentUrl, 'giteaIssue46CommentUrl');
  const configuredIssueUrl = process.env.WAVEWORLD_REVIEW_ISSUE_URL?.trim();
  let trustedIssue: URL;
  try {
    trustedIssue = new URL(configuredIssueUrl ?? '');
    if (trustedIssue.protocol !== 'https:' || trustedIssue.username || trustedIssue.password ||
        !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9]\d*$/.test(trustedIssue.pathname) ||
        configuredIssueUrl !== trustedIssue.origin + trustedIssue.pathname) {
      throw new Error('invalid review issue configuration');
    }
  } catch {
    throw Object.assign(new Error('WAVEWORLD_REVIEW_ISSUE_URL is missing or invalid'), { status: 503 });
  }
  let suppliedIssue: URL;
  try {
    suppliedIssue = new URL(issueUrl);
  } catch {
    throw Object.assign(new Error('review must link to the configured issue'), { status: 400 });
  }
  if (suppliedIssue.origin !== trustedIssue.origin || suppliedIssue.pathname !== trustedIssue.pathname ||
      suppliedIssue.username || suppliedIssue.password || suppliedIssue.search ||
      !/^(?:#issuecomment-\d+)?$/.test(suppliedIssue.hash) ||
      issueUrl !== trustedIssue.href + suppliedIssue.hash) {
    throw Object.assign(new Error('review must link to the configured issue'), { status: 400 });
  }
}

function rowToRecord(row: Record<string, unknown>): IndependentReviewRecord {
  return { id: String(row.id), publicId: String(row.public_id), version: Number(row.publication_version), reviewerUserId: String(row.reviewer_user_id), reviewerName: String(row.reviewer_name), reviewerWorkspaceId: String(row.reviewer_workspace_id), publicationOwnerUserId: String(row.publication_owner_user_id), status: String(row.status), bundleSha256: String(row.bundle_sha256), manifestSha256: String(row.manifest_sha256), payloadSha256: String(row.payload_sha256), recordSha256: String(row.record_sha256), semanticDecision: String(row.semantic_decision), createdAt: String(row.created_at) };
}

export async function submitIndependentReview(input: { publicId: string; version?: number; payload: ReviewPayload }, user: HostUser): Promise<IndependentReviewRecord> {
  if (user.authProvider !== 'oidc') throw Object.assign(new Error('independent review requires a W-ID authenticated session'), { status: 403 });
  const { getPublication, readPublicationBundle, verifyPublicationBundle } = await import('./tasks/publications');
  const publication = getPublication(input.publicId, input.version ?? 1);
  if (!publication || !publication.public) throw Object.assign(new Error('public publication not found'), { status: 404 });
  if (publication.ownerUserId === user.id) throw Object.assign(new Error('publication owner cannot independently review their own bundle'), { status: 403 });
  validatePayload(input.payload, user, publication);
  const loaded = readPublicationBundle(publication);
  verifyPublicationBundle(loaded.data);
  const { verifyGoldenPublication } = await import('../../../../scripts/research/verify-golden-publication.mjs');
  const semantic = verifyGoldenPublication(loaded.data) as { ok: boolean; recalculated: { status: string }; bundleSha256: string; manifestSha256: string };
  if (!semantic.ok || semantic.bundleSha256 !== publication.bundleSha256 || semantic.manifestSha256 !== publication.manifestSha256) throw Object.assign(new Error('server semantic verification does not match publication record'), { status: 409 });
  const { canonicalJson } = await import('./tasks/audit-manifest');
  // Independently prove that a re-signed scientific mutation gets through the
  // generic container checker but is rejected by the golden semantic checker.
  const forged = structuredClone(loaded.bundle);
  const rk4 = forged.manifest.jobs.find((job) => {
    const entry = forged.entries.find((candidate) => candidate.path === job.specPath);
    if (!entry) return false;
    const spec = JSON.parse(Buffer.from(entry.contentBase64, 'base64').toString('utf8')) as { experiment?: { model?: { id?: string } } };
    return spec.experiment?.model?.id === 'photosensitization-rk4';
  });
  if (!rk4) throw Object.assign(new Error('golden publication lacks an RK4 result for the server tamper exercise'), { status: 409 });
  const resultEntry = forged.entries.find((entry) => entry.path === rk4.resultPath)!;
  const result = JSON.parse(Buffer.from(resultEntry.contentBase64, 'base64').toString('utf8')) as { experiment: { outputs: Record<string, { value: number[] }> } };
  result.experiment.outputs['calibration.predictedSingletO2'].value[1] += 0.25;
  const rewritten = Buffer.from(canonicalJson(result));
  resultEntry.contentBase64 = rewritten.toString('base64'); resultEntry.bytes = rewritten.byteLength; resultEntry.sha256 = sha(rewritten);
  const resultMeta = forged.manifest.entries.find((entry) => entry.path === resultEntry.path)!;
  resultMeta.bytes = resultEntry.bytes; resultMeta.sha256 = resultEntry.sha256;
  forged.manifestSha256 = sha(canonicalJson(forged.manifest));
  const forgedBytes = Buffer.from(canonicalJson(forged));
  verifyPublicationBundle(forgedBytes);
  let serverTamperError = '';
  try { verifyGoldenPublication(forgedBytes); }
  catch (error) { serverTamperError = error instanceof Error ? error.message : String(error); }
  if (!/calibration RMSE mismatch/.test(serverTamperError)) throw Object.assign(new Error('server semantic tamper exercise did not fail as required'), { status: 409 });
  const payloadJson = canonicalJson(input.payload);
  const serverVerification = { generic: 'pass', semantic: 'pass', semanticDecision: semantic.recalculated.status,
    tamperExercise: { changedField: `${resultEntry.path}:calibration.predictedSingletO2[1]`, generic: 'pass', semantic: 'rejected', error: serverTamperError, forgedBundleSha256: sha(forgedBytes) },
    verifiedAt: new Date().toISOString() };
  const serverJson = canonicalJson(serverVerification);
  const createdAt = new Date().toISOString();
  const id = `review_${randomBytes(18).toString('base64url')}`;
  const payloadSha256 = sha(payloadJson);
  const recordMaterial = { schema: RECORD_SCHEMA, id, publicId: publication.publicId, version: publication.version, reviewerUserId: user.id, reviewerWorkspaceId: user.workspaceId, publicationOwnerUserId: publication.ownerUserId, bundleSha256: publication.bundleSha256, manifestSha256: publication.manifestSha256, payloadSha256, serverVerification, createdAt };
  const recordSha256 = sha(canonicalJson(recordMaterial));
  const sqlite = ensureTables();
  try {
    sqlite.prepare(`INSERT INTO independent_reviews (id,public_id,publication_version,reviewer_user_id,reviewer_name,reviewer_workspace_id,publication_owner_user_id,status,bundle_sha256,manifest_sha256,payload_json,payload_sha256,server_verification_json,record_sha256,semantic_decision,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, publication.publicId, publication.version, user.id, user.name, user.workspaceId, publication.ownerUserId, 'verified', publication.bundleSha256, publication.manifestSha256, payloadJson, payloadSha256, serverJson, recordSha256, semantic.recalculated.status, createdAt);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) throw Object.assign(new Error('this reviewer has already submitted an immutable review for this publication version'), { status: 409 });
    throw error;
  }
  return rowToRecord(sqlite.prepare('SELECT * FROM independent_reviews WHERE id=?').get(id) as Record<string, unknown>);
}

export function listIndependentReviews(publicId: string, version: number, user: HostUser): IndependentReviewRecord[] {
  const sqlite = ensureTables();
  const rows = sqlite.prepare('SELECT * FROM independent_reviews WHERE public_id=? AND publication_version=? ORDER BY created_at').all(publicId, version) as Record<string, unknown>[];
  // The publication owner and participating reviewers can see attributable summaries;
  // full attestation payloads remain server-side and are anchored by payloadSha256.
  return rows.map(rowToRecord).filter((row) => row.publicationOwnerUserId === user.id || row.reviewerUserId === user.id);
}

export const independentReviewConstants = { reviewSchema: REVIEW_SCHEMA, requiredAttestation: REQUIRED_ATTESTATION };

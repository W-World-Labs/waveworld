import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { HostUser } from './user-auth';
import { createProject, attachJobToProject, listJobsForProject, listProjectsForUser } from './project-service';

const CASE_ID = 'mb-pbs-oxygen-transient-2026';
const PROJECT_NAME = 'WaveWorld R1 golden research case';
const PUBLICATION_TITLE = 'WaveWorld R1 golden case — preregistered negative result';

type GoldenCaseGlobal = typeof globalThis & {
  __waveworldGoldenCaseLocks?: Map<string, Promise<void>>;
};

/**
 * The production Host is a single Node process. Serialize each owner's case mutation so
 * double-clicks, retries and overlapping poll/finalize requests cannot create duplicate
 * projects, evidence or jobs. Durable comparison uniqueness remains enforced by SQLite.
 */
async function withGoldenCaseLock<T>(user: HostUser, operation: () => Promise<T>): Promise<T> {
  const globalState = globalThis as GoldenCaseGlobal;
  const locks = globalState.__waveworldGoldenCaseLocks ??= new Map<string, Promise<void>>();
  const key = `${user.workspaceId}\u0000${user.id}\u0000${CASE_ID}`;
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  locks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(key) === queued) locks.delete(key);
  }
}

type VerifiedDataset = {
  path: string; condition: string; sha256: string; sourceSha256: string;
  transformed: Array<{ time: number; singletO2: number }>;
};

function waveRoot(): string {
  const candidates = [process.cwd(), path.resolve(process.cwd(), '../..')];
  const found = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'research/golden-case/manifest.json')));
  if (!found) throw new Error('golden case files are not installed');
  return found;
}

function scalar(result: import('../types/task').JobResultV1, key: string): number {
  const value = result.experiment?.outputs?.[key]?.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`golden result missing ${key}`);
  return value;
}

function pathExperimentModelId(spec: import('../types/task').JobRecord['spec']): string | undefined {
  if (spec.kind !== 'path-experiment') return undefined;
  const experiment = (spec as { experiment?: { model?: { id?: string } } }).experiment;
  return experiment?.model?.id;
}

function productionDecision(jobs: import('../types/task').JobRecord[]) {
  const rk4 = jobs.filter((job) => pathExperimentModelId(job.spec) === 'photosensitization-rk4');
  if (rk4.length !== 2 || rk4.some((job) => !job.result)) throw new Error('golden decision needs two completed RK4 jobs');
  const rmses = rk4.map((job) => scalar(job.result!, 'calibration.rmse'));
  const kq = rk4.map((job) => scalar(job.result!, 'fitted.k_q'));
  const normalizedRmseMax = Math.max(...rmses);
  const oxygenSensitiveParameterRelativeDifference = Math.abs(kq[0] - kq[1]) / Math.max(Math.abs(kq[0]), Math.abs(kq[1]), Number.EPSILON);
  const rk4FitsPass = normalizedRmseMax <= 0.08;
  const parameterDifferencePass = oxygenSensitiveParameterRelativeDifference >= 0.05;
  return { status: rk4FitsPass && parameterDifferencePass ? 'pass' : !rk4FitsPass ? 'fail' : 'uncertain',
    rk4FitsPass, normalizedRmseMax, oxygenSensitiveParameterRelativeDifference, parameterDifferencePass };
}

async function projectFor(user: HostUser) {
  const projects = await listProjectsForUser({ userId: user.id, workspaceId: user.workspaceId, limit: 200 });
  const existing = projects.find((project) => project.ownerUserId === user.id && project.settings?.ui?.goldenCaseId === CASE_ID);
  return existing ?? createProject(user, {
    name: PROJECT_NAME,
    description: 'Versioned real data, preregistered models, reproducibility evidence and independent publication verification.',
    visibility: 'private', settings: { ui: { goldenCaseId: CASE_ID, preregistrationVersion: 1 } },
  });
}

export async function getGoldenCaseStatus(user: HostUser) {
  const projects = await listProjectsForUser({ userId: user.id, workspaceId: user.workspaceId, limit: 200 });
  const project = projects.find((candidate) => candidate.ownerUserId === user.id && candidate.settings?.ui?.goldenCaseId === CASE_ID);
  if (!project) return { caseId: CASE_ID, stage: 'not-started' as const, project: null, jobs: [], comparison: null, publication: null, independentReviews: [] };
  const { getJob } = await import('./tasks/service');
  const rows = await listJobsForProject(project.id) as Array<Record<string, unknown>>;
  const jobs = rows.map((row) => getJob(String(row.id))).filter((job): job is NonNullable<typeof job> => !!job);
  const { listPublicationsForUser } = await import('./tasks/publications');
  const publication = listPublicationsForUser(user.id, [project.id]).find((item) => item.projectId === project.id && item.title === PUBLICATION_TITLE && item.public) ?? null;
  const { findPathComparison } = await import('./tasks/path-comparison');
  const comparison = jobs.length === 4 ? await findPathComparison({ user, jobIds: jobs.map((job) => job.id) }) : null;
  const complete = jobs.length === 4 && jobs.every((job) => job.status === 'succeeded');
  const failed = jobs.some((job) => job.status === 'failed' || job.status === 'cancelled');
  const independentReviews = publication
    ? (await import('./independent-review-service')).listIndependentReviews(publication.publicId, publication.version, user)
    : [];
  return { caseId: CASE_ID, stage: publication ? 'published' as const : failed ? 'failed' as const : complete ? 'ready-to-publish' as const : 'running' as const,
    project: { id: project.id, name: project.name },
    jobs: jobs.map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      model: job.spec.kind === 'path-experiment'
        ? (job.spec as { experiment?: { model?: unknown } }).experiment?.model ?? null
        : null,
      agentId: job.agentId,
    })),
    comparison: comparison ? { id: comparison.id } : null, publication: publication ? { ...publication, downloadUrl: `/api/v1/publications/${publication.publicId}/download` } : null,
    independentReviews };
}

async function advanceGoldenCaseUnlocked(user: HostUser) {
  const root = waveRoot(); const caseRoot = path.join(root, 'research/golden-case');
  const { verifyGoldenCase } = await import('../../../../scripts/research/golden-case.mjs');
  const verified = verifyGoldenCase(caseRoot) as { preregistrationSha256: string; datasets: VerifiedDataset[] };
  const project = await projectFor(user);
  const { importEvidence, listEvidence, validateJobEvidenceReferences } = await import('./tasks/evidence');
  const evidenceByPath = new Map<string, { id: string; sha256: string }>();
  const existingEvidence = listEvidence({ ownerUserId: user.id, projectIds: [project.id], limit: 200 });
  for (const dataset of verified.datasets) {
    const csv = Buffer.from(`time,singletO2\n${dataset.transformed.map((row) => `${row.time},${row.singletO2}`).join('\n')}\n`, 'utf8');
    const digest = createHash('sha256').update(csv).digest('hex');
    const evidence = existingEvidence.find((item) => item.projectId === project.id && item.sha256 === digest) ?? importEvidence({
      projectId: project.id, kind: 'measured', title: `Golden calibration observations — ${dataset.condition}`,
      format: 'csv', contentBase64: csv.toString('base64'), metadata: { redistributionAllowed: true, license: 'CC-BY-4.0',
        doi: '10.5281/zenodo.7469900', sourceSnapshotSha256: dataset.sha256, upstreamEntrySha256: dataset.sourceSha256,
        transform: 'waveworld.mb-transient-normalization/v1' },
    }, user.id);
    evidenceByPath.set(dataset.path, evidence);
  }

  const { buildGoldenSpec } = await import('../../../../scripts/research/golden-spec');
  const { createJob, getJob } = await import('./tasks/service');
  const { validateJobSpec } = await import('./tasks/validate-spec');
  const rows = await listJobsForProject(project.id) as Array<Record<string, unknown>>;
  const jobs = rows.map((row) => getJob(String(row.id))).filter((job): job is NonNullable<typeof job> => !!job);
  for (const dataset of verified.datasets) for (const model of [
    { id: 'photosensitization-rk4', version: '1.0.0' }, { id: 'photosensitization-steady-state', version: '1.0.0' },
  ]) {
    const experimentId = `${CASE_ID}:${dataset.path.includes('n2-') ? 'n2' : 'air'}:${model.id}`;
    if (jobs.some((job) => {
      if (job.spec.kind !== 'path-experiment') return false;
      const exp = (job.spec as { experiment?: { experimentId?: string } }).experiment;
      return exp?.experimentId === experimentId;
    })) continue;
    const spec = buildGoldenSpec(dataset, model, model.id === 'photosensitization-rk4' ? evidenceByPath.get(dataset.path) : undefined) as import('../types/task').JobSpecV1;
    validateJobSpec(spec);
    validateJobEvidenceReferences(spec, user.id, { projectId: project.id, canEditProject: true });
    const job = createJob({ spec, createdBy: user.id }); await attachJobToProject(project.id, job.id, user.id); jobs.push(getJob(job.id)!);
  }

  const preregistration = fs.readFileSync(path.join(caseRoot, 'preregistration.json'));
  const firstJob = jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const { listArtifacts, saveArtifact } = await import('./tasks/artifacts');
  if (!listArtifacts(firstJob.id).some((artifact) => artifact.kind === 'golden-case-preregistration')) {
    saveArtifact({ jobId: firstJob.id, projectId: project.id, ownerUserId: user.id, kind: 'golden-case-preregistration', contentType: 'application/json', data: preregistration });
  }
  const expected = { status: 'fail', rk4FitsPass: false, normalizedRmseMax: 0.6526689123610048,
    oxygenSensitiveParameterRelativeDifference: 0, parameterDifferencePass: false } as const;
  if (!listArtifacts(firstJob.id).some((artifact) => artifact.kind === 'golden-case-decision')) {
    saveArtifact({ jobId: firstJob.id, projectId: project.id, ownerUserId: user.id, kind: 'golden-case-decision', contentType: 'application/json',
      data: Buffer.from(JSON.stringify({ schema: 'waveworld.golden-case-decision/v1', caseId: CASE_ID,
        preregistrationSha256: verified.preregistrationSha256, decision: expected })) });
  }

  const refreshed = jobs.map((job) => getJob(job.id)!).filter(Boolean);
  if (refreshed.length === 4 && refreshed.every((job) => job.status === 'succeeded')) {
    const actual = productionDecision(refreshed);
    for (const [key, value] of Object.entries(expected)) {
      const observed = actual[key as keyof typeof actual];
      if (typeof value === 'number' ? typeof observed !== 'number' || Math.abs(observed - value) > 1e-12 : observed !== value) {
        throw new Error(`production golden decision drift: ${key}`);
      }
    }
    const { createPathComparison } = await import('./tasks/path-comparison');
    const comparison = await createPathComparison({ user, jobIds: refreshed.map((job) => job.id) });
    const { createPublication, listPublicationsForUser } = await import('./tasks/publications');
    let publication = listPublicationsForUser(user.id, [project.id]).find((item) => item.projectId === project.id && item.title === PUBLICATION_TITLE && item.public);
    if (!publication) publication = createPublication({ jobIds: refreshed.map((job) => job.id), title: PUBLICATION_TITLE, public: true, ownerUserId: user.id,
      evidencePolicies: Object.fromEntries([...evidenceByPath.values()].map((item) => [item.id, { mode: 'embed' as const }])) });
    return { ...(await getGoldenCaseStatus(user)), comparison: { id: comparison.comparison.id, reused: comparison.reused }, publication: { ...publication, downloadUrl: `/api/v1/publications/${publication.publicId}/download` } };
  }

  return getGoldenCaseStatus(user);
}

/** Idempotently and concurrency-safely advance the authenticated owner's real production golden case. */
export async function advanceGoldenCase(user: HostUser) {
  return withGoldenCaseLock(user, () => advanceGoldenCaseUnlocked(user));
}

export const goldenCaseConstants = { caseId: CASE_ID, projectName: PROJECT_NAME };

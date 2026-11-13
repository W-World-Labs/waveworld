import { ensureTaskEnv } from '../../../../lib/ensure-task-env';
import { sameSecret } from '../../../../lib/safe-error-message';
import { withRadarRoute } from '@/lib/radar-telemetry';

export const runtime = 'nodejs';

/**
 * Jobs list/create. Residual after aabd0bf: operator x-api-key uses shared
 * timing-safe sameSecret (parity metrics/jobs-stats/job-sharing). Do not claim
 * Lab fully usable while #49 open.
 */
async function getJobs(req: Request) {
  ensureTaskEnv();
  const { listJobs } = await import('@/lib/tasks/service');
  const { errorResponse, json } = await import('@/lib/tasks/http');
  try {
    const { resolveUser } = await import('../../../../lib/user-auth');
    const { userMayAccessJob } = await import('../../../../lib/job-sharing');
    const user = await resolveUser(req);
    const operatorKey = process.env.TASK_API_KEY?.trim();
    const operator = !!operatorKey && sameSecret(req.headers.get('x-api-key'), operatorKey);
    const devOpen = process.env.NODE_ENV !== 'production' && process.env.JOB_REQUIRE_AUTH !== '1';
    if (!user && !operator && !devOpen) return json({ error: 'user authentication required' }, 401);
    const url = new URL(req.url);
    const status = url.searchParams.get('status') as import('@/types/task').JobStatus | null;
    const kind = url.searchParams.get('kind') as import('@/types/task').JobKind | null;
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const mine = url.searchParams.get('mine') === '1';
    let jobs = listJobs({
      status: status ?? undefined,
      kind: kind ?? undefined,
      limit: Number.isFinite(limit) ? limit : 50,
    });
    if (user && !operator) {
      const visible = [];
      for (const job of jobs) if (await userMayAccessJob(user, job, 'read')) visible.push(job);
      jobs = visible;
    } else if (mine && user) {
      jobs = jobs.filter((j) => j.createdBy === user.id);
    }
    return json({ jobs });
  } catch (err) {
    return errorResponse(err);
  }
}

const getJobsWithRadar = withRadarRoute('GET', '/api/v1/jobs', getJobs);
export async function GET(req: Request) {
  return getJobsWithRadar(req);
}

async function createJobRoute(req: Request) {
  ensureTaskEnv();
  const { consumeRateLimit, rateLimitedResponse } = await import('../../../../lib/rate-limit');
  const limited = consumeRateLimit(req, 'jobSubmit');
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
  const { checkSubmitAuth } = await import('@/lib/tasks/auth-agent');
  const { createJob, createOrReuseJob, getJob } = await import('@/lib/tasks/service');
  const { errorResponse, HttpError, json, readJson } = await import('@/lib/tasks/http');
  const { SpecValidationError, validateJobSpec } = await import('@/lib/tasks/validate-spec');
  const { resolveUser } = await import('../../../../lib/user-auth');
  try {
    const user = await resolveUser(req);
    const operatorKey = process.env.TASK_API_KEY;
    const operator = !!operatorKey && checkSubmitAuth(req);
    const devOpen = process.env.NODE_ENV !== 'production' && process.env.JOB_REQUIRE_AUTH !== '1';
    if (!user && !operator && !devOpen) return json({ error: 'user authentication or x-api-key required' }, 401);
    const url = new URL(req.url);
    const body = await readJson<{
      spec: import('@/types/task').JobSpecV1;
      knowledge?: {
        kind?: string;
        releaseId?: string;
        packClaimId?: string;
        packSubjectId?: string;
        materialClaimIds?: string[];
      };
      priority?: number;
      createdBy?: string;
      maxAttempts?: number;
      projectId?: string;
      /** When true, return prior succeeded job for equivalent fingerprint (no re-queue). */
      reuseSucceeded?: boolean;
      /** Run this new job in the authenticated user's browser. */
      execution?: 'browser';
    }>(req, 4 * 1024 * 1024);
    if (!body.spec) throw new HttpError(400, 'spec required');
    if (body.knowledge) {
      const { assembleJobSpecFromKnowledge } = await import('../../../../lib/assemble-job-spec');
      try {
        const assembled = assembleJobSpecFromKnowledge({
          spec: body.spec,
          knowledge: body.knowledge,
        });
        body.spec = assembled.spec;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new HttpError(400, msg);
      }
    }
    try {
      validateJobSpec(body.spec);
    } catch (e) {
      if (e instanceof SpecValidationError) throw new HttpError(400, e.message);
      throw e;
    }

    let projectRole: 'owner' | 'editor' | 'viewer' | null = null;
    if (body.projectId && user) {
      const { canAccessProject } = await import('../../../../lib/project-service');
      projectRole = await canAccessProject(body.projectId, user.id, user.workspaceId);
      if (projectRole !== 'owner' && projectRole !== 'editor') throw new HttpError(403, 'project editor access required');
    }
    // API-key operators are not project principals and therefore cannot bypass
    // membership or create an ambiguously unscoped job from project evidence.
    if (body.projectId && !user) throw new HttpError(403, 'project jobs require an authenticated editor');

    const { validateModelArtifactReference } = await import('@/lib/tasks/artifacts');
    validateModelArtifactReference(body.spec, user?.id ?? null, {
      projectId: body.projectId,
      canEditProject: projectRole === 'owner' || projectRole === 'editor',
    });

    if (body.spec.kind === 'path-experiment') {
      const { validateJobEvidenceReferences } = await import('@/lib/tasks/evidence');
      validateJobEvidenceReferences(body.spec, user?.id ?? null, {
        projectId: body.projectId,
        canEditProject: projectRole === 'owner' || projectRole === 'editor',
      });
    }
    const createdBy = user?.id ?? (operator || devOpen ? body.createdBy ?? req.headers.get('x-created-by') : null) ?? null;

    // Stamp workspace on spec when user is known
    if (user && !body.spec.workspaceId) {
      body.spec = { ...body.spec, workspaceId: user.workspaceId };
    }

    if (body.execution !== undefined) {
      if (body.execution !== 'browser') throw new HttpError(400, 'unsupported execution target');
      if (!user) throw new HttpError(401, 'browser execution requires user authentication');
      const { isNativeAlgorithmInput, isNativeModule, readModuleJobInput } = await import('../../../../../../../src/lib/sim/module-compute');
      const { isBrowserLbmJob } = await import('../../../../../../../src/lib/sim/lbm-compute');
      const browserModule = body.spec.kind === 'waveworld-module' ? readModuleJobInput(body.spec) : null;
      if (body.spec.kind !== 'mac-3d' && !isBrowserLbmJob(body.spec) &&
          (!browserModule || isNativeAlgorithmInput(browserModule) || !isNativeModule(browserModule.module))) {
        throw new HttpError(400, 'This module has no admitted browser agent');
      }
      // Creation and claim share one DB transaction; no backend can race this tab.
      let job = createJob({ spec: body.spec, createdBy: user.id, priority: body.priority,
        maxAttempts: body.maxAttempts, browserAgentId: `browser-${crypto.randomUUID()}` });
      if (body.projectId) {
        const { attachJobToProject } = await import('../../../../lib/project-service');
        await attachJobToProject(body.projectId, job.id, user.id);
        job = getJob(job.id) ?? job;
      }
      return json({ job, reused: false }, 201, { 'Cache-Control': 'no-store' });
    }

    const reuseSucceeded =
      body.reuseSucceeded === true ||
      url.searchParams.get('reuse') === '1' ||
      url.searchParams.get('reuseSucceeded') === '1';

    let { job, reused } = createOrReuseJob({
      spec: body.spec,
      priority: body.priority,
      createdBy,
      maxAttempts: body.maxAttempts,
      reuseSucceeded,
    });
    // Equivalent compute owned by another principal must never become an ID-oracle.
    // Queue a separately owned record until result cloning is implemented.
    if (reused && user && job.createdBy !== user.id) {
      job = createJob({ spec: body.spec, priority: body.priority, createdBy, maxAttempts: body.maxAttempts });
      reused = false;
    }
    // Reuse must preserve the requested authorization boundary. Equivalent
    // numerics do not make a personal and a project record interchangeable.
    if (reused && (job.projectId ?? null) !== (body.projectId ?? null)) {
      job = createJob({ spec: body.spec, priority: body.priority, createdBy, maxAttempts: body.maxAttempts });
      reused = false;
    }

    // Optional: attach to user project (only new jobs; reused may already be linked)
    if (!reused && body.projectId && user) {
      const { attachJobToProject } = await import('../../../../lib/project-service');
      await attachJobToProject(body.projectId, job.id, user.id);
      job = getJob(job.id) ?? job;
    }

    return json({ job, reused }, reused ? 200 : 201);
  } catch (err) {
    return errorResponse(err);
  }
}

const createJobWithRadar = withRadarRoute('POST', '/api/v1/jobs', createJobRoute);
export async function POST(req: Request) {
  return createJobWithRadar(req);
}

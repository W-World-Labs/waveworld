import { ensureTaskEnv } from '../../../../../lib/ensure-task-env';
import { withRadarRoute } from '@/lib/radar-telemetry';

export const runtime = 'nodejs';

/**
 * Download artifact by id.
 * Auth: leasing agent of the artifact's job; user must own or be project member; open only in non-production.
 * Residual after wave40: normalizeArtifactId path gate — garbage/traversal/non-UUID
 * path ids → 400 invalid artifact id (not dishonest 404 "Artifact not found").
 * saveArtifact issues crypto.randomUUID. Do not claim Lab fully usable while #49 open.
 */
async function downloadArtifactRoute(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  ensureTaskEnv();
  const { getArtifact, readArtifactBytes, allowOpenArtifactAccess, userMayAccessArtifact, statArtifactFile } = await import(
    '@/lib/tasks/artifacts'
  );
  const { errorResponse, json, HttpError } = await import('@/lib/tasks/http');
  const { authenticateAgent } = await import('@/lib/tasks/auth-agent');
  const { resolveUser } = await import('../../../../../lib/user-auth');
  try {
    const { id } = await ctx.params;
    const { normalizeArtifactId } = await import('../../../../../lib/job-sharing');
    // Residual after wave40: format gate + trim before getArtifact (saveArtifact → UUID).
    const artifactId = normalizeArtifactId(id);
    if (!artifactId) return json({ error: 'invalid artifact id' }, 400);
    const { consumeArtifactReadLimit, rateLimitedResponse } = await import('../../../../../lib/rate-limit');
    const agentForLimit = authenticateAgent(req.headers.get('authorization'));
    const limited = consumeArtifactReadLimit(req, agentForLimit?.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);

    const found = getArtifact(artifactId);
    // statArtifactFile keeps a store fault (EACCES/ELOOP/EIO…) honest — 5xx,
    // not the 404 "not found" lie existsSync would return for the same fault.
    if (!found || statArtifactFile(found.absPath) === 'missing') {
      return json({ error: 'Artifact not found' }, 404);
    }

    const agent = agentForLimit;
    const user = agent ? null : await resolveUser(req);
    const { agentMayAccessArtifact, normalizeJobId, shareAllowsJob, shareTokenFromRequest } = await import('../../../../../lib/job-sharing');
    const shared = !!found.meta.jobId && await shareAllowsJob(shareTokenFromRequest(req), found.meta.jobId);
    if (!agent && !user && !shared && !allowOpenArtifactAccess()) {
      throw new HttpError(401, 'artifact download requires authentication or a valid share grant');
    }

    if (agent && !shared) {
      let job = null;
      const requestedJob = new URL(req.url).searchParams.get('jobId');
      const modelJobId = requestedJob === null ? null : normalizeJobId(requestedJob);
      if (requestedJob !== null && !modelJobId) throw new HttpError(400, 'invalid job id');
      if (modelJobId || found.meta.jobId) {
        const { getJob } = await import('@/lib/tasks/service');
        job = getJob(modelJobId ?? found.meta.jobId!);
      }
      const modelInput = !!modelJobId && job?.spec.model?.source === 'artifact' && job.spec.model.artifactId === artifactId
        && job.agentId === agent.id && (job.status === 'leased' || job.status === 'running')
        && !!job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) > Date.now();
      if (modelJobId ? !modelInput : !agentMayAccessArtifact(agent, found.meta, job)) {
        throw new HttpError(403, 'forbidden: agent does not hold this job');
      }
    }

    if (user && !agent && !shared) {
      let projectAccess: 'owner' | 'editor' | 'viewer' | null = null;
      if (found.meta.projectId) {
        const { canAccessProject } = await import('../../../../../lib/project-service');
        projectAccess = await canAccessProject(
          found.meta.projectId,
          user.id,
          user.workspaceId
        );
      }
      if (!userMayAccessArtifact(found.meta, user, projectAccess)) {
        throw new HttpError(403, 'forbidden: no access to this artifact');
      }
    }

    const verified = readArtifactBytes(artifactId);
    if (!verified) return json({ error: 'Artifact failed integrity verification' }, 409);
    const data = verified.data;
    const safeName = found.meta.id.replace(/[^a-zA-Z0-9._-]/g, '_');
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': found.meta.contentType,
        'Content-Length': String(found.meta.bytes),
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'X-Artifact-Project-Id': found.meta.projectId ?? '',
        'X-Artifact-Owner': found.meta.ownerUserId ?? '',
        'X-Artifact-SHA256': found.meta.sha256 ?? '',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

const downloadArtifactWithRadar = withRadarRoute('GET', '/api/v1/artifacts/:id', downloadArtifactRoute);
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return downloadArtifactWithRadar(req, ctx);
}

import { ensureTaskEnv } from '../../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/**
 * Import evidence (agent or authenticated user).
 * Residual after wave41: normalizeProjectId on optional body.projectId —
 * garbage → 400 invalid project id (not dishonest 403 from canAccessProject
 * null / forbidden). createProject → randomUUID. Do not claim Lab fully
 * usable while #49/#54 open.
 */
export async function POST(req: Request) {
  ensureTaskEnv();
  const { readJson, json, errorResponse, HttpError } = await import('@/lib/tasks/http');
  const { importEvidence } = await import('@/lib/tasks/evidence');
  const { allowOpenArtifactAccess } = await import('@/lib/tasks/artifacts');
  const { authenticateAgent } = await import('@/lib/tasks/auth-agent');
  const { resolveUser } = await import('../../../../../lib/user-auth');
  try {
    const agent = authenticateAgent(req.headers.get('authorization'));
    const user = agent ? null : await resolveUser(req);
    if (!agent && !user && !allowOpenArtifactAccess()) throw new HttpError(401, 'evidence import requires authentication');
    // contentBase64 becomes an artifact — same disk-write surface as
    // artifacts POST, so it shares the principal-keyed artifactUpload bucket.
    const { consumeArtifactUploadLimit, rateLimitedResponse } = await import('../../../../../lib/rate-limit');
    const limited = consumeArtifactUploadLimit(req, { agentId: agent?.id, userId: user?.id });
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    // contentBase64 becomes an artifact — bound the envelope at 2× the
    // artifact byte cap (base64 inflation ~4/3) instead of unbounded req.json().
    const { getArtifactMaxBytes } = await import('@/lib/tasks/artifacts');
    const body = await readJson<import('@/lib/tasks/evidence').EvidenceImportInput>(req, getArtifactMaxBytes() * 2);
    if (body.projectId != null && body.projectId !== '') {
      const { normalizeProjectId } = await import('../../../../../lib/job-sharing');
      const projectId = normalizeProjectId(body.projectId);
      if (!projectId) return json({ error: 'invalid project id' }, 400);
      body.projectId = projectId;
      if (!user) throw new HttpError(403, 'project evidence import requires a user');
      const { canAccessProject } = await import('../../../../../lib/project-service');
      const role = await canAccessProject(projectId, user.id, user.workspaceId);
      if (role !== 'owner' && role !== 'editor') throw new HttpError(403, 'project editor access required');
    }
    return json({ evidence: importEvidence(body, user?.id ?? null) }, 201);
  } catch (error) { return errorResponse(error); }
}

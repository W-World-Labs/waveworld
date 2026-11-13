import { ensureTaskEnv } from '../../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/**
 * Evidence detail by id.
 * Residual after wave40: normalizeEvidenceId path gate — garbage path ids → 400
 * invalid evidence id (not dishonest 404 "evidence not found"). createEvidence
 * issues crypto.randomUUID. Do not claim Lab fully usable while #49 open.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureTaskEnv();
  const { json, errorResponse, HttpError } = await import('@/lib/tasks/http');
  const { getEvidence } = await import('@/lib/tasks/evidence');
  const { allowOpenArtifactAccess } = await import('@/lib/tasks/artifacts');
  const { authenticateAgent } = await import('@/lib/tasks/auth-agent');
  const { resolveUser } = await import('../../../../../lib/user-auth');
  try {
    const { normalizeEvidenceId } = await import('../../../../../lib/job-sharing');
    const evidenceId = normalizeEvidenceId((await ctx.params).id);
    if (!evidenceId) return json({ error: 'invalid evidence id' }, 400);
    const evidence = getEvidence(evidenceId);
    if (!evidence) throw new HttpError(404, 'evidence not found');
    const agent = authenticateAgent(req.headers.get('authorization'));
    const user = agent ? null : await resolveUser(req);
    if (!allowOpenArtifactAccess()) {
      if (!agent && !user) throw new HttpError(403, 'forbidden: no access to evidence');
      // Registration grants execution rights, not access to every research
      // record. Only unowned, unscoped Agent imports retain Agent read access.
      if (evidence.projectId) {
        if (!user) throw new HttpError(403, 'forbidden: no access to evidence');
        const { canAccessProject } = await import('../../../../../lib/project-service');
        if (!await canAccessProject(evidence.projectId, user.id, user.workspaceId)) throw new HttpError(403, 'forbidden: no access to evidence');
      } else if (evidence.ownerUserId && evidence.ownerUserId !== user?.id) {
        throw new HttpError(403, 'forbidden: no access to evidence');
      }
    }
    return json({ evidence });
  } catch (error) { return errorResponse(error); }
}

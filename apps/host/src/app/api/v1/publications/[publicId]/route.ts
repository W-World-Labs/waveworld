import { ensureTaskEnv } from '../../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/**
 * Publication detail by publicId.
 * Residual after wave35: isPlausiblePublicId + normalizePublicationVersion —
 * numeric/garbage path ids and non-integer/NaN ?version → 400 (not dishonest
 * 404 "publication not found"). Parity shares DELETE isPlausibleShareId (wave32).
 * Do not claim Lab fully usable while #49 open.
 */
export async function GET(req: Request, ctx: { params: Promise<{ publicId: string }> }) {
  ensureTaskEnv();
  const { json, errorResponse, HttpError } = await import('@/lib/tasks/http');
  try {
    const publicId = (await ctx.params).publicId;
    const {
      isPlausiblePublicId,
      normalizePublicationVersion,
    } = await import('../../../../../lib/job-sharing');
    // Residual after wave35: format gate before getPublication (tuanliu already
    // rejects invalid ids as null → 404; Host must surface client errors as 400).
    if (!isPlausiblePublicId(publicId)) {
      throw new HttpError(400, 'invalid publication id');
    }
    const version = normalizePublicationVersion(
      new URL(req.url).searchParams.get('version'),
    );
    const { getPublication, readPublicationBundle } = await import('@/lib/tasks/publications');
    const publication = getPublication(publicId, version);
    if (!publication) throw new HttpError(404, 'publication not found');
    if (!publication.public) {
      const { resolveUser } = await import('../../../../../lib/user-auth');
      const user = await resolveUser(req);
      if (!user) throw new HttpError(404, 'publication not found');
      if (publication.ownerUserId !== user.id) {
        if (!publication.projectId) throw new HttpError(404, 'publication not found');
        const { canAccessProject } = await import('../../../../../lib/project-service');
        if (!await canAccessProject(publication.projectId, user.id, user.workspaceId)) throw new HttpError(404, 'publication not found');
      }
    }
    const { bundle } = readPublicationBundle(publication);
    return json({ publication, manifest: bundle.manifest, verified: true });
  } catch (error) { return errorResponse(error); }
}

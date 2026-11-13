import { ensureTaskEnv } from '../../../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/**
 * Publication bundle download by publicId.
 * Residual after wave35: isPlausiblePublicId + normalizePublicationVersion —
 * garbage path ids / invalid ?version → 400 (not dishonest 404). Parity detail
 * route. Do not claim Lab fully usable while #49 open.
 */
export async function GET(req: Request, ctx: { params: Promise<{ publicId: string }> }) {
  ensureTaskEnv();
  const { errorResponse, HttpError } = await import('@/lib/tasks/http');
  try {
    // Public bundles re-read + re-verify on every hit without auth; cap
    // per-IP before the id check so a repeat loop is shed before disk.
    const { consumeRateLimit, rateLimitedResponse } = await import('../../../../../../lib/rate-limit');
    const limited = consumeRateLimit(req, 'publicationDownload');
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const publicId = (await ctx.params).publicId;
    const {
      isPlausiblePublicId,
      normalizePublicationVersion,
    } = await import('../../../../../../lib/job-sharing');
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
      const { resolveUser } = await import('../../../../../../lib/user-auth');
      const user = await resolveUser(req);
      if (!user) throw new HttpError(404, 'publication not found');
      if (publication.ownerUserId !== user.id) {
        if (!publication.projectId) throw new HttpError(404, 'publication not found');
        const { canAccessProject } = await import('../../../../../../lib/project-service');
        if (!await canAccessProject(publication.projectId, user.id, user.workspaceId)) throw new HttpError(404, 'publication not found');
      }
    }
    const { data } = readPublicationBundle(publication);
    return new Response(new Uint8Array(data), { status: 200, headers: {
      'content-type': 'application/vnd.waveworld.publication+json',
      'content-length': String(data.byteLength),
      'content-disposition': `attachment; filename="${publication.publicId}-v${publication.version}.wwpub.json"`,
      'digest': `sha-256=${Buffer.from(publication.bundleSha256, 'hex').toString('base64')}`,
      'cache-control': publication.public ? 'public, max-age=31536000, immutable' : 'private, no-store',
    } });
  } catch (error) { return errorResponse(error); }
}

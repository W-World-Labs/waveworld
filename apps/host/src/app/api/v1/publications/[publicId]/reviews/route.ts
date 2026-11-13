import { ensureTaskEnv } from '../../../../../../lib/ensure-task-env';

export const runtime = 'nodejs';

/**
 * Independent reviews for a publication.
 * Residual after wave35: isPlausiblePublicId + normalizePublicationVersion on
 * GET (?version) and POST body.version — garbage path ids / invalid versions
 * → 400 (not dishonest 404). Parity detail/download. Do not claim Lab fully
 * usable while #49 open.
 */
export async function GET(req: Request, ctx: { params: Promise<{ publicId: string }> }) {
  ensureTaskEnv();
  const { json, errorResponse, HttpError } = await import('@/lib/tasks/http');
  try {
    const { requireUser } = await import('../../../../../../lib/user-auth');
    const user = await requireUser(req);
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
    const { listIndependentReviews } = await import('../../../../../../lib/independent-review-service');
    return json({ reviews: listIndependentReviews(publicId, version, user) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(req: Request, ctx: { params: Promise<{ publicId: string }> }) {
  ensureTaskEnv();
  const { json, errorResponse, readJson, HttpError } = await import('@/lib/tasks/http');
  try {
    const { requireUser } = await import('../../../../../../lib/user-auth');
    const user = await requireUser(req);
    const { consumePublicationReviewLimit, rateLimitedResponse } = await import('../../../../../../lib/rate-limit');
    const limited = consumePublicationReviewLimit(user.id);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);
    const publicId = (await ctx.params).publicId;
    const {
      isPlausiblePublicId,
      normalizePublicationVersion,
    } = await import('../../../../../../lib/job-sharing');
    if (!isPlausiblePublicId(publicId)) {
      throw new HttpError(400, 'invalid publication id');
    }
    const body = await readJson<{ version?: unknown; payload?: Record<string, unknown> }>(req, 1024 * 1024);
    // Residual after wave35: body.version honesty (undefined → 1; garbage → 400).
    const version = normalizePublicationVersion(body.version);
    const { submitIndependentReview } = await import('../../../../../../lib/independent-review-service');
    const review = await submitIndependentReview({ publicId, version, payload: (body.payload ?? {}) as never }, user);
    return json({ review }, 201);
  } catch (error) { return errorResponse(error); }
}

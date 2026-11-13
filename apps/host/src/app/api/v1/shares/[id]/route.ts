import { ensureTaskEnv } from '../../../../../lib/ensure-task-env';
import {
  PROBE_NO_STORE_HEADERS,
  safeOperationalErrorMessage,
} from '../../../../../lib/safe-error-message';

export const runtime = 'nodejs';

/**
 * Revoke a job share. Residual after wave30: responses use PROBE_NO_STORE_HEADERS
 * (parity shares POST / agents/register — never edge-cache auth outcome for
 * share lifecycle). Residual after wave31: catch path also PROBE_NO_STORE +
 * safeOperationalErrorMessage (401/5xx never cacheable; no secret echo).
 * Residual after wave32: share id format gate (UUID) → 400 invalid share id
 * for numeric/garbage ids (not dishonest 404 not-found).
 * Residual after wave38: normalizeShareId (trim+UUID parity normalizeJobId) so
 * padded path ids revoke the correct row; garbage still 400 not dishonest 404.
 * Do not claim Lab fully usable while #49 open.
 */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  ensureTaskEnv();
  try {
    const { requireUser } = await import('../../../../../lib/user-auth');
    const { normalizeShareId, revokeJobShare } = await import('../../../../../lib/job-sharing');
    const user = await requireUser(req);
    // Share lifecycle shares one per-user bucket with share create.
    const { consumeJobShareLimit } = await import('../../../../../lib/rate-limit');
    const limited = consumeJobShareLimit(user.id);
    if (!limited.ok) {
      return Response.json(
        { error: 'rate_limited' },
        {
          status: 429,
          headers: { ...PROBE_NO_STORE_HEADERS, 'Retry-After': String(limited.retryAfterSec) },
        },
      );
    }
    const id = (await ctx.params).id;
    // Residual after wave32/38: malformed path id is a client error, not "not found".
    const shareId = normalizeShareId(id);
    if (!shareId) {
      return Response.json(
        { error: 'invalid share id' },
        { status: 400, headers: PROBE_NO_STORE_HEADERS },
      );
    }
    const ok = await revokeJobShare(shareId, user.id);
    // Auth-gated lifecycle — always no-store (never edge-cache revoke outcome).
    return Response.json(
      ok ? { ok: true } : { error: 'share not found' },
      { status: ok ? 200 : 404, headers: PROBE_NO_STORE_HEADERS },
    );
  } catch (error) {
    // Residual after wave31: 401/5xx also no-store + redacted (parity register/POST).
    const status =
      error instanceof Error && typeof (error as Error & { status?: number }).status === 'number'
        ? (error as Error & { status: number }).status
        : 500;
    return Response.json(
      { error: safeOperationalErrorMessage(error) },
      { status, headers: PROBE_NO_STORE_HEADERS },
    );
  }
}

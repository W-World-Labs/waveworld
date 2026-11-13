/**
 * POST /api/v1/knowledge/resolve-job — K6
 *
 * Body: { kind, releaseId?, packClaimId?, packSubjectId?, materialClaimIds?,
 *         refs?, overrides?, validate? }
 * → JobSpec-shaped payload + provenance { knowledgeDbReleaseId, claimIds }
 *
 * w-sim never opens knowledge.db; Host is the assembly point.
 */
export const runtime = 'nodejs';

import { requireKnowledgeWriteAuthIfConfigured } from '../../../../../lib/knowledge-write-auth';

/**
 * Write-path gate (K18): when TASK_API_KEY or KNOWLEDGE_WRITE_API_KEY is set,
 * require matching x-api-key (or Bearer). Unset key = open (dev / public demos).
 * Compare is timing-safe via sameSecret (#58).
 */
function requireKnowledgeWriteAuth(req: Request): Response | null {
  return requireKnowledgeWriteAuthIfConfigured(req);
}


export async function POST(req: Request) {
  // Per-IP cap before the 4MB body + knowledge.db assembly; the K18 key
  // is optional (open when unset) so this is the only bound on open
  // deployments. Matches requireKnowledgeRegistrationKey ordering.
  const { consumeRateLimit, rateLimitedResponse } = await import('../../../../../lib/rate-limit');
  const limited = consumeRateLimit(req, 'knowledgeResolveJob');
  if (!limited.ok) return rateLimitedResponse(limited.retryAfterSec);

  const authFail = requireKnowledgeWriteAuth(req);
  if (authFail) return authFail;

  const {
    resolveJobErrorStatus,
    resolveJobSpecFromKnowledge,
  } = await import('../../../../../lib/knowledge-db');
  const { json, errorResponse, HttpError, readJson } = await import('@/lib/tasks/http');
  try {
    let body: unknown;
    try {
      body = await readJson(req, 4 * 1024 * 1024);
    } catch (err) {
      if (err instanceof HttpError && err.status === 413) throw err;
      throw new HttpError(400, 'invalid JSON body');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'body must be a JSON object');
    }
    const input = body as Record<string, unknown>;
    if (typeof input.kind !== 'string' || input.kind.trim() === '') {
      throw new HttpError(400, 'kind is required');
    }

    const result = resolveJobSpecFromKnowledge({
      kind: input.kind,
      releaseId:
        typeof input.releaseId === 'string' ? input.releaseId : undefined,
      packClaimId:
        typeof input.packClaimId === 'string' ? input.packClaimId : undefined,
      packSubjectId:
        typeof input.packSubjectId === 'string'
          ? input.packSubjectId
          : undefined,
      materialClaimIds: Array.isArray(input.materialClaimIds)
        ? input.materialClaimIds.filter(
            (x): x is string => typeof x === 'string',
          )
        : undefined,
      refs:
        input.refs && typeof input.refs === 'object' && !Array.isArray(input.refs)
          ? (input.refs as {
              packClaimId?: string;
              packSubjectId?: string;
              materialClaimIds?: string[];
            })
          : undefined,
      overrides:
        input.overrides
        && typeof input.overrides === 'object'
        && !Array.isArray(input.overrides)
          ? (input.overrides as {
              parameters?: Record<string, unknown>;
              run?: { maxSteps?: number };
              name?: string;
              model?: Record<string, unknown>;
              outputs?: Record<string, unknown>;
            })
          : undefined,
      validate: input.validate === false ? false : true,
    });

    if (!result.ok) {
      throw new HttpError(
        resolveJobErrorStatus(result.code),
        `${result.code}: ${result.message}`,
      );
    }

    return json({
      source: 'db',
      jobSpec: result.jobSpec,
      provenance: result.provenance,
      pack: {
        id: result.pack.id,
        kind: result.pack.kind,
        subjectId: result.pack.subjectId,
      },
      materials: result.materials.map((m) => ({
        id: m.id,
        kind: m.kind,
        subjectId: m.subjectId,
        materialId: m.statement.materialId ?? null,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

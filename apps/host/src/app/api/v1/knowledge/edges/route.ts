/**
 * GET  /api/v1/knowledge/edges — public skeleton; optional embed released claims.
 * POST /api/v1/knowledge/edges — create conversion edge (+ optional efficiency claim) (K23)
 *
 * POST requires agent registration key (AGENT_REGISTRATION_KEY / TASK_API_KEY /
 * KNOWLEDGE_WRITE_KEY). Unauthorized without key. Not a public write path.
 *
 * Query GET: limit, offset, q, from, to, status, efficiencyKind, embed=claims|efficiencyClaims
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { requireKnowledgeRegistrationKey } from '../../../../../lib/knowledge-write-auth';

function parseIntParam(raw: string | null, fallback: number): number {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function wantsEmbedClaims(raw: string | null): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return (
    v === '1' ||
    v === 'true' ||
    v === 'claims' ||
    v === 'efficiency' ||
    v === 'efficiencyclaims' ||
    v.includes('claim')
  );
}

function requireRegistrationKey(req: Request): Response | null {
  return requireKnowledgeRegistrationKey(
    req,
    'edges write requires AGENT_REGISTRATION_KEY or TASK_API_KEY on host',
  );
}

export async function GET(req: Request) {
  const { listKnowledgeEdges } = await import('../../../../../lib/knowledge-db');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const url = new URL(req.url);
    const embed =
      wantsEmbedClaims(url.searchParams.get('embed')) ||
      url.searchParams.get('embedClaims') === '1' ||
      url.searchParams.get('embedClaims') === 'true';
    const efficiencyKind =
      url.searchParams.get('efficiencyKind') ??
      url.searchParams.get('efficiency_kind') ??
      undefined;
    const result = listKnowledgeEdges({
      q: url.searchParams.get('q') ?? undefined,
      fromNodeId:
        url.searchParams.get('from') ??
        url.searchParams.get('fromNodeId') ??
        undefined,
      toNodeId:
        url.searchParams.get('to') ??
        url.searchParams.get('toNodeId') ??
        undefined,
      status: url.searchParams.get('status') ?? undefined,
      efficiencyKind: efficiencyKind ?? undefined,
      limit: parseIntParam(url.searchParams.get('limit'), 50),
      offset: parseIntParam(url.searchParams.get('offset'), 0),
      embedReleasedClaims: embed,
    });
    return json({
      source: 'db',
      embedReleasedClaims: embed,
      efficiencyKind: efficiencyKind ?? undefined,
      items: result.items,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  const authFail = requireRegistrationKey(req);
  if (authFail) return authFail;

  const {
    createKnowledgeEdgeSync,
    normalizeCreateEdgeInput,
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

    let input;
    try {
      input = normalizeCreateEdgeInput(body as Record<string, unknown>);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HttpError(400, msg.replace(/^invalid:\s*/i, '') || msg);
    }

    const result = createKnowledgeEdgeSync(input);
    return json(
      {
        source: 'db',
        ok: true,
        created: result.created,
        claimCreated: result.claimCreated,
        claimId: result.claimId,
        nodesCreated: result.nodesCreated,
        item: result.edge,
        dbPath: result.dbPath,
      },
      result.created ? 201 : 200,
    );
  } catch (err) {
    return errorResponse(err);
  }
}

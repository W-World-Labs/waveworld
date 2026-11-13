/**
 * GET  /api/v1/knowledge/nodes — public Knowledge DB nodes (K3 / EPIC #52).
 * POST /api/v1/knowledge/nodes — create energy node (K24); registration key required.
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

function requireRegistrationKey(req: Request): Response | null {
  return requireKnowledgeRegistrationKey(
    req,
    'nodes write requires AGENT_REGISTRATION_KEY or TASK_API_KEY on host',
  );
}

export async function GET(req: Request) {
  const { listKnowledgeNodes } = await import('../../../../../lib/knowledge-db');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const url = new URL(req.url);
    const parentRaw =
      url.searchParams.get('parentId') ??
      url.searchParams.get('parent') ??
      undefined;
    const result = listKnowledgeNodes({
      q: url.searchParams.get('q') ?? undefined,
      parentId: parentRaw === null ? undefined : parentRaw,
      limit: parseIntParam(url.searchParams.get('limit'), 50),
      offset: parseIntParam(url.searchParams.get('offset'), 0),
    });
    return json({
      source: 'db',
      parentId: parentRaw ?? undefined,
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
    createKnowledgeNodeSync,
    normalizeCreateNodeInput,
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
      input = normalizeCreateNodeInput(body as Record<string, unknown>);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HttpError(400, msg.replace(/^invalid:\s*/i, '') || msg);
    }

    const result = createKnowledgeNodeSync(input);
    return json(
      {
        source: 'db',
        ok: true,
        created: result.created,
        parentCreated: result.parentCreated,
        item: result.node,
        dbPath: result.dbPath,
      },
      result.created ? 201 : 200,
    );
  } catch (err) {
    return errorResponse(err);
  }
}

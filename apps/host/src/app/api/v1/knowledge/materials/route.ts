/**
 * GET  /api/v1/knowledge/materials — list materials (public read)
 * POST /api/v1/knowledge/materials — create material + sim.material claim (K22)
 *
 * POST requires agent registration key (AGENT_REGISTRATION_KEY / TASK_API_KEY /
 * KNOWLEDGE_WRITE_KEY). Unauthorized without key. Not a public write path.
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
    'materials write requires AGENT_REGISTRATION_KEY or TASK_API_KEY on host',
  );
}

export async function GET(req: Request) {
  const { listKnowledgeMaterials } = await import('../../../../../lib/knowledge-db');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const url = new URL(req.url);
    const kindRaw = url.searchParams.get('kind')?.trim()
    const result = listKnowledgeMaterials({
      q: url.searchParams.get('q') ?? undefined,
      categoryId:
        url.searchParams.get('category') ??
        url.searchParams.get('categoryId') ??
        undefined,
      kind: kindRaw || undefined,
      limit: parseIntParam(url.searchParams.get('limit'), 50),
      offset: parseIntParam(url.searchParams.get('offset'), 0),
    });
    return json({
      source: 'db',
      kind: kindRaw || undefined,
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
    createKnowledgeMaterialSync,
    normalizeCreateMaterialInput,
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
      input = normalizeCreateMaterialInput(body as Record<string, unknown>);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new HttpError(400, msg.replace(/^invalid:\s*/i, '') || msg);
    }

    const result = createKnowledgeMaterialSync(input);
    return json(
      {
        source: 'db',
        ok: true,
        created: result.created,
        claimCreated: result.claimCreated,
        claimId: result.claimId,
        item: result.material,
        dbPath: result.dbPath,
      },
      result.created ? 201 : 200,
    );
  } catch (err) {
    return errorResponse(err);
  }
}

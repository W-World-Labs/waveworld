/**
 * GET  /api/v1/knowledge/releases — public released digests only.
 * POST /api/v1/knowledge/releases — publish KnowledgeRelease (K25); registration key required.
 *
 * Body: full KnowledgeRelease JSON (must pass verifyKnowledgeRelease), or
 * `{ release: KnowledgeRelease, exportRoot?: string }`.
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
    'releases write requires AGENT_REGISTRATION_KEY or TASK_API_KEY on host',
  );
}

export async function GET(req: Request) {
  const { listKnowledgeReleases } = await import('../../../../../lib/knowledge-db');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get('q') ?? undefined;
    const result = listKnowledgeReleases({
      q: q ?? undefined,
      limit: parseIntParam(url.searchParams.get('limit'), 50),
      offset: parseIntParam(url.searchParams.get('offset'), 0),
    });
    return json({
      source: 'db',
      q: q ?? undefined,
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

  const { publishKnowledgeReleaseToDb } = await import(
    '../../../../../lib/knowledge-db'
  );
  const { verifyKnowledgeRelease } = await import(
    '@ww/lib/knowledge/release'
  );
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
    const raw = body as Record<string, unknown>;
    const release =
      raw.release && typeof raw.release === 'object' && !Array.isArray(raw.release)
        ? raw.release
        : body;
    const exportRoot =
      typeof raw.exportRoot === 'string' && raw.exportRoot.trim()
        ? raw.exportRoot.trim()
        : undefined;

    const verifyErr = await verifyKnowledgeRelease(release as never);
    if (verifyErr) {
      throw new HttpError(400, `release verify failed: ${verifyErr}`);
    }

    const result = await publishKnowledgeReleaseToDb(release as never, {
      exportRoot,
      meta: { via: 'write-api-k25' },
    });

    return json(
      {
        source: 'db',
        ok: true,
        releaseId: result.releaseId,
        sha256: result.sha256,
        claimCount: result.claimCount,
        snapshotCount: result.snapshotCount,
        bindingCount: result.bindingCount,
        conflictCount: result.conflictCount,
        dbPath: result.dbPath,
        exportRelpath: result.exportRelpath ?? null,
        exportFile: result.exportFile ?? null,
      },
      201,
    );
  } catch (err) {
    return errorResponse(err);
  }
}

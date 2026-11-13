export const runtime = 'nodejs';

function parseIntParam(raw: string | null, fallback: number): number {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

export async function GET(req: Request) {
  const { listMethods } = await import('../../../../../lib/ontology-catalog');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const url = new URL(req.url);
    const result = await listMethods({
      q: url.searchParams.get('q') ?? undefined,
      kind: url.searchParams.get('kind') ?? undefined,
      limit: parseIntParam(url.searchParams.get('limit'), 50),
      offset: parseIntParam(url.searchParams.get('offset'), 0),
      fields: url.searchParams.get('fields') ?? undefined,
    });
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

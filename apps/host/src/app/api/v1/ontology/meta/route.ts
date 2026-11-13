export const runtime = 'nodejs';

export async function GET() {
  const { ontologyMeta, ontologyCacheInfo } = await import(
    '../../../../../lib/ontology-catalog'
  );
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const meta = await ontologyMeta();
    const cache = ontologyCacheInfo();
    return json({ ok: true, ...meta, cache: { loaded: cache.loaded, count: cache.count } });
  } catch (err) {
    return errorResponse(err);
  }
}

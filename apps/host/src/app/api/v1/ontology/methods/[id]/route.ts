export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { getMethod } = await import('../../../../../../lib/ontology-catalog');
  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const { id: rawId } = await ctx.params;
    const id = decodeURIComponent(rawId ?? '').trim();
    if (!id) {
      return json({ error: 'method id required' }, 400);
    }
    const method = await getMethod(id);
    if (!method) {
      return json({ error: 'method not found', id }, 404);
    }
    return json({ method });
  } catch (err) {
    return errorResponse(err);
  }
}

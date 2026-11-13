/**
 * GET /api/v1/knowledge/claims/counts — claim totals (K34 by state; K46 by kind).
 *
 * Query: `by=state` (default, K34) | `by=kind` (K46).
 * Ops companion to K27 list. Requires registration key.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { requireKnowledgeRegistrationKey } from '../../../../../../lib/knowledge-write-auth';

function requireRegistrationKey(req: Request): Response | null {
  return requireKnowledgeRegistrationKey(
    req,
    'claims counts requires AGENT_REGISTRATION_KEY or TASK_API_KEY on host',
  );
}

export async function GET(req: Request) {
  const authFail = requireRegistrationKey(req);
  if (authFail) return authFail;

  const { json, errorResponse } = await import('@/lib/tasks/http');
  try {
    const url = new URL(req.url);
    const by = (url.searchParams.get('by') ?? 'state').toLowerCase();

    if (by === 'kind') {
      const { countClaimsByKindSync } = await import(
        '../../../../../../lib/knowledge-db'
      );
      const counts = countClaimsByKindSync();
      return json({
        source: 'db',
        by: 'kind',
        counts: {
          conversion_efficiency: counts.conversion_efficiency,
          sim_material: counts.sim_material,
          sim_param_pack: counts.sim_param_pack,
          other: counts.other,
          total: counts.total,
          byKind: counts.byKind,
        },
      });
    }

    const { countClaimsByStateSync } = await import(
      '../../../../../../lib/knowledge-db'
    );
    const counts = countClaimsByStateSync();
    return json({
      source: 'db',
      by: 'state',
      counts: {
        candidate: counts.candidate,
        quarantine: counts.quarantine,
        validated: counts.validated,
        released: counts.released,
        total: counts.total,
        other: counts.other,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

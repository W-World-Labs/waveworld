import { ensureTaskEnv } from '../../../../../lib/ensure-task-env';
import {
  assertHostLabUsabilityHonesty,
  hostLabUsabilityHonesty,
} from '../../../../../lib/lab-entry';
import {
  PROBE_NO_STORE_HEADERS,
  safeOperationalErrorMessage,
} from '../../../../../lib/safe-error-message';

export const runtime = 'nodejs';

/**
 * Queue counters for ops / multi-agent dashboards.
 * Residual after 1b367e7: PROBE_NO_STORE_HEADERS on all paths; timing-safe
 * TASK_API_KEY compare (parity with metrics); pin lab honesty so queue green
 * is never read as “Lab fully usable” while #49 open; errors redact secrets.
 * Residual after aabd0bf: sameSecret from shared lib (parity job-sharing / jobs list).
 * Residual after f8da984: JOB_REQUIRE_AUTH=1 closes dev-open queue stats
 * (parity jobs list / job-sharing); queue KPI green ≠ Lab fully usable.
 */
export async function GET(req: Request) {
  ensureTaskEnv();
  const lab = hostLabUsabilityHonesty();
  assertHostLabUsabilityHonesty(lab);
  try {
    // JOB_REQUIRE_AUTH / devOpen: operator-only via allowOperatorProbe (#66).
    const { allowOperatorProbe } = await import('../../../../../lib/operator-auth');
    if (!allowOperatorProbe(req)) {
      return Response.json(
        { error: 'authentication required' },
        { status: 401, headers: PROBE_NO_STORE_HEADERS },
      );
    }
    const { getJobStats } = await import('@/lib/tasks/service');
    return Response.json(
      {
        stats: getJobStats(),
        // Queue monitoring honesty: counters green ≠ Lab fully usable while #49 open.
        labClaimFullyUsable: lab.claimFullyUsable,
        labBlockerOpen: lab.blockerOpen,
        labBlockerIssue: lab.blockerIssue,
        labPathLiveNotFullyUsable: lab.pathLiveNotFullyUsable,
      },
      { status: 200, headers: PROBE_NO_STORE_HEADERS },
    );
  } catch (err) {
    const status =
      err instanceof Error && typeof (err as Error & { status?: number }).status === 'number'
        ? (err as Error & { status: number }).status
        : 500;
    return Response.json(
      { error: safeOperationalErrorMessage(err) },
      { status, headers: PROBE_NO_STORE_HEADERS },
    );
  }
}

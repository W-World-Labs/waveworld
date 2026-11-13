import { ensureTaskEnv } from '../../../../lib/ensure-task-env';
import {
  assertHostLabUsabilityHonesty,
  hostLabUsabilityHonesty,
} from '../../../../lib/lab-entry';
import {
  PROBE_NO_STORE_HEADERS,
  redactOperationalSecrets,
  safeOperationalErrorMessage,
  sameSecret,
} from '../../../../lib/safe-error-message';

export const runtime = 'nodejs';

async function authorized(req: Request): Promise<boolean> {
  const { allowOperatorProbe } = await import('../../../../lib/operator-auth');
  return allowOperatorProbe(req);
}

function metric(name: string, help: string, type: 'gauge' | 'counter', samples: string[]): string[] {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, ...samples];
}
/**
 * Prometheus label value: escape + redact secret env values.
 * Residual after 6d08a42: kind/status free text must never echo TASK_API_KEY etc.
 */
function label(value: string): string {
  return redactOperationalSecrets(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/** Plain-text metrics error/auth responses: never cache; never echo secrets. */
const METRICS_HEADERS_PLAIN = {
  'Content-Type': 'text/plain; charset=utf-8',
  ...PROBE_NO_STORE_HEADERS,
} as const;

/**
 * Residual after 59a3fa3: Prometheus exposition also always no-store
 * (same honesty as 401/503 — scrapers must not cache Lab claim gauges).
 * Residual after 6d08a42: share PROBE_NO_STORE_HEADERS (private/must-revalidate/Pragma).
 */
const METRICS_HEADERS_PROM = {
  'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
  ...PROBE_NO_STORE_HEADERS,
} as const;

/**
 * Residual after a0c47ec: re-export shared redactor (metrics 503 + readiness 503).
 * Prefer `safeOperationalErrorMessage` for new call sites.
 */
const metricsSafeErrorMessage = safeOperationalErrorMessage;

export async function GET(req: Request) {
  ensureTaskEnv();
  if (!(await authorized(req))) {
    return new Response('authentication required\n', {
      status: 401,
      headers: METRICS_HEADERS_PLAIN,
    });
  }
  try {
    const { getJobStats } = await import('@/lib/tasks/service');
    const stats = getJobStats(); const lines: string[] = [];
    // Lab honesty gauges (numeric only — never secrets). Host scrape green ≠ Lab fully usable.
    const lab = hostLabUsabilityHonesty();
    assertHostLabUsabilityHonesty(lab);
    lines.push(...metric(
      'waveworld_lab_claim_fully_usable',
      '1 if Host claims engineering Lab fully production-usable; 0 while an open Lab blocker exists.',
      'gauge',
      [`waveworld_lab_claim_fully_usable ${lab.claimFullyUsable ? 1 : 0}`],
    ));
    lines.push(...metric(
      'waveworld_lab_blocker_open',
      '1 while the Lab usability blocker is open; operators must not treat host ok as Lab fully usable.',
      'gauge',
      [`waveworld_lab_blocker_open ${lab.blockerOpen ? 1 : 0}`],
    ));
    // Residual after c96460f: pin issue number so alert rules can match WaveWorld #49 without parsing HELP text.
    lines.push(...metric(
      'waveworld_lab_blocker_issue',
      'Open Lab usability blocker Gitea issue number (WAVEWORLD_LAB_BLOCKER_ISSUE); 0 when no blocker.',
      'gauge',
      [`waveworld_lab_blocker_issue ${lab.blockerOpen ? lab.blockerIssue : 0}`],
    ));
    // Residual after 6b2e2fa: path live is independent of full usability (gateway up ≠ Lab fully usable).
    lines.push(...metric(
      'waveworld_lab_path_live_not_fully_usable',
      '1 while public Lab path/gateway may be live but Host must not claim full engineering usability.',
      'gauge',
      [`waveworld_lab_path_live_not_fully_usable ${lab.pathLiveNotFullyUsable ? 1 : 0}`],
    ));
    lines.push(...metric('waveworld_jobs', 'Current jobs by status.', 'gauge',
      (['queued', 'leased', 'running', 'failed', 'succeeded', 'cancelled'] as const).map((status) => `waveworld_jobs{status="${status}"} ${stats[status]}`)));
    lines.push(...metric('waveworld_queue_oldest_queued_age_seconds', 'Age of the oldest queued job.', 'gauge', [`waveworld_queue_oldest_queued_age_seconds ${stats.oldestQueuedAgeSeconds}`]));
    lines.push(...metric('waveworld_queue_expired_leases', 'Expired leases observed before the latest safe sweep.', 'gauge', [`waveworld_queue_expired_leases ${stats.expiredLeases}`]));
    for (const [kind, group] of Object.entries(stats.byKind)) {
      for (const status of ['queued', 'leased', 'running', 'failed', 'succeeded'] as const) lines.push(`waveworld_jobs_by_kind{kind="${label(kind)}",status="${status}"} ${group[status]}`);
    }
    lines.unshift('# HELP waveworld_jobs_by_kind Current jobs by finite protocol kind and status.', '# TYPE waveworld_jobs_by_kind gauge');
    lines.push(...metric('waveworld_jobs_completed_window', 'Terminal jobs in the fixed recent window.', 'gauge', [
      `waveworld_jobs_completed_window{status="succeeded",window="${stats.recent.windowSeconds}s"} ${stats.recent.succeeded}`,
      `waveworld_jobs_completed_window{status="failed",window="${stats.recent.windowSeconds}s"} ${stats.recent.failed}`,
    ]));
    lines.push(...metric('waveworld_job_duration_seconds', 'Recent terminal job duration aggregate.', 'gauge', [
      `waveworld_job_duration_seconds{aggregation="average",window="${stats.recent.windowSeconds}s"} ${stats.recent.averageDurationSeconds}`,
      `waveworld_job_duration_seconds{aggregation="maximum",window="${stats.recent.windowSeconds}s"} ${stats.recent.maximumDurationSeconds}`,
    ]));
    // Artifact volume: no GC exists — these gauges are the only ops signal
    // for unbounded disk growth on the origin. terminal_jobs counts rows whose
    // owning job settled failed/cancelled, including retained model inputs.
    lines.push(...metric('waveworld_artifacts', 'Stored artifacts after the retention sweep.', 'gauge', [`waveworld_artifacts ${stats.artifacts.total}`]));
    lines.push(...metric('waveworld_artifact_bytes', 'Total stored artifact bytes.', 'gauge', [`waveworld_artifact_bytes ${stats.artifacts.bytes}`]));
    lines.push(...metric('waveworld_artifacts_terminal_jobs', 'Artifacts bound to failed/cancelled jobs, including retained model inputs.', 'gauge', [`waveworld_artifacts_terminal_jobs ${stats.artifacts.terminalJobArtifacts}`]));
    return new Response(`${lines.join('\n')}\n`, {
      headers: METRICS_HEADERS_PROM,
    });
  } catch (error) {
    return new Response(`metrics unavailable: ${metricsSafeErrorMessage(error)}\n`, {
      status: 503,
      headers: METRICS_HEADERS_PLAIN,
    });
  }
}

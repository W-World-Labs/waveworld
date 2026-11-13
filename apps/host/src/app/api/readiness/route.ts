import { ensureTaskEnv } from '../../../lib/ensure-task-env';
import {
  assertHostLabUsabilityHonesty,
  hostLabUsabilityHonesty,
} from '../../../lib/lab-entry';
import {
  PROBE_NO_STORE_HEADERS,
  safeOperationalErrorMessage,
} from '../../../lib/safe-error-message';

export const runtime = 'nodejs';

/**
 * Dependency readiness. Unlike /api/health, a task DB failure is non-200.
 * `ok`/`ready` is Host task-DB readiness only — not L2 Lab full usability (#49).
 * Residual after 6d08a42: always pin readyScope=dependency=task-db on both paths
 * so operators never read ready=true as “Lab fully usable”.
 */
export async function GET() {
  const lab = hostLabUsabilityHonesty();
  assertHostLabUsabilityHonesty(lab);
  try {
    ensureTaskEnv();
    const { getSqlite } = await import('@/lib/tasks/db');
    const { getJobStats } = await import('@/lib/tasks/service');
    const probe = getSqlite().prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined;
    if (probe?.ok !== 1) throw new Error('task database probe returned an invalid response');
    const stats = getJobStats();
    // no-store: readiness is probe-only; never cache; body must never include secrets.
    // Residual after 59a3fa3: explicit `ready` alias (ok/ready = task-DB only, not Lab #49).
    // Residual after 6d08a42: readyScope + dependency always named (200 and 503).
    return Response.json(
      {
        ok: true,
        ready: true,
        status: 'ready',
        service: 'waveworld-host',
        /** What ready means: Host task SQLite only — not L2 Lab (#49). */
        readyScope: 'task-db',
        dependency: 'task-db',
        jobs: stats,
        lab,
        time: new Date().toISOString(),
      },
      {
        status: 200,
        headers: PROBE_NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        ready: false,
        status: 'not_ready',
        service: 'waveworld-host',
        readyScope: 'task-db',
        dependency: 'task-db',
        // Residual after a0c47ec: redact secret env values (same helper as metrics 503).
        error: safeOperationalErrorMessage(error),
        lab,
        time: new Date().toISOString(),
      },
      {
        status: 503,
        headers: PROBE_NO_STORE_HEADERS,
      },
    );
  }
}

/** Configure the task database and resume durable W-Compute work on Node servers. */
export async function register() {
  if (!process.env.TASK_DB_PATH) {
    const cwd = process.cwd().replace(/\\/g, '/');
    process.env.TASK_DB_PATH = cwd.endsWith('/apps/host')
      ? cwd.replace(/\/apps\/host$/, '/data/tasks.db') : `${cwd}/data/tasks.db`;
  }
  // Always start: with W-Compute disabled the tick finalizes orphaned
  // reservations instead of reconciling, so queued jobs cannot strand.
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build') {
    const { startComputeReconciler } = await import('./lib/tasks/w-compute');
    startComputeReconciler();
  }
}

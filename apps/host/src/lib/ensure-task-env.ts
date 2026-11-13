import path from 'path';

/**
 * Default task DB under WaveWorld data/ so host and agent share one queue.
 * Prefer env set by package scripts; only fill in if missing.
 */
export function ensureTaskEnv() {
  if (process.env.TASK_DB_PATH) return;

  const cwd = process.cwd();
  if (cwd.replace(/\\/g, '/').endsWith('/apps/host')) {
    process.env.TASK_DB_PATH = path.resolve(cwd, '../../data/tasks.db');
    return;
  }
  process.env.TASK_DB_PATH = path.resolve(cwd, 'data/tasks.db');
}

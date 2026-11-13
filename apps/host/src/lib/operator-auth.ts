import { sameSecret } from './safe-error-message';

/** Operator x-api-key only — Atlas user sessions are not operators (#66). */
export function isOperatorRequest(req: Request): boolean {
  const key = process.env.TASK_API_KEY?.trim();
  if (!key) return false;
  return sameSecret(req.headers.get('x-api-key'), key);
}

/**
 * Metrics / jobs-stats gate.
 * Production: operator key required.
 * Non-production: open unless JOB_REQUIRE_AUTH=1.
 */
export function allowOperatorProbe(req: Request): boolean {
  if (isOperatorRequest(req)) return true;
  if (process.env.TASK_API_KEY?.trim()) return false;
  return process.env.NODE_ENV !== 'production' && process.env.JOB_REQUIRE_AUTH !== '1';
}

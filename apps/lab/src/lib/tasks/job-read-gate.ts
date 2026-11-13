import { sameSecret } from '../../../../host/src/lib/safe-error-message';
import { authenticateAgent } from './auth-agent';

/**
 * Leftover Lab job reads (/app/lab/api/v1/jobs, /:id, /stats).
 * Open only outside production. JOB_REQUIRE_AUTH=1 closes every environment.
 * A missing TASK_API_KEY never counts as an operator.
 */
export function allowOpenJobRead(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (env.JOB_REQUIRE_AUTH === '1' || env.JOB_REQUIRE_AUTH === 'true') return false;
  return env.NODE_ENV !== 'production';
}

export function operatorMayReadJobs(
  req: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const key = env.TASK_API_KEY?.trim();
  if (!key) return false;
  return sameSecret(req.headers.get('x-api-key'), key);
}

export function mayReadLabJobQueue(
  req: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (allowOpenJobRead(env)) return true;
  return operatorMayReadJobs(req, env);
}

/** Single-job read: operator key, or the agent that currently holds the job. */
export function mayReadLabJob(
  req: Request,
  job: { agentId: string | null },
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (allowOpenJobRead(env)) return true;
  if (operatorMayReadJobs(req, env)) return true;
  const agent = authenticateAgent(req.headers.get('authorization'));
  return !!agent && !!job.agentId && job.agentId === agent.id;
}

export const LAB_JOB_READ_CACHE = { 'Cache-Control': 'no-store' } as const;

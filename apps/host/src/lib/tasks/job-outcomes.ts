import type Database from 'better-sqlite3';
import type { JobResultV1 } from '@/types/task';

export type JobHostOutcome = { jobId: string } & (
  | { status: 'succeeded'; result: JobResultV1 }
  | { status: 'failed'; error: string }
  | { status: 'cancelled' }
  | { status: 'queued' }
);

export function hostOutcome(jobId: string, status: string, result: JobResultV1 | null, error: string | null): JobHostOutcome {
  if (status === 'succeeded' && result) return { jobId, status, result };
  if (status === 'failed' && typeof error === 'string') return { jobId, status, error };
  if (status === 'cancelled') return { jobId, status };
  if (status === 'queued') return { jobId, status };
  throw new Error(`Cannot create terminal Host outcome for ${jobId}: ${status}`);
}

export function storeAttemptOutcome(
  sqlite: Database.Database,
  input: { jobId: string; attempt: number; agentId: string; outcome: JobHostOutcome; createdAt: string },
): void {
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 0 || input.outcome.jobId !== input.jobId) {
    throw new Error('Invalid Host attempt receipt identity');
  }
  sqlite.prepare(`
    INSERT INTO job_attempt_outcomes (job_id, attempt, agent_id, outcome, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (job_id, attempt) DO NOTHING
  `).run(input.jobId, input.attempt, input.agentId, JSON.stringify(input.outcome), input.createdAt);
  const saved = sqlite.prepare(`
    SELECT agent_id, outcome FROM job_attempt_outcomes WHERE job_id = ? AND attempt = ?
  `).get(input.jobId, input.attempt) as { agent_id: string; outcome: string } | undefined;
  if (!saved || saved.agent_id !== input.agentId || saved.outcome !== JSON.stringify(input.outcome)) {
    throw new Error('Conflicting immutable Host attempt receipt');
  }
}

export function readAttemptOutcome(
  sqlite: Database.Database,
  input: { jobId: string; attempt: number; agentId: string },
): JobHostOutcome | null {
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 0) return null;
  const row = sqlite.prepare(`
    SELECT outcome FROM job_attempt_outcomes
    WHERE job_id = ? AND attempt = ? AND agent_id = ?
  `).get(input.jobId, input.attempt, input.agentId) as { outcome: string } | undefined;
  if (!row) return null;
  const parsed: unknown = JSON.parse(row.outcome);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || (parsed as { jobId?: unknown }).jobId !== input.jobId) {
    throw new Error('Corrupt Host attempt receipt');
  }
  return parsed as JobHostOutcome;
}

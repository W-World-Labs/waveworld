/**
 * Per-job run telemetry and fallback-reason plumbing for the claim loop.
 *
 * The agent processes one claimed job at a time, so a single module-scoped
 * slot is correct; begin/drain keeps any cross-run residue honest.
 *
 * Every job attempt emits one grep-able JSON line:
 *   [agent:telemetry] {"event":"agent.run","request_id":"...","cuda_used":true,...}
 * `grep '\[agent:telemetry\]'` answers whether a run went through CUDA,
 * fell back, or failed — without parsing nested result payloads.
 */

import { isCudaResultBackendId } from './backends/native-cuda.ts';
import { resolveAgentBuildProvenance } from './build-provenance.ts';
import { finishAgentTrace } from './radar-telemetry.ts';

export interface RunTelemetry {
  event: 'agent.run';
  /** Claimed job id — the canonical per-request identity. */
  request_id: string;
  kind: string;
  /** spec.requirements.backends (ANY-OF), as submitted. */
  backend_requested: readonly string[];
  /** W_SIM_BACKEND env at run time (preference, not a spec override). */
  backend_preference: string;
  backend_used: string | null;
  cuda_used: boolean;
  device: string | null;
  latency_ms: number;
  /** Non-null whenever the run executed on a weaker backend than preferred/attempted. */
  fallback_reason: string | null;
  git_sha: string;
  status: 'completed' | 'failed' | 'cancelled' | 'lease_lost' | 'requeued';
  error?: string;
}

let active: { fallbacks: string[] } | null = null;

/** Open the telemetry context for one claimed job (resets fallback capture). */
export function beginRunTelemetry(): void {
  active = { fallbacks: [] };
}

/**
 * Record a backend degradation from inside a runner — called where a cuda
 * attempt (probe or exec) fails and the spec permits a weaker backend.
 * Warns immediately so a stuck GPU is visible before the job finishes;
 * no-op outside a run context.
 */
export function recordFallback(reason: string): void {
  const clean = reason.replace(/\s+/g, ' ').trim().slice(0, 500);
  active?.fallbacks.push(clean);
  console.warn(`[agent:fallback] ${clean}`);
}

/** Drain captured fallback reasons into one telemetry string (null when none). */
export function drainFallbackReason(): string | null {
  const reasons = active?.fallbacks ?? [];
  return reasons.length ? reasons.join('; ') : null;
}

export function endRunTelemetry(): void {
  active = null;
}

let cachedGitSha: string | null = null;

/** Deployment build identity — never throws; telemetry must not break the loop. */
export function agentGitSha(): string {
  if (cachedGitSha) return cachedGitSha;
  try {
    cachedGitSha = resolveAgentBuildProvenance().agentBuildId;
  } catch {
    cachedGitSha = process.env.GIT_SHA ?? process.env.WAVEWORLD_BUILD_ID ?? 'unknown';
  }
  return cachedGitSha;
}

export function cudaBackendUsed(backendId: string | null | undefined): boolean {
  return backendId != null && isCudaResultBackendId(backendId);
}

export function emitRunTelemetry(t: RunTelemetry): void {
  finishAgentTrace(t.status, {
    backend: t.backend_used,
    error: t.error,
    gitSha: t.git_sha,
  });
  console.log(`[agent:telemetry] ${JSON.stringify(t)}`);
}

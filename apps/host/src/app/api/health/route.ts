import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ensureTaskEnv } from '../../../lib/ensure-task-env';
import {
  assertHostLabUsabilityHonesty,
  hostLabUsabilityHonesty,
} from '../../../lib/lab-entry';
import { PROBE_NO_STORE_HEADERS } from '../../../lib/safe-error-message';

export const runtime = 'nodejs';

/** Process start (module load) for uptimeSeconds in health probes. */
const STARTED_MS = Date.now();

function readHostVersion(): string {
  try {
    const candidates = [
      path.join(process.cwd(), 'package.json'),
      path.join(process.cwd(), 'apps/host/package.json'),
    ];
    for (const p of candidates) {
      try {
        const pkg = JSON.parse(readFileSync(p, 'utf8')) as {
          name?: string;
          version?: string;
        };
        if (!pkg.version) continue;
        // Prefer waveworld-host; accept cwd package when started from apps/host
        if (pkg.name === 'waveworld-host' || p.includes(`${path.sep}apps${path.sep}host`)) {
          return pkg.version;
        }
      } catch {
        /* try next */
      }
    }
  } catch {
    /* ignore */
  }
  return process.env.npm_package_version?.trim() || '0.0.0';
}

function readBuildId(): string | undefined {
  const id =
    process.env.BUILD_ID?.trim() ||
    process.env.WAVEWORLD_BUILD_ID?.trim() ||
    process.env.GIT_SHA?.trim() ||
    process.env.GITHUB_SHA?.trim();
  return id || undefined;
}

/**
 * Phase 1+ health probe — WaveWorld host is up and serving API.
 * Includes optional job queue counters when the task DB is available.
 * Returns package version, process uptime, and optional build id for deploy checks.
 *
 * `ok` / `status: healthy` means the Host process answers — not that L2 Lab
 * is fully production-usable. See `lab` (#49 honesty) for that distinction.
 * Residual after 1b367e7: always pin okScope=process so operators never read
 * health ok as task-DB ready or Lab fully usable (contrast readiness readyScope=task-db).
 */
export async function GET() {
  let jobs:
    | {
        queued: number;
        leased: number;
        running: number;
        failed: number;
        succeeded: number;
        cancelled: number;
        total: number;
        leaseSeconds: number;
      }
    | undefined;
  try {
    ensureTaskEnv();
    const { getJobStats } = await import('@/lib/tasks/service');
    jobs = getJobStats();
  } catch {
    /* health stays green if DB is not ready */
  }

  const version = readHostVersion();
  const buildId = readBuildId();
  const uptimeSeconds = Math.max(0, Math.floor((Date.now() - STARTED_MS) / 1000));
  const { allowDevLogin, getOidcPublicConfig } = await import('../../../lib/user-auth');
  const identityFeatures = [
    ...(allowDevLogin() ? ['dev-login'] : []),
    ...(getOidcPublicConfig().configured ? ['oidc'] : []),
  ];
  const lab = hostLabUsabilityHonesty();
  // Structural guard: ship fails closed if honesty ever claims full Lab usable while #49 open.
  assertHostLabUsabilityHonesty(lab);

  // no-store: never cache honesty / process identity (and never put secrets in body).
  // Residual after 59a3fa3: shared PROBE_NO_STORE_HEADERS with readiness/auth-config.
  return Response.json(
    {
      ok: true,
      status: 'healthy',
      service: 'waveworld-host',
      /** What ok means: Host process answers — not task-DB ready, not Lab fully usable (#49). */
      okScope: 'process',
      version,
      uptimeSeconds,
      ...(buildId ? { buildId } : {}),
      phase: 3,
      features: [
        'jobs',
        'agents',
        'ontology',
        'goals-meta',
        ...identityFeatures,
        'session-cookie',
        'artifacts',
        'projects',
        'job-stats',
        'evidence-import',
        'audit-manifests',
        'scoped-job-shares',
        'readiness-metrics',
        'lab-usability-honesty',
      ],
      /** L2 honesty: host healthy ≠ Lab fully usable while #49 open. */
      lab,
      time: new Date().toISOString(),
      ...(jobs ? { jobs } : {}),
    },
    {
      status: 200,
      headers: PROBE_NO_STORE_HEADERS,
    },
  );
}

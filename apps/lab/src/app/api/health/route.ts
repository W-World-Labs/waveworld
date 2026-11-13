import { readFileSync } from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';

/** Process start (module load) for uptimeSeconds in health probes. */
const STARTED_MS = Date.now();

function readLabVersion(): string {
  try {
    const candidates = [
      path.join(process.cwd(), 'package.json'),
      path.join(process.cwd(), 'apps/lab/package.json'),
    ];
    for (const p of candidates) {
      try {
        const pkg = JSON.parse(readFileSync(p, 'utf8')) as {
          name?: string;
          version?: string;
        };
        if (!pkg.version) continue;
        if (
          pkg.name === 'waveworld-lab' ||
          pkg.name === 'tuanliu' ||
          p.includes(`${path.sep}lab${path.sep}package.json`)
        ) {
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
    process.env.GITHUB_SHA?.trim() ||
    process.env.NEXT_PUBLIC_WAVEWORLD_BUILD_ID?.trim() ||
    process.env.NEXT_PUBLIC_BUILD_ID?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  return id || undefined;
}

/**
 * Liveness probe for tuanliu Lab (Next App Router).
 * Public path under production basePath: `/app/lab/api/health`
 * (Next basePath prefixes; this route is app-relative `/api/health`).
 * No secrets; DB/agent failure must not make liveness fail.
 */
export async function GET() {
  const version = readLabVersion();
  const buildId = readBuildId();
  const uptimeSeconds = Math.max(0, Math.floor((Date.now() - STARTED_MS) / 1000));
  const basePath =
    (process.env.TUANLIU_BASE_PATH || process.env.BASE_PATH || process.env.NEXT_PUBLIC_TUANLIU_BASE_PATH || '')
      .replace(/\/$/, '') || undefined;

  return Response.json(
    {
      ok: true,
      status: 'healthy',
      service: 'tuanliu-lab',
      version,
      uptimeSeconds,
      ...(buildId ? { buildId } : {}),
      ...(basePath ? { basePath } : {}),
      time: new Date().toISOString(),
    },
    { status: 200 },
  );
}

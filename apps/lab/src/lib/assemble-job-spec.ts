/**
 * Leftover Lab jobs API is not the product jobs plane (#89 / #90).
 * Canonical assemble + create lives on Host :3001.
 * This module stays inside apps/lab so Next typecheck does not pull
 * WaveWorld knowledge-db `.ts` imports.
 */

export const CANONICAL_HOST_JOBS_PATH = '/api/v1/jobs';

/** Server-side fetch target. Loopback is a development default only. */
export function resolveCanonicalHostJobsUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = (env.WAVEWORLD_HOST_URL || env.TASK_API_URL || '').trim()
  const base = (configured || (env.NODE_ENV === 'production' ? '' : 'http://127.0.0.1:3001'))
    .trim()
    .replace(/\/$/, '');
  if (!base) throw new Error('WAVEWORLD_HOST_URL or TASK_API_URL is required in production')
  return `${base}${CANONICAL_HOST_JOBS_PATH}`;
}

function configuredJobsBase(env: NodeJS.ProcessEnv): string {
  return (env.WAVEWORLD_HOST_URL || env.TASK_API_URL || '').trim().replace(/\/$/, '');
}

/** True when a base must not be copied onto a public response. */
export function jobsBaseIsAdvertisable(base: string): boolean {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return false;
  }
  return true;
}

/**
 * Successor cited by public Lab responses (Link, X-WaveWorld-Canonical-Jobs,
 * client 400 text). Loopback, private, and non-https bases stay server-side;
 * callers then get the same-origin `/api/v1/jobs` path the edge already
 * routes to Host.
 */
export function resolvePublicJobsSuccessor(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = configuredJobsBase(env);
  if (!configured || !jobsBaseIsAdvertisable(configured)) return CANONICAL_HOST_JOBS_PATH;
  return `${new URL(configured).origin}${CANONICAL_HOST_JOBS_PATH}`;
}

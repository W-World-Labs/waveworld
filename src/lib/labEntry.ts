/**
 * Pure Lab / sim-entry URL decisions (P5-A UX).
 * Unit-tested without mounting React; hostApi.ts wraps env + window.
 */

export type LabResolveInput = {
  /** VITE_LAB_URL / NEXT_PUBLIC_LAB_URL (may include path prefix e.g. …/app/lab) */
  envLabUrl?: string | null
  hostname?: string
  port?: string
  origin?: string
}

export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    hostname === ''
  )
}

export function isLoopbackBase(url: string): boolean {
  try {
    const u = new URL(url.includes('://') ? url : `http://${url}`)
    return isLoopbackHostname(u.hostname)
  } catch {
    return /127\.0\.0\.1|localhost|\[::1\]|::1/i.test(url)
  }
}

export function isViteDevPort(port: string | undefined): boolean {
  return port === '5173' || port === '4173' || port === '4174'
}

/** Browser clients use the app's same-origin ingress. Local Next Lab needs a
 * private rewrite prefix because it still owns legacy /api routes. */
export function resolveHostApiBase(input: { hostname?: string; port?: string } = {}): string {
  const hostname = input.hostname ?? ''
  if (isLoopbackHostname(hostname) && input.port === '3000') return '/host-api'
  // Vite proxies /api in dev/preview; production ingress already routes /api
  // to Host. Keep browser requests on their current origin for W-ID cookies.
  return ''
}

/**
 * Base URL of the tuanliu Lab app (no trailing slash).
 * Shared by Atlas and Host (#90). Does not append the `/lab` page segment.
 *
 * 1. Non-loopback env wins.
 * 2. Public page + loopback/empty env → same-origin `/app/lab` (never expose loopback).
 * 3. Loopback / Vite page → env if set, else `http://127.0.0.1:3000`.
 */
export function resolveLabUiBase(input: LabResolveInput = {}): string {
  const env = (input.envLabUrl ?? '').trim().replace(/\/$/, '')
  const hostname = input.hostname ?? ''
  const port = input.port ?? ''
  const origin = (input.origin ?? '').replace(/\/$/, '')

  const local = isLoopbackHostname(hostname)
  const vite = isViteDevPort(port)

  if (env && !isLoopbackBase(env)) return env

  if (!local && !vite && origin) {
    return `${origin}/app/lab`
  }

  if (env) return env

  // Prerender / SSR has no window host.  Baking loopback here made public
  // /lab iframe http://127.0.0.1:3000 (blocked by frame-src 'self').
  if (!hostname && !origin) {
    return '/app/lab'
  }

  if (local || vite) {
    return 'http://127.0.0.1:3000'
  }

  return ''
}

/**
 * True when the Lab base is reachable from this browser context
 * (public URL always; loopback only when the page itself is loopback).
 */
export function resolveIsLabUiConfigured(input: LabResolveInput = {}): boolean {
  const base = resolveLabUiBase(input)
  if (!base) return false
  const loopback = /127\.0\.0\.1|localhost|\[::1\]|::1/i.test(base)
  if (!loopback) return true
  const hostname = input.hostname ?? ''
  // Outside browser (tests / SSR): allow loopback default
  if (!hostname && !input.origin) return true
  return isLoopbackHostname(hostname)
}

/**
 * Full page URL for the engineering Lab (tuanliu `/lab` route under basePath).
 * null when Lab should not be embedded/opened for this context.
 */
export function resolveFullLabPageUrl(input: LabResolveInput = {}): string | null {
  if (!resolveIsLabUiConfigured(input)) return null
  const base = resolveLabUiBase(input)
  if (!base) return null
  return `${base.replace(/\/$/, '')}/lab`
}

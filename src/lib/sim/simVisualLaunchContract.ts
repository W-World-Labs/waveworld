/**
 * Pure launch-contract helpers for L0 sim visual smoke (#32 launch-contract-bar).
 * Extracted from e2e/sim-visual-launch.spec.ts so Vitest can gate launch metadata
 * without Playwright / browser. Playwright re-imports these predicates.
 */

import {
  SIM_CAPABILITY_CATALOG,
  type SimCapability,
  type SimMode,
  type SimRenderer,
} from './simCapabilityCatalog'

/** Modes that step or interact — must stay launch-smoke ready (first paint + stage). */
export const INTERACTIVE_LAUNCH_MODES: readonly SimMode[] = ['stepped', 'interactive'] as const

/**
 * Visible stage selectors used by Playwright `assertVisibleStage`.
 * Keep CSS fragments pure so unit tests pin the contract without a browser.
 */
export const SIM_VISIBLE_STAGE_SELECTORS: readonly string[] = [
  '#root canvas',
  '#root svg',
  '#root iframe',
  '#root [role="img"]',
  '#root .stage',
  '#root [data-sim-stage]',
] as const

/** Combined CSS selector for any expected visual stage node. */
export function simVisibleStageSelector(): string {
  return SIM_VISIBLE_STAGE_SELECTORS.join(', ')
}

/** Attached fallback when a11y visibility is flaky (WebGL canvas). */
export const SIM_VISIBLE_STAGE_ATTACHED_FALLBACK =
  '#root canvas, #root [data-sim-stage]' as const

/** Bare nav path slug: lowercase alnum + hyphen (matches catalog + nav). */
export function isSimNavPathSlug(path: string): boolean {
  return /^[a-z0-9-]+$/.test(path)
}

/** Absolute launch path: `/` + bare slug. */
export function isSimLaunchAbsPath(path: string): boolean {
  return /^\/[a-z0-9-]+$/.test(path)
}

/** `/${navPath}` for a catalog/nav bare path. */
export function toSimLaunchAbsPath(navPath: string): string {
  return `/${navPath}`
}

export function isInteractiveLaunchMode(mode: SimMode): boolean {
  return mode === 'stepped' || mode === 'interactive'
}

/**
 * Console noise that must not fail visual launch smoke (headless / optional host).
 * Mirrors e2e/sim-visual-launch.spec.ts historical filters.
 */
export function isBenignSimVisualConsole(text: string): boolean {
  const t = text.toLowerCase()
  if (
    t.includes('webgpu') &&
    (t.includes('not supported') || t.includes('failed to get') || t.includes('no adapter'))
  ) {
    return true
  }
  if (t.includes('webgl') && (t.includes('disabled') || t.includes('not supported'))) return true
  if (t.includes('fonts.googleapis.com') || t.includes('fonts.gstatic.com')) return true
  if (t.includes('react router future flag')) return true
  // Host API optional on preview — failed health is soft noise for visual shell
  if (t.includes('failed to fetch') && (t.includes('health') || t.includes('api'))) return true
  if (t.includes('cors policy') && t.includes('/api/')) return true
  // Chromium duplicates HTTP/network failures as URL-less console errors. The
  // Playwright capture gates the corresponding response/request URL instead.
  if (t.includes('failed to load resource')) return true
  if (t.includes('net::err_') || t.includes('load failed')) return true
  return false
}

/**
 * Whether a failed HTTP response URL should be ignored during visual launch
 * (fonts / optional same-origin API without host). Pure predicate for e2e.
 */
export function isBenignSimVisualFailedResponseUrl(url: string): boolean {
  if (/fonts\.googleapis|fonts\.gstatic|google/.test(url)) return true
  if (/\/api\//.test(url)) return true
  return false
}

/** Renderers that can host a visible stage under #root. */
export function rendererCanHostVisibleStage(renderer: SimRenderer): boolean {
  return (
    renderer === 'canvas2d' ||
    renderer === 'three' ||
    renderer === 'svg' ||
    renderer === 'iframe' ||
    renderer === 'mixed' ||
    renderer === 'dom'
  )
}

/** Minimal launch row shape shared by catalog + e2e SIM_VISUAL_ROUTES. */
export type SimLaunchRouteLike = {
  path: string
  navPath: string
  label?: string
  hasVisibleStage: boolean
  tier: SimCapability['tier']
  hqModuleId?: string
  renderer: SimRenderer
}

export type SimLaunchContractIssue = {
  path: string
  code: string
  detail: string
}

/**
 * Launch-metadata contract for a single stepped/interactive capability.
 * Returns issues (empty = pass). Pure — no DOM, no network.
 */
export function launchMetadataIssues(
  cap: SimCapability,
  route?: SimLaunchRouteLike | null,
): SimLaunchContractIssue[] {
  const issues: SimLaunchContractIssue[] = []
  const p = cap.path

  if (!isInteractiveLaunchMode(cap.mode)) {
    return issues
  }

  if (!isSimNavPathSlug(p)) {
    issues.push({ path: p, code: 'nav-slug', detail: `invalid nav path slug: ${p}` })
  }

  if (!cap.hasVisibleStage) {
    issues.push({
      path: p,
      code: 'visible-stage',
      detail: `${cap.mode} leaf must have hasVisibleStage=true for launch smoke`,
    })
  }

  if (cap.requiresClickForContent) {
    issues.push({
      path: p,
      code: 'click-for-content',
      detail: `${cap.mode} leaf must not require click for first content (launch smoke)`,
    })
  }

  if (!rendererCanHostVisibleStage(cap.renderer)) {
    issues.push({
      path: p,
      code: 'renderer',
      detail: `renderer ${cap.renderer} cannot host a visible stage`,
    })
  }

  if (cap.engine.trim().length < 3) {
    issues.push({ path: p, code: 'engine', detail: 'engine id/path too short' })
  }

  // Stepped sims are time-evolving: pause + reset are part of the industrial control bar.
  if (cap.mode === 'stepped') {
    if (!cap.supportsPause) {
      issues.push({
        path: p,
        code: 'stepped-pause',
        detail: 'stepped mode expects supportsPause=true',
      })
    }
    if (!cap.supportsReset) {
      issues.push({
        path: p,
        code: 'stepped-reset',
        detail: 'stepped mode expects supportsReset=true',
      })
    }
  }

  if (route) {
    if (route.navPath !== cap.path) {
      issues.push({
        path: p,
        code: 'route-navPath',
        detail: `route.navPath ${route.navPath} !== cap.path ${cap.path}`,
      })
    }
    if (route.path !== toSimLaunchAbsPath(cap.path)) {
      issues.push({
        path: p,
        code: 'route-abs-path',
        detail: `route.path ${route.path} !== ${toSimLaunchAbsPath(cap.path)}`,
      })
    }
    if (!isSimLaunchAbsPath(route.path)) {
      issues.push({
        path: p,
        code: 'route-abs-slug',
        detail: `route.path not absolute launch slug: ${route.path}`,
      })
    }
    if (route.hasVisibleStage !== cap.hasVisibleStage) {
      issues.push({
        path: p,
        code: 'route-hasVisibleStage',
        detail: `route.hasVisibleStage ${route.hasVisibleStage} !== catalog ${cap.hasVisibleStage}`,
      })
    }
    if (route.tier !== cap.tier) {
      issues.push({
        path: p,
        code: 'route-tier',
        detail: `route.tier ${route.tier} !== catalog ${cap.tier}`,
      })
    }
    if (route.renderer !== cap.renderer) {
      issues.push({
        path: p,
        code: 'route-renderer',
        detail: `route.renderer ${route.renderer} !== catalog ${cap.renderer}`,
      })
    }
    if (route.hqModuleId !== cap.hqModuleId) {
      issues.push({
        path: p,
        code: 'route-hqModuleId',
        detail: `route.hqModuleId ${route.hqModuleId} !== catalog ${cap.hqModuleId}`,
      })
    }
  } else {
    issues.push({
      path: p,
      code: 'missing-route',
      detail: 'no matching SIM_VISUAL_ROUTES entry for interactive launch leaf',
    })
  }

  return issues
}

/** Catalog rows that must pass the interactive launch contract. */
export function interactiveLaunchCapabilities(): readonly SimCapability[] {
  return SIM_CAPABILITY_CATALOG.filter((c) => isInteractiveLaunchMode(c.mode))
}

/**
 * Collect launch-contract issues for every stepped/interactive catalog leaf
 * against an optional visual-route map keyed by bare nav path.
 */
export function collectInteractiveLaunchIssues(
  routesByNavPath: Map<string, SimLaunchRouteLike> | ReadonlyMap<string, SimLaunchRouteLike>,
): SimLaunchContractIssue[] {
  const out: SimLaunchContractIssue[] = []
  for (const cap of interactiveLaunchCapabilities()) {
    out.push(...launchMetadataIssues(cap, routesByNavPath.get(cap.path) ?? null))
  }
  return out
}

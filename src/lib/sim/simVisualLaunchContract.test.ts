/**
 * L0 launch-contract bar (#32 launch-contract-bar).
 * Pure Vitest: stepped/interactive catalog leaves keep launch metadata consistent
 * with e2e SIM_VISUAL_ROUTES (hasVisibleStage, path, tier, renderer, …).
 * Does not run Playwright.
 */
import { describe, expect, it } from 'vitest'
import {
  SIM_CAPABILITY_CATALOG,
  simCapabilityByPath,
  type SimCapability,
} from './simCapabilityCatalog'
import {
  SIM_VISUAL_ROUTES,
  type SimVisualRoute,
} from '../../../e2e/sim-visual-routes'
import {
  INTERACTIVE_LAUNCH_MODES,
  SIM_VISIBLE_STAGE_ATTACHED_FALLBACK,
  SIM_VISIBLE_STAGE_SELECTORS,
  collectInteractiveLaunchIssues,
  interactiveLaunchCapabilities,
  isBenignSimVisualConsole,
  isBenignSimVisualFailedResponseUrl,
  isInteractiveLaunchMode,
  isSimLaunchAbsPath,
  isSimNavPathSlug,
  launchMetadataIssues,
  rendererCanHostVisibleStage,
  simVisibleStageSelector,
  toSimLaunchAbsPath,
  type SimLaunchRouteLike,
} from './simVisualLaunchContract'

function routesByNavPath(): Map<string, SimLaunchRouteLike> {
  return new Map(
    SIM_VISUAL_ROUTES.map((r: SimVisualRoute) => [
      r.navPath,
      {
        path: r.path,
        navPath: r.navPath,
        label: r.label,
        hasVisibleStage: r.hasVisibleStage,
        tier: r.tier,
        hqModuleId: r.hqModuleId,
        renderer: r.renderer,
      } satisfies SimLaunchRouteLike,
    ]),
  )
}

describe('sim visual launch contract (#32 launch-contract-bar)', () => {
  const interactive = interactiveLaunchCapabilities()
  const byNav = routesByNavPath()

  it('exposes stepped+interactive as the interactive launch mode set', () => {
    expect(INTERACTIVE_LAUNCH_MODES).toEqual(['stepped', 'interactive'])
    expect(isInteractiveLaunchMode('stepped')).toBe(true)
    expect(isInteractiveLaunchMode('interactive')).toBe(true)
    expect(isInteractiveLaunchMode('parametric')).toBe(false)
    expect(isInteractiveLaunchMode('gateway')).toBe(false)
    expect(isInteractiveLaunchMode('catalog')).toBe(false)
  })

  it('lists every stepped/interactive catalog leaf (non-empty, no duplicates)', () => {
    expect(interactive.length).toBeGreaterThanOrEqual(20)
    const paths = interactive.map((c) => c.path)
    expect(new Set(paths).size).toBe(paths.length)
    for (const c of SIM_CAPABILITY_CATALOG) {
      if (c.mode === 'stepped' || c.mode === 'interactive') {
        expect(paths).toContain(c.path)
      } else {
        expect(paths).not.toContain(c.path)
      }
    }
  })

  it('every stepped/interactive leaf has consistent launch metadata vs SIM_VISUAL_ROUTES', () => {
    const issues = collectInteractiveLaunchIssues(byNav)
    expect(issues, issues.map((i) => `${i.path}:${i.code}:${i.detail}`).join('\n')).toEqual([])
  })

  it('per-leaf: path, hasVisibleStage, tier, renderer, no click-to-seed', () => {
    for (const cap of interactive) {
      const route = byNav.get(cap.path)
      expect(route, `visual route for /${cap.path}`).toBeDefined()
      const leafIssues = launchMetadataIssues(cap, route)
      expect(
        leafIssues,
        leafIssues.map((i) => `${i.code}:${i.detail}`).join('; '),
      ).toEqual([])

      expect(cap.hasVisibleStage).toBe(true)
      expect(cap.requiresClickForContent).toBe(false)
      expect(isSimNavPathSlug(cap.path)).toBe(true)
      expect(route!.path).toBe(toSimLaunchAbsPath(cap.path))
      expect(isSimLaunchAbsPath(route!.path)).toBe(true)
      expect(route!.hasVisibleStage).toBe(true)
      expect(route!.renderer).toBe(cap.renderer)
      expect(route!.tier).toBe(cap.tier)
      expect(rendererCanHostVisibleStage(cap.renderer)).toBe(true)
    }
  })

  it('stepped leaves support pause+reset; all interactive leaves keep engine ids', () => {
    for (const cap of interactive) {
      expect(cap.engine.trim().length).toBeGreaterThan(3)
      if (cap.mode === 'stepped') {
        expect(cap.supportsPause, `/${cap.path} stepped pause`).toBe(true)
        expect(cap.supportsReset, `/${cap.path} stepped reset`).toBe(true)
      }
    }
  })

  it('stage selector contract matches Playwright assertVisibleStage targets', () => {
    expect(SIM_VISIBLE_STAGE_SELECTORS.length).toBeGreaterThanOrEqual(4)
    expect(SIM_VISIBLE_STAGE_SELECTORS).toContain('#root canvas')
    expect(SIM_VISIBLE_STAGE_SELECTORS).toContain('#root svg')
    expect(SIM_VISIBLE_STAGE_SELECTORS).toContain('#root iframe')
    expect(SIM_VISIBLE_STAGE_SELECTORS).toContain('#root [data-sim-stage]')
    const joined = simVisibleStageSelector()
    expect(joined).toContain('#root canvas')
    expect(joined.split(', ').length).toBe(SIM_VISIBLE_STAGE_SELECTORS.length)
    expect(SIM_VISIBLE_STAGE_ATTACHED_FALLBACK).toContain('#root canvas')
    expect(SIM_VISIBLE_STAGE_ATTACHED_FALLBACK).toContain('[data-sim-stage]')
  })

  it('isBenignSimVisualConsole filters headless / optional-host noise only', () => {
    expect(isBenignSimVisualConsole('WebGPU is not supported in this browser')).toBe(true)
    expect(isBenignSimVisualConsole('WebGPU: failed to get GPU adapter')).toBe(true)
    expect(isBenignSimVisualConsole('WebGPU: no adapter')).toBe(true)
    expect(isBenignSimVisualConsole('WebGL disabled')).toBe(true)
    expect(isBenignSimVisualConsole('fonts.googleapis.com 404')).toBe(true)
    expect(isBenignSimVisualConsole('React Router Future Flag Warning')).toBe(true)
    expect(isBenignSimVisualConsole('Failed to fetch /api/health')).toBe(true)
    expect(
      isBenignSimVisualConsole(
        "Access to fetch at 'http://127.0.0.1:3001/api/health' has been blocked by CORS policy",
      ),
    ).toBe(true)
    expect(
      isBenignSimVisualConsole(
        'Failed to load resource: the server responded with a status of 404 (Not Found)',
      ),
    ).toBe(true)
    expect(isBenignSimVisualConsole('net::ERR_CONNECTION_REFUSED')).toBe(true)
    expect(isBenignSimVisualConsole('TypeError: Cannot read properties of null')).toBe(false)
    expect(isBenignSimVisualConsole('Uncaught ReferenceError: x is not defined')).toBe(false)
  })

  it('isBenignSimVisualFailedResponseUrl ignores fonts and /api/ only', () => {
    expect(isBenignSimVisualFailedResponseUrl('https://fonts.gstatic.com/s/x.woff2')).toBe(true)
    expect(isBenignSimVisualFailedResponseUrl('http://localhost:4173/api/health')).toBe(true)
    expect(isBenignSimVisualFailedResponseUrl('http://localhost:4173/assets/index.js')).toBe(
      false,
    )
  })

  it('path helpers round-trip bare nav ↔ absolute launch path', () => {
    expect(toSimLaunchAbsPath('fdtd')).toBe('/fdtd')
    expect(isSimLaunchAbsPath('/fdtd')).toBe(true)
    expect(isSimLaunchAbsPath('fdtd')).toBe(false)
    expect(isSimLaunchAbsPath('/FDTD')).toBe(false)
    expect(isSimNavPathSlug('em-wave')).toBe(true)
    expect(isSimNavPathSlug('/em-wave')).toBe(false)
  })

  it('launchMetadataIssues flags a broken synthetic leaf (negative fixture)', () => {
    const bad: SimCapability = {
      path: 'Bad_Path',
      mode: 'stepped',
      renderer: 'canvas2d',
      backend: 'cpu',
      engine: '',
      hasVisibleStage: false,
      supportsPause: false,
      supportsReset: false,
      requiresClickForContent: true,
      tier: 'legacy',
      hqModuleId: 'x',
      hqKind: 'field',
    }
    const codes = launchMetadataIssues(bad, null).map((i) => i.code).sort()
    expect(codes).toContain('nav-slug')
    expect(codes).toContain('visible-stage')
    expect(codes).toContain('click-for-content')
    expect(codes).toContain('stepped-pause')
    expect(codes).toContain('stepped-reset')
    expect(codes).toContain('engine')
    expect(codes).toContain('missing-route')
  })

  it('spectrum + FDTD interactive launch leaves stay first-paint honest', () => {
    for (const path of ['electromagnetic', 'sound', 'vibration', 'fdtd'] as const) {
      const cap = simCapabilityByPath(path)
      expect(cap, path).toBeDefined()
      expect(isInteractiveLaunchMode(cap!.mode)).toBe(true)
      expect(launchMetadataIssues(cap!, byNav.get(path))).toEqual([])
    }
  })
})

/**
 * Sim-domain visual launch routes — driven from shipped catalog + nav
 * (single industrial source). Playwright imports this for full sim coverage.
 * Vitest L0 bar (#32 e2e-routes-bar) imports assertSimVisualCoverageComplete
 * so the isomorphic contract is gated without a full Playwright run.
 */
import { ALL_LEAVES } from '../src/nav'
import {
  SIM_CAPABILITY_CATALOG,
  type SimCapability,
  simCatalogPaths,
} from '../src/lib/sim/simCapabilityCatalog'

export type SimVisualRoute = {
  path: string
  navPath: string
  label: string
  hasVisibleStage: boolean
  tier: SimCapability['tier']
  hqModuleId?: string
  renderer: SimCapability['renderer']
}

/** Every Sim nav leaf with catalog visual metadata. */
export const SIM_VISUAL_ROUTES: SimVisualRoute[] = (() => {
  const simLeaves = ALL_LEAVES.filter((l) => l.domainKey === 'sim')
  const byPath = new Map(SIM_CAPABILITY_CATALOG.map((c) => [c.path, c]))
  const out: SimVisualRoute[] = []
  for (const leaf of simLeaves) {
    const cap = byPath.get(leaf.path)
    if (!cap) {
      throw new Error(`Sim nav path /${leaf.path} missing from SIM_CAPABILITY_CATALOG`)
    }
    out.push({
      path: `/${leaf.path}`,
      navPath: leaf.path,
      label: leaf.label,
      hasVisibleStage: cap.hasVisibleStage,
      tier: cap.tier,
      hqModuleId: cap.hqModuleId,
      renderer: cap.renderer,
    })
  }
  return out
})()

/** Paths that must be visited (absolute). */
export function simVisualPathSet(): Set<string> {
  return new Set(SIM_VISUAL_ROUTES.map((r) => r.path))
}

export type SimVisualCoverage = {
  simNavCount: number
  catalogCount: number
  visualCount: number
  /** Sorted Sim nav leaf paths (domainKey === 'sim'). */
  simNavPaths: string[]
  /** Sorted catalog paths. */
  catalogPaths: string[]
  /** Sorted visual navPath values (bare path, no leading slash). */
  visualNavPaths: string[]
  /** Sorted absolute visual paths (`/${navPath}`). */
  visualAbsPaths: string[]
  /** Nav sim leaves not present in SIM_VISUAL_ROUTES. */
  missingFromVisual: string[]
  /** Nav sim leaves not present in SIM_CAPABILITY_CATALOG. */
  missingFromCatalog: string[]
  /** Catalog paths not present as Sim nav leaves. */
  extraInCatalog: string[]
  /** Catalog paths not present in SIM_VISUAL_ROUTES. */
  catalogMissingFromVisual: string[]
  /** Visual navPaths not present as Sim nav leaves (should never happen). */
  extraInVisual: string[]
}

/**
 * Assert catalog / Sim nav / visual route list completeness (isomorphism).
 * Used by Playwright self-check and by the Vitest L0 e2e-routes-bar (#32).
 */
export function assertSimVisualCoverageComplete(): SimVisualCoverage {
  const simNavPaths = ALL_LEAVES.filter((l) => l.domainKey === 'sim')
    .map((l) => l.path)
    .sort()
  const catalogPaths = [...simCatalogPaths()].sort()
  const visualNavPaths = SIM_VISUAL_ROUTES.map((r) => r.navPath).sort()
  const visualAbsPaths = SIM_VISUAL_ROUTES.map((r) => r.path).sort()

  const visualSet = new Set(visualNavPaths)
  const catalogSet = new Set(catalogPaths)
  const navSet = new Set(simNavPaths)

  const missingFromVisual = simNavPaths.filter((p) => !visualSet.has(p))
  const missingFromCatalog = simNavPaths.filter((p) => !catalogSet.has(p))
  const extraInCatalog = catalogPaths.filter((p) => !navSet.has(p))
  const catalogMissingFromVisual = catalogPaths.filter((p) => !visualSet.has(p))
  const extraInVisual = visualNavPaths.filter((p) => !navSet.has(p))

  return {
    simNavCount: simNavPaths.length,
    catalogCount: catalogPaths.length,
    visualCount: visualNavPaths.length,
    simNavPaths,
    catalogPaths,
    visualNavPaths,
    visualAbsPaths,
    missingFromVisual,
    missingFromCatalog,
    extraInCatalog,
    catalogMissingFromVisual,
    extraInVisual,
  }
}

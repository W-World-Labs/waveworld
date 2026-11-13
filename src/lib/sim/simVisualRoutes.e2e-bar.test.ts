/**
 * L0 structural bar for e2e/sim-visual-routes.ts (#32 e2e-routes-bar).
 * SIM_VISUAL_ROUTES path list must stay isomorphic with:
 *   - ALL_LEAVES where domainKey === 'sim'
 *   - SIM_CAPABILITY_CATALOG / simCatalogPaths()
 * Prefer this Vitest gate over full Playwright on a 5m tick.
 */
import { describe, expect, it } from 'vitest'
import { ALL_LEAVES } from '../../nav'
import {
  SIM_CAPABILITY_CATALOG,
  simCatalogPaths,
  simCapabilityByPath,
} from './simCapabilityCatalog'
import {
  SIM_VISUAL_ROUTES,
  assertSimVisualCoverageComplete,
  simVisualPathSet,
  type SimVisualRoute,
} from '../../../e2e/sim-visual-routes'

describe('sim visual routes e2e bar (#32 e2e-routes-bar)', () => {
  const cov = assertSimVisualCoverageComplete()
  const simLeaves = ALL_LEAVES.filter((l) => l.domainKey === 'sim')

  it('visual list is isomorphic with Sim nav + catalog (bidirectional, no drift)', () => {
    expect(cov.missingFromVisual, `nav missing from visual: ${cov.missingFromVisual.join(',')}`).toEqual(
      [],
    )
    expect(
      cov.missingFromCatalog,
      `nav missing from catalog: ${cov.missingFromCatalog.join(',')}`,
    ).toEqual([])
    expect(cov.extraInCatalog, `catalog orphans: ${cov.extraInCatalog.join(',')}`).toEqual([])
    expect(
      cov.catalogMissingFromVisual,
      `catalog missing from visual: ${cov.catalogMissingFromVisual.join(',')}`,
    ).toEqual([])
    expect(cov.extraInVisual, `visual orphans: ${cov.extraInVisual.join(',')}`).toEqual([])

    expect(cov.visualNavPaths).toEqual(cov.simNavPaths)
    expect(cov.visualNavPaths).toEqual(cov.catalogPaths)
    expect(cov.visualCount).toBe(cov.simNavCount)
    expect(cov.visualCount).toBe(cov.catalogCount)
    expect(cov.visualCount).toBe(SIM_VISUAL_ROUTES.length)
    expect(cov.visualCount).toBe(SIM_CAPABILITY_CATALOG.length)
    expect(cov.visualCount).toBeGreaterThanOrEqual(37)
    expect(new Set(cov.visualNavPaths).size).toBe(cov.visualCount)
  })

  it('every visual route has absolute /{navPath}, catalog metadata, and matching leaf label', () => {
    const leafByPath = new Map(simLeaves.map((l) => [l.path, l]))
    for (const route of SIM_VISUAL_ROUTES) {
      expect(route.path).toBe(`/${route.navPath}`)
      expect(route.path).toMatch(/^\/[a-z0-9-]+$/)
      expect(route.navPath).toMatch(/^[a-z0-9-]+$/)

      const cap = simCapabilityByPath(route.navPath)
      expect(cap, `catalog row for ${route.path}`).toBeDefined()
      expect(route.hasVisibleStage).toBe(cap!.hasVisibleStage)
      expect(route.tier).toBe(cap!.tier)
      expect(route.renderer).toBe(cap!.renderer)
      expect(route.hqModuleId).toBe(cap!.hqModuleId)

      const leaf = leafByPath.get(route.navPath)
      expect(leaf, `nav leaf for ${route.path}`).toBeDefined()
      expect(route.label).toBe(leaf!.label)
    }
  })

  it('simVisualPathSet mirrors SIM_VISUAL_ROUTES absolute paths 1:1', () => {
    const set = simVisualPathSet()
    expect(set.size).toBe(SIM_VISUAL_ROUTES.length)
    for (const route of SIM_VISUAL_ROUTES) {
      expect(set.has(route.path), route.path).toBe(true)
    }
    expect([...set].sort()).toEqual(cov.visualAbsPaths)
  })

  it('hand-built expected paths from catalog equal visual abs paths (contract mirror)', () => {
    // Same construction e2e/routes consumers expect: `/${path}` for every catalog/nav leaf.
    const expected = simCatalogPaths()
      .map((p) => `/${p}`)
      .sort()
    expect(cov.visualAbsPaths).toEqual(expected)
    expect(SIM_VISUAL_ROUTES.map((r: SimVisualRoute) => r.path).sort()).toEqual(expected)
  })
})

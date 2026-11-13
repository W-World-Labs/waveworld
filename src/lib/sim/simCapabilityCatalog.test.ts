/**
 * L0 structural smoke bar for SIM_CAPABILITY_CATALOG (#32 catalog-smoke-bar · B0 #51).
 * Catalog must stay isomorphic with Sim nav leaves + router static paths, and
 * HQ default-live flags must stay honest (no fake 3D default for unshipped modules).
 * Product honesty: tier=legacy is L0 teaching; tier=hq is L2 engineering Lab —
 * never market L0 leaves as engineering CFD/EM.
 * Prefer this unit gate over full Playwright on a 5m tick.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ALL_LEAVES } from '../../nav'
import { PAGE_HEADERS } from '../i18n/pageHeaders'
import {
  L0_SMOKE_SAMPLE_PATHS,
  SIM_CAPABILITY_CATALOG,
  SIM_TIER_PRODUCT_LABELS,
  assertCatalogTierHonesty,
  assertL0SmokeSampleHonesty,
  catalogTierHonestyFor,
  l0TeachingCatalogPaths,
  l2EngineeringCatalogPaths,
  simCatalogPaths,
  simCapabilityByPath,
  simCapabilityHonesty,
} from './simCapabilityCatalog'

const ROOT = resolve(import.meta.dirname, '../../..')

/** Static leaf paths declared in router.tsx (no createBrowserRouter / jsdom). */
function routerStaticLeafPaths(): Set<string> {
  const src = readFileSync(resolve(ROOT, 'src/router.tsx'), 'utf8')
  const paths = new Set<string>()
  for (const m of src.matchAll(/path:\s*['"]([a-z0-9-]+)['"]/g)) {
    paths.add(m[1]!)
  }
  return paths
}

describe('sim capability catalog (#8 / #32 L0 structural bar)', () => {
  const simLeaves = ALL_LEAVES.filter((l) => l.domainKey === 'sim')
  const navPaths = simLeaves.map((l) => l.path).sort()
  const catPaths = [...simCatalogPaths()].sort()

  it('catalog paths equal Sim nav leaves (no missing / extra / duplicate)', () => {
    expect(catPaths).toEqual(navPaths)
    expect(new Set(catPaths).size).toBe(catPaths.length)
    expect(catPaths.length).toBeGreaterThanOrEqual(37)
  })

  it('catalog covers every Sim nav path that router/nav expect (router static + nav)', () => {
    const routerLeaves = routerStaticLeafPaths()
    // Nav sim leaves are the product surface; each must be catalogued and routed.
    for (const path of navPaths) {
      expect(simCapabilityByPath(path), `nav sim /${path} missing from catalog`).toBeDefined()
      expect(routerLeaves.has(path), `nav sim /${path} missing from router.tsx static path`).toBe(
        true,
      )
    }
    // Catalog must not invent orphan leaves (not in nav) or unrouted paths.
    for (const path of catPaths) {
      expect(navPaths, `catalog /${path} not a Sim nav leaf`).toContain(path)
      expect(routerLeaves.has(path), `catalog /${path} missing from router.tsx`).toBe(true)
    }
    expect(catPaths.length).toBe(navPaths.length)
  })

  it('every row has required industrial upgrade metadata', () => {
    for (const c of SIM_CAPABILITY_CATALOG) {
      expect(c.path).toMatch(/^[a-z0-9-]+$/)
      expect(['stepped', 'parametric', 'interactive', 'gateway', 'catalog']).toContain(
        c.mode,
      )
      expect(['canvas2d', 'three', 'svg', 'dom', 'iframe', 'mixed']).toContain(c.renderer)
      expect(['cpu', 'webgpu-or-cpu', 'host-api', 'none']).toContain(c.backend)
      expect(c.engine.length).toBeGreaterThan(3)
      expect(typeof c.hasVisibleStage).toBe('boolean')
      expect(['legacy', 'hq', 'gateway']).toContain(c.tier)
      // Industrial board: every leaf has target module + kind
      expect(c.hqModuleId, `/${c.path} needs hqModuleId`).toBeTruthy()
      expect(c.hqKind, `/${c.path} needs hqKind`).toBeTruthy()
      expect(['field', 'instrument', 'gateway']).toContain(c.hqKind!)
      if (c.tier === 'hq') {
        expect(c.hqModuleId, `hq path /${c.path} needs hqModuleId`).toBeTruthy()
      }
    }
  })

  it('Ansys catalog page is an L3 Host API route with native module context', () => {
    const capability = simCapabilityByPath('ansys')
    expect(capability).toMatchObject({
      mode: 'catalog',
      renderer: 'dom',
      backend: 'host-api',
      engine: 'src/pages/Ansys.tsx',
      tier: 'gateway',
      hqKind: 'gateway',
    })
    expect(capability?.supportsPause).toBe(false)
    expect(capability?.supportsReset).toBe(false)
    expect(catalogTierHonestyFor('gateway', 'ansys').productLayer).toBe('L3')
    expect(PAGE_HEADERS.ansys?.titleEn).toBe('Ansys capability cases')
  })

  it('Abaqus catalog is closed through nav, DOM gateway and L3 operations surface', () => {
    const capability = simCapabilityByPath('abaqus')
    expect(capability).toMatchObject({
      mode: 'catalog', renderer: 'dom', backend: 'host-api',
      engine: 'src/pages/Abaqus.tsx',
      tier: 'gateway', hqKind: 'gateway',
    })
    expect(catalogTierHonestyFor('gateway', 'abaqus').productLayer).toBe('L3')
    expect(PAGE_HEADERS.abaqus?.titleEn).toBe('Abaqus capability cases')
  })

  it('OpticStudio catalog is an L3 Host API route with explicit native optics context', () => {
    const capability = simCapabilityByPath('opticstudio')
    expect(capability).toMatchObject({ mode: 'catalog', renderer: 'dom', backend: 'host-api', engine: 'src/pages/OpticStudio.tsx', tier: 'gateway', hqKind: 'gateway' })
    expect(catalogTierHonestyFor('gateway', 'opticstudio').productLayer).toBe('L3')
    expect(PAGE_HEADERS.opticstudio?.titleEn).toBe('Ansys Zemax OpticStudio capability cases')
  })

  it('Dymola catalog is an L3 Host API route with native module and DAE context', () => {
    const capability = simCapabilityByPath('dymola')
    expect(capability).toMatchObject({ mode: 'catalog', renderer: 'dom', backend: 'host-api', engine: 'src/pages/Dymola.tsx', tier: 'gateway', hqKind: 'gateway' })
    expect(catalogTierHonestyFor('gateway', 'dymola').productLayer).toBe('L3')
    expect(PAGE_HEADERS.dymola?.titleEn).toBe('Dymola capability cases')
  })

  it('STAR-CCM+ mapped catalog is an L3 Host API gateway', () => {
    const capability = simCapabilityByPath('star-ccm')
    expect(capability).toMatchObject({ mode: 'catalog', renderer: 'dom', backend: 'host-api', engine: 'src/pages/StarCcm.tsx', tier: 'gateway', hqKind: 'gateway' })
    expect(catalogTierHonestyFor('gateway', 'star-ccm').productLayer).toBe('L3')
    expect(PAGE_HEADERS['star-ccm']?.titleEn).toBe('STAR-CCM+ capability cases')
  })

  it('CST catalog is an L3 Host API gateway with native module compute context', () => {
    const capability = simCapabilityByPath('cst')
    expect(capability).toMatchObject({ mode: 'catalog', renderer: 'dom', backend: 'host-api', engine: 'src/pages/Cst.tsx', tier: 'gateway', hqModuleId: 'gateway', hqKind: 'gateway' })
    expect(catalogTierHonestyFor('gateway', 'cst').productLayer).toBe('L3')
    expect(PAGE_HEADERS.cst?.titleEn).toBe('CST Studio Suite capability cases')
  })

  it('windtunnel remains the only product-presentation HQ module', () => {
    const windtunnel = simCapabilityByPath('windtunnel')
    expect(windtunnel).toMatchObject({ tier: 'hq', hqModuleId: 'tuanliu', hqKind: 'field' })
    expect(simCapabilityByPath('sim')).toMatchObject({ tier: 'legacy', hqModuleId: 'thermal' })
    expect(simCapabilityByPath('fdtd')).toMatchObject({ tier: 'legacy', hqModuleId: 'em-fdtd' })
  })

  it('spectrum + FDTD would fail static-only / click-to-seed contracts', () => {
    for (const path of ['electromagnetic', 'sound', 'vibration', 'fdtd'] as const) {
      const c = simCapabilityByPath(path)
      expect(c, path).toBeDefined()
      expect(c!.hasVisibleStage).toBe(true)
      expect(c!.requiresClickForContent).toBe(false)
      expect(c!.engine.length).toBeGreaterThan(0)
    }
    // EM/sound/vibration share spectrum-runnable engines (not SpectrumView-only)
    for (const path of ['electromagnetic', 'sound', 'vibration'] as const) {
      expect(simCapabilityByPath(path)!.engine).toContain('spectrum-runnable')
    }
  })

  it('engine path points at an existing repo file for non-gateway engines under src/', () => {
    for (const c of SIM_CAPABILITY_CATALOG) {
      if (!c.engine.startsWith('src/')) continue
      const abs = resolve(ROOT, c.engine)
      expect(existsSync(abs), `missing engine ${c.engine} for /${c.path}`).toBe(true)
    }
  })

  it('every catalog path has PAGE_HEADERS titleEn + subtitleEn (#29)', () => {
    for (const c of SIM_CAPABILITY_CATALOG) {
      const h = PAGE_HEADERS[c.path]
      expect(h, `PAGE_HEADERS missing for /${c.path}`).toBeDefined()
      expect((h!.titleEn?.trim().length ?? 0) > 0, `titleEn /${c.path}`).toBe(true)
      expect((h!.subtitleEn?.trim().length ?? 0) > 8, `subtitleEn /${c.path}`).toBe(true)
      expect((h!.title?.trim().length ?? 0) > 0, `title zh /${c.path}`).toBe(true)
    }
  })

  it('B0 catalog tier honesty: L0 teaching vs L2 engineering (no mislabel)', () => {
    expect(() => assertCatalogTierHonesty()).not.toThrow()

    const legacyLabel = SIM_TIER_PRODUCT_LABELS.legacy
    expect(legacyLabel.productLayer).toBe('L0')
    expect(legacyLabel.isTeachingOnly).toBe(true)
    expect(legacyLabel.isEngineeringCredit).toBe(false)
    expect(legacyLabel.shortEn).toMatch(/teach/i)
    expect(legacyLabel.blurbEn).toMatch(/not engineering/i)

    const hqLabel = SIM_TIER_PRODUCT_LABELS.hq
    expect(hqLabel.productLayer).toBe('L2')
    expect(hqLabel.isTeachingOnly).toBe(false)
    expect(hqLabel.isEngineeringCredit).toBe(true)
    expect(hqLabel.shortEn).toMatch(/engineering|lab/i)

    // Every legacy leaf is L0 teaching only
    const l0 = l0TeachingCatalogPaths()
    expect(l0.length).toBeGreaterThanOrEqual(20)
    for (const path of l0) {
      const c = simCapabilityByPath(path)!
      const h = simCapabilityHonesty(c)
      expect(h.productLayer, `/${path}`).toBe('L0')
      expect(h.isTeachingOnly, `/${path}`).toBe(true)
      expect(h.isEngineeringCredit, `/${path} must not claim engineering`).toBe(false)
      expect(c.tier).toBe('legacy')
    }

    // Live HQ defaults are L2 engineering, not teaching-only
    const l2 = l2EngineeringCatalogPaths()
    expect(l2.sort()).toEqual(['windtunnel'].sort())
    for (const path of l2) {
      const h = simCapabilityHonesty(simCapabilityByPath(path)!)
      expect(h.productLayer).toBe('L2')
      expect(h.isTeachingOnly).toBe(false)
      expect(h.isEngineeringCredit).toBe(true)
    }

    // Thermal / FDTD still L0 teaching until modules ship
    for (const path of ['sim', 'heaterfc', 'convection', 'fdtd', 'emwave3d'] as const) {
      const h = simCapabilityHonesty(simCapabilityByPath(path)!)
      expect(h.isTeachingOnly, `/${path}`).toBe(true)
      expect(h.isEngineeringCredit, `/${path}`).toBe(false)
      expect(h.productLayer).toBe('L0')
    }

    // Management and catalog gateways are not numerical solver leaves.
    expect(catalogTierHonestyFor('gateway', 'batch-jobs').productLayer).toBe('L3')
    expect(catalogTierHonestyFor('gateway', 'my-projects').productLayer).toBe('L3')
    expect(catalogTierHonestyFor('gateway', 'comsol').productLayer).toBe('L3')
    expect(catalogTierHonestyFor('gateway', 'star-ccm').productLayer).toBe('L3')
    expect(catalogTierHonestyFor('gateway', 'antennas').productLayer).toBe('L2')
  })

  it('L0 smoke: teaching leaves keep visible stage + real engine file (full legacy parity)', () => {
    // Full-parity residual (#51 · #32): L0_SMOKE covers every catalog legacy leaf.
    // Catalog-driven, CI-cheap; proves teaching demos still paint without claiming HQ.
    expect(L0_SMOKE_SAMPLE_PATHS.length).toBeGreaterThanOrEqual(30)
    expect(() => assertL0SmokeSampleHonesty()).not.toThrow()

    const teachingPaths = l0TeachingCatalogPaths()
    // Full parity: sorted smoke set === all tier=legacy paths (no silent gap)
    expect([...L0_SMOKE_SAMPLE_PATHS].sort()).toEqual(teachingPaths)

    // Every catalog row carries module flags (maturity table / owner inventory)
    for (const c of SIM_CAPABILITY_CATALOG) {
      expect(c.hqModuleId, `/${c.path} hqModuleId`).toBeTruthy()
      expect(c.hqKind, `/${c.path} hqKind`).toBeTruthy()
    }

    const engineering = new Set(l2EngineeringCatalogPaths())
    for (const path of L0_SMOKE_SAMPLE_PATHS) {
      const c = simCapabilityByPath(path)
      expect(c, path).toBeDefined()
      expect(c!.tier, `/${path} still L0 teaching`).toBe('legacy')
      const h = simCapabilityHonesty(c!)
      expect(h.productLayer, `/${path}`).toBe('L0')
      expect(h.isTeachingOnly, `/${path}`).toBe(true)
      expect(h.isEngineeringCredit, `/${path} teaching ≠ engineering`).toBe(false)
      expect(h.shortEn, `/${path}`).toMatch(/teach/i)
      expect(engineering.has(path), `/${path} must not be L2 eng HQ`).toBe(false)
      expect(c!.hasVisibleStage, `/${path} visible stage`).toBe(true)
      expect(c!.requiresClickForContent, `/${path} no click-to-seed`).toBe(false)
      expect(c!.engine.length).toBeGreaterThan(3)
      if (c!.engine.startsWith('src/')) {
        expect(existsSync(resolve(ROOT, c!.engine)), c!.engine).toBe(true)
      }
      // Must not use HQ default while still teaching
    }

    // Side-by-side honesty: live HQ engineering defaults stay out of L0 smoke sample
    for (const path of engineering) {
      expect(L0_SMOKE_SAMPLE_PATHS as readonly string[]).not.toContain(path)
      const h = simCapabilityHonesty(simCapabilityByPath(path)!)
      expect(h.productLayer).toBe('L2')
      expect(h.isEngineeringCredit).toBe(true)
      expect(h.isTeachingOnly).toBe(false)
    }

    // Full L0 set still non-empty and covered by catalog smoke bar above
    expect(teachingPaths.length).toBe(
      SIM_CAPABILITY_CATALOG.filter((c) => c.tier === 'legacy').length,
    )
  })
})

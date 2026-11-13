/**
 * Nav ↔ smoke-route ↔ pageHeaders closure.
 * e2e/routes.ts builds leaf smoke paths as `/${leaf.path}` from ALL_LEAVES —
 * mirror that contract here (without importing e2e/ or createBrowserRouter,
 * which need Node types / a browser document under tsc and Vitest).
 */
import { describe, expect, it } from 'vitest'
import { ALL_LEAVES } from './nav'
import { PAGE_HEADERS } from './lib/i18n/pageHeaders'
import { methodsForSimPath } from './data/methods/methods'

describe('nav ↔ smoke routes ↔ pageHeaders', () => {
  /** Same leaf-path contract as e2e/routes.ts `leaves` mapping. */
  function expectedLeafSmokePaths(): string[] {
    return ALL_LEAVES.map((l) => `/${l.path}`)
  }

  it('every ALL_LEAVES path has a unique smoke path of form /{path}', () => {
    const paths = expectedLeafSmokePaths()
    expect(paths.length).toBe(ALL_LEAVES.length)
    expect(new Set(paths).size).toBe(paths.length)
    for (const p of paths) {
      expect(p).toMatch(/^\/[a-z0-9-]+$/)
    }
  })

  it('smith leaf is wired for product surface (nav, smoke contract, headers, methods)', () => {
    const leaf = ALL_LEAVES.find((l) => l.path === 'smith')
    expect(leaf, 'smith in ALL_LEAVES').toBeDefined()
    expect(leaf!.labelEn).toMatch(/Smith/i)
    expect(leaf!.domainKey).toBe('sim')
    expect(leaf!.label.trim().length).toBeGreaterThan(0)

    expect(expectedLeafSmokePaths()).toContain('/smith')
    expect(PAGE_HEADERS.smith?.titleEn).toMatch(/Smith/i)
    expect(PAGE_HEADERS.smith?.subtitleEn?.length ?? 0).toBeGreaterThan(12)

    const methods = methodsForSimPath('smith')
    expect(methods.map((m) => m.id)).toContain('method-algo-smith-chart')
    expect(methods.some((m) => m.id === 'method-impedance-match')).toBe(true)
  })

  it('flow, particle and management entries have navigation, headers and smoke coverage', () => {
    expect(ALL_LEAVES.some((leaf) => leaf.path === 'lab-cfd')).toBe(false)
    for (const path of ['windtunnel', 'particles', 'batch-jobs', 'my-projects', 'comsol', 'ansys', 'abaqus', 'star-ccm', 'cst'] as const) {
      const leaf = ALL_LEAVES.find((l) => l.path === path)
      expect(leaf, `${path} in ALL_LEAVES`).toBeDefined()
      expect(leaf!.domainKey).toBe('sim')
      expect(leaf!.labelEn.trim().length).toBeGreaterThan(0)
      expect(expectedLeafSmokePaths()).toContain(`/${path}`)
      expect(PAGE_HEADERS[path]?.titleEn?.length ?? 0).toBeGreaterThan(4)
      expect(PAGE_HEADERS[path]?.subtitleEn?.length ?? 0).toBeGreaterThan(12)
    }
  })
})

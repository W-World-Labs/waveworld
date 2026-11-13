/**
 * Structural discovery for ULP sensor research pathway:
 * sensing ↔ node-budget ↔ smith/impedance methods and leaves.
 */
import { describe, expect, it } from 'vitest'
import { ALL_LEAVES } from '../nav'
import { PAGE_HEADERS } from './i18n/pageHeaders'
import { methodsForSimPath } from '../data/methods/methods'

describe('ULP sensor research pathway links', () => {
  it('nav leaves and pageHeaders for sensing + node-budget + smith', () => {
    for (const path of ['sensing', 'node-budget', 'smith'] as const) {
      const leaf = ALL_LEAVES.find((l) => l.path === path)
      expect(leaf, path).toBeDefined()
      expect(leaf!.labelEn.trim().length).toBeGreaterThan(0)
      expect(PAGE_HEADERS[path]?.titleEn?.length ?? 0).toBeGreaterThan(2)
    }
    // Edge self-power research narrative in headers
    expect(PAGE_HEADERS.sensing?.subtitleEn ?? '').toMatch(
      /self-power|harvester|budget|Smith|transducer/i,
    )
    expect(PAGE_HEADERS['node-budget']?.subtitleEn ?? '').toMatch(
      /harvest|self-powered|lifetime|duty/i,
    )
  })

  it('methodsForSimPath wires budget + RF + edge chain onto sensing and node-budget', () => {
    const sensing = methodsForSimPath('sensing').map((m) => m.id)
    expect(
      sensing.some((id) => id.includes('node-energy') || id.includes('node-duty')),
      `sensing methods: ${sensing.join(',')}`,
    ).toBe(true)
    expect(
      sensing.some((id) => id.includes('impedance') || id.includes('smith') || id.includes('edge-self-power')),
      `sensing methods: ${sensing.join(',')}`,
    ).toBe(true)

    const budget = methodsForSimPath('node-budget').map((m) => m.id)
    expect(budget).toContain('method-node-energy-budget')
    expect(budget).toContain('method-algo-node-duty-budget')
    expect(budget).toContain('method-algo-edge-self-power-chain')
    expect(budget).toContain('method-algo-research-2026-claims')

    const smith = methodsForSimPath('smith').map((m) => m.id)
    expect(smith.some((id) => id.includes('smith') || id.includes('impedance') || id.includes('edge-self-power'))).toBe(true)
  })

  it('ALL_LEAVES smoke-path contract includes pathway routes', () => {
    const paths = new Set(ALL_LEAVES.map((l) => `/${l.path}`))
    expect(paths.has('/sensing')).toBe(true)
    expect(paths.has('/node-budget')).toBe(true)
    expect(paths.has('/smith')).toBe(true)
  })
})

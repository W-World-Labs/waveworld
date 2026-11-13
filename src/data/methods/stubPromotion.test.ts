import { describe, expect, it } from 'vitest'
import { methodById } from './methods'
import { runnerFor } from './moduleRegistry'

/**
 * #3 coverage slice: historical *-stub method ids that already have pure
 * sample runners are treated as promoted (display names no longer say "stub",
 * registry run() returns ok/found truthy payloads).
 */
const PROMOTED_STUB_IDS = [
  'method-algo-path-dijkstra-stub',
  'method-algo-fc-polarization-stub',
  'method-algo-fvm-hllc-stub',
  'method-algo-fvm-roe-stub',
  'method-algo-lbm-mrt-stub',
  'method-algo-pf-ukf-stub',
  'method-algo-fiber-dispersion-stub',
  'method-algo-ks-scf-stub',
  'method-algo-exchange-lda-stub',
] as const

describe('promoted method stubs (#3)', () => {
  for (const id of PROMOTED_STUB_IDS) {
    it(`${id} has method row, non-stub English name, registry run, simPaths`, () => {
      const m = methodById(id)
      expect(m, id).toBeDefined()
      expect((m?.nameEn ?? '').toLowerCase()).not.toMatch(/\bstub\b/)
      expect(m!.name).not.toMatch(/占位/)
      expect((m!.simPaths?.length ?? 0) > 0).toBe(true)

      const mod = runnerFor(id)
      expect(mod, `registry ${id}`).toBeDefined()
      const out = mod!.run() as Record<string, unknown>
      expect(out).toBeTruthy()
      // Dijkstra: found; FC/HLLC/Roe: ok; MRT: massConserved + finite
      if ('found' in out) expect(out.found).toBe(true)
      if ('ok' in out) expect(out.ok).toBe(true)
      if ('massConserved' in out) expect(out.massConserved).toBe(true)
      if ('finite' in out) expect(out.finite).toBe(true)
      // Sample may report canonical sibling methodId (e.g. ukf-sigma vs pf-ukf-stub).
      if ('methodId' in out) expect(typeof out.methodId).toBe('string')
    })
  }
})

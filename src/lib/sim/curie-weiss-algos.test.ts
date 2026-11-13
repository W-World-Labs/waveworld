import { describe, it, expect } from 'vitest'
import {
  METHOD_CURIE,
  METHOD_ALGO_CURIE_CHI,
  CURIE_PARENT,
  CURIE_METHOD_IDS,
  DEFAULT_C,
  DEFAULT_T,
  DEFAULT_TC,
  curieChi,
  runCurieChiSample,
} from './curie-weiss-algos'

describe('Curie–Weiss · χ = C/(T − Tc) for T>Tc', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_CURIE).toBe('method-curie-weiss')
    expect(METHOD_ALGO_CURIE_CHI).toBe('method-algo-curie-chi')
    expect(CURIE_PARENT).toBe(METHOD_CURIE)
    expect(CURIE_METHOD_IDS).toContain(METHOD_ALGO_CURIE_CHI)
  })

  it('curieChi: formula', () => {
    expect(curieChi(2, 400, 300)).toBeCloseTo(0.02, 12)
    expect(curieChi(DEFAULT_C, DEFAULT_T, DEFAULT_TC)).toBeCloseTo(
      DEFAULT_C / (DEFAULT_T - DEFAULT_TC),
      12,
    )
  })

  it('∝ C; T≤Tc → NaN', () => {
    expect(curieChi(4, 400, 300)).toBeCloseTo(2 * curieChi(2, 400, 300), 12)
    expect(Number.isNaN(curieChi(1, 300, 300))).toBe(true)
    expect(Number.isNaN(curieChi(1, 200, 300))).toBe(true)
    expect(Number.isNaN(curieChi(NaN, 400, 300))).toBe(true)
  })

  it('runCurieChiSample: ok, formula, methodId/familyId', () => {
    const r = runCurieChiSample()
    expect(r.methodId).toBe(METHOD_ALGO_CURIE_CHI)
    expect(r.familyId).toBe(METHOD_CURIE)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.chi).toBeCloseTo(r.C / (r.T - r.Tc), 12)
    expect(r.chi_nearTc).toBeGreaterThan(r.chi)
    expect(Number.isFinite(r.chi_bad)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runCurieChiSample({ C: 2, T: 500, Tc: 100 }).ok).toBe(true)
  })
})

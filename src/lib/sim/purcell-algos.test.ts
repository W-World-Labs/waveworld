import { describe, it, expect } from 'vitest'
import {
  METHOD_PURCELL,
  METHOD_ALGO_PURCELL_F,
  PURCELL_PARENT,
  PURCELL_METHOD_IDS,
  DEFAULT_Q,
  DEFAULT_V,
  DEFAULT_LAMBDA,
  purcellFactor,
  runPurcellFSample,
} from './purcell-algos'

describe('Purcell · F_p = 3 Q λ³ / (4 π² V)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_PURCELL).toBe('method-purcell-factor')
    expect(METHOD_ALGO_PURCELL_F).toBe('method-algo-purcell-f')
    expect(PURCELL_PARENT).toBe(METHOD_PURCELL)
    expect(PURCELL_METHOD_IDS).toContain(METHOD_ALGO_PURCELL_F)
  })

  it('purcellFactor: formula', () => {
    const Q = 1
    const V = 1
    const lambda = 1
    expect(purcellFactor(Q, V, lambda)).toBeCloseTo(
      3 / (4 * Math.PI ** 2),
      12,
    )
    expect(purcellFactor(DEFAULT_Q, DEFAULT_V, DEFAULT_LAMBDA)).toBeCloseTo(
      (3 * DEFAULT_Q * DEFAULT_LAMBDA ** 3) /
        (4 * Math.PI ** 2 * DEFAULT_V),
      8,
    )
  })

  it('∝ Q, 1/V; V≤0 → NaN', () => {
    const f = purcellFactor(100, 1e-18, 1e-6)
    expect(purcellFactor(200, 1e-18, 1e-6)).toBeCloseTo(2 * f, 10)
    expect(purcellFactor(100, 2e-18, 1e-6)).toBeCloseTo(f / 2, 10)
    expect(Number.isNaN(purcellFactor(1, 0, 1))).toBe(true)
    expect(Number.isNaN(purcellFactor(NaN, 1, 1))).toBe(true)
  })

  it('runPurcellFSample: ok, formula, scales', () => {
    const r = runPurcellFSample()
    expect(r.methodId).toBe(METHOD_ALGO_PURCELL_F)
    expect(r.familyId).toBe(METHOD_PURCELL)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Fp).toBeCloseTo(
      (3 * r.Q * r.lambda ** 3) / (4 * Math.PI ** 2 * r.V),
      8,
    )
    expect(r.Fp_doubleQ).toBeCloseTo(2 * r.Fp, 10)
    expect(r.Fp_doubleV).toBeCloseTo(r.Fp / 2, 10)
    expect(Number.isFinite(r.Fp_badV)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runPurcellFSample({ Q: 1e3, V: 1e-17, lambda: 5e-7 }).ok).toBe(
      true,
    )
  })
})

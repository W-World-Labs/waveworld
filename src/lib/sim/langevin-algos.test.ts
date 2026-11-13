import { describe, it, expect } from 'vitest'
import {
  METHOD_LANGEVIN,
  METHOD_ALGO_LANGEVIN_L,
  LANGEVIN_PARENT,
  LANGEVIN_METHOD_IDS,
  DEFAULT_X,
  langevinL,
  runLangevinLSample,
} from './langevin-algos'

describe('Langevin · L(x) = coth(x) − 1/x', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_LANGEVIN).toBe('method-langevin')
    expect(METHOD_ALGO_LANGEVIN_L).toBe('method-algo-langevin-l')
    expect(LANGEVIN_PARENT).toBe(METHOD_LANGEVIN)
    expect(LANGEVIN_METHOD_IDS).toContain(METHOD_ALGO_LANGEVIN_L)
  })

  it('langevinL: formula at DEFAULT_X', () => {
    const x = DEFAULT_X
    expect(langevinL(x)).toBeCloseTo(1 / Math.tanh(x) - 1 / x, 12)
  })

  it('odd; L(0)=0; |L|→1; small-x series; bad → NaN', () => {
    expect(langevinL(-2)).toBeCloseTo(-langevinL(2), 12)
    expect(langevinL(0)).toBeCloseTo(0, 18)
    expect(langevinL(1e-10)).toBeCloseTo(1e-10 / 3, 8)
    // L(x) ≈ 1 − 1/x for large x (coth → 1)
    expect(langevinL(1e6)).toBeCloseTo(1, 5)
    expect(langevinL(-1e6)).toBeCloseTo(-1, 5)
    expect(langevinL(30)).toBeCloseTo(1 - 1 / 30, 12)
    expect(Number.isNaN(langevinL(NaN))).toBe(true)
    expect(Number.isNaN(langevinL(Infinity))).toBe(true)
  })

  it('runLangevinLSample: ok, odd, bounds', () => {
    const r = runLangevinLSample()
    expect(r.methodId).toBe(METHOD_ALGO_LANGEVIN_L)
    expect(r.familyId).toBe(METHOD_LANGEVIN)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.L).toBeCloseTo(1 / Math.tanh(r.x) - 1 / r.x, 12)
    expect(r.L_neg).toBeCloseTo(-r.L, 12)
    expect(r.L_zero).toBe(0)
    expect(r.L_large).toBeCloseTo(1, 5)
    expect(Number.isFinite(r.L_bad)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runLangevinLSample({ x: 0.5 }).ok).toBe(true)
    expect(runLangevinLSample({ x: 3 }).ok).toBe(true)
  })
})

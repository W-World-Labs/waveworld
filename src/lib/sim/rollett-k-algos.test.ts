import { describe, it, expect } from 'vitest'
import {
  METHOD_ROLLETT,
  METHOD_ALGO_ROLLETT_K,
  ROLLETT_PARENT,
  ROLLETT_METHOD_IDS,
  DEFAULT_S11,
  DEFAULT_S12,
  DEFAULT_S21,
  DEFAULT_S22,
  rollettK,
  rollettDelta,
  runRollettKSample,
} from './rollett-k-algos'

describe('Rollett K · stability factor', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_ROLLETT).toBe('method-rollett-k')
    expect(METHOD_ALGO_ROLLETT_K).toBe('method-algo-rollett-k')
    expect(ROLLETT_PARENT).toBe(METHOD_ROLLETT)
    expect(ROLLETT_METHOD_IDS).toContain(METHOD_ALGO_ROLLETT_K)
  })

  it('rollettK: formula with real Sij', () => {
    const S11 = DEFAULT_S11
    const S12 = DEFAULT_S12
    const S21 = DEFAULT_S21
    const S22 = DEFAULT_S22
    const Delta = S11 * S22 - S12 * S21
    const expected =
      (1 - S11 * S11 - S22 * S22 + Delta * Delta) /
      (2 * Math.abs(S12 * S21))
    expect(rollettDelta(S11, S12, S21, S22)).toBeCloseTo(Delta, 15)
    expect(rollettK(S11, S12, S21, S22)).toBeCloseTo(expected, 12)
    expect(rollettK(S11, S12, S21, S22)).toBeGreaterThan(1)
  })

  it('S12=S21=0 ⇒ NaN; non-finite → NaN', () => {
    expect(Number.isNaN(rollettK(0.1, 0, 0, 0.1))).toBe(true)
    expect(Number.isNaN(rollettK(NaN, 0.1, 1, 0.1))).toBe(true)
  })

  it('runRollettKSample: ok, K>1, |Δ|<1', () => {
    const r = runRollettKSample()
    expect(r.methodId).toBe(METHOD_ALGO_ROLLETT_K)
    expect(r.familyId).toBe(METHOD_ROLLETT)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.K).toBeGreaterThan(1)
    expect(Math.abs(r.Delta)).toBeLessThan(1)
    expect(Number.isFinite(r.K_bad)).toBe(false)
  })

  it('custom stable params still ok', () => {
    expect(
      runRollettKSample({ S11: 0.1, S12: 0.02, S21: 1.5, S22: 0.1 }).ok,
    ).toBe(true)
  })
})

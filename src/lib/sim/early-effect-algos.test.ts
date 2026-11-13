import { describe, it, expect } from 'vitest'
import {
  METHOD_EARLY,
  METHOD_ALGO_EARLY_VA,
  EARLY_PARENT,
  EARLY_METHOD_IDS,
  DEFAULT_IC0,
  DEFAULT_VCE,
  DEFAULT_VA,
  earlyIc,
  runEarlyVaSample,
} from './early-effect-algos'

describe('Early effect · Ic = Ic0 (1 + Vce/Va)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_EARLY).toBe('method-early-effect')
    expect(METHOD_ALGO_EARLY_VA).toBe('method-algo-early-va')
    expect(EARLY_PARENT).toBe(METHOD_EARLY)
    expect(EARLY_METHOD_IDS).toContain(METHOD_ALGO_EARLY_VA)
  })

  it('earlyIc: formula; Vce=0 ⇒ Ic0', () => {
    expect(earlyIc(1e-3, 0, 50)).toBeCloseTo(1e-3, 18)
    expect(earlyIc(DEFAULT_IC0, DEFAULT_VCE, DEFAULT_VA)).toBeCloseTo(
      DEFAULT_IC0 * (1 + DEFAULT_VCE / DEFAULT_VA),
      12,
    )
  })

  it('∝ Ic0; Va=0 → NaN', () => {
    const Ic = earlyIc(1e-3, 10, 100)
    expect(earlyIc(2e-3, 10, 100)).toBeCloseTo(2 * Ic, 12)
    expect(Ic).toBeGreaterThan(1e-3)
    expect(Number.isNaN(earlyIc(1e-3, 5, 0))).toBe(true)
    expect(Number.isNaN(earlyIc(NaN, 5, 50))).toBe(true)
  })

  it('runEarlyVaSample: ok, formula, methodId/familyId', () => {
    const r = runEarlyVaSample()
    expect(r.methodId).toBe(METHOD_ALGO_EARLY_VA)
    expect(r.familyId).toBe(METHOD_EARLY)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Ic).toBeCloseTo(r.Ic0 * (1 + r.Vce / r.Va), 12)
    expect(r.Ic_zeroVce).toBeCloseTo(r.Ic0, 18)
    expect(r.Ic_doubleIc0).toBeCloseTo(2 * r.Ic, 12)
  })

  it('custom params still ok', () => {
    expect(runEarlyVaSample({ Ic0: 2e-3, Vce: 10, Va: 80 }).ok).toBe(true)
  })
})

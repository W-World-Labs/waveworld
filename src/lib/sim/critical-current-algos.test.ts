import { describe, it, expect } from 'vitest'
import {
  METHOD_IC,
  METHOD_ALGO_IC_JOSEPHSON,
  IC_PARENT,
  IC_METHOD_IDS,
  E_CHARGE,
  DEFAULT_DELTA,
  DEFAULT_RN,
  DEFAULT_TC,
  josephsonIc,
  icNearTc,
  runIcJosephsonSample,
} from './critical-current-algos'

describe('Critical current · Ic = (π/2) Δ/(e Rn)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_IC).toBe('method-critical-current')
    expect(METHOD_ALGO_IC_JOSEPHSON).toBe('method-algo-ic-josephson')
    expect(IC_PARENT).toBe(METHOD_IC)
    expect(IC_METHOD_IDS).toContain(METHOD_ALGO_IC_JOSEPHSON)
  })

  it('josephsonIc: Ic = (π/2) Δ/(e Rn)', () => {
    const Ic = josephsonIc(DEFAULT_DELTA, DEFAULT_RN)
    expect(Ic).toBeCloseTo(
      ((Math.PI / 2) * DEFAULT_DELTA) / (E_CHARGE * DEFAULT_RN),
      8,
    )
  })

  it('∝ Δ, 1/Rn; Rn≤0 → NaN', () => {
    const Ic = josephsonIc(DEFAULT_DELTA, DEFAULT_RN)
    expect(josephsonIc(2 * DEFAULT_DELTA, DEFAULT_RN)).toBeCloseTo(2 * Ic, 10)
    expect(josephsonIc(DEFAULT_DELTA, 2 * DEFAULT_RN)).toBeCloseTo(Ic / 2, 10)
    expect(Number.isNaN(josephsonIc(1, 0))).toBe(true)
    expect(Number.isNaN(josephsonIc(NaN, 1))).toBe(true)
  })

  it('icNearTc: I0(1−T/Tc); T≥Tc ⇒ 0', () => {
    expect(icNearTc(10, 0, DEFAULT_TC)).toBeCloseTo(10, 12)
    expect(icNearTc(10, DEFAULT_TC / 2, DEFAULT_TC)).toBeCloseTo(5, 12)
    expect(icNearTc(10, DEFAULT_TC, DEFAULT_TC)).toBe(0)
    expect(icNearTc(10, DEFAULT_TC + 1, DEFAULT_TC)).toBe(0)
  })

  it('runIcJosephsonSample: ok, formula, scales', () => {
    const r = runIcJosephsonSample()
    expect(r.methodId).toBe(METHOD_ALGO_IC_JOSEPHSON)
    expect(r.familyId).toBe(METHOD_IC)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Ic).toBeCloseTo(
      ((Math.PI / 2) * r.Delta) / (E_CHARGE * r.Rn),
      8,
    )
    expect(r.Ic_doubleDelta).toBeCloseTo(2 * r.Ic, 10)
    expect(r.Ic_doubleRn).toBeCloseTo(r.Ic / 2, 10)
    expect(Number.isFinite(r.Ic_badRn)).toBe(false)
  })
})

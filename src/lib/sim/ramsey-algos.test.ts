import { describe, it, expect } from 'vitest'
import {
  METHOD_RAMSEY,
  METHOD_ALGO_RAMSEY_P,
  RAMSEY_PARENT,
  RAMSEY_METHOD_IDS,
  DEFAULT_DELTA,
  DEFAULT_T,
  ramseyP,
  runRamseyPSample,
} from './ramsey-algos'

describe('Ramsey · P = cos²(δ T / 2)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_RAMSEY).toBe('method-ramsey')
    expect(METHOD_ALGO_RAMSEY_P).toBe('method-algo-ramsey-p')
    expect(RAMSEY_PARENT).toBe(METHOD_RAMSEY)
    expect(RAMSEY_METHOD_IDS).toContain(METHOD_ALGO_RAMSEY_P)
  })

  it('ramseyP: formula and specials', () => {
    const half = (DEFAULT_DELTA * DEFAULT_T) / 2
    expect(ramseyP(DEFAULT_DELTA, DEFAULT_T)).toBeCloseTo(
      Math.cos(half) ** 2,
      12,
    )
    expect(ramseyP(0, 1)).toBeCloseTo(1, 15)
    expect(ramseyP(1, 0)).toBeCloseTo(1, 15)
    // δT/2 = π/2 ⇒ P=0
    expect(ramseyP(Math.PI, 1)).toBeCloseTo(0, 12)
  })

  it('bounds [0,1]; non-finite → NaN', () => {
    const p = ramseyP(3, 0.1)
    expect(p).toBeGreaterThanOrEqual(0)
    expect(p).toBeLessThanOrEqual(1)
    expect(Number.isNaN(ramseyP(NaN, 1))).toBe(true)
    expect(Number.isNaN(ramseyP(1, Infinity))).toBe(true)
  })

  it('runRamseyPSample: ok, formula, zeros', () => {
    const r = runRamseyPSample()
    expect(r.methodId).toBe(METHOD_ALGO_RAMSEY_P)
    expect(r.familyId).toBe(METHOD_RAMSEY)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.P_zeroDelta).toBeCloseTo(1, 12)
    expect(r.P_zeroT).toBeCloseTo(1, 12)
    expect(r.P_pi).toBeCloseTo(0, 10)
  })

  it('custom params still ok', () => {
    expect(runRamseyPSample({ delta: 100, T: 0.01 }).ok).toBe(true)
  })
})

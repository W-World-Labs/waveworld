import { describe, it, expect } from 'vitest'
import {
  METHOD_MILLER,
  METHOD_ALGO_MILLER_CIN,
  MILLER_PARENT,
  MILLER_METHOD_IDS,
  DEFAULT_CGS,
  DEFAULT_CGD,
  DEFAULT_GM,
  DEFAULT_RL,
  millerCin,
  millerCgdEff,
  runMillerCinSample,
} from './miller-cap-algos'

describe('Miller · Cin = Cgs + Cgd(1+gm RL)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_MILLER).toBe('method-miller-capacitance')
    expect(METHOD_ALGO_MILLER_CIN).toBe('method-algo-miller-cin')
    expect(MILLER_PARENT).toBe(METHOD_MILLER)
    expect(MILLER_METHOD_IDS).toContain(METHOD_ALGO_MILLER_CIN)
  })

  it('millerCin / millerCgdEff formulas', () => {
    const Cgs = DEFAULT_CGS
    const Cgd = DEFAULT_CGD
    const gm = DEFAULT_GM
    const RL = DEFAULT_RL
    const Av = gm * RL
    expect(millerCin(Cgs, Cgd, gm, RL)).toBeCloseTo(
      Cgs + Cgd * (1 + Av),
      18,
    )
    expect(millerCgdEff(Cgd, gm, RL)).toBeCloseTo(Cgd * (1 + Av), 18)
  })

  it('gm=0 ⇒ Cin = Cgs+Cgd; Miller boost; bad → NaN', () => {
    expect(millerCin(1e-12, 0.2e-12, 0, 1e3)).toBeCloseTo(1.2e-12, 18)
    const boosted = millerCin(1e-12, 0.2e-12, 0.01, 1e3)
    expect(boosted).toBeGreaterThan(1.2e-12)
    expect(Number.isNaN(millerCin(1, 1, NaN, 1))).toBe(true)
    expect(Number.isNaN(millerCgdEff(1, Infinity, 1))).toBe(true)
  })

  it('runMillerCinSample: ok, Av, split', () => {
    const r = runMillerCinSample()
    expect(r.methodId).toBe(METHOD_ALGO_MILLER_CIN)
    expect(r.familyId).toBe(METHOD_MILLER)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Av).toBeCloseTo(r.gm * r.RL, 12)
    expect(r.Cin).toBeCloseTo(r.Cgs + r.Cgd * (1 + r.Av), 18)
    expect(r.Cin).toBeCloseTo(r.Cgs + r.Cgd_eff, 18)
    expect(r.Cin_zeroGm).toBeCloseTo(r.Cgs + r.Cgd, 18)
    expect(Number.isFinite(r.Cin_bad)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(
      runMillerCinSample({ Cgs: 2e-12, Cgd: 0.5e-12, gm: 0.02, RL: 500 })
        .ok,
    ).toBe(true)
  })
})

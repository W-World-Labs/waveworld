import { describe, it, expect } from 'vitest'
import {
  METHOD_BEER,
  METHOD_ALGO_BEER_ABSORBANCE,
  BEER_PARENT,
  BEER_METHOD_IDS,
  DEFAULT_EPS,
  DEFAULT_C,
  DEFAULT_L,
  beerAbsorbance,
  transmittanceFromA,
  transmittanceExp,
  muFromAbsorbance,
  runBeerAbsorbanceSample,
} from './beer-lambert-algos'

describe('Beer–Lambert · A = ε c L; T = 10^(−A)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_BEER).toBe('method-beer-lambert')
    expect(METHOD_ALGO_BEER_ABSORBANCE).toBe('method-algo-beer-absorbance')
    expect(BEER_PARENT).toBe(METHOD_BEER)
    expect(BEER_METHOD_IDS).toContain(METHOD_ALGO_BEER_ABSORBANCE)
  })

  it('beerAbsorbance: A = ε c L', () => {
    expect(beerAbsorbance(1e4, 1e-4, 1)).toBeCloseTo(1, 12)
    expect(beerAbsorbance(DEFAULT_EPS, DEFAULT_C, DEFAULT_L)).toBeCloseTo(
      DEFAULT_EPS * DEFAULT_C * DEFAULT_L,
      12,
    )
  })

  it('transmittanceFromA: T = 10^(−A); A=0 ⇒ T=1', () => {
    expect(transmittanceFromA(0)).toBeCloseTo(1, 15)
    expect(transmittanceFromA(1)).toBeCloseTo(0.1, 12)
    expect(transmittanceFromA(2)).toBeCloseTo(0.01, 12)
  })

  it('transmittanceExp and muFromAbsorbance match 10^(−A)', () => {
    const A = 1
    const L = 2
    const mu = muFromAbsorbance(A, L)
    expect(mu).toBeCloseTo((A * Math.LN10) / L, 12)
    const T_log = transmittanceFromA(A)
    const T_exp = transmittanceExp(mu, L)
    expect(T_exp).toBeCloseTo(T_log, 12)
  })

  it('non-finite → NaN', () => {
    expect(Number.isNaN(beerAbsorbance(NaN, 1, 1))).toBe(true)
    expect(Number.isNaN(transmittanceFromA(Infinity))).toBe(true)
    expect(Number.isNaN(muFromAbsorbance(1, 0))).toBe(true)
  })

  it('runBeerAbsorbanceSample: ok, formula, double L, exp match', () => {
    const r = runBeerAbsorbanceSample()
    expect(r.methodId).toBe(METHOD_ALGO_BEER_ABSORBANCE)
    expect(r.familyId).toBe(METHOD_BEER)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.A).toBeCloseTo(r.eps * r.c * r.L, 12)
    expect(r.T).toBeCloseTo(10 ** -r.A, 12)
    expect(r.A_doubleL).toBeCloseTo(2 * r.A, 12)
    expect(r.T_zeroA).toBeCloseTo(1, 15)
    expect(r.T_exp).toBeCloseTo(r.T, 10)
  })

  it('custom params still ok', () => {
    expect(runBeerAbsorbanceSample({ eps: 2e3, c: 1e-3, L: 0.5 }).ok).toBe(
      true,
    )
  })
})

import { describe, it, expect } from 'vitest'
import {
  METHOD_DRUDE,
  METHOD_ALGO_DRUDE_SIGMA,
  DRUDE_PARENT,
  DRUDE_METHOD_IDS,
  EPS0,
  E_CHARGE,
  M_E,
  DEFAULT_N,
  DEFAULT_TAU,
  drudeSigma,
  plasmaOmega,
  runDrudeSigmaSample,
} from './drude-algos'

describe('Drude · σ = n e² τ / m', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_DRUDE).toBe('method-drude-model')
    expect(METHOD_ALGO_DRUDE_SIGMA).toBe('method-algo-drude-sigma')
    expect(DRUDE_PARENT).toBe(METHOD_DRUDE)
    expect(DRUDE_METHOD_IDS).toContain(METHOD_ALGO_DRUDE_SIGMA)
    expect(E_CHARGE).toBe(1.602176634e-19)
  })

  it('drudeSigma: formula', () => {
    const s = drudeSigma(DEFAULT_N, DEFAULT_TAU)
    expect(s).toBeCloseTo(
      (DEFAULT_N * E_CHARGE * E_CHARGE * DEFAULT_TAU) / M_E,
      6,
    )
    expect(s).toBeGreaterThan(0)
  })

  it('∝ n, τ; plasma ω_p; m≤0 → NaN', () => {
    const s = drudeSigma(DEFAULT_N, DEFAULT_TAU)
    expect(drudeSigma(2 * DEFAULT_N, DEFAULT_TAU)).toBeCloseTo(2 * s, 10)
    expect(drudeSigma(DEFAULT_N, 2 * DEFAULT_TAU)).toBeCloseTo(2 * s, 10)
    const wp = plasmaOmega(DEFAULT_N)
    expect(wp).toBeCloseTo(
      Math.sqrt((DEFAULT_N * E_CHARGE * E_CHARGE) / (EPS0 * M_E)),
      6,
    )
    expect(Number.isNaN(drudeSigma(1e28, 1e-14, 0))).toBe(true)
    expect(Number.isNaN(drudeSigma(NaN, 1e-14))).toBe(true)
    expect(Number.isNaN(plasmaOmega(-1))).toBe(true)
  })

  it('runDrudeSigmaSample: ok, formula, linear n/τ, plasma', () => {
    const r = runDrudeSigmaSample()
    expect(r.methodId).toBe(METHOD_ALGO_DRUDE_SIGMA)
    expect(r.familyId).toBe(METHOD_DRUDE)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.sigma).toBeCloseTo((r.n * r.e * r.e * r.tau) / r.m, 6)
    expect(r.sigma_doubleN).toBeCloseTo(2 * r.sigma, 10)
    expect(r.sigma_doubleTau).toBeCloseTo(2 * r.sigma, 10)
    expect(r.omega_p).toBeGreaterThan(0)
    expect(Number.isFinite(r.sigma_badM)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runDrudeSigmaSample({ n: 1e28, tau: 1e-14 }).ok).toBe(true)
  })
})

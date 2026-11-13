import { describe, it, expect } from 'vitest'
import {
  METHOD_NU,
  METHOD_ALGO_NU,
  METHOD_PR,
  METHOD_ALGO_PR,
  NU_PARENT,
  PR_PARENT,
  NU_METHOD_IDS,
  PR_METHOD_IDS,
  DEFAULT_H,
  DEFAULT_L,
  DEFAULT_K,
  DEFAULT_MU,
  DEFAULT_CP,
  nusseltNumber,
  prandtlNumber,
  runNusseltSample,
  runPrandtlSample,
} from './nusselt-prandtl-algos'

describe('Nusselt · Nu = h L / k', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_NU).toBe('method-nusselt-number')
    expect(METHOD_ALGO_NU).toBe('method-algo-nusselt')
    expect(NU_PARENT).toBe(METHOD_NU)
    expect(NU_METHOD_IDS).toContain(METHOD_ALGO_NU)
  })

  it('nusseltNumber: formula', () => {
    expect(nusseltNumber(100, 0.1, 0.6)).toBeCloseTo(100 * 0.1 / 0.6, 12)
    expect(nusseltNumber(DEFAULT_H, DEFAULT_L, DEFAULT_K)).toBeCloseTo(
      (DEFAULT_H * DEFAULT_L) / DEFAULT_K,
      10,
    )
  })

  it('∝ h, L; ∝ 1/k; k≤0 / non-finite → NaN', () => {
    const Nu = nusseltNumber(100, 0.1, 0.6)
    expect(nusseltNumber(200, 0.1, 0.6)).toBeCloseTo(2 * Nu, 10)
    expect(nusseltNumber(100, 0.1, 0.3)).toBeCloseTo(2 * Nu, 10)
    expect(Number.isNaN(nusseltNumber(100, 0.1, 0))).toBe(true)
    expect(Number.isNaN(nusseltNumber(NaN, 0.1, 0.6))).toBe(true)
  })

  it('runNusseltSample: ok, formula, linear h, half k', () => {
    const r = runNusseltSample()
    expect(r.methodId).toBe(METHOD_ALGO_NU)
    expect(r.familyId).toBe(METHOD_NU)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Nu).toBeCloseTo((r.h * r.L) / r.k, 10)
    expect(r.Nu_doubleH).toBeCloseTo(2 * r.Nu, 10)
    expect(r.Nu_halfK).toBeCloseTo(2 * r.Nu, 10)
    expect(Number.isFinite(r.Nu_badK)).toBe(false)
  })
})

describe('Prandtl · Pr = μ cp / k', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_PR).toBe('method-prandtl-number')
    expect(METHOD_ALGO_PR).toBe('method-algo-prandtl')
    expect(PR_PARENT).toBe(METHOD_PR)
    expect(PR_METHOD_IDS).toContain(METHOD_ALGO_PR)
  })

  it('prandtlNumber: formula', () => {
    // water-class: μ=1e-3, cp=4180, k=0.6 → Pr ≈ 6.97
    expect(prandtlNumber(1e-3, 4180, 0.6)).toBeCloseTo((1e-3 * 4180) / 0.6, 10)
    expect(prandtlNumber(DEFAULT_MU, DEFAULT_CP, DEFAULT_K)).toBeCloseTo(
      (DEFAULT_MU * DEFAULT_CP) / DEFAULT_K,
      10,
    )
  })

  it('∝ μ, cp; ∝ 1/k; k≤0 → NaN', () => {
    const Pr = prandtlNumber(1e-3, 4180, 0.6)
    expect(prandtlNumber(2e-3, 4180, 0.6)).toBeCloseTo(2 * Pr, 10)
    expect(prandtlNumber(1e-3, 4180, 0.3)).toBeCloseTo(2 * Pr, 10)
    expect(Number.isNaN(prandtlNumber(1e-3, 4180, 0))).toBe(true)
    expect(Number.isNaN(prandtlNumber(NaN, 4180, 0.6))).toBe(true)
  })

  it('runPrandtlSample: ok, formula, linear μ, half k', () => {
    const r = runPrandtlSample()
    expect(r.methodId).toBe(METHOD_ALGO_PR)
    expect(r.familyId).toBe(METHOD_PR)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Pr).toBeCloseTo((r.mu * r.cp) / r.k, 10)
    expect(r.Pr_doubleMu).toBeCloseTo(2 * r.Pr, 10)
    expect(r.Pr_halfK).toBeCloseTo(2 * r.Pr, 10)
    expect(Number.isFinite(r.Pr_badK)).toBe(false)
  })
})

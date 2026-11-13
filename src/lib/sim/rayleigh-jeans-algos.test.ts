import { describe, it, expect } from 'vitest'
import {
  METHOD_RJ,
  METHOD_ALGO_RJ_B,
  RJ_PARENT,
  RJ_METHOD_IDS,
  K_B,
  C_LIGHT,
  DEFAULT_NU,
  DEFAULT_T,
  rayleighJeansB,
  runRayleighJeansBSample,
} from './rayleigh-jeans-algos'

describe('Rayleigh–Jeans · B_ν = 2 ν² k T / c²', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_RJ).toBe('method-rayleigh-jeans')
    expect(METHOD_ALGO_RJ_B).toBe('method-algo-rj-b')
    expect(RJ_PARENT).toBe(METHOD_RJ)
    expect(RJ_METHOD_IDS).toContain(METHOD_ALGO_RJ_B)
  })

  it('rayleighJeansB: formula', () => {
    const nu = 1e10
    const T = 300
    const expected = (2 * nu * nu * K_B * T) / (C_LIGHT * C_LIGHT)
    expect(rayleighJeansB(nu, T)).toBeCloseTo(expected, 20)
    expect(rayleighJeansB(DEFAULT_NU, DEFAULT_T)).toBeCloseTo(
      (2 * DEFAULT_NU * DEFAULT_NU * K_B * DEFAULT_T) / (C_LIGHT * C_LIGHT),
      20,
    )
  })

  it('∝ ν², T; T=0 or ν=0 ⇒ 0; bad → NaN', () => {
    const B = rayleighJeansB(1e10, 300)
    expect(rayleighJeansB(2e10, 300)).toBeCloseTo(4 * B, 18)
    expect(rayleighJeansB(1e10, 600)).toBeCloseTo(2 * B, 18)
    expect(rayleighJeansB(1e10, 0)).toBe(0)
    expect(rayleighJeansB(0, 300)).toBe(0)
    expect(Number.isNaN(rayleighJeansB(-1, 300))).toBe(true)
    expect(Number.isNaN(rayleighJeansB(1e10, -1))).toBe(true)
    expect(Number.isNaN(rayleighJeansB(NaN, 300))).toBe(true)
  })

  it('runRayleighJeansBSample: ok, formula, ∝ν², ∝T', () => {
    const r = runRayleighJeansBSample()
    expect(r.methodId).toBe(METHOD_ALGO_RJ_B)
    expect(r.familyId).toBe(METHOD_RJ)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.B).toBeCloseTo(
      (2 * r.nu * r.nu * K_B * r.T) / (C_LIGHT * C_LIGHT),
      18,
    )
    expect(r.B_doubleNu).toBeCloseTo(4 * r.B, 16)
    expect(r.B_doubleT).toBeCloseTo(2 * r.B, 16)
    expect(r.B_zeroT).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runRayleighJeansBSample({ nu: 1e9, T: 100 }).ok).toBe(true)
  })
})

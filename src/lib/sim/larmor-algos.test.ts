import { describe, it, expect } from 'vitest'
import {
  METHOD_LARMOR,
  METHOD_ALGO_LARMOR_W,
  LARMOR_PARENT,
  LARMOR_METHOD_IDS,
  DEFAULT_GAMMA,
  DEFAULT_B,
  larmorOmega,
  runLarmorOmegaSample,
} from './larmor-algos'

describe('Larmor · ω = γ B precession', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_LARMOR).toBe('method-larmor-precession')
    expect(METHOD_ALGO_LARMOR_W).toBe('method-algo-larmor-omega')
    expect(LARMOR_PARENT).toBe(METHOD_LARMOR)
    expect(LARMOR_METHOD_IDS).toContain(METHOD_ALGO_LARMOR_W)
  })

  it('larmorOmega: ω = γ · B', () => {
    expect(larmorOmega(2, 3)).toBeCloseTo(6, 12)
    expect(larmorOmega(DEFAULT_GAMMA, DEFAULT_B)).toBeCloseTo(
      DEFAULT_GAMMA * DEFAULT_B,
      6,
    )
    expect(larmorOmega(DEFAULT_GAMMA, 0)).toBe(0)
  })

  it('linear in γ,B; non-finite → NaN', () => {
    const w = larmorOmega(DEFAULT_GAMMA, DEFAULT_B)
    expect(larmorOmega(DEFAULT_GAMMA, 2 * DEFAULT_B)).toBeCloseTo(2 * w, 10)
    expect(larmorOmega(2 * DEFAULT_GAMMA, DEFAULT_B)).toBeCloseTo(2 * w, 10)
    expect(Number.isNaN(larmorOmega(NaN, 1))).toBe(true)
    expect(Number.isNaN(larmorOmega(1, Infinity))).toBe(true)
  })

  it('runLarmorOmegaSample: ok, formula, linear', () => {
    const r = runLarmorOmegaSample()
    expect(r.methodId).toBe(METHOD_ALGO_LARMOR_W)
    expect(r.familyId).toBe(METHOD_LARMOR)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.omega).toBeCloseTo(r.gamma * r.B, 10)
    expect(r.omega_doubleB).toBeCloseTo(2 * r.omega, 10)
    expect(r.omega_doubleGamma).toBeCloseTo(2 * r.omega, 10)
    expect(r.omega_zeroB).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runLarmorOmegaSample({ gamma: 1e8, B: 3 }).ok).toBe(true)
  })
})

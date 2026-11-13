import { describe, it, expect } from 'vitest'
import {
  METHOD_MACH,
  METHOD_ALGO_MACH,
  METHOD_KN,
  METHOD_ALGO_KN,
  MACH_PARENT,
  KN_PARENT,
  MACH_METHOD_IDS,
  KN_METHOD_IDS,
  DEFAULT_U,
  DEFAULT_A,
  DEFAULT_LAMBDA,
  DEFAULT_L,
  machNumber,
  knudsenNumber,
  runMachSample,
  runKnudsenSample,
} from './mach-knudsen-algos'

describe('Mach · M = U / a', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_MACH).toBe('method-mach-number')
    expect(METHOD_ALGO_MACH).toBe('method-algo-mach')
    expect(MACH_PARENT).toBe(METHOD_MACH)
    expect(MACH_METHOD_IDS).toContain(METHOD_ALGO_MACH)
  })

  it('machNumber: formula', () => {
    expect(machNumber(340, 340)).toBeCloseTo(1, 12)
    expect(machNumber(DEFAULT_U, DEFAULT_A)).toBeCloseTo(
      DEFAULT_U / DEFAULT_A,
      12,
    )
  })

  it('∝ U; ∝ 1/a; a≤0 / non-finite → NaN', () => {
    const M = machNumber(100, 340)
    expect(machNumber(200, 340)).toBeCloseTo(2 * M, 12)
    expect(machNumber(100, 170)).toBeCloseTo(2 * M, 12)
    expect(Number.isNaN(machNumber(100, 0))).toBe(true)
    expect(Number.isNaN(machNumber(NaN, 340))).toBe(true)
  })

  it('runMachSample: ok, formula, linear U', () => {
    const r = runMachSample()
    expect(r.methodId).toBe(METHOD_ALGO_MACH)
    expect(r.familyId).toBe(METHOD_MACH)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.M).toBeCloseTo(r.U / r.a, 12)
    expect(r.M_doubleU).toBeCloseTo(2 * r.M, 12)
    expect(r.M_halfA).toBeCloseTo(2 * r.M, 12)
    expect(Number.isFinite(r.M_badA)).toBe(false)
  })
})

describe('Knudsen · Kn = λ / L', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_KN).toBe('method-knudsen-number')
    expect(METHOD_ALGO_KN).toBe('method-algo-knudsen')
    expect(KN_PARENT).toBe(METHOD_KN)
    expect(KN_METHOD_IDS).toContain(METHOD_ALGO_KN)
  })

  it('knudsenNumber: formula', () => {
    expect(knudsenNumber(1e-7, 1e-3)).toBeCloseTo(1e-4, 12)
    expect(knudsenNumber(DEFAULT_LAMBDA, DEFAULT_L)).toBeCloseTo(
      DEFAULT_LAMBDA / DEFAULT_L,
      12,
    )
  })

  it('∝ λ; ∝ 1/L; L≤0 → NaN', () => {
    const Kn = knudsenNumber(1e-7, 1e-3)
    expect(knudsenNumber(2e-7, 1e-3)).toBeCloseTo(2 * Kn, 12)
    expect(knudsenNumber(1e-7, 5e-4)).toBeCloseTo(2 * Kn, 12)
    expect(Number.isNaN(knudsenNumber(1e-7, 0))).toBe(true)
    expect(Number.isNaN(knudsenNumber(NaN, 1e-3))).toBe(true)
  })

  it('runKnudsenSample: ok, formula, linear λ', () => {
    const r = runKnudsenSample()
    expect(r.methodId).toBe(METHOD_ALGO_KN)
    expect(r.familyId).toBe(METHOD_KN)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Kn).toBeCloseTo(r.lambda / r.L, 12)
    expect(r.Kn_doubleLambda).toBeCloseTo(2 * r.Kn, 12)
    expect(r.Kn_halfL).toBeCloseTo(2 * r.Kn, 12)
    expect(Number.isFinite(r.Kn_badL)).toBe(false)
  })
})

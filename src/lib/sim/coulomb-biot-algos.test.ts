import { describe, it, expect } from 'vitest'
import {
  METHOD_COULOMB,
  METHOD_ALGO_COULOMB_F,
  METHOD_BIOT,
  METHOD_ALGO_BIOT_B,
  COULOMB_PARENT,
  BIOT_PARENT,
  COULOMB_METHOD_IDS,
  BIOT_METHOD_IDS,
  K_COULOMB,
  MU0_OVER_2PI,
  DEFAULT_Q1,
  DEFAULT_Q2,
  DEFAULT_R_COULOMB,
  DEFAULT_I,
  DEFAULT_R_WIRE,
  coulombForce,
  biotWireB,
  runCoulombForceSample,
  runBiotBSample,
} from './coulomb-biot-algos'

describe('Coulomb · F = k |q1 q2| / r²', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_COULOMB).toBe('method-coulomb-law')
    expect(METHOD_ALGO_COULOMB_F).toBe('method-algo-coulomb-force')
    expect(COULOMB_PARENT).toBe(METHOD_COULOMB)
    expect(COULOMB_METHOD_IDS).toContain(METHOD_ALGO_COULOMB_F)
    expect(K_COULOMB).toBe(8.99e9)
  })

  it('coulombForce: formula', () => {
    const F = coulombForce(1e-6, 1e-6, 0.1)
    expect(F).toBeCloseTo((K_COULOMB * 1e-12) / 0.01, 8)
    expect(F).toBeGreaterThan(0)
  })

  it('∝ 1/r²; magnitude ignores sign; r≤0 → NaN', () => {
    const F = coulombForce(DEFAULT_Q1, DEFAULT_Q2, DEFAULT_R_COULOMB)
    expect(
      coulombForce(DEFAULT_Q1, DEFAULT_Q2, 2 * DEFAULT_R_COULOMB),
    ).toBeCloseTo(F / 4, 10)
    expect(coulombForce(-1e-6, 1e-6, 0.1)).toBeCloseTo(
      coulombForce(1e-6, 1e-6, 0.1),
      12,
    )
    expect(Number.isNaN(coulombForce(1, 1, 0))).toBe(true)
    expect(Number.isNaN(coulombForce(1, 1, -1))).toBe(true)
    expect(Number.isNaN(coulombForce(NaN, 1, 1))).toBe(true)
  })

  it('runCoulombForceSample: ok, formula, 1/r²', () => {
    const r = runCoulombForceSample()
    expect(r.methodId).toBe(METHOD_ALGO_COULOMB_F)
    expect(r.familyId).toBe(METHOD_COULOMB)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.F).toBeCloseTo(
      (r.k * Math.abs(r.q1 * r.q2)) / (r.r * r.r),
      10,
    )
    expect(r.F_doubleR).toBeCloseTo(r.F / 4, 10)
    expect(Number.isFinite(r.F_badR)).toBe(false)
  })
})

describe('Biot–Savart · B = 2e-7 · I / r (long wire)', () => {
  it('method id constants', () => {
    expect(METHOD_BIOT).toBe('method-biot-savart')
    expect(METHOD_ALGO_BIOT_B).toBe('method-algo-biot-b')
    expect(BIOT_PARENT).toBe(METHOD_BIOT)
    expect(BIOT_METHOD_IDS).toContain(METHOD_ALGO_BIOT_B)
    expect(MU0_OVER_2PI).toBe(2e-7)
  })

  it('biotWireB: formula', () => {
    const B = biotWireB(10, 0.05)
    expect(B).toBeCloseTo((2e-7 * 10) / 0.05, 14)
    // 40 µT
    expect(B).toBeCloseTo(4e-5, 12)
  })

  it('∝ I, 1/r; r≤0 → NaN', () => {
    const B = biotWireB(DEFAULT_I, DEFAULT_R_WIRE)
    expect(biotWireB(2 * DEFAULT_I, DEFAULT_R_WIRE)).toBeCloseTo(2 * B, 14)
    expect(biotWireB(DEFAULT_I, 2 * DEFAULT_R_WIRE)).toBeCloseTo(B / 2, 14)
    expect(Number.isNaN(biotWireB(1, 0))).toBe(true)
    expect(Number.isNaN(biotWireB(NaN, 1))).toBe(true)
  })

  it('runBiotBSample: ok, formula, scalings', () => {
    const r = runBiotBSample()
    expect(r.methodId).toBe(METHOD_ALGO_BIOT_B)
    expect(r.familyId).toBe(METHOD_BIOT)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.B).toBeCloseTo((r.mu0Over2pi * Math.abs(r.I)) / r.r, 14)
    expect(r.B_doubleI).toBeCloseTo(2 * r.B, 14)
    expect(r.B_doubleR).toBeCloseTo(r.B / 2, 14)
    expect(Number.isFinite(r.B_badR)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runCoulombForceSample({ q1: 2e-6, q2: 3e-6, r: 0.2 }).ok).toBe(
      true,
    )
    expect(runBiotBSample({ I: 5, r: 0.1 }).ok).toBe(true)
  })
})

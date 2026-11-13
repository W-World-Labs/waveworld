import { describe, it, expect } from 'vitest'
import {
  METHOD_BORN_LANDE,
  METHOD_ALGO_BORN_LANDE_U,
  BORN_LANDE_PARENT,
  BORN_LANDE_METHOD_IDS,
  EPS0,
  E_CHARGE,
  DEFAULT_A,
  DEFAULT_R0,
  DEFAULT_N_BORN,
  DEFAULT_N,
  bornLandeU,
  runBornLandeUSample,
} from './born-lande-algos'

describe('Born–Landé · U = −(N A e²)/(4π ε0 r0)·(1−1/n)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_BORN_LANDE).toBe('method-born-lande')
    expect(METHOD_ALGO_BORN_LANDE_U).toBe('method-algo-born-lande-u')
    expect(BORN_LANDE_PARENT).toBe(METHOD_BORN_LANDE)
    expect(BORN_LANDE_METHOD_IDS).toContain(METHOD_ALGO_BORN_LANDE_U)
  })

  it('bornLandeU: formula, U < 0', () => {
    const A = DEFAULT_A
    const r0 = DEFAULT_R0
    const n = DEFAULT_N_BORN
    const N = DEFAULT_N
    const coulomb =
      (N * A * E_CHARGE * E_CHARGE) / (4 * Math.PI * EPS0 * r0)
    const expected = -coulomb * (1 - 1 / n)
    expect(bornLandeU(A, r0, n, N)).toBeCloseTo(expected, 8)
    expect(bornLandeU(A, r0, n, N)).toBeLessThan(0)
  })

  it('2× r0 ⇒ |U|/2; n≤1 or r0≤0 → NaN', () => {
    const U = bornLandeU(DEFAULT_A, DEFAULT_R0, DEFAULT_N_BORN)
    expect(bornLandeU(DEFAULT_A, 2 * DEFAULT_R0, DEFAULT_N_BORN)).toBeCloseTo(
      U / 2,
      10,
    )
    expect(Number.isNaN(bornLandeU(DEFAULT_A, 0, 9))).toBe(true)
    expect(Number.isNaN(bornLandeU(DEFAULT_A, DEFAULT_R0, 1))).toBe(true)
    expect(Number.isNaN(bornLandeU(DEFAULT_A, DEFAULT_R0, 0.5))).toBe(true)
    expect(Number.isNaN(bornLandeU(NaN, DEFAULT_R0, 9))).toBe(true)
  })

  it('runBornLandeUSample: ok, formula, large-n limit', () => {
    const r = runBornLandeUSample()
    expect(r.methodId).toBe(METHOD_ALGO_BORN_LANDE_U)
    expect(r.familyId).toBe(METHOD_BORN_LANDE)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.U).toBeLessThan(0)
    expect(r.U_doubleR).toBeCloseTo(r.U / 2, 10)
    expect(Number.isFinite(r.U_badR)).toBe(false)
    expect(Number.isFinite(r.U_badN)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runBornLandeUSample({ n: 8, r0: 3e-10 }).ok).toBe(true)
  })
})

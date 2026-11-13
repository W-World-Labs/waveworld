import { describe, it, expect } from 'vitest'
import {
  METHOD_MADELUNG,
  METHOD_ALGO_MADELUNG_U,
  MADELUNG_PARENT,
  MADELUNG_METHOD_IDS,
  K_COULOMB,
  DEFAULT_A,
  DEFAULT_Q,
  DEFAULT_R0,
  DEFAULT_N,
  madelungU,
  runMadelungUSample,
} from './madelung-algos'

describe('Madelung · U = −N A k q² / r0', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_MADELUNG).toBe('method-madelung')
    expect(METHOD_ALGO_MADELUNG_U).toBe('method-algo-madelung-u')
    expect(MADELUNG_PARENT).toBe(METHOD_MADELUNG)
    expect(MADELUNG_METHOD_IDS).toContain(METHOD_ALGO_MADELUNG_U)
  })

  it('madelungU: U = −N A k q² / r', () => {
    const U = madelungU(DEFAULT_A, DEFAULT_R0, DEFAULT_Q, DEFAULT_N)
    expect(U).toBeCloseTo(
      -((DEFAULT_N * DEFAULT_A * K_COULOMB * DEFAULT_Q * DEFAULT_Q) /
        DEFAULT_R0),
      6,
    )
    expect(U).toBeLessThan(0)
  })

  it('larger r ⇒ half |U|; r≤0 → NaN', () => {
    const U = madelungU(DEFAULT_A, DEFAULT_R0)
    expect(madelungU(DEFAULT_A, 2 * DEFAULT_R0)).toBeCloseTo(U / 2, 10)
    expect(madelungU(2 * DEFAULT_A, DEFAULT_R0)).toBeCloseTo(2 * U, 10)
    expect(Number.isNaN(madelungU(1, 0))).toBe(true)
    expect(Number.isNaN(madelungU(NaN, 1))).toBe(true)
  })

  it('runMadelungUSample: ok, formula, scales', () => {
    const r = runMadelungUSample()
    expect(r.methodId).toBe(METHOD_ALGO_MADELUNG_U)
    expect(r.familyId).toBe(METHOD_MADELUNG)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.U).toBeCloseTo(
      -((r.N * r.A * K_COULOMB * r.q * r.q) / r.r0),
      6,
    )
    expect(r.U_doubleR).toBeCloseTo(r.U / 2, 10)
    expect(r.U_doubleA).toBeCloseTo(2 * r.U, 10)
    expect(r.U).toBeLessThan(0)
    expect(Number.isFinite(r.U_badR)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runMadelungUSample({ A: 1.7, r0: 3e-10, N: 2 }).ok).toBe(true)
  })
})

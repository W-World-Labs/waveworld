import { describe, it, expect } from 'vitest'
import {
  METHOD_VIRIAL,
  METHOD_ALGO_VIRIAL_T,
  VIRIAL_PARENT,
  VIRIAL_METHOD_IDS,
  K_B,
  DEFAULT_K,
  DEFAULT_N,
  DEFAULT_P,
  DEFAULT_V,
  virialTempFromKE,
  virialTempFromPV,
  runVirialTSample,
} from './virial-algos'

describe('Virial · T from KE and PV = NkT', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_VIRIAL).toBe('method-virial')
    expect(METHOD_ALGO_VIRIAL_T).toBe('method-algo-virial-t')
    expect(VIRIAL_PARENT).toBe(METHOD_VIRIAL)
    expect(VIRIAL_METHOD_IDS).toContain(METHOD_ALGO_VIRIAL_T)
  })

  it('virialTempFromKE: T = 2K/(3 N k)', () => {
    // K = (3/2) N k T with N=1, T=300 ⇒ K = 1.5 * k * 300
    const T = 300
    const K = 1.5 * K_B * T
    expect(virialTempFromKE(K, 1)).toBeCloseTo(T, 8)
    expect(virialTempFromKE(DEFAULT_K, DEFAULT_N)).toBeCloseTo(
      (2 * DEFAULT_K) / (3 * DEFAULT_N * K_B),
      8,
    )
  })

  it('virialTempFromPV: T = PV/(N k)', () => {
    expect(virialTempFromPV(DEFAULT_P, DEFAULT_V, DEFAULT_N)).toBeCloseTo(
      (DEFAULT_P * DEFAULT_V) / (DEFAULT_N * K_B),
      6,
    )
  })

  it('linear in K; N≤0 → NaN', () => {
    const t = virialTempFromKE(DEFAULT_K, 1)
    expect(virialTempFromKE(2 * DEFAULT_K, 1)).toBeCloseTo(2 * t, 10)
    expect(Number.isNaN(virialTempFromKE(1, 0))).toBe(true)
    expect(Number.isNaN(virialTempFromPV(1, 1, 0))).toBe(true)
    expect(Number.isNaN(virialTempFromKE(NaN, 1))).toBe(true)
  })

  it('runVirialTSample: ok, formula, double K', () => {
    const r = runVirialTSample()
    expect(r.methodId).toBe(METHOD_ALGO_VIRIAL_T)
    expect(r.familyId).toBe(METHOD_VIRIAL)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.T_ke).toBeCloseTo((2 * r.K) / (3 * r.N * K_B), 8)
    expect(r.T_doubleK).toBeCloseTo(2 * r.T_ke, 10)
    expect(r.T_pv).toBeCloseTo((r.P * r.V) / (r.N * K_B), 6)
    expect(Number.isFinite(r.T_badN)).toBe(false)
  })
})

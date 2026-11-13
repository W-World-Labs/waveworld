import { describe, it, expect } from 'vitest'
import {
  METHOD_WKB,
  METHOD_ALGO_WKB_T,
  WKB_PARENT,
  WKB_METHOD_IDS,
  HBAR,
  M_E,
  DEFAULT_K,
  DEFAULT_L,
  DEFAULT_V_MINUS_E,
  wkbTransmission,
  wkbKappa,
  wkbTransmissionFromEnergy,
  runWkbTSample,
} from './wkb-tunnel-algos'

describe('WKB tunneling · T = exp(−2 k L)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_WKB).toBe('method-wkb-tunneling')
    expect(METHOD_ALGO_WKB_T).toBe('method-algo-wkb-transmission')
    expect(WKB_PARENT).toBe(METHOD_WKB)
    expect(WKB_METHOD_IDS).toContain(METHOD_ALGO_WKB_T)
    expect(HBAR).toBeCloseTo(1.054571817e-34, 20)
  })

  it('wkbTransmission: formula; L=0 ⇒ T=1', () => {
    expect(wkbTransmission(DEFAULT_K, DEFAULT_L)).toBeCloseTo(
      Math.exp(-2 * DEFAULT_K * DEFAULT_L),
      12,
    )
    expect(wkbTransmission(DEFAULT_K, 0)).toBeCloseTo(1, 15)
  })

  it('T(2L)=T²; κ from energy; bad inputs → NaN', () => {
    const T = wkbTransmission(DEFAULT_K, DEFAULT_L)
    expect(wkbTransmission(DEFAULT_K, 2 * DEFAULT_L)).toBeCloseTo(T * T, 12)
    const kappa = wkbKappa(DEFAULT_V_MINUS_E)
    expect(kappa).toBeCloseTo(
      Math.sqrt(2 * M_E * DEFAULT_V_MINUS_E) / HBAR,
      6,
    )
    expect(wkbTransmissionFromEnergy(DEFAULT_V_MINUS_E, DEFAULT_L)).toBeCloseTo(
      Math.exp(-2 * kappa * DEFAULT_L),
      10,
    )
    expect(Number.isNaN(wkbTransmission(-1, 1e-9))).toBe(true)
    expect(Number.isNaN(wkbKappa(0))).toBe(true)
    expect(Number.isNaN(wkbTransmission(NaN, 1))).toBe(true)
  })

  it('runWkbTSample: ok, formula, double L, energy form', () => {
    const r = runWkbTSample()
    expect(r.methodId).toBe(METHOD_ALGO_WKB_T)
    expect(r.familyId).toBe(METHOD_WKB)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.T).toBeCloseTo(Math.exp(-2 * r.k * r.L), 12)
    expect(r.T_doubleL).toBeCloseTo(r.T * r.T, 10)
    expect(r.T_zeroL).toBeCloseTo(1, 15)
    expect(r.T).toBeGreaterThan(0)
    expect(r.T).toBeLessThanOrEqual(1)
  })

  it('custom params still ok', () => {
    expect(runWkbTSample({ k: 5e8, L: 2e-9 }).ok).toBe(true)
  })
})

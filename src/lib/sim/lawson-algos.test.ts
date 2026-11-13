import { describe, it, expect } from 'vitest'
import {
  METHOD_LAWSON,
  METHOD_ALGO_LAWSON_NTT,
  LAWSON_PARENT,
  LAWSON_METHOD_IDS,
  DEFAULT_N,
  DEFAULT_T,
  DEFAULT_TAU,
  lawsonNTau,
  tripleProduct,
  runLawsonNttSample,
} from './lawson-algos'

describe('Lawson · nτ + triple product nTτ', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_LAWSON).toBe('method-lawson-criterion')
    expect(METHOD_ALGO_LAWSON_NTT).toBe('method-algo-lawson-ntt')
    expect(LAWSON_PARENT).toBe(METHOD_LAWSON)
    expect(LAWSON_METHOD_IDS).toContain(METHOD_ALGO_LAWSON_NTT)
  })

  it('lawsonNTau: n·τ', () => {
    expect(lawsonNTau(1e20, 1)).toBeCloseTo(1e20, 6)
    expect(lawsonNTau(DEFAULT_N, DEFAULT_TAU)).toBeCloseTo(
      DEFAULT_N * DEFAULT_TAU,
      6,
    )
    expect(lawsonNTau(0, 5)).toBe(0)
  })

  it('tripleProduct: n·T·τ', () => {
    expect(tripleProduct(1e20, 10, 1)).toBeCloseTo(1e21, 6)
    expect(tripleProduct(DEFAULT_N, DEFAULT_T, DEFAULT_TAU)).toBeCloseTo(
      DEFAULT_N * DEFAULT_T * DEFAULT_TAU,
      6,
    )
  })

  it('linear scalings; bad → NaN', () => {
    const nt = lawsonNTau(1e20, 2)
    expect(lawsonNTau(2e20, 2)).toBeCloseTo(2 * nt, 6)
    const tp = tripleProduct(1e20, 10, 1)
    expect(tripleProduct(1e20, 20, 1)).toBeCloseTo(2 * tp, 6)
    expect(Number.isNaN(lawsonNTau(-1, 1))).toBe(true)
    expect(Number.isNaN(tripleProduct(1, -1, 1))).toBe(true)
    expect(Number.isNaN(tripleProduct(NaN, 1, 1))).toBe(true)
  })

  it('runLawsonNttSample: ok, formulas, scalings', () => {
    const r = runLawsonNttSample()
    expect(r.methodId).toBe(METHOD_ALGO_LAWSON_NTT)
    expect(r.familyId).toBe(METHOD_LAWSON)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.nTau).toBeCloseTo(r.n * r.tau, 6)
    expect(r.nTTau).toBeCloseTo(r.n * r.T * r.tau, 6)
    expect(r.nTau_doubleN).toBeCloseTo(2 * r.nTau, 6)
    expect(r.nTTau_doubleT).toBeCloseTo(2 * r.nTTau, 6)
    expect(Number.isFinite(r.nTau_bad)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runLawsonNttSample({ n: 5e19, T: 15, tau: 2 }).ok).toBe(true)
  })
})

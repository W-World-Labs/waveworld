import { describe, it, expect } from 'vitest'
import {
  METHOD_VARSHNI,
  METHOD_ALGO_VARSHNI_EG,
  VARSHNI_PARENT,
  VARSHNI_METHOD_IDS,
  DEFAULT_EG0,
  DEFAULT_A,
  DEFAULT_B,
  DEFAULT_T,
  varshniEg,
  runVarshniEgSample,
} from './varshni-algos'

describe('Varshni · Eg(T) = Eg0 − a T²/(T+b)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_VARSHNI).toBe('method-varshni')
    expect(METHOD_ALGO_VARSHNI_EG).toBe('method-algo-varshni-eg')
    expect(VARSHNI_PARENT).toBe(METHOD_VARSHNI)
    expect(VARSHNI_METHOD_IDS).toContain(METHOD_ALGO_VARSHNI_EG)
  })

  it('varshniEg: formula; Eg(0)=Eg0', () => {
    expect(varshniEg(DEFAULT_EG0, DEFAULT_A, DEFAULT_B, 0)).toBeCloseTo(
      DEFAULT_EG0,
      12,
    )
    const expected =
      DEFAULT_EG0 -
      (DEFAULT_A * DEFAULT_T * DEFAULT_T) / (DEFAULT_T + DEFAULT_B)
    expect(varshniEg(DEFAULT_EG0, DEFAULT_A, DEFAULT_B, DEFAULT_T)).toBeCloseTo(
      expected,
      12,
    )
  })

  it('shrinks with T; bad → NaN', () => {
    const Eg300 = varshniEg(1.17, 4.73e-4, 636, 300)
    const Eg600 = varshniEg(1.17, 4.73e-4, 636, 600)
    expect(Eg300).toBeLessThan(1.17)
    expect(Eg600).toBeLessThan(Eg300)
    expect(Number.isNaN(varshniEg(1, 1e-4, 100, -1))).toBe(true)
    expect(Number.isNaN(varshniEg(NaN, 1e-4, 100, 300))).toBe(true)
  })

  it('runVarshniEgSample: ok, formula, methodId/familyId', () => {
    const r = runVarshniEgSample()
    expect(r.methodId).toBe(METHOD_ALGO_VARSHNI_EG)
    expect(r.familyId).toBe(METHOD_VARSHNI)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Eg).toBeCloseTo(r.Eg0 - (r.a * r.T * r.T) / (r.T + r.b), 12)
    expect(r.Eg_zero).toBeCloseTo(r.Eg0, 12)
    expect(r.Eg_hot).toBeLessThan(r.Eg)
  })

  it('custom params still ok', () => {
    expect(runVarshniEgSample({ Eg0: 1.52, a: 5.4e-4, b: 204, T: 300 }).ok).toBe(
      true,
    )
  })
})

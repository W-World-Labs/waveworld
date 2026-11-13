import { describe, it, expect } from 'vitest'
import {
  METHOD_MTF,
  METHOD_ALGO_MTF,
  MTF_PARENT,
  MTF_METHOD_IDS,
  DEFAULT_IMAX,
  DEFAULT_IMIN,
  mtfContrast,
  runMtfSample,
} from './mtf-algos'

describe('MTF · contrast = (Imax−Imin)/(Imax+Imin)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_MTF).toBe('method-mtf')
    expect(METHOD_ALGO_MTF).toBe('method-algo-mtf-contrast')
    expect(MTF_PARENT).toBe(METHOD_MTF)
    expect(MTF_METHOD_IDS).toContain(METHOD_ALGO_MTF)
  })

  it('mtfContrast: formula', () => {
    expect(mtfContrast(1, 0)).toBeCloseTo(1, 12)
    expect(mtfContrast(1, 1)).toBeCloseTo(0, 12)
    expect(mtfContrast(1, 0.5)).toBeCloseTo(1 / 3, 12)
    expect(mtfContrast(DEFAULT_IMAX, DEFAULT_IMIN)).toBeCloseTo(
      (DEFAULT_IMAX - DEFAULT_IMIN) / (DEFAULT_IMAX + DEFAULT_IMIN),
      12,
    )
  })

  it('sum=0 / non-finite → NaN', () => {
    expect(Number.isNaN(mtfContrast(0, 0))).toBe(true)
    expect(Number.isNaN(mtfContrast(1, -1))).toBe(true)
    expect(Number.isNaN(mtfContrast(NaN, 0.5))).toBe(true)
    expect(Number.isNaN(mtfContrast(1, Infinity))).toBe(true)
  })

  it('runMtfSample: ok, formula, full & flat contrast', () => {
    const r = runMtfSample()
    expect(r.methodId).toBe(METHOD_ALGO_MTF)
    expect(r.familyId).toBe(METHOD_MTF)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.MTF).toBeCloseTo((r.Imax - r.Imin) / (r.Imax + r.Imin), 12)
    expect(r.MTF_full).toBeCloseTo(1, 12)
    expect(r.MTF_flat).toBeCloseTo(0, 12)
    expect(Number.isFinite(r.MTF_bad)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runMtfSample({ Imax: 10, Imin: 2 }).ok).toBe(true)
  })
})

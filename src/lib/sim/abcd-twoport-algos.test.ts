import { describe, it, expect } from 'vitest'
import {
  METHOD_ABCD,
  METHOD_ALGO_ABCD_SERIES_Z,
  ABCD_PARENT,
  ABCD_METHOD_IDS,
  DEFAULT_Z,
  abcdSeriesZ,
  abcdCascade,
  runAbcdSeriesZSample,
} from './abcd-twoport-algos'

describe('ABCD two-port · series Z and cascade', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_ABCD).toBe('method-abcd-twoport')
    expect(METHOD_ALGO_ABCD_SERIES_Z).toBe('method-algo-abcd-series-z')
    expect(ABCD_PARENT).toBe(METHOD_ABCD)
    expect(ABCD_METHOD_IDS).toContain(METHOD_ALGO_ABCD_SERIES_Z)
  })

  it('abcdSeriesZ: A=1, B=Z, C=0, D=1', () => {
    const m = abcdSeriesZ(DEFAULT_Z)
    expect(m.A).toBe(1)
    expect(m.B).toBe(DEFAULT_Z)
    expect(m.C).toBe(0)
    expect(m.D).toBe(1)
    expect(m.A * m.D - m.B * m.C).toBeCloseTo(1, 15)
  })

  it('cascade of two series Z: B = Z1+Z2; bad → NaN', () => {
    const m1 = abcdSeriesZ(25)
    const m2 = abcdSeriesZ(75)
    const c = abcdCascade(m1, m2)
    expect(c.A).toBe(1)
    expect(c.B).toBeCloseTo(100, 12)
    expect(c.C).toBe(0)
    expect(c.D).toBe(1)
    expect(Number.isNaN(abcdSeriesZ(NaN).B)).toBe(true)
  })

  it('runAbcdSeriesZSample: ok, entries, cascade B=2Z', () => {
    const r = runAbcdSeriesZSample()
    expect(r.methodId).toBe(METHOD_ALGO_ABCD_SERIES_Z)
    expect(r.familyId).toBe(METHOD_ABCD)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.A).toBe(1)
    expect(r.B).toBe(r.Z)
    expect(r.C).toBe(0)
    expect(r.D).toBe(1)
    expect(r.cascadeB).toBeCloseTo(2 * r.Z, 12)
    expect(r.det).toBeCloseTo(1, 12)
    expect(Number.isFinite(r.badB)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runAbcdSeriesZSample({ Z: 75 }).ok).toBe(true)
  })
})

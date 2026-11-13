import { describe, it, expect } from 'vitest'
import {
  METHOD_MZ,
  METHOD_ALGO_MZ_I,
  MZ_PARENT,
  MZ_METHOD_IDS,
  DEFAULT_I0,
  DEFAULT_DELTA,
  mzIntensity,
  runMzISample,
} from './mach-zehnder-algos'

describe('Mach–Zehnder · I = I0 cos²(δ/2)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_MZ).toBe('method-mach-zehnder')
    expect(METHOD_ALGO_MZ_I).toBe('method-algo-mz-intensity')
    expect(MZ_PARENT).toBe(METHOD_MZ)
    expect(MZ_METHOD_IDS).toContain(METHOD_ALGO_MZ_I)
  })

  it('mzIntensity: formula; constructive / destructive', () => {
    expect(mzIntensity(0, 1)).toBeCloseTo(1, 12)
    expect(mzIntensity(Math.PI, 1)).toBeCloseTo(0, 12)
    expect(mzIntensity(Math.PI / 2, 2)).toBeCloseTo(1, 12)
    expect(mzIntensity(DEFAULT_DELTA, DEFAULT_I0)).toBeCloseTo(
      DEFAULT_I0 * Math.cos(DEFAULT_DELTA / 2) ** 2,
      12,
    )
  })

  it('∝ I0; bad → NaN', () => {
    const I = mzIntensity(1, 3)
    expect(mzIntensity(1, 6)).toBeCloseTo(2 * I, 12)
    expect(Number.isNaN(mzIntensity(0, -1))).toBe(true)
    expect(Number.isNaN(mzIntensity(NaN, 1))).toBe(true)
  })

  it('runMzISample: ok, formula, methodId/familyId', () => {
    const r = runMzISample()
    expect(r.methodId).toBe(METHOD_ALGO_MZ_I)
    expect(r.familyId).toBe(METHOD_MZ)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.I).toBeCloseTo(r.I0 * Math.cos(r.delta / 2) ** 2, 12)
    expect(r.I_constructive).toBeCloseTo(r.I0, 12)
    expect(r.I_destructive).toBeCloseTo(0, 12)
  })

  it('custom params still ok', () => {
    expect(runMzISample({ delta: Math.PI / 4, I0: 2 }).ok).toBe(true)
  })
})

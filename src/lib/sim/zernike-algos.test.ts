import { describe, it, expect } from 'vitest'
import {
  METHOD_ZERNIKE,
  METHOD_ALGO_ZERNIKE_DEFOCUS,
  ZERNIKE_PARENT,
  ZERNIKE_METHOD_IDS,
  DEFAULT_A20,
  zernikeDefocus,
  zernikePiston,
  zernikeDefocusRms,
  runZernikeDefocusSample,
} from './zernike-algos'

describe('Zernike · Z₂⁰ defocus = 2r² − 1', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_ZERNIKE).toBe('method-zernike')
    expect(METHOD_ALGO_ZERNIKE_DEFOCUS).toBe('method-algo-zernike-defocus')
    expect(ZERNIKE_PARENT).toBe(METHOD_ZERNIKE)
    expect(ZERNIKE_METHOD_IDS).toContain(METHOD_ALGO_ZERNIKE_DEFOCUS)
  })

  it('zernikeDefocus: endpoints and mid', () => {
    expect(zernikeDefocus(0)).toBeCloseTo(-1, 15)
    expect(zernikeDefocus(1)).toBeCloseTo(1, 15)
    expect(zernikeDefocus(0.5)).toBeCloseTo(-0.5, 15)
    expect(zernikePiston()).toBe(1)
  })

  it('RMS scales with |a20|; non-finite → NaN', () => {
    const r1 = zernikeDefocusRms(DEFAULT_A20, 32)
    const r2 = zernikeDefocusRms(2 * DEFAULT_A20, 32)
    expect(r2).toBeCloseTo(2 * r1, 10)
    expect(r1).toBeGreaterThan(0)
    expect(Number.isNaN(zernikeDefocus(NaN))).toBe(true)
    expect(Number.isNaN(zernikeDefocusRms(1, 1))).toBe(true)
  })

  it('runZernikeDefocusSample: ok, endpoints, RMS scale', () => {
    const r = runZernikeDefocusSample()
    expect(r.methodId).toBe(METHOD_ALGO_ZERNIKE_DEFOCUS)
    expect(r.familyId).toBe(METHOD_ZERNIKE)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Z0).toBeCloseTo(-1, 12)
    expect(r.Z1).toBeCloseTo(1, 12)
    expect(r.rms_double).toBeCloseTo(2 * r.rms, 10)
    expect(r.piston).toBe(1)
  })

  it('custom params still ok', () => {
    expect(runZernikeDefocusSample({ a20: 0.5, n: 16 }).ok).toBe(true)
  })
})

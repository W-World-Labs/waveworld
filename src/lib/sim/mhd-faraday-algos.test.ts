import { describe, it, expect } from 'vitest'
import {
  METHOD_MHD,
  METHOD_ALGO_MHD_EMF,
  MHD_PARENT,
  MHD_METHOD_IDS,
  mhdEmf,
  runMhdEmfSample,
} from './mhd-faraday-algos'

describe('MHD Faraday · ℰ = u B L', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_MHD).toBe('method-mhd-generator')
    expect(METHOD_ALGO_MHD_EMF).toBe('method-algo-mhd-emf')
    expect(MHD_PARENT).toBe(METHOD_MHD)
    expect(MHD_METHOD_IDS).toContain(METHOD_ALGO_MHD_EMF)
  })

  it('mhdEmf: ℰ = u · B · L', () => {
    expect(mhdEmf(1000, 2, 0.5)).toBeCloseTo(1000, 12)
    expect(mhdEmf(100, 1, 1)).toBe(100)
    expect(mhdEmf(0, 2, 1)).toBe(0)
  })

  it('mhdEmf: linear in u, B, L', () => {
    const base = mhdEmf(200, 1.5, 0.4)
    expect(mhdEmf(400, 1.5, 0.4)).toBeCloseTo(2 * base, 12)
    expect(mhdEmf(200, 3, 0.4)).toBeCloseTo(2 * base, 12)
    expect(mhdEmf(200, 1.5, 0.8)).toBeCloseTo(2 * base, 12)
  })

  it('mhdEmf: non-finite → NaN', () => {
    expect(Number.isNaN(mhdEmf(NaN, 1, 1))).toBe(true)
    expect(Number.isNaN(mhdEmf(1, Infinity, 1))).toBe(true)
    expect(Number.isNaN(mhdEmf(1, 1, -Infinity))).toBe(true)
  })

  it('runMhdEmfSample: ok, methodId/familyId, linear checks', () => {
    const r = runMhdEmfSample()
    expect(r.methodId).toBe(METHOD_ALGO_MHD_EMF)
    expect(r.familyId).toBe(METHOD_MHD)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.emf).toBeCloseTo(r.u * r.B * r.L, 12)
    expect(r.emf).toBeCloseTo(1000, 12)
    expect(r.emf_doubleU).toBeCloseTo(2 * r.emf, 12)
    expect(r.emf_doubleB).toBeCloseTo(2 * r.emf, 12)
    expect(r.emf_doubleL).toBeCloseTo(2 * r.emf, 12)
    expect(r.emf_zeroU).toBe(0)
  })
})

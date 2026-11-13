import { describe, it, expect } from 'vitest'
import {
  METHOD_NF,
  METHOD_ALGO_FRIIS_NF,
  NF_PARENT,
  NF_METHOD_IDS,
  DEFAULT_F1,
  DEFAULT_G1,
  DEFAULT_F2,
  DEFAULT_G2,
  DEFAULT_F3,
  noiseFigureDb,
  noiseFactorFromDb,
  friisNoiseFactor,
  runFriisNfSample,
} from './noise-figure-algos'

describe('Noise figure · Friis cascade', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_NF).toBe('method-noise-figure')
    expect(METHOD_ALGO_FRIIS_NF).toBe('method-algo-friis-nf')
    expect(NF_PARENT).toBe(METHOD_NF)
    expect(NF_METHOD_IDS).toContain(METHOD_ALGO_FRIIS_NF)
  })

  it('friisNoiseFactor: 2- and 3-stage formula', () => {
    const F2s = friisNoiseFactor(2, 10, 3)
    expect(F2s).toBeCloseTo(2 + (3 - 1) / 10, 12)
    const F3s = friisNoiseFactor(
      DEFAULT_F1,
      DEFAULT_G1,
      DEFAULT_F2,
      DEFAULT_G2,
      DEFAULT_F3,
    )
    expect(F3s).toBeCloseTo(
      DEFAULT_F1 +
        (DEFAULT_F2 - 1) / DEFAULT_G1 +
        (DEFAULT_F3 - 1) / (DEFAULT_G1 * DEFAULT_G2),
      12,
    )
  })

  it('NF dB ↔ linear; G1 dilutes later stages; bad → NaN', () => {
    expect(noiseFigureDb(2)).toBeCloseTo(10 * Math.log10(2), 12)
    expect(noiseFactorFromDb(3)).toBeCloseTo(10 ** 0.3, 12)
    const F_lo = friisNoiseFactor(2, 1, 10)
    const F_hi = friisNoiseFactor(2, 100, 10)
    expect(F_hi).toBeLessThan(F_lo)
    expect(Number.isNaN(friisNoiseFactor(1, 0, 2))).toBe(true)
    expect(Number.isNaN(noiseFigureDb(0))).toBe(true)
    expect(Number.isNaN(friisNoiseFactor(NaN, 1, 1))).toBe(true)
  })

  it('runFriisNfSample: ok, formula, dB, high G1', () => {
    const r = runFriisNfSample()
    expect(r.methodId).toBe(METHOD_ALGO_FRIIS_NF)
    expect(r.familyId).toBe(METHOD_NF)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.F).toBeCloseTo(
      r.F1 + (r.F2 - 1) / r.G1 + (r.F3 - 1) / (r.G1 * r.G2),
      12,
    )
    expect(r.NF_dB).toBeCloseTo(10 * Math.log10(r.F), 12)
    expect(r.F_highG1).toBeLessThan(r.F)
    expect(Number.isFinite(r.F_badG)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(
      runFriisNfSample({ F1: 1.5, G1: 20, F2: 2, G2: 5, F3: 3 }).ok,
    ).toBe(true)
  })
})

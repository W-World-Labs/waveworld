import { describe, it, expect } from 'vitest'
import {
  METHOD_SPITZER,
  METHOD_ALGO_SPITZER_ETA,
  METHOD_BOHM,
  METHOD_ALGO_BOHM_D,
  SPITZER_PARENT,
  BOHM_PARENT,
  SPITZER_METHOD_IDS,
  BOHM_METHOD_IDS,
  SPITZER_BOHM_METHOD_IDS,
  DEFAULT_T,
  DEFAULT_LN_LAMBDA,
  DEFAULT_C,
  DEFAULT_B,
  spitzerEta,
  bohmDiffusion,
  runSpitzerEtaSample,
  runBohmDSample,
} from './spitzer-bohm-algos'

describe('Spitzer + Bohm · resistivity and diffusion', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_SPITZER).toBe('method-spitzer-resistivity')
    expect(METHOD_ALGO_SPITZER_ETA).toBe('method-algo-spitzer-eta')
    expect(METHOD_BOHM).toBe('method-bohm-diffusion')
    expect(METHOD_ALGO_BOHM_D).toBe('method-algo-bohm-d')
    expect(SPITZER_PARENT).toBe(METHOD_SPITZER)
    expect(BOHM_PARENT).toBe(METHOD_BOHM)
    expect(SPITZER_METHOD_IDS).toContain(METHOD_ALGO_SPITZER_ETA)
    expect(BOHM_METHOD_IDS).toContain(METHOD_ALGO_BOHM_D)
    expect(SPITZER_BOHM_METHOD_IDS).toContain(METHOD_ALGO_SPITZER_ETA)
    expect(SPITZER_BOHM_METHOD_IDS).toContain(METHOD_ALGO_BOHM_D)
  })

  it('spitzerEta: η = C lnΛ / T^{1.5}', () => {
    expect(spitzerEta(1, 1, 1)).toBeCloseTo(1, 12)
    expect(spitzerEta(4, 1, 1)).toBeCloseTo(1 / 8, 12)
    expect(spitzerEta(DEFAULT_T, DEFAULT_LN_LAMBDA, DEFAULT_C)).toBeCloseTo(
      (DEFAULT_C * DEFAULT_LN_LAMBDA) / DEFAULT_T ** 1.5,
      12,
    )
  })

  it('spitzerEta: hotter lower η; T≤0 → NaN', () => {
    const e = spitzerEta(100, 15, 1)
    expect(spitzerEta(200, 15, 1)).toBeLessThan(e)
    expect(Number.isNaN(spitzerEta(0, 15))).toBe(true)
    expect(Number.isNaN(spitzerEta(NaN, 15))).toBe(true)
  })

  it('bohmDiffusion: D = T/(16 B)', () => {
    expect(bohmDiffusion(16, 1)).toBeCloseTo(1, 12)
    expect(bohmDiffusion(DEFAULT_T, DEFAULT_B)).toBeCloseTo(
      DEFAULT_T / (16 * DEFAULT_B),
      12,
    )
  })

  it('bohmDiffusion: ∝ T, 1/B; B≤0 → NaN', () => {
    const d = bohmDiffusion(100, 1)
    expect(bohmDiffusion(200, 1)).toBeCloseTo(2 * d, 12)
    expect(bohmDiffusion(100, 2)).toBeCloseTo(d / 2, 12)
    expect(Number.isNaN(bohmDiffusion(100, 0))).toBe(true)
  })

  it('runSpitzerEtaSample: ok, formula, scale', () => {
    const r = runSpitzerEtaSample()
    expect(r.methodId).toBe(METHOD_ALGO_SPITZER_ETA)
    expect(r.familyId).toBe(METHOD_SPITZER)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.eta).toBeCloseTo((r.C * r.lnLambda) / r.T ** 1.5, 12)
    expect(r.eta_doubleT).toBeCloseTo(r.eta / 2 ** 1.5, 12)
    expect(Number.isFinite(r.eta_badT)).toBe(false)
  })

  it('runBohmDSample: ok, formula, half B', () => {
    const r = runBohmDSample()
    expect(r.methodId).toBe(METHOD_ALGO_BOHM_D)
    expect(r.familyId).toBe(METHOD_BOHM)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.D).toBeCloseTo(r.T / (16 * r.B), 12)
    expect(r.D_doubleT).toBeCloseTo(2 * r.D, 12)
    expect(r.D_doubleB).toBeCloseTo(r.D / 2, 12)
    expect(Number.isFinite(r.D_badB)).toBe(false)
  })
})

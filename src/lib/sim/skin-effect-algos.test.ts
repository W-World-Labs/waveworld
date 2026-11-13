import { describe, it, expect } from 'vitest'
import {
  METHOD_SKIN,
  METHOD_ALGO_SKIN_DEPTH,
  SKIN_PARENT,
  SKIN_METHOD_IDS,
  MU0,
  DEFAULT_F,
  DEFAULT_MU,
  DEFAULT_SIGMA,
  skinDepth,
  skinDepthFromRho,
  runSkinDepthSample,
} from './skin-effect-algos'

describe('Skin effect · δ = 1/√(π f μ σ)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_SKIN).toBe('method-skin-effect')
    expect(METHOD_ALGO_SKIN_DEPTH).toBe('method-algo-skin-depth')
    expect(SKIN_PARENT).toBe(METHOD_SKIN)
    expect(SKIN_METHOD_IDS).toContain(METHOD_ALGO_SKIN_DEPTH)
    expect(MU0).toBeCloseTo(4 * Math.PI * 1e-7, 10)
  })

  it('skinDepth: formula', () => {
    const d = skinDepth(DEFAULT_F, DEFAULT_MU, DEFAULT_SIGMA)
    expect(d).toBeCloseTo(
      1 / Math.sqrt(Math.PI * DEFAULT_F * DEFAULT_MU * DEFAULT_SIGMA),
      12,
    )
    expect(d).toBeGreaterThan(0)
  })

  it('∝ 1/√f; ρ-form matches; f≤0 → NaN', () => {
    const d = skinDepth(DEFAULT_F, DEFAULT_MU, DEFAULT_SIGMA)
    expect(skinDepth(4 * DEFAULT_F, DEFAULT_MU, DEFAULT_SIGMA)).toBeCloseTo(
      d / 2,
      12,
    )
    expect(
      skinDepthFromRho(DEFAULT_F, DEFAULT_MU, 1 / DEFAULT_SIGMA),
    ).toBeCloseTo(d, 10)
    expect(Number.isNaN(skinDepth(0, DEFAULT_MU, DEFAULT_SIGMA))).toBe(true)
    expect(Number.isNaN(skinDepth(-1, DEFAULT_MU, DEFAULT_SIGMA))).toBe(true)
    expect(Number.isNaN(skinDepth(1e6, 0, DEFAULT_SIGMA))).toBe(true)
    expect(Number.isNaN(skinDepth(NaN, DEFAULT_MU, DEFAULT_SIGMA))).toBe(true)
  })

  it('runSkinDepthSample: ok, formula, 1/√f, ρ match', () => {
    const r = runSkinDepthSample()
    expect(r.methodId).toBe(METHOD_ALGO_SKIN_DEPTH)
    expect(r.familyId).toBe(METHOD_SKIN)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.delta).toBeCloseTo(
      1 / Math.sqrt(Math.PI * r.f * r.mu * r.sigma),
      12,
    )
    expect(r.delta_doubleF).toBeCloseTo(r.delta / Math.SQRT2, 10)
    expect(r.delta_rho).toBeCloseTo(r.delta, 10)
    expect(Number.isFinite(r.delta_badF)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runSkinDepthSample({ f: 60, mu: MU0, sigma: 1e7 }).ok).toBe(true)
  })
})

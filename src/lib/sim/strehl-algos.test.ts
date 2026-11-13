import { describe, it, expect } from 'vitest'
import {
  METHOD_STREHL,
  METHOD_ALGO_STREHL,
  STREHL_PARENT,
  STREHL_METHOD_IDS,
  DEFAULT_SIGMA,
  DEFAULT_LAMBDA,
  strehlMarechal,
  runStrehlSample,
} from './strehl-algos'

describe('Strehl · Maréchal S ≈ exp(−(2πσ/λ)²)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_STREHL).toBe('method-strehl-ratio')
    expect(METHOD_ALGO_STREHL).toBe('method-algo-strehl')
    expect(STREHL_PARENT).toBe(METHOD_STREHL)
    expect(STREHL_METHOD_IDS).toContain(METHOD_ALGO_STREHL)
  })

  it('strehlMarechal: formula', () => {
    const sigma = DEFAULT_SIGMA
    const lambda = DEFAULT_LAMBDA
    const phi = (2 * Math.PI * sigma) / lambda
    expect(strehlMarechal(sigma, lambda)).toBeCloseTo(
      Math.exp(-(phi * phi)),
      12,
    )
  })

  it('σ=0 ⇒ S=1; larger σ lowers S; bad → NaN', () => {
    expect(strehlMarechal(0, 550e-9)).toBe(1)
    const S = strehlMarechal(50e-9, 550e-9)
    expect(strehlMarechal(100e-9, 550e-9)).toBeLessThan(S)
    expect(S).toBeGreaterThan(0)
    expect(S).toBeLessThanOrEqual(1)
    expect(Number.isNaN(strehlMarechal(-1, 1))).toBe(true)
    expect(Number.isNaN(strehlMarechal(1, 0))).toBe(true)
    expect(Number.isNaN(strehlMarechal(NaN, 1))).toBe(true)
  })

  it('runStrehlSample: ok, formula, perfect, degrade', () => {
    const r = runStrehlSample()
    expect(r.methodId).toBe(METHOD_ALGO_STREHL)
    expect(r.familyId).toBe(METHOD_STREHL)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    const phi = (2 * Math.PI * r.sigma) / r.lambda
    expect(r.S).toBeCloseTo(Math.exp(-(phi * phi)), 12)
    expect(r.S_perfect).toBe(1)
    expect(r.S_doubleSigma).toBeLessThan(r.S)
    expect(Number.isFinite(r.S_bad)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runStrehlSample({ sigma: 20e-9, lambda: 633e-9 }).ok).toBe(true)
  })
})

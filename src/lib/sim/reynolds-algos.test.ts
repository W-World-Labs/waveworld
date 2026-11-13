import { describe, it, expect } from 'vitest'
import {
  METHOD_RE,
  METHOD_ALGO_RE,
  RE_PARENT,
  RE_METHOD_IDS,
  DEFAULT_RHO,
  DEFAULT_U,
  DEFAULT_L,
  DEFAULT_MU,
  reynoldsNumber,
  runReynoldsSample,
} from './reynolds-algos'

describe('Reynolds · Re = ρ U L / μ', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_RE).toBe('method-reynolds-number')
    expect(METHOD_ALGO_RE).toBe('method-algo-reynolds')
    expect(RE_PARENT).toBe(METHOD_RE)
    expect(RE_METHOD_IDS).toContain(METHOD_ALGO_RE)
  })

  it('reynoldsNumber: formula', () => {
    expect(reynoldsNumber(1000, 1, 0.1, 1e-3)).toBeCloseTo(1e5, 8)
    expect(reynoldsNumber(DEFAULT_RHO, DEFAULT_U, DEFAULT_L, DEFAULT_MU)).toBeCloseTo(
      (DEFAULT_RHO * DEFAULT_U * DEFAULT_L) / DEFAULT_MU,
      8,
    )
  })

  it('∝ U, ρ, L; ∝ 1/μ; μ≤0 / non-finite → NaN', () => {
    const Re = reynoldsNumber(1000, 1, 0.1, 1e-3)
    expect(reynoldsNumber(1000, 2, 0.1, 1e-3)).toBeCloseTo(2 * Re, 10)
    expect(reynoldsNumber(1000, 1, 0.1, 5e-4)).toBeCloseTo(2 * Re, 10)
    expect(Number.isNaN(reynoldsNumber(1000, 1, 0.1, 0))).toBe(true)
    expect(Number.isNaN(reynoldsNumber(1000, 1, 0.1, -1))).toBe(true)
    expect(Number.isNaN(reynoldsNumber(NaN, 1, 0.1, 1e-3))).toBe(true)
    expect(Number.isNaN(reynoldsNumber(1000, Infinity, 0.1, 1e-3))).toBe(true)
  })

  it('runReynoldsSample: ok, formula, linear U, half μ', () => {
    const r = runReynoldsSample()
    expect(r.methodId).toBe(METHOD_ALGO_RE)
    expect(r.familyId).toBe(METHOD_RE)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Re).toBeCloseTo((r.rho * r.U * r.L) / r.mu, 10)
    expect(r.Re_doubleU).toBeCloseTo(2 * r.Re, 10)
    expect(r.Re_halfMu).toBeCloseTo(2 * r.Re, 10)
    expect(Number.isFinite(r.Re_badMu)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runReynoldsSample({ rho: 1.2, U: 10, L: 1, mu: 1.8e-5 }).ok).toBe(
      true,
    )
  })
})

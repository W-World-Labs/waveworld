import { describe, it, expect } from 'vitest'
import {
  METHOD_ROOT_LOCUS,
  METHOD_ALGO_DAMPING_ZETA,
  ROOT_LOCUS_PARENT,
  ROOT_LOCUS_METHOD_IDS,
  DEFAULT_C,
  DEFAULT_K,
  DEFAULT_M,
  dampingZeta,
  runDampingZetaSample,
} from './root-locus-algos'

describe('Root locus · ζ = c/(2√(k m))', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_ROOT_LOCUS).toBe('method-root-locus')
    expect(METHOD_ALGO_DAMPING_ZETA).toBe('method-algo-damping-zeta')
    expect(ROOT_LOCUS_PARENT).toBe(METHOD_ROOT_LOCUS)
    expect(ROOT_LOCUS_METHOD_IDS).toContain(METHOD_ALGO_DAMPING_ZETA)
  })

  it('dampingZeta: ζ = c/(2√(km))', () => {
    // c=2, k=1, m=1 ⇒ ζ = 2/(2·1) = 1 critical
    expect(dampingZeta(2, 1, 1)).toBeCloseTo(1, 12)
    expect(dampingZeta(DEFAULT_C, DEFAULT_K, DEFAULT_M)).toBeCloseTo(
      DEFAULT_C / (2 * Math.sqrt(DEFAULT_K * DEFAULT_M)),
      12,
    )
  })

  it('linear in c; k,m≤0 → NaN', () => {
    const z = dampingZeta(2, 100, 1)
    expect(dampingZeta(4, 100, 1)).toBeCloseTo(2 * z, 12)
    expect(Number.isNaN(dampingZeta(1, 0, 1))).toBe(true)
    expect(Number.isNaN(dampingZeta(1, 1, 0))).toBe(true)
    expect(Number.isNaN(dampingZeta(NaN, 1, 1))).toBe(true)
  })

  it('runDampingZetaSample: ok, formula, scales', () => {
    const r = runDampingZetaSample()
    expect(r.methodId).toBe(METHOD_ALGO_DAMPING_ZETA)
    expect(r.familyId).toBe(METHOD_ROOT_LOCUS)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.zeta).toBeCloseTo(r.c / (2 * Math.sqrt(r.k * r.m)), 12)
    expect(r.zeta_doubleC).toBeCloseTo(2 * r.zeta, 12)
    expect(r.zeta_doubleK).toBeCloseTo(r.zeta / Math.SQRT2, 12)
    expect(Number.isFinite(r.zeta_badK)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runDampingZetaSample({ c: 0.5, k: 10, m: 2 }).ok).toBe(true)
  })
})

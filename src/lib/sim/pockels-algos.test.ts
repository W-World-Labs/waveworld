import { describe, it, expect } from 'vitest'
import {
  METHOD_POCKELS,
  METHOD_ALGO_POCKELS_DN,
  POCKELS_PARENT,
  POCKELS_METHOD_IDS,
  DEFAULT_N,
  DEFAULT_R,
  DEFAULT_E,
  pockelsDn,
  runPockelsDnSample,
} from './pockels-algos'

describe('Pockels · Δn = ½ n³ r E', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_POCKELS).toBe('method-pockels')
    expect(METHOD_ALGO_POCKELS_DN).toBe('method-algo-pockels-dn')
    expect(POCKELS_PARENT).toBe(METHOD_POCKELS)
    expect(POCKELS_METHOD_IDS).toContain(METHOD_ALGO_POCKELS_DN)
  })

  it('pockelsDn: Δn = 0.5 n³ r E', () => {
    const n = 2.2
    const r = 30e-12
    const E = 1e6
    const dn = pockelsDn(n, r, E)
    expect(dn).toBeCloseTo(0.5 * n ** 3 * r * E, 18)
    expect(pockelsDn(DEFAULT_N, DEFAULT_R, 0)).toBe(0)
  })

  it('linear/odd in E; n≤0 or non-finite → NaN', () => {
    const base = pockelsDn(2, 1e-11, 1e5)
    expect(pockelsDn(2, 1e-11, 2e5)).toBeCloseTo(2 * base, 18)
    expect(pockelsDn(2, 1e-11, -1e5)).toBeCloseTo(-base, 18)
    expect(Number.isNaN(pockelsDn(0, 1e-11, 1))).toBe(true)
    expect(Number.isNaN(pockelsDn(-1, 1e-11, 1))).toBe(true)
    expect(Number.isNaN(pockelsDn(NaN, 1e-11, 1))).toBe(true)
  })

  it('runPockelsDnSample: ok, formula, linear, antisym', () => {
    const r = runPockelsDnSample()
    expect(r.methodId).toBe(METHOD_ALGO_POCKELS_DN)
    expect(r.familyId).toBe(METHOD_POCKELS)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.n).toBe(DEFAULT_N)
    expect(r.r).toBe(DEFAULT_R)
    expect(r.E).toBe(DEFAULT_E)
    expect(r.dn).toBeCloseTo(0.5 * r.n ** 3 * r.r * r.E, 18)
    expect(r.dn_doubleE).toBeCloseTo(2 * r.dn, 18)
    expect(r.dn_negE).toBeCloseTo(-r.dn, 18)
    expect(r.dn_zeroE).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runPockelsDnSample({ n: 1.5, r: 20e-12, E: 5e5 }).ok).toBe(true)
  })
})

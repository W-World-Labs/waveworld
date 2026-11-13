import { describe, it, expect } from 'vitest'
import {
  METHOD_ROUTH,
  METHOD_ALGO_ROUTH_STABLE,
  ROUTH_PARENT,
  ROUTH_METHOD_IDS,
  DEFAULT_A2,
  DEFAULT_B2,
  DEFAULT_A3,
  DEFAULT_B3,
  DEFAULT_C3,
  routhStable2,
  routhStable3,
  runRouthStable2Sample,
} from './routh-hurwitz-algos'

describe('Routh–Hurwitz · 2nd & 3rd order stability', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_ROUTH).toBe('method-routh-hurwitz')
    expect(METHOD_ALGO_ROUTH_STABLE).toBe('method-algo-routh-stable-2')
    expect(ROUTH_PARENT).toBe(METHOD_ROUTH)
    expect(ROUTH_METHOD_IDS).toContain(METHOD_ALGO_ROUTH_STABLE)
  })

  it('routhStable2: a>0 and b>0', () => {
    expect(routhStable2(DEFAULT_A2, DEFAULT_B2)).toBe(true)
    expect(routhStable2(1, 1)).toBe(true)
    expect(routhStable2(0, 1)).toBe(false)
    expect(routhStable2(1, 0)).toBe(false)
    expect(routhStable2(-1, 1)).toBe(false)
    expect(routhStable2(1, -1)).toBe(false)
    expect(routhStable2(NaN, 1)).toBe(false)
  })

  it('routhStable3: a>0, c>0, a·b>c', () => {
    // (s+1)(s+2)(s+3) = s³+6s²+11s+6
    expect(routhStable3(DEFAULT_A3, DEFAULT_B3, DEFAULT_C3)).toBe(true)
    expect(routhStable3(6, 11, 6)).toBe(true)
    expect(routhStable3(1, 1, 2)).toBe(false) // a*b = 1 < 2
    expect(routhStable3(2, 3, 6)).toBe(false) // a*b = c
    expect(routhStable3(-1, 1, 1)).toBe(false)
    expect(routhStable3(1, 1, -1)).toBe(false)
    expect(routhStable3(NaN, 1, 1)).toBe(false)
  })

  it('runRouthStable2Sample: ok, stable defaults, bad cases', () => {
    const r = runRouthStable2Sample()
    expect(r.methodId).toBe(METHOD_ALGO_ROUTH_STABLE)
    expect(r.familyId).toBe(METHOD_ROUTH)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.stable2).toBe(true)
    expect(r.stable2_badA).toBe(false)
    expect(r.stable2_badB).toBe(false)
    expect(r.stable3).toBe(true)
    expect(r.stable3_bad).toBe(false)
  })

  it('custom params still ok when stable', () => {
    expect(
      runRouthStable2Sample({ a2: 3, b2: 4, a3: 4, b3: 5, c3: 1 }).ok,
    ).toBe(true)
  })
})

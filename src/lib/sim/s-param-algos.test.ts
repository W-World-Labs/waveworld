import { describe, it, expect } from 'vitest'
import {
  METHOD_SPARAM,
  METHOD_ALGO_S11_DB,
  SPARAM_PARENT,
  SPARAM_METHOD_IDS,
  DEFAULT_S11_MAG,
  s11Db,
  runS11DbSample,
} from './s-param-algos'

describe('S-parameters · S11_dB = 20 log10(|S11|)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_SPARAM).toBe('method-s-parameters')
    expect(METHOD_ALGO_S11_DB).toBe('method-algo-s11-db')
    expect(SPARAM_PARENT).toBe(METHOD_SPARAM)
    expect(SPARAM_METHOD_IDS).toContain(METHOD_ALGO_S11_DB)
  })

  it('s11Db: formula', () => {
    expect(s11Db(0.1)).toBeCloseTo(-20, 12)
    expect(s11Db(1)).toBeCloseTo(0, 12)
    expect(s11Db(DEFAULT_S11_MAG)).toBeCloseTo(
      20 * Math.log10(DEFAULT_S11_MAG),
      12,
    )
  })

  it('half mag −6 dB; mag≤0 → NaN', () => {
    const dB = s11Db(0.2)
    expect(s11Db(0.1)).toBeCloseTo(dB - 20 * Math.log10(2), 10)
    expect(Number.isNaN(s11Db(0))).toBe(true)
    expect(Number.isNaN(s11Db(-0.1))).toBe(true)
    expect(Number.isNaN(s11Db(NaN))).toBe(true)
  })

  it('runS11DbSample: ok, formula, half, unity', () => {
    const r = runS11DbSample()
    expect(r.methodId).toBe(METHOD_ALGO_S11_DB)
    expect(r.familyId).toBe(METHOD_SPARAM)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.S11_dB).toBeCloseTo(20 * Math.log10(r.mag), 12)
    expect(r.S11_dB_half).toBeCloseTo(
      r.S11_dB - 20 * Math.log10(2),
      10,
    )
    expect(r.S11_dB_unity).toBeCloseTo(0, 12)
    expect(Number.isFinite(r.S11_dB_bad)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runS11DbSample({ mag: 0.5 }).ok).toBe(true)
  })
})

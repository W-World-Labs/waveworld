import { describe, it, expect } from 'vitest'
import {
  METHOD_FSPL,
  METHOD_ALGO_FSPL_DB,
  FSPL_PARENT,
  FSPL_METHOD_IDS,
  C_LIGHT,
  DEFAULT_D,
  DEFAULT_F,
  fsplDb,
  fsplDbClassic,
  runFsplDbSample,
} from './fspl-algos'

describe('FSPL · free-space path loss dB', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_FSPL).toBe('method-fspl')
    expect(METHOD_ALGO_FSPL_DB).toBe('method-algo-fspl-db')
    expect(FSPL_PARENT).toBe(METHOD_FSPL)
    expect(FSPL_METHOD_IDS).toContain(METHOD_ALGO_FSPL_DB)
  })

  it('fsplDb: SI formula 20 log10(4π d f / c)', () => {
    const d = 1000
    const f = 1e9
    const expected = 20 * Math.log10((4 * Math.PI * d * f) / C_LIGHT)
    expect(fsplDb(d, f)).toBeCloseTo(expected, 10)
    expect(fsplDb(DEFAULT_D, DEFAULT_F)).toBeCloseTo(
      20 * Math.log10((4 * Math.PI * DEFAULT_D * DEFAULT_F) / C_LIGHT),
      8,
    )
  })

  it('2×d or 2×f ⇒ +6 dB; classic ≈ SI; bad → NaN', () => {
    const L = fsplDb(1000, 1e9)
    expect(fsplDb(2000, 1e9)).toBeCloseTo(L + 20 * Math.log10(2), 10)
    expect(fsplDb(1000, 2e9)).toBeCloseTo(L + 20 * Math.log10(2), 10)
    expect(fsplDbClassic(1, 1000)).toBeCloseTo(L, 1)
    expect(Number.isNaN(fsplDb(0, 1e9))).toBe(true)
    expect(Number.isNaN(fsplDb(-1, 1e9))).toBe(true)
    expect(Number.isNaN(fsplDb(1, NaN))).toBe(true)
  })

  it('runFsplDbSample: ok, formula, +6 dB doubles', () => {
    const r = runFsplDbSample()
    expect(r.methodId).toBe(METHOD_ALGO_FSPL_DB)
    expect(r.familyId).toBe(METHOD_FSPL)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.FSPL_doubleD).toBeCloseTo(r.FSPL_dB + 20 * Math.log10(2), 8)
    expect(r.FSPL_doubleF).toBeCloseTo(r.FSPL_dB + 20 * Math.log10(2), 8)
    expect(Number.isFinite(r.FSPL_bad)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runFsplDbSample({ d_m: 500, f_Hz: 2.4e9 }).ok).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import {
  METHOD_SNR,
  METHOD_ALGO_SNR_DB,
  SNR_PARENT,
  SNR_METHOD_IDS,
  DEFAULT_PS,
  DEFAULT_PN,
  snrDb,
  snrLinear,
  runSnrDbSample,
} from './snr-algos'

describe('SNR · SNR_dB = 10 log10(Ps/Pn)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_SNR).toBe('method-snr')
    expect(METHOD_ALGO_SNR_DB).toBe('method-algo-snr-db')
    expect(SNR_PARENT).toBe(METHOD_SNR)
    expect(SNR_METHOD_IDS).toContain(METHOD_ALGO_SNR_DB)
  })

  it('snrDb / snrLinear: formula', () => {
    // Ps/Pn = 1000 ⇒ 30 dB
    expect(snrDb(1e-6, 1e-9)).toBeCloseTo(30, 12)
    expect(snrLinear(DEFAULT_PS, DEFAULT_PN)).toBeCloseTo(
      DEFAULT_PS / DEFAULT_PN,
      12,
    )
    expect(snrDb(1, 1)).toBeCloseTo(0, 12)
  })

  it('10× Ps ⇒ +10 dB; bad → NaN', () => {
    const s = snrDb(1e-6, 1e-9)
    expect(snrDb(1e-5, 1e-9)).toBeCloseTo(s + 10, 10)
    expect(Number.isNaN(snrDb(0, 1))).toBe(true)
    expect(Number.isNaN(snrDb(1, 0))).toBe(true)
    expect(Number.isNaN(snrDb(-1, 1))).toBe(true)
    expect(Number.isNaN(snrDb(NaN, 1))).toBe(true)
  })

  it('runSnrDbSample: ok, formula, +10 dB', () => {
    const r = runSnrDbSample()
    expect(r.methodId).toBe(METHOD_ALGO_SNR_DB)
    expect(r.familyId).toBe(METHOD_SNR)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.SNR_dB).toBeCloseTo(10 * Math.log10(r.Ps / r.Pn), 10)
    expect(r.SNR_10xPs).toBeCloseTo(r.SNR_dB + 10, 8)
    expect(r.SNR_equal).toBeCloseTo(0, 12)
    expect(Number.isFinite(r.SNR_bad)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runSnrDbSample({ Ps: 2, Pn: 0.01 }).ok).toBe(true)
  })
})

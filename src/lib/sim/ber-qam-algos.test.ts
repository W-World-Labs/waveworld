import { describe, it, expect } from 'vitest'
import {
  METHOD_BER,
  METHOD_ALGO_BER_BPSK,
  BER_PARENT,
  BER_METHOD_IDS,
  DEFAULT_EBN0,
  erfc,
  berBpsk,
  ebN0FromDb,
  runBerBpskSample,
} from './ber-qam-algos'

describe('BER BPSK · Pb ≈ ½ erfc(√(Eb/N0))', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_BER).toBe('method-ber')
    expect(METHOD_ALGO_BER_BPSK).toBe('method-algo-ber-bpsk')
    expect(BER_PARENT).toBe(METHOD_BER)
    expect(BER_METHOD_IDS).toContain(METHOD_ALGO_BER_BPSK)
  })

  it('erfc: known values', () => {
    expect(erfc(0)).toBeCloseTo(1, 6)
    expect(erfc(Infinity)).toBeCloseTo(0, 6)
    // erfc(1) ≈ 0.157299
    expect(erfc(1)).toBeCloseTo(0.15729920705, 5)
  })

  it('berBpsk: formula and limits', () => {
    expect(berBpsk(0)).toBeCloseTo(0.5, 12)
    // EbN0=1 ⇒ 0.5*erfc(1) ≈ 0.07865
    expect(berBpsk(1)).toBeCloseTo(0.5 * erfc(1), 10)
    expect(berBpsk(DEFAULT_EBN0)).toBeCloseTo(
      0.5 * erfc(Math.sqrt(DEFAULT_EBN0)),
      10,
    )
  })

  it('higher SNR ⇒ lower Pb; bad → NaN', () => {
    expect(berBpsk(40)).toBeLessThan(berBpsk(10))
    expect(Number.isNaN(berBpsk(-1))).toBe(true)
    expect(Number.isNaN(berBpsk(NaN))).toBe(true)
  })

  it('ebN0FromDb: 10 dB ⇒ 10 linear', () => {
    expect(ebN0FromDb(10)).toBeCloseTo(10, 12)
    expect(ebN0FromDb(0)).toBeCloseTo(1, 12)
    expect(Number.isNaN(ebN0FromDb(NaN))).toBe(true)
  })

  it('runBerBpskSample: ok, formula, mono, Pb(0)=0.5', () => {
    const r = runBerBpskSample()
    expect(r.methodId).toBe(METHOD_ALGO_BER_BPSK)
    expect(r.familyId).toBe(METHOD_BER)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Pb).toBeCloseTo(0.5 * erfc(Math.sqrt(r.EbN0)), 10)
    expect(r.Pb_highSnr).toBeLessThan(r.Pb)
    expect(r.Pb_zero).toBeCloseTo(0.5, 12)
    expect(r.Pb).toBeGreaterThan(0)
    expect(r.Pb).toBeLessThan(0.5)
  })

  it('custom params still ok', () => {
    expect(runBerBpskSample({ EbN0: 4 }).ok).toBe(true)
  })
})

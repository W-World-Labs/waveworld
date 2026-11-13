import { describe, it, expect } from 'vitest'
import {
  METHOD_SHANNON,
  METHOD_ALGO_SHANNON_C,
  SHANNON_PARENT,
  SHANNON_METHOD_IDS,
  DEFAULT_B,
  DEFAULT_SNR,
  shannonCapacity,
  snrFromDb,
  runShannonCSample,
} from './shannon-algos'

describe('Shannon · C = B log2(1 + SNR)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_SHANNON).toBe('method-shannon-capacity')
    expect(METHOD_ALGO_SHANNON_C).toBe('method-algo-shannon-c')
    expect(SHANNON_PARENT).toBe(METHOD_SHANNON)
    expect(SHANNON_METHOD_IDS).toContain(METHOD_ALGO_SHANNON_C)
  })

  it('shannonCapacity: formula', () => {
    // B=1, SNR=1 ⇒ C = log2(2) = 1
    expect(shannonCapacity(1, 1)).toBeCloseTo(1, 12)
    expect(shannonCapacity(DEFAULT_B, DEFAULT_SNR)).toBeCloseTo(
      DEFAULT_B * Math.log2(1 + DEFAULT_SNR),
      8,
    )
  })

  it('∝ B; SNR=0 ⇒ C=0; snrFromDb; bad → NaN', () => {
    const C = shannonCapacity(DEFAULT_B, DEFAULT_SNR)
    expect(shannonCapacity(2 * DEFAULT_B, DEFAULT_SNR)).toBeCloseTo(2 * C, 10)
    expect(shannonCapacity(DEFAULT_B, 0)).toBe(0)
    expect(snrFromDb(10)).toBeCloseTo(10, 12)
    expect(snrFromDb(0)).toBeCloseTo(1, 12)
    expect(Number.isNaN(shannonCapacity(-1, 1))).toBe(true)
    expect(Number.isNaN(shannonCapacity(1, -1))).toBe(true)
    expect(Number.isNaN(shannonCapacity(NaN, 1))).toBe(true)
  })

  it('runShannonCSample: ok, formula, linear B', () => {
    const r = runShannonCSample()
    expect(r.methodId).toBe(METHOD_ALGO_SHANNON_C)
    expect(r.familyId).toBe(METHOD_SHANNON)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.C).toBeCloseTo(r.B * Math.log2(1 + r.snr), 10)
    expect(r.C_doubleB).toBeCloseTo(2 * r.C, 10)
    expect(r.C_zeroSnr).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runShannonCSample({ B: 3e3, snr: 1000 }).ok).toBe(true)
  })
})

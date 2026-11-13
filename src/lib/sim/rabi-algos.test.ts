import { describe, it, expect } from 'vitest'
import {
  METHOD_RABI,
  METHOD_ALGO_RABI_FREQ,
  RABI_PARENT,
  RABI_METHOD_IDS,
  DEFAULT_GAMMA,
  DEFAULT_B1,
  rabiFreq,
  runRabiFreqSample,
} from './rabi-algos'

describe('Rabi · Ω = γ B1 frequency', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_RABI).toBe('method-rabi')
    expect(METHOD_ALGO_RABI_FREQ).toBe('method-algo-rabi-freq')
    expect(RABI_PARENT).toBe(METHOD_RABI)
    expect(RABI_METHOD_IDS).toContain(METHOD_ALGO_RABI_FREQ)
  })

  it('rabiFreq: Ω = γ · B1', () => {
    expect(rabiFreq(2, 3)).toBeCloseTo(6, 12)
    expect(rabiFreq(DEFAULT_GAMMA, DEFAULT_B1)).toBeCloseTo(
      DEFAULT_GAMMA * DEFAULT_B1,
      6,
    )
    expect(rabiFreq(DEFAULT_GAMMA, 0)).toBe(0)
  })

  it('linear in γ,B1; non-finite → NaN', () => {
    const o = rabiFreq(DEFAULT_GAMMA, DEFAULT_B1)
    expect(rabiFreq(DEFAULT_GAMMA, 2 * DEFAULT_B1)).toBeCloseTo(2 * o, 10)
    expect(rabiFreq(2 * DEFAULT_GAMMA, DEFAULT_B1)).toBeCloseTo(2 * o, 10)
    expect(Number.isNaN(rabiFreq(NaN, 1))).toBe(true)
    expect(Number.isNaN(rabiFreq(1, Infinity))).toBe(true)
  })

  it('runRabiFreqSample: ok, formula, linear', () => {
    const r = runRabiFreqSample()
    expect(r.methodId).toBe(METHOD_ALGO_RABI_FREQ)
    expect(r.familyId).toBe(METHOD_RABI)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Omega).toBeCloseTo(r.gamma * r.B1, 10)
    expect(r.Omega_doubleB1).toBeCloseTo(2 * r.Omega, 10)
    expect(r.Omega_doubleGamma).toBeCloseTo(2 * r.Omega, 10)
    expect(r.Omega_zero).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runRabiFreqSample({ gamma: 1e8, B1: 1e-3 }).ok).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import {
  METHOD_FP,
  METHOD_ALGO_FP_FSR,
  FP_PARENT,
  FP_METHOD_IDS,
  C,
  DEFAULT_N,
  DEFAULT_L,
  DEFAULT_FINESSE_F,
  fabryPerotFSR,
  airyTransmission,
  runFpFsrSample,
} from './fabry-perot-algos'

describe('Fabry–Pérot · FSR = c/(2 n L)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_FP).toBe('method-fabry-perot')
    expect(METHOD_ALGO_FP_FSR).toBe('method-algo-fp-fsr')
    expect(FP_PARENT).toBe(METHOD_FP)
    expect(FP_METHOD_IDS).toContain(METHOD_ALGO_FP_FSR)
    expect(C).toBe(299792458)
  })

  it('fabryPerotFSR: formula', () => {
    const fsr = fabryPerotFSR(DEFAULT_N, DEFAULT_L)
    expect(fsr).toBeCloseTo(C / (2 * DEFAULT_N * DEFAULT_L), 6)
    expect(fsr).toBeGreaterThan(0)
  })

  it('∝ 1/L, 1/n; Airy peak/mid; L≤0 → NaN', () => {
    const fsr = fabryPerotFSR(DEFAULT_N, DEFAULT_L)
    expect(fabryPerotFSR(DEFAULT_N, 2 * DEFAULT_L)).toBeCloseTo(fsr / 2, 10)
    expect(fabryPerotFSR(2 * DEFAULT_N, DEFAULT_L)).toBeCloseTo(fsr / 2, 10)
    expect(airyTransmission(DEFAULT_FINESSE_F, 0)).toBeCloseTo(1, 15)
    expect(airyTransmission(DEFAULT_FINESSE_F, Math.PI)).toBeCloseTo(
      1 / (1 + DEFAULT_FINESSE_F),
      12,
    )
    expect(Number.isNaN(fabryPerotFSR(1, 0))).toBe(true)
    expect(Number.isNaN(fabryPerotFSR(NaN, 1))).toBe(true)
  })

  it('runFpFsrSample: ok, formula, Airy', () => {
    const r = runFpFsrSample()
    expect(r.methodId).toBe(METHOD_ALGO_FP_FSR)
    expect(r.familyId).toBe(METHOD_FP)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.fsr).toBeCloseTo(r.c / (2 * r.n * r.L), 6)
    expect(r.fsr_doubleL).toBeCloseTo(r.fsr / 2, 10)
    expect(r.T_peak).toBeCloseTo(1, 15)
    expect(r.T_mid).toBeCloseTo(1 / (1 + r.F), 12)
    expect(Number.isFinite(r.fsr_badL)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runFpFsrSample({ n: 1, L: 0.1, F: 4 }).ok).toBe(true)
  })
})

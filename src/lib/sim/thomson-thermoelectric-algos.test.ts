import { describe, it, expect } from 'vitest'
import {
  METHOD_THOMSON,
  METHOD_ALGO_THOMSON_Q,
  THOMSON_PARENT,
  THOMSON_METHOD_IDS,
  DEFAULT_TAU,
  DEFAULT_I,
  DEFAULT_DELTA_T,
  thomsonHeat,
  runThomsonHeatSample,
} from './thomson-thermoelectric-algos'

describe('Thomson · Q = τ · I · ΔT', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_THOMSON).toBe('method-thomson-thermoelectric')
    expect(METHOD_ALGO_THOMSON_Q).toBe('method-algo-thomson-heat')
    expect(THOMSON_PARENT).toBe(METHOD_THOMSON)
    expect(THOMSON_METHOD_IDS).toContain(METHOD_ALGO_THOMSON_Q)
  })

  it('thomsonHeat: Q = τ · I · ΔT', () => {
    expect(thomsonHeat(1e-4, 2, 20)).toBeCloseTo(0.004, 12)
    expect(thomsonHeat(DEFAULT_TAU, 0, 50)).toBe(0)
    expect(thomsonHeat(-1e-4, 1, 10)).toBeCloseTo(-0.001, 12)
  })

  it('thomsonHeat: linear in I,ΔT; antisym in ΔT; non-finite → NaN', () => {
    const base = thomsonHeat(1e-4, 1, 10)
    expect(thomsonHeat(1e-4, 2, 10)).toBeCloseTo(2 * base, 18)
    expect(thomsonHeat(1e-4, 1, -10)).toBeCloseTo(-base, 18)
    expect(Number.isNaN(thomsonHeat(NaN, 1, 1))).toBe(true)
    expect(Number.isNaN(thomsonHeat(1e-4, Infinity, 1))).toBe(true)
  })

  it('runThomsonHeatSample: ok, formula, linear, antisym', () => {
    const r = runThomsonHeatSample()
    expect(r.methodId).toBe(METHOD_ALGO_THOMSON_Q)
    expect(r.familyId).toBe(METHOD_THOMSON)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.tau).toBe(DEFAULT_TAU)
    expect(r.I).toBe(DEFAULT_I)
    expect(r.deltaT).toBe(DEFAULT_DELTA_T)
    expect(r.Q).toBeCloseTo(r.tau * r.I * r.deltaT, 18)
    expect(r.Q_doubleI).toBeCloseTo(2 * r.Q, 18)
    expect(r.Q_negDeltaT).toBeCloseTo(-r.Q, 18)
    expect(r.Q_zeroI).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runThomsonHeatSample({ tau: 2e-4, I: 5, deltaT: 10 }).ok).toBe(true)
  })
})

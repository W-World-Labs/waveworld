import { describe, it, expect } from 'vitest'
import {
  METHOD_SEEBECK,
  METHOD_ALGO_SEEBECK_V,
  METHOD_ALGO_ZT,
  SEEBECK_PARENT,
  SEEBECK_METHOD_IDS,
  DEFAULT_ALPHA,
  DEFAULT_DELTA_T,
  seebeckVoltage,
  figureOfMeritZT,
  powerFactor,
  seebeckVoltageSweep,
  runSeebeckVSample,
  runZTSample,
} from './seebeck-algos'

describe('Seebeck · thermoelectric voltage + ZT figure of merit', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_SEEBECK).toBe('method-seebeck')
    expect(METHOD_ALGO_SEEBECK_V).toBe('method-algo-seebeck-v')
    expect(METHOD_ALGO_ZT).toBe('method-algo-zt-figure')
    expect(SEEBECK_PARENT).toBe(METHOD_SEEBECK)
    expect(SEEBECK_METHOD_IDS).toContain(METHOD_ALGO_SEEBECK_V)
    expect(SEEBECK_METHOD_IDS).toContain(METHOD_ALGO_ZT)
  })

  it('seebeckVoltage: V = α · ΔT', () => {
    expect(seebeckVoltage(200e-6, 50)).toBeCloseTo(0.01, 12)
    expect(seebeckVoltage(DEFAULT_ALPHA, 0)).toBe(0)
    expect(seebeckVoltage(-100e-6, 10)).toBeCloseTo(-0.001, 12)
  })

  it('seebeckVoltage: linear in ΔT; non-finite → NaN', () => {
    const a = 1e-4
    expect(seebeckVoltage(a, 40)).toBeCloseTo(2 * seebeckVoltage(a, 20), 18)
    expect(Number.isNaN(seebeckVoltage(NaN, 1))).toBe(true)
    expect(Number.isNaN(seebeckVoltage(1e-4, Infinity))).toBe(true)
  })

  it('figureOfMeritZT: ZT = α² σ T / κ', () => {
    const alpha = 200e-6
    const sigma = 1e5
    const T = 300
    const kappa = 1.5
    const zt = figureOfMeritZT(alpha, sigma, T, kappa)
    expect(zt).toBeCloseTo((alpha * alpha * sigma * T) / kappa, 12)
    expect(zt).toBeGreaterThan(0.5)
    expect(zt).toBeLessThan(1.5)
  })

  it('figureOfMeritZT: κ≤0 or T≤0 → NaN', () => {
    expect(Number.isNaN(figureOfMeritZT(1e-4, 1e5, 300, 0))).toBe(true)
    expect(Number.isNaN(figureOfMeritZT(1e-4, 1e5, 0, 1))).toBe(true)
    expect(Number.isNaN(figureOfMeritZT(1e-4, 1e5, -10, 1))).toBe(true)
  })

  it('powerFactor: PF = α² σ', () => {
    expect(powerFactor(2e-4, 1e5)).toBeCloseTo(4e-3, 12)
  })

  it('seebeckVoltageSweep: Float64Array lengths and endpoints', () => {
    const { deltaT, V } = seebeckVoltageSweep(1e-4, 100, 5)
    expect(deltaT).toBeInstanceOf(Float64Array)
    expect(V).toBeInstanceOf(Float64Array)
    expect(deltaT.length).toBe(5)
    expect(V.length).toBe(5)
    expect(deltaT[0]).toBe(0)
    expect(deltaT[4]).toBeCloseTo(100, 12)
    expect(V[0]).toBe(0)
    expect(V[4]).toBeCloseTo(0.01, 12)
  })

  it('runSeebeckVSample: ok, formula, linear, zero', () => {
    const r = runSeebeckVSample()
    expect(r.methodId).toBe(METHOD_ALGO_SEEBECK_V)
    expect(r.familyId).toBe(METHOD_SEEBECK)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.V).toBeCloseTo(r.alpha * r.deltaT, 18)
    expect(r.V_doubleDT).toBeCloseTo(2 * r.V, 18)
    expect(r.V_zero).toBe(0)
    expect(r.alpha).toBe(DEFAULT_ALPHA)
    expect(r.deltaT).toBe(DEFAULT_DELTA_T)
  })

  it('runZTSample: ok, ZT formula, half-κ doubles ZT', () => {
    const r = runZTSample()
    expect(r.methodId).toBe(METHOD_ALGO_ZT)
    expect(r.familyId).toBe(METHOD_SEEBECK)
    expect(r.familyId).toBe('method-seebeck')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.ZT).toBeCloseTo(
      (r.alpha * r.alpha * r.sigma * r.T) / r.kappa,
      12,
    )
    expect(r.ZT_halfKappa).toBeCloseTo(2 * r.ZT, 12)
    expect(Number.isFinite(r.ZT_badKappa)).toBe(false)
    expect(r.PF).toBeCloseTo(r.alpha * r.alpha * r.sigma, 18)
  })
})

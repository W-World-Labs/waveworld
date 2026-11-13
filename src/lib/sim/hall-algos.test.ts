import { describe, it, expect } from 'vitest'
import {
  METHOD_HALL,
  METHOD_ALGO_HALL_V,
  HALL_PARENT,
  HALL_METHOD_IDS,
  DEFAULT_E,
  DEFAULT_N_CU,
  hallVoltage,
  runHallVoltageSample,
} from './hall-algos'

describe('Hall effect · V_H = I B / (n e t)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_HALL).toBe('method-hall-effect')
    expect(METHOD_ALGO_HALL_V).toBe('method-algo-hall-voltage')
    expect(HALL_PARENT).toBe(METHOD_HALL)
    expect(HALL_METHOD_IDS).toContain(METHOD_ALGO_HALL_V)
  })

  it('DEFAULT_E is elementary charge', () => {
    expect(DEFAULT_E).toBeCloseTo(1.602e-19, 22)
  })

  it('hallVoltage: formula and copper-ish sample scale', () => {
    const I = 10
    const B = 1
    const n = DEFAULT_N_CU
    const e = DEFAULT_E
    const t = 1e-3
    const VH = hallVoltage(I, B, n, e, t)
    expect(VH).toBeCloseTo((I * B) / (n * e * t), 12)
    // ~7.35e-7 V — small but finite for bulk Cu strip
    expect(VH).toBeGreaterThan(0)
    expect(VH).toBeLessThan(1e-5)
  })

  it('hallVoltage: linear in I,B; inverse in t,n', () => {
    const base = hallVoltage(5, 0.5, 1e28, DEFAULT_E, 2e-3)
    expect(hallVoltage(10, 0.5, 1e28, DEFAULT_E, 2e-3)).toBeCloseTo(2 * base, 12)
    expect(hallVoltage(5, 1, 1e28, DEFAULT_E, 2e-3)).toBeCloseTo(2 * base, 12)
    expect(hallVoltage(5, 0.5, 1e28, DEFAULT_E, 1e-3)).toBeCloseTo(2 * base, 12)
    expect(hallVoltage(5, 0.5, 5e27, DEFAULT_E, 2e-3)).toBeCloseTo(2 * base, 12)
  })

  it('hallVoltage: zero I → 0; zero n/e/t → NaN; non-finite → NaN', () => {
    expect(hallVoltage(0, 1, 1e28, DEFAULT_E, 1e-3)).toBe(0)
    expect(Number.isNaN(hallVoltage(1, 1, 0, DEFAULT_E, 1e-3))).toBe(true)
    expect(Number.isNaN(hallVoltage(1, 1, 1e28, 0, 1e-3))).toBe(true)
    expect(Number.isNaN(hallVoltage(1, 1, 1e28, DEFAULT_E, 0))).toBe(true)
    expect(Number.isNaN(hallVoltage(NaN, 1, 1e28, DEFAULT_E, 1e-3))).toBe(true)
    expect(Number.isNaN(hallVoltage(1, Infinity, 1e28, DEFAULT_E, 1e-3))).toBe(
      true,
    )
  })

  it('runHallVoltageSample: ok, methodId/familyId, linear checks', () => {
    const r = runHallVoltageSample()
    expect(r.methodId).toBe(METHOD_ALGO_HALL_V)
    expect(r.familyId).toBe(METHOD_HALL)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.n).toBe(DEFAULT_N_CU)
    expect(r.e).toBe(DEFAULT_E)
    expect(r.VH).toBeCloseTo((r.I * r.B) / (r.n * r.e * r.t), 12)
    expect(r.VH_doubleI).toBeCloseTo(2 * r.VH, 12)
    expect(r.VH_doubleB).toBeCloseTo(2 * r.VH, 12)
    expect(r.VH_halfT).toBeCloseTo(2 * r.VH, 12)
    expect(r.VH_zeroI).toBe(0)
  })

  it('custom params still ok', () => {
    const r = runHallVoltageSample({ I: 1, B: 0.2, n: 1e22, t: 100e-6 })
    expect(r.ok).toBe(true)
    expect(r.VH).toBeGreaterThan(0)
  })
})

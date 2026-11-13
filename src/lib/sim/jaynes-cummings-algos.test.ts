import { describe, it, expect } from 'vitest'
import {
  METHOD_JC,
  METHOD_ALGO_JC_SPLIT,
  JC_PARENT,
  JC_METHOD_IDS,
  DEFAULT_G,
  vacuumRabiSplit,
  runJcVacuumRabiSample,
} from './jaynes-cummings-algos'

describe('Jaynes–Cummings · vacuum Rabi Ω = 2g', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_JC).toBe('method-jaynes-cummings')
    expect(METHOD_ALGO_JC_SPLIT).toBe('method-algo-jc-vacuum-rabi')
    expect(JC_PARENT).toBe(METHOD_JC)
    expect(JC_METHOD_IDS).toContain(METHOD_ALGO_JC_SPLIT)
  })

  it('vacuumRabiSplit: Ω = 2g', () => {
    expect(vacuumRabiSplit(DEFAULT_G)).toBeCloseTo(2 * DEFAULT_G, 12)
    expect(vacuumRabiSplit(5)).toBe(10)
    expect(vacuumRabiSplit(0)).toBe(0)
  })

  it('linear in g; non-finite → NaN', () => {
    const o = vacuumRabiSplit(1e6)
    expect(vacuumRabiSplit(2e6)).toBeCloseTo(2 * o, 12)
    expect(Number.isNaN(vacuumRabiSplit(NaN))).toBe(true)
    expect(Number.isNaN(vacuumRabiSplit(Infinity))).toBe(true)
  })

  it('runJcVacuumRabiSample: ok, Ω=2g, linear', () => {
    const r = runJcVacuumRabiSample()
    expect(r.methodId).toBe(METHOD_ALGO_JC_SPLIT)
    expect(r.familyId).toBe(METHOD_JC)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.Omega).toBeCloseTo(2 * r.g, 12)
    expect(r.Omega_doubleG).toBeCloseTo(2 * r.Omega, 12)
    expect(r.Omega_zero).toBe(0)
  })

  it('custom params still ok', () => {
    expect(runJcVacuumRabiSample({ g: 3e8 }).ok).toBe(true)
  })
})

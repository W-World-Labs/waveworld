import { describe, it, expect } from 'vitest'
import {
  METHOD_FERMI,
  METHOD_ALGO_FERMI_F,
  FERMI_PARENT,
  FERMI_METHOD_IDS,
  K_EV,
  DEFAULT_EF,
  DEFAULT_T,
  fermiOccupation,
  runFermiOccupationSample,
} from './fermi-dirac-algos'

describe('Fermi–Dirac · f(E) = 1/(exp((E−Ef)/(kT))+1)', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_FERMI).toBe('method-fermi-dirac')
    expect(METHOD_ALGO_FERMI_F).toBe('method-algo-fermi-occupation')
    expect(FERMI_PARENT).toBe(METHOD_FERMI)
    expect(FERMI_METHOD_IDS).toContain(METHOD_ALGO_FERMI_F)
    expect(K_EV).toBe(8.617e-5)
  })

  it('fermiOccupation: f(Ef) = 1/2', () => {
    expect(fermiOccupation(DEFAULT_EF, DEFAULT_EF, DEFAULT_T)).toBeCloseTo(
      0.5,
      14,
    )
    expect(fermiOccupation(0, 0, 300)).toBeCloseTo(0.5, 14)
  })

  it('E ≪ Ef → ~1; E ≫ Ef → ~0; formula at finite offset', () => {
    const Ef = 5
    const T = 300
    expect(fermiOccupation(Ef - 1, Ef, T)).toBeGreaterThan(0.99)
    expect(fermiOccupation(Ef + 1, Ef, T)).toBeLessThan(0.01)
    const E = Ef + 0.05
    const x = (E - Ef) / (K_EV * T)
    expect(fermiOccupation(E, Ef, T)).toBeCloseTo(1 / (Math.exp(x) + 1), 12)
  })

  it('T≤0 or non-finite → NaN; overflow clamp', () => {
    expect(Number.isNaN(fermiOccupation(1, 1, 0))).toBe(true)
    expect(Number.isNaN(fermiOccupation(1, 1, -10))).toBe(true)
    expect(Number.isNaN(fermiOccupation(NaN, 1, 300))).toBe(true)
    // Deep below / above should clamp to 1 / 0
    expect(fermiOccupation(-100, 0, 300)).toBe(1)
    expect(fermiOccupation(100, 0, 300)).toBe(0)
  })

  it('runFermiOccupationSample: ok, half, mono, bounds', () => {
    const r = runFermiOccupationSample()
    expect(r.methodId).toBe(METHOD_ALGO_FERMI_F)
    expect(r.familyId).toBe(METHOD_FERMI)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.f_atEf).toBeCloseTo(0.5, 14)
    expect(r.f_below).toBeGreaterThan(r.f_atEf)
    expect(r.f_above).toBeLessThan(r.f_atEf)
    expect(Number.isFinite(r.f_badT)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(
      runFermiOccupationSample({ E: 1, Ef: 1, T: 77 }).ok,
    ).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import {
  METHOD_FUELCELL,
  METHOD_ALGO_NERNST,
  METHOD_ALGO_FC_POLARIZATION,
  FUELCELL_PARENT,
  FUELCELL_METHOD_IDS,
  R_GAS,
  F_FARADAY,
  E0_H2_O2,
  nernstVoltage,
  nernstStandard,
  activationOverpotential,
  polarizationVoltage,
  polarizationSweep,
  runNernstSample,
  runFcPolarizationSample,
} from './fuelcell-algos'

describe('Fuel cell · Nernst voltage + polarization stub', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_FUELCELL).toBe('method-fuel-cell')
    expect(METHOD_ALGO_NERNST).toBe('method-algo-nernst-voltage')
    expect(METHOD_ALGO_FC_POLARIZATION).toBe('method-algo-fc-polarization-stub')
    expect(FUELCELL_PARENT).toBe(METHOD_FUELCELL)
    expect(FUELCELL_METHOD_IDS).toContain(METHOD_ALGO_NERNST)
    expect(FUELCELL_METHOD_IDS).toContain(METHOD_ALGO_FC_POLARIZATION)
  })

  it('nernstVoltage: unit activities → E0', () => {
    const E = nernstVoltage(E0_H2_O2, 298.15, 1, 1, 1, 2)
    expect(E).toBeCloseTo(E0_H2_O2, 12)
    expect(nernstStandard()).toBeCloseTo(E0_H2_O2, 12)
  })

  it('nernstVoltage: matches E0 − (RT/nF) ln(Q)', () => {
    const E0 = 1.229
    const T = 350
    const pH2 = 1
    const pO2 = 0.21
    const pH2O = 1
    const n = 2
    const Q = pH2O / (pH2 * Math.sqrt(pO2))
    const expected = E0 - ((R_GAS * T) / (n * F_FARADAY)) * Math.log(Q)
    expect(nernstVoltage(E0, T, pH2, pO2, pH2O, n)).toBeCloseTo(expected, 12)
  })

  it('nernstVoltage: rich fuel lifts E; lean drops; bad p → NaN', () => {
    const E0 = 1.2
    const T = 340
    const Estd = nernstVoltage(E0, T, 1, 1, 1, 2)
    expect(nernstVoltage(E0, T, 2, 1, 0.5, 2)).toBeGreaterThan(Estd)
    expect(nernstVoltage(E0, T, 0.2, 0.1, 1, 2)).toBeLessThan(Estd)
    expect(Number.isNaN(nernstVoltage(E0, T, 0, 1, 1, 2))).toBe(true)
    expect(Number.isNaN(nernstVoltage(E0, 0, 1, 1, 1, 2))).toBe(true)
  })

  it('activationOverpotential: η = b ln(1 + I/I0); I=0 → 0', () => {
    const b = 0.06
    const I0 = 0.02
    expect(activationOverpotential(0, b, I0)).toBeCloseTo(0, 15)
    expect(activationOverpotential(0.02, b, I0)).toBeCloseTo(b * Math.log(2), 12)
    expect(Number.isNaN(activationOverpotential(1, b, 0))).toBe(true)
  })

  it('polarizationVoltage: V = E − IR − η_act; OCV at I=0', () => {
    const E = 1.0
    const R = 0.1
    const b = 0.05
    const I0 = 0.01
    expect(polarizationVoltage(E, 0, R, b, I0)).toBeCloseTo(E, 12)
    const I = 2
    const eta = activationOverpotential(I, b, I0)
    expect(polarizationVoltage(E, I, R, b, I0)).toBeCloseTo(
      Math.max(0, E - I * R - eta),
      12,
    )
  })

  it('polarizationVoltage: drops with load; clamps at 0', () => {
    const V1 = polarizationVoltage(1.0, 1, 0.05, 0.05, 0.01)
    const V2 = polarizationVoltage(1.0, 3, 0.05, 0.05, 0.01)
    expect(V2).toBeLessThan(V1)
    expect(polarizationVoltage(0.1, 100, 1, 0.1, 0.01)).toBe(0)
  })

  it('polarizationSweep: Float64Array lengths, OCV endpoint', () => {
    const { I, V } = polarizationSweep(1.0, 0.05, 0.04, 0.01, 2, 5)
    expect(I).toBeInstanceOf(Float64Array)
    expect(V).toBeInstanceOf(Float64Array)
    expect(I.length).toBe(5)
    expect(V.length).toBe(5)
    expect(I[0]).toBe(0)
    expect(V[0]).toBeCloseTo(1.0, 12)
    expect(I[4]).toBeCloseTo(2, 12)
    expect(V[4]!).toBeLessThan(V[0]!)
  })

  it('runNernstSample: ok, std/rich/lean', () => {
    const r = runNernstSample()
    expect(r.methodId).toBe(METHOD_ALGO_NERNST)
    expect(r.familyId).toBe(METHOD_FUELCELL)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.E_std).toBeCloseTo(r.E0, 12)
    expect(r.E_rich).toBeGreaterThan(r.E_std)
    expect(r.E_lean).toBeLessThan(r.E_std)
  })

  it('runFcPolarizationSample: ok, ohmic+activation drop', () => {
    const r = runFcPolarizationSample()
    expect(r.methodId).toBe(METHOD_ALGO_FC_POLARIZATION)
    expect(r.familyId).toBe(METHOD_FUELCELL)
    expect(r.familyId).toBe('method-fuel-cell')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.V0).toBeCloseTo(r.E, 12)
    expect(r.V).toBeCloseTo(Math.max(0, r.E - r.irDrop - r.eta_act), 12)
    expect(r.V).toBeLessThan(r.V0)
    expect(r.V_highI).toBeLessThan(r.V)
    expect(r.eta_act).toBeGreaterThan(0)
    expect(r.irDrop).toBeCloseTo(r.I * r.R, 12)
  })
})

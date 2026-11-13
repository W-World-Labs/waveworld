import { describe, it, expect } from 'vitest'
import {
  METHOD_STEFAN,
  METHOD_ALGO_STEFAN,
  STEFAN_PARENT,
  STEFAN_METHOD_IDS,
  SIGMA,
  H,
  C,
  WIEN_B,
  stefanExitance,
  stefanNetFlux,
  stefanGreyExitance,
  photonEnergy,
  wavelengthFromFreq,
  wienPeakWavelength,
  runStefanSample,
} from './stefan-boltzmann-algos'

describe('Stefan–Boltzmann · j = σ T⁴ teaching stub', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_STEFAN).toBe('method-stefan-boltzmann')
    expect(METHOD_ALGO_STEFAN).toBe('method-algo-stefan-law')
    expect(STEFAN_PARENT).toBe(METHOD_STEFAN)
    expect(STEFAN_METHOD_IDS).toContain(METHOD_ALGO_STEFAN)
  })

  describe('stefanExitance', () => {
    it('j = σ T⁴', () => {
      expect(stefanExitance(300)).toBeCloseTo(SIGMA * 300 ** 4, 10)
      expect(stefanExitance(1)).toBeCloseTo(SIGMA, 14)
    })

    it('T doubles → j × 16', () => {
      const j = stefanExitance(400)
      expect(stefanExitance(800) / j).toBeCloseTo(16, 12)
    })

    it('non-positive T → NaN', () => {
      expect(Number.isNaN(stefanExitance(0))).toBe(true)
      expect(Number.isNaN(stefanExitance(-100))).toBe(true)
    })
  })

  describe('net / grey', () => {
    it('q = σ (Th⁴ − Tc⁴); grey j = ε σ T⁴', () => {
      const q = stefanNetFlux(400, 300)
      expect(q).toBeCloseTo(SIGMA * (400 ** 4 - 300 ** 4), 8)
      expect(q).toBeGreaterThan(0)
      expect(stefanGreyExitance(300, 0.5)).toBeCloseTo(0.5 * stefanExitance(300), 12)
    })

    it('ε out of [0,1] → NaN', () => {
      expect(Number.isNaN(stefanGreyExitance(300, -0.1))).toBe(true)
      expect(Number.isNaN(stefanGreyExitance(300, 1.1))).toBe(true)
    })
  })

  describe('optional photon helpers', () => {
    it('E = hν; λ = c/ν; Wien λ_max T = b', () => {
      const nu = 5e14
      expect(photonEnergy(nu)).toBeCloseTo(H * nu, 20)
      expect(wavelengthFromFreq(nu)).toBeCloseTo(C / nu, 12)
      expect(wienPeakWavelength(300)).toBeCloseTo(WIEN_B / 300, 14)
    })
  })

  describe('runStefanSample', () => {
    it('ok, methodId/familyId, scale and net flux', () => {
      const r = runStefanSample()
      expect(r.methodId).toBe(METHOD_ALGO_STEFAN)
      expect(r.familyId).toBe(METHOD_STEFAN)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.j).toBeCloseTo(SIGMA * r.T ** 4, 10)
      expect(r.jHotter / r.j).toBeCloseTo(16, 10)
      expect(r.qNet).toBeGreaterThan(0)
      expect(r.jGrey).toBeCloseTo(r.emissivity * r.j, 12)
      expect(r.E_photon).toBeGreaterThan(0)
      expect(r.lambdaPeak).toBeGreaterThan(0)
    })

    it('custom T still ok', () => {
      const r = runStefanSample({ T: 5778, T_c: 300, emissivity: 1 })
      expect(r.ok).toBe(true)
      expect(r.j).toBeCloseTo(SIGMA * 5778 ** 4, 4)
    })
  })
})

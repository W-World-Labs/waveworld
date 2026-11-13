import { describe, it, expect } from 'vitest'
import {
  METHOD_FOURIER,
  METHOD_ALGO_FOURIER_FLUX,
  FOURIER_PARENT,
  FOURIER_METHOD_IDS,
  DEFAULT_K,
  DEFAULT_DELTA_T,
  DEFAULT_DELTA_X,
  fourierFlux,
  runFourierFluxSample,
} from './fourier-heat-algos'

describe('Fourier · q = −k ΔT/Δx', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_FOURIER).toBe('method-fourier-law')
    expect(METHOD_ALGO_FOURIER_FLUX).toBe('method-algo-fourier-flux')
    expect(FOURIER_PARENT).toBe(METHOD_FOURIER)
    expect(FOURIER_METHOD_IDS).toContain(METHOD_ALGO_FOURIER_FLUX)
  })

  it('fourierFlux: q = −k ΔT/Δx', () => {
    expect(fourierFlux(200, 50, 0.01)).toBeCloseTo(-1e6, 6)
    expect(
      fourierFlux(DEFAULT_K, DEFAULT_DELTA_T, DEFAULT_DELTA_X),
    ).toBeCloseTo(-DEFAULT_K * (DEFAULT_DELTA_T / DEFAULT_DELTA_X), 6)
  })

  it('linear in k; zero ΔT; Δx=0 → NaN', () => {
    const q = fourierFlux(100, 20, 0.05)
    expect(fourierFlux(200, 20, 0.05)).toBeCloseTo(2 * q, 12)
    expect(fourierFlux(100, 0, 0.05)).toBe(0)
    expect(Number.isNaN(fourierFlux(100, 20, 0))).toBe(true)
    expect(Number.isNaN(fourierFlux(NaN, 1, 1))).toBe(true)
  })

  it('down-gradient sign: ΔT>0, Δx>0 ⇒ q<0', () => {
    expect(fourierFlux(1, 10, 2)).toBeLessThan(0)
    expect(fourierFlux(1, -10, 2)).toBeGreaterThan(0)
  })

  it('runFourierFluxSample: ok, formula, double k, zero T', () => {
    const r = runFourierFluxSample()
    expect(r.methodId).toBe(METHOD_ALGO_FOURIER_FLUX)
    expect(r.familyId).toBe(METHOD_FOURIER)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.q).toBeCloseTo(-r.k * (r.deltaT / r.deltaX), 6)
    expect(r.q).toBeLessThan(0)
    expect(r.q_doubleK).toBeCloseTo(2 * r.q, 6)
    expect(r.q_zeroT).toBe(0)
    expect(Number.isFinite(r.q_badX)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runFourierFluxSample({ k: 50, deltaT: 10, deltaX: 0.1 }).ok).toBe(
      true,
    )
  })
})

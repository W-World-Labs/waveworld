import { describe, it, expect } from 'vitest'
import {
  METHOD_FICK,
  METHOD_ALGO_FICK_FLUX,
  FICK_PARENT,
  FICK_METHOD_IDS,
  DEFAULT_D,
  DEFAULT_DELTA_C,
  DEFAULT_DELTA_X,
  fickFlux,
  runFickFluxSample,
} from './fick-diffusion-algos'

describe('Fick · J = −D ΔC/Δx', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_FICK).toBe('method-fick-diffusion')
    expect(METHOD_ALGO_FICK_FLUX).toBe('method-algo-fick-flux')
    expect(FICK_PARENT).toBe(METHOD_FICK)
    expect(FICK_METHOD_IDS).toContain(METHOD_ALGO_FICK_FLUX)
  })

  it('fickFlux: J = −D ΔC/Δx', () => {
    expect(fickFlux(1e-9, 100, 1e-3)).toBeCloseTo(-1e-4, 18)
    expect(fickFlux(DEFAULT_D, DEFAULT_DELTA_C, DEFAULT_DELTA_X)).toBeCloseTo(
      -DEFAULT_D * (DEFAULT_DELTA_C / DEFAULT_DELTA_X),
      18,
    )
  })

  it('linear in D; zero ΔC; Δx=0 → NaN; non-finite → NaN', () => {
    const J = fickFlux(1e-9, 50, 0.01)
    expect(fickFlux(2e-9, 50, 0.01)).toBeCloseTo(2 * J, 18)
    expect(fickFlux(1e-9, 0, 0.01)).toBe(0)
    expect(Number.isNaN(fickFlux(1e-9, 1, 0))).toBe(true)
    expect(Number.isNaN(fickFlux(NaN, 1, 1))).toBe(true)
  })

  it('down-gradient sign: ΔC>0, Δx>0 ⇒ J<0', () => {
    expect(fickFlux(1, 10, 2)).toBeLessThan(0)
    expect(fickFlux(1, -10, 2)).toBeGreaterThan(0)
  })

  it('runFickFluxSample: ok, formula, double D, zero C', () => {
    const r = runFickFluxSample()
    expect(r.methodId).toBe(METHOD_ALGO_FICK_FLUX)
    expect(r.familyId).toBe(METHOD_FICK)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.J).toBeCloseTo(-r.D * (r.deltaC / r.deltaX), 18)
    expect(r.J).toBeLessThan(0)
    expect(r.J_doubleD).toBeCloseTo(2 * r.J, 18)
    expect(r.J_zeroC).toBe(0)
    expect(Number.isFinite(r.J_badX)).toBe(false)
  })

  it('custom params still ok', () => {
    expect(runFickFluxSample({ D: 1e-10, deltaC: 10, deltaX: 1e-4 }).ok).toBe(
      true,
    )
  })
})

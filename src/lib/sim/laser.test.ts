import { WasmLaser } from './wasm-fields'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT,
  laserStep,
  steadyPhotons,
  thresholdPump,
  type LaserParams,
  type LaserState,
} from './laser'

describe('laser.ts rate-equation kernel (#7)', () => {
  it('analytic steady state satisfies both rate equations without time integration', () => {
    for (const pump of [0, 400, 1000, 2500, 4000]) {
      const p = DEFAULT, S = steadyPhotons(pump), N = pump / (1 / p.tauN + p.B * S)
      expect(pump - N / p.tauN - p.B * N * S).toBeCloseTo(0, 9)
      expect(p.B * N * S - S / p.tauC + p.spont * N).toBeCloseTo(0, 9)
    }
    expect(steadyPhotons(4000, { ...DEFAULT, spont: 0 })).toBe(0)
  })
  it('thresholdPump matches N_th / τN = 1/(B τC τN)', () => {
    const p: LaserParams = { ...DEFAULT }
    expect(thresholdPump(p)).toBeCloseTo(1 / (p.B * p.tauC * p.tauN), 12)
  })

  it('below threshold S stays small; above threshold S grows', () => {
    const Pth = thresholdPump()
    const below = steadyPhotons(Pth * 0.4)
    const above = steadyPhotons(Pth * 2.5)
    expect(Number.isFinite(below) && Number.isFinite(above)).toBe(true)
    expect(above).toBeGreaterThan(below * 10)
  })

  it('laserStep keeps N,S ≥ 0 and finite for legal params', () => {
    const owner = new WasmLaser(), pump = thresholdPump() * 1.5
    let s: LaserState = { N: 1, S: 0 }
    for (let i = 0; i < 100; i++) {
      s = laserStep(s, pump, 0.01, DEFAULT, owner)
      expect(Number.isFinite(s.N) && Number.isFinite(s.S)).toBe(true)
      expect(s.N).toBeGreaterThanOrEqual(0)
      expect(s.S).toBeGreaterThanOrEqual(0)
    }
  })

  it('dynamics converge to the analytic steady state with turn-on overshoot', () => {
    // Tolerance-based invariants only — the trajectory itself is integrator-dependent
    // (Euler→RK4), but the fixed point and the relaxation-oscillation overshoot are not.
    const owner = new WasmLaser(), pump = thresholdPump() * 1.5
    let s: LaserState = { N: 0, S: 0 }, maxS = 0
    for (let i = 0; i < 2000; i++) {
      s = laserStep(s, pump, 0.02, DEFAULT, owner)
      maxS = Math.max(maxS, s.S)
    }
    const ss = steadyPhotons(pump, DEFAULT, owner)
    const nSteady = pump / (1 / DEFAULT.tauN + DEFAULT.B * ss)
    expect(Math.abs(s.S - ss) / ss).toBeLessThan(0.02)
    expect(Math.abs(s.N - nSteady) / nSteady).toBeLessThan(0.02)
    // Laser turn-on overshoots the steady photon density (relaxation oscillation).
    expect(maxS).toBeGreaterThan(2 * ss)
  })

  it('below-threshold pump keeps photon density near zero', () => {
    const owner = new WasmLaser(), pump = thresholdPump() * 0.4
    let s: LaserState = { N: 0, S: 0 }
    for (let i = 0; i < 2000; i++) s = laserStep(s, pump, 0.02, DEFAULT, owner)
    expect(s.S).toBeLessThan(1)
    expect(s.S).toBeGreaterThanOrEqual(0)
    expect(s.N).toBeLessThan(thresholdPump() * DEFAULT.tauN * 0.6)
  })

  it('zero pump + zero IC stays at origin (legal zero amplitude)', () => {
    const owner = new WasmLaser()
    let s: LaserState = { N: 0, S: 0 }
    for (let i = 0; i < 50; i++) s = laserStep(s, 0, 0.01, DEFAULT, owner)
    expect(s.N).toBe(0)
    expect(s.S).toBe(0)
  })

  it('illegal params throw RangeError with field name', () => {
    expect(() => laserStep({ N: 0, S: 0 }, 1, 0.01, { ...DEFAULT, tauN: 0 })).toThrow(
      /tauN/,
    )
    expect(() => laserStep({ N: 0, S: 0 }, Number.NaN, 0.01)).toThrow(/pump/)
    expect(() => laserStep({ N: 0, S: 0 }, 1, -0.1)).toThrow(/dt/)
  })
})

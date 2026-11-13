import { describe, it, expect } from 'vitest'
import {
  METHOD_BLOCH,
  METHOD_ALGO_BLOCH_PRECESS,
  BLOCH_PARENT,
  BLOCH_METHOD_IDS,
  GAMMA_PROTON,
  DEFAULT_BLOCH,
  larmorOmega,
  magNorm,
  mxy,
  blochPrecessAnalytic,
  blochEulerStep,
  integrateBlochPrecess,
  runBlochPrecessSample,
  type BlochM,
  type BlochParams,
} from './bloch-algos'

describe('Bloch · classical precession about B0', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_BLOCH).toBe('method-bloch')
    expect(METHOD_ALGO_BLOCH_PRECESS).toBe('method-algo-bloch-precess')
    expect(BLOCH_PARENT).toBe(METHOD_BLOCH)
    expect(BLOCH_METHOD_IDS).toContain(METHOD_ALGO_BLOCH_PRECESS)
  })

  it('larmorOmega = γ B0', () => {
    expect(larmorOmega(1.5, GAMMA_PROTON)).toBeCloseTo(
      GAMMA_PROTON * 1.5,
      6,
    )
  })

  it('analytic precession: full 2π restores M when T2=∞', () => {
    const m0: BlochM = { Mx: 1, My: 0, Mz: 0 }
    const p: BlochParams = { ...DEFAULT_BLOCH, T2: Infinity, T1: Infinity }
    const w = larmorOmega(p.B0, p.gamma)
    const T = (2 * Math.PI) / w
    const m = blochPrecessAnalytic(m0, T, p)
    expect(m.Mx).toBeCloseTo(1, 10)
    expect(m.My).toBeCloseTo(0, 10)
    expect(m.Mz).toBeCloseTo(0, 12)
    expect(magNorm(m)).toBeCloseTo(1, 12)
  })

  it('analytic quarter-turn: Mx→My rotation sense', () => {
    const m0: BlochM = { Mx: 1, My: 0, Mz: 0 }
    const p: BlochParams = { ...DEFAULT_BLOCH, T2: Infinity }
    const w = larmorOmega(p.B0, p.gamma)
    const m = blochPrecessAnalytic(m0, (0.25 * 2 * Math.PI) / w, p)
    // Mx' = Mx cos + My sin; My' = −Mx sin + My cos at φ=π/2 ⇒ Mx≈0, My≈−1
    expect(m.Mx).toBeCloseTo(0, 10)
    expect(m.My).toBeCloseTo(-1, 10)
  })

  it('T2 damps Mxy exponentially', () => {
    const m0: BlochM = { Mx: 1, My: 0, Mz: 0 }
    const T2 = 1e-3
    const p: BlochParams = {
      B0: 1.5,
      gamma: GAMMA_PROTON,
      T2,
      T1: Infinity,
      M0: 1,
    }
    const m = blochPrecessAnalytic(m0, T2, p)
    expect(mxy(m)).toBeCloseTo(Math.exp(-1), 10)
  })

  it('Euler step tracks analytic over short dt', () => {
    const m0: BlochM = { Mx: 0.8, My: 0.2, Mz: 0.1 }
    const p: BlochParams = { ...DEFAULT_BLOCH, T2: Infinity }
    const w = larmorOmega(p.B0, p.gamma)
    const dt = (2 * Math.PI) / w / 500
    let mE = { ...m0 }
    let mA = { ...m0 }
    for (let i = 0; i < 20; i++) {
      mE = blochEulerStep(mE, dt, p)
      mA = blochPrecessAnalytic(mA, dt, p)
    }
    expect(mE.Mx).toBeCloseTo(mA.Mx, 2)
    expect(mE.My).toBeCloseTo(mA.My, 2)
  })

  it('integrateBlochPrecess: |M| conserved without T2', () => {
    const m0: BlochM = { Mx: 1, My: 0, Mz: 0 }
    const p: BlochParams = { ...DEFAULT_BLOCH, T2: Infinity }
    const w = larmorOmega(p.B0, p.gamma)
    const period = (2 * Math.PI) / w
    const r = integrateBlochPrecess(m0, {
      dt: period / 32,
      nSteps: 64,
      p,
    })
    expect(r.finite).toBe(true)
    expect(magNorm(r.mFinal)).toBeCloseTo(1, 10)
    expect(r.Mxy[r.Mxy.length - 1]!).toBeCloseTo(1, 10)
  })

  it('runBlochPrecessSample: ok, precession + T2 decay', () => {
    const r = runBlochPrecessSample()
    expect(r.methodId).toBe(METHOD_ALGO_BLOCH_PRECESS)
    expect(r.familyId).toBe(METHOD_BLOCH)
    expect(r.familyId).toBe('method-bloch')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.normConserved).toBe(true)
    expect(r.mxyConserved).toBe(true)
    expect(r.t2Decays).toBe(true)
    expect(r.stayedTransverse).toBe(true)
    expect(r.omega0).toBeGreaterThan(0)
    expect(r.period).toBeGreaterThan(0)
  })
})

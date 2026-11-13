import { describe, it, expect } from 'vitest'
import {
  METHOD_SHOOTING,
  METHOD_ALGO_SHOOT_LINEAR,
  METHOD_ALGO_SHOOT_SECANT,
  SHOOTING_PARENT,
  SHOOTING_METHOD_IDS,
  DEFAULT_A,
  DEFAULT_B,
  DEFAULT_Y0,
  DEFAULT_TARGET,
  EXACT_SLOPE,
  DEFAULT_N_STEPS,
  sinhField,
  rk4StepVec,
  integrateShoot,
  shootResidual,
  exactY,
  shootLinear,
  shootSecant,
  runShootLinearSample,
  runShootSecantSample,
} from './shooting-algos'

describe('Shooting · 2-point BVP y″=y', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_SHOOTING).toBe('method-shooting')
    expect(METHOD_ALGO_SHOOT_LINEAR).toBe('method-algo-shoot-linear')
    expect(METHOD_ALGO_SHOOT_SECANT).toBe('method-algo-shoot-secant')
    expect(SHOOTING_PARENT).toBe(METHOD_SHOOTING)
    expect(SHOOTING_METHOD_IDS).toContain(METHOD_ALGO_SHOOT_LINEAR)
    expect(SHOOTING_METHOD_IDS).toContain(METHOD_ALGO_SHOOT_SECANT)
    expect(DEFAULT_A).toBe(0)
    expect(DEFAULT_B).toBe(1)
    expect(DEFAULT_Y0).toBe(0)
    expect(DEFAULT_TARGET).toBeCloseTo(Math.sinh(1), 12)
    expect(EXACT_SLOPE).toBe(1)
    expect(DEFAULT_N_STEPS).toBeGreaterThanOrEqual(8)
  })

  it('sinhField: y″=y as first-order [y,v]', () => {
    const out = new Float64Array(2)
    sinhField(0, [0.5, -1.2], out)
    expect(out[0]).toBeCloseTo(-1.2, 12)
    expect(out[1]).toBeCloseTo(0.5, 12)
  })

  it('exactY: y=s·sinh(x); exact slope gives target at x=1', () => {
    expect(exactY(0, 1)).toBeCloseTo(0, 12)
    expect(exactY(1, 1)).toBeCloseTo(Math.sinh(1), 12)
    expect(exactY(1, 2)).toBeCloseTo(2 * Math.sinh(1), 12)
  })

  it('RK4 integrate with s=1: y(1)≈sinh(1)', () => {
    const r = integrateShoot(EXACT_SLOPE, { nSteps: 80, storePath: true })
    expect(r.finite).toBe(true)
    expect(r.xEnd).toBeCloseTo(1, 12)
    expect(Math.abs(r.yEnd - Math.sinh(1))).toBeLessThan(1e-8)
    expect(r.pathX).toBeDefined()
    expect(r.pathY!.length).toBe(81)
    // mid-point vs exact
    const mid = Math.floor(r.pathX!.length / 2)
    const xMid = r.pathX![mid]!
    expect(Math.abs(r.pathY![mid]! - Math.sinh(xMid))).toBeLessThan(1e-8)
  })

  it('residual is linear in s: F(s)=s·sinh(1)−target', () => {
    const nSteps = 100
    const f0 = shootResidual(0, { nSteps })
    const f1 = shootResidual(1, { nSteps })
    const f2 = shootResidual(2, { nSteps })
    expect(Math.abs(f0 - (0 - DEFAULT_TARGET))).toBeLessThan(1e-7)
    expect(Math.abs(f1)).toBeLessThan(1e-8)
    expect(Math.abs(f2 - (2 * Math.sinh(1) - DEFAULT_TARGET))).toBeLessThan(
      1e-7,
    )
  })

  it('shootLinear with exact s: small residual and path error', () => {
    const r = shootLinear({ s: 1, nSteps: 64 })
    expect(r.methodId).toBe(METHOD_ALGO_SHOOT_LINEAR)
    expect(r.familyId).toBe(METHOD_SHOOTING)
    expect(r.finite).toBe(true)
    expect(r.absResidual).toBeLessThan(1e-8)
    expect(r.maxPathErr).toBeLessThan(1e-8)
    expect(r.yEnd).toBeCloseTo(r.target, 8)
  })

  it('shootLinear with wrong s: residual ≈ (s−1)·sinh(1)', () => {
    const s = 0.5
    const r = shootLinear({ s, nSteps: 80 })
    const expected = s * Math.sinh(1) - Math.sinh(1)
    expect(Math.abs(r.residual - expected)).toBeLessThan(1e-7)
    expect(r.absResidual).toBeGreaterThan(0.1)
  })

  it('shootSecant recovers s≈1 from distant guesses', () => {
    const r = shootSecant({ s0: 0.1, s1: 2.5, nSteps: 64, tol: 1e-12 })
    expect(r.methodId).toBe(METHOD_ALGO_SHOOT_SECANT)
    expect(r.familyId).toBe(METHOD_SHOOTING)
    expect(r.finite).toBe(true)
    expect(r.converged).toBe(true)
    expect(Math.abs(r.s - 1)).toBeLessThan(1e-8)
    expect(r.absResidual).toBeLessThan(1e-10)
    expect(r.iterations).toBeGreaterThan(0)
    expect(r.iterations).toBeLessThan(15)
    expect(r.history.length).toBe(r.iterations + 2)
  })

  it('rk4StepVec advances one step consistently with integrateShoot', () => {
    let y = new Float64Array([0, 1])
    const dt = 0.05
    let t = 0
    y = new Float64Array(rk4StepVec(y, t, dt, sinhField))
    t += dt
    expect(Number.isFinite(y[0]!) && Number.isFinite(y[1]!)).toBe(true)
    // y increases from 0 when v=1
    expect(y[0]!).toBeGreaterThan(0)
    expect(Math.abs(y[0]! - Math.sinh(dt))).toBeLessThan(1e-8)
  })

  it('runShootLinearSample: ok, exact slope, familyId', () => {
    const r = runShootLinearSample()
    expect(r.methodId).toBe(METHOD_ALGO_SHOOT_LINEAR)
    expect(r.familyId).toBe(METHOD_SHOOTING)
    expect(r.familyId).toBe('method-shooting')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.matchesExact).toBe(true)
    expect(r.s).toBe(1)
    expect(r.absResidual).toBeLessThan(1e-8)
    expect(r.maxPathErr).toBeLessThan(1e-8)
    expect(r.yEnd).toBeCloseTo(Math.sinh(1), 8)
  })

  it('runShootSecantSample: ok, slope ≈ 1', () => {
    const r = runShootSecantSample()
    expect(r.methodId).toBe(METHOD_ALGO_SHOOT_SECANT)
    expect(r.familyId).toBe(METHOD_SHOOTING)
    expect(r.familyId).toBe('method-shooting')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.converged).toBe(true)
    expect(r.slopeErr).toBeLessThan(1e-6)
    expect(r.absResidual).toBeLessThan(1e-8)
    expect(r.exactSlope).toBe(1)
  })
})

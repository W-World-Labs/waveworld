import { describe, it, expect } from 'vitest'
import {
  METHOD_BDF,
  METHOD_ALGO_BDF2,
  BDF_PARENT,
  BDF_METHOD_IDS,
  decayOde,
  decayExact,
  bdf1StepDecay,
  bdf2StepDecay,
  bdf2StepFixedPoint,
  rk4Step,
  eulerStep,
  integrateBdf2Decay,
  integrateEulerDecay,
  runBdf2Sample,
} from './bdf-algos'

describe('BDF · multistep BDF2 on y′=−y', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_BDF).toBe('method-bdf')
    expect(METHOD_ALGO_BDF2).toBe('method-algo-bdf2')
    expect(BDF_PARENT).toBe(METHOD_BDF)
    expect(BDF_METHOD_IDS).toContain(METHOD_ALGO_BDF2)
  })

  it('decayOde and decayExact', () => {
    expect(decayOde(0, 2)).toBe(-2)
    expect(decayExact(1, 0)).toBe(1)
    expect(decayExact(1, 1)).toBeCloseTo(Math.exp(-1), 12)
  })

  it('BDF1 step matches y/(1+dt) and is A-stable on decay', () => {
    const y1 = bdf1StepDecay(1, 0.5)
    expect(y1).toBeCloseTo(1 / 1.5, 12)
    // large dt still damps (no blow-up)
    const yBig = bdf1StepDecay(1, 10)
    expect(yBig).toBeCloseTo(1 / 11, 12)
    expect(yBig).toBeGreaterThan(0)
    expect(yBig).toBeLessThan(1)
  })

  it('BDF2 direct step formula', () => {
    const yN = 0.9
    const yNm1 = 1
    const dt = 0.1
    const yPlus = bdf2StepDecay(yN, yNm1, dt)
    expect(yPlus).toBeCloseTo((4 * yN - yNm1) / (3 + 2 * dt), 12)
  })

  it('BDF2 fixed-point matches direct solve on y′=−y', () => {
    const yN = 0.85
    const yNm1 = 0.95
    const dt = 0.05
    const tN = 0.2
    const direct = bdf2StepDecay(yN, yNm1, dt)
    const fp = bdf2StepFixedPoint(yN, yNm1, tN, dt, decayOde, {
      tol: 1e-14,
      maxIter: 50,
    })
    expect(fp.converged).toBe(true)
    expect(Math.abs(fp.y - direct)).toBeLessThan(1e-12)
  })

  it('integrateBdf2Decay: accuracy vs exact and better than Euler', () => {
    const nSteps = 50
    const dt = 0.08
    const y0 = 1
    const bdf = integrateBdf2Decay(y0, 0, dt, nSteps, { bootstrap: 'bdf1' })
    const euler = integrateEulerDecay(y0, 0, dt, nSteps)
    const exact = decayExact(y0, nSteps * dt)
    expect(bdf.finite).toBe(true)
    expect(bdf.t).toBeCloseTo(nSteps * dt, 12)
    expect(Math.abs(bdf.y - exact)).toBeLessThan(Math.abs(euler.y - exact))
    expect(Math.abs(bdf.y - exact)).toBeLessThan(5e-4)
  })

  it('bootstrap RK4 vs BDF1 both produce small error', () => {
    const nSteps = 40
    const dt = 0.05
    const a = integrateBdf2Decay(1, 0, dt, nSteps, { bootstrap: 'bdf1' })
    const b = integrateBdf2Decay(1, 0, dt, nSteps, { bootstrap: 'rk4' })
    const exact = decayExact(1, nSteps * dt)
    expect(Math.abs(a.y - exact)).toBeLessThan(5e-4)
    expect(Math.abs(b.y - exact)).toBeLessThan(5e-4)
  })

  it('BDF2 more stable than forward Euler on stiff-ish dt>2', () => {
    // Forward Euler on y′=−y unstable for dt>2 (|1−dt|>1); BDF2 remains damped (A-stable)
    const dt = 2.5
    const nSteps = 16
    const bdf = integrateBdf2Decay(1, 0, dt, nSteps, { bootstrap: 'bdf1' })
    const euler = integrateEulerDecay(1, 0, dt, nSteps)
    const exact = decayExact(1, nSteps * dt)
    expect(bdf.finite).toBe(true)
    expect(euler.finite).toBe(true)
    // Euler amplifies: |1−dt|=1.5 each step
    expect(Math.abs(euler.y)).toBeGreaterThan(10)
    // BDF2 stays near exact decay (tiny at t=40)
    expect(Math.abs(bdf.y)).toBeLessThan(1)
    expect(Math.abs(bdf.y - exact)).toBeLessThan(Math.abs(euler.y - exact))
  })

  it('rk4Step and eulerStep sanity', () => {
    const dt = 0.1
    const yR = rk4Step(1, 0, dt, decayOde)
    const yE = eulerStep(1, 0, dt, decayOde)
    const exact = decayExact(1, dt)
    expect(Math.abs(yR - exact)).toBeLessThan(Math.abs(yE - exact))
    expect(yE).toBeCloseTo(0.9, 12)
  })

  it('runBdf2Sample: ok, methodId, familyId, better than Euler', () => {
    const r = runBdf2Sample()
    expect(r.methodId).toBe(METHOD_ALGO_BDF2)
    expect(r.familyId).toBe(METHOD_BDF)
    expect(r.familyId).toBe('method-bdf')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.bdf2Better).toBe(true)
    expect(r.bdf2Err).toBeLessThan(r.eulerErr)
    expect(r.bdf2Err).toBeLessThan(1e-3)
    expect(r.fpAgree).toBeLessThan(1e-10)
  })

  it('runBdf2Sample with fixedPoint option', () => {
    const r = runBdf2Sample({ fixedPoint: true, nSteps: 30, dt: 0.1 })
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import {
  METHOD_PID,
  METHOD_ALGO_PID_STEP,
  PID_PARENT,
  PID_METHOD_IDS,
  DEFAULT_PID_GAINS,
  DEFAULT_PLANT,
  createPidState,
  pidStep,
  plantStep,
  simulatePidPlant,
  runPidStepSample,
} from './pid-algos'

describe('PID · discrete controller + first-order plant', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_PID).toBe('method-pid')
    expect(METHOD_ALGO_PID_STEP).toBe('method-algo-pid-step')
    expect(PID_PARENT).toBe(METHOD_PID)
    expect(PID_METHOD_IDS).toContain(METHOD_ALGO_PID_STEP)
  })

  it('pidStep: P-only proportional, integral accumulates', () => {
    let st = createPidState()
    const gains = { Kp: 2, Ki: 0, Kd: 0 }
    const r1 = pidStep(1, 0, 0.1, gains, st)
    expect(r1.e).toBeCloseTo(1, 12)
    expect(r1.u).toBeCloseTo(2, 12)
    st = r1.state

    const gainsI = { Kp: 0, Ki: 3, Kd: 0 }
    st = createPidState()
    const a = pidStep(1, 0, 0.5, gainsI, st)
    expect(a.u).toBeCloseTo(3 * 1 * 0.5, 12)
    const b = pidStep(1, 0, 0.5, gainsI, a.state)
    expect(b.u).toBeCloseTo(3 * 1 * 1.0, 12)
  })

  it('pidStep: derivative uses backward difference after first sample', () => {
    let st = createPidState()
    const gains = { Kp: 0, Ki: 0, Kd: 4 }
    const r0 = pidStep(0, 0, 0.1, gains, st)
    expect(r0.u).toBeCloseTo(0, 12)
    st = r0.state
    // e: 0 → 0.5 in dt=0.1 ⇒ de/dt = 5 ⇒ u = 4*5 = 20
    const r1 = pidStep(0.5, 0, 0.1, gains, st)
    expect(r1.u).toBeCloseTo(20, 10)
  })

  it('plantStep: open-loop step approaches K u', () => {
    let y = 0
    const u = 1
    const dt = 0.05
    for (let i = 0; i < 200; i++) y = plantStep(y, u, dt, DEFAULT_PLANT)
    // τ=1, t=10 ⇒ 1−e^{−10} ≈ 1
    expect(y).toBeGreaterThan(0.99)
    expect(y).toBeLessThanOrEqual(1 + 1e-9)
  })

  it('simulatePidPlant: finite trajectory, y moves toward sp', () => {
    const r = simulatePidPlant({ sp: 1, y0: 0, nSteps: 120, dt: 0.05 })
    expect(r.finite).toBe(true)
    expect(r.yFinal).toBeGreaterThan(0.5)
    expect(r.absErrFinal).toBeLessThan(0.15)
    expect(r.y.length).toBe(121)
  })

  it('runPidStepSample: ok, tracks setpoint, familyId method-pid', () => {
    const r = runPidStepSample()
    expect(r.methodId).toBe(METHOD_ALGO_PID_STEP)
    expect(r.familyId).toBe(METHOD_PID)
    expect(r.familyId).toBe('method-pid')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.tracks).toBe(true)
    expect(r.bounded).toBe(true)
    expect(r.absErrFinal).toBeLessThan(0.12)
    expect(r.yFinal).toBeCloseTo(r.sp, 0)
    expect(DEFAULT_PID_GAINS.Kp).toBeGreaterThan(0)
  })

  it('runPidStepSample: custom gains still finite and track', () => {
    const r = runPidStepSample({
      gains: { Kp: 2.0, Ki: 0.8, Kd: 0.05 },
      nSteps: 120,
      dt: 0.05,
      errTol: 0.15,
    })
    expect(r.finite).toBe(true)
    expect(r.ok).toBe(true)
    expect(r.absErrFinal).toBeLessThan(0.15)
  })
})


import { describe, it, expect } from 'vitest'
import {
  METHOD_RK,
  METHOD_ALGO_RK4,
  RK_PARENT,
  RK_METHOD_IDS,
  eulerStep,
  rk4Step,
  integrateScalar,
  eulerStepVec,
  rk4StepVec,
  harmonicField,
  harmonicEnergy,
  decayOde,
  decayExact,
  runRk4Sample,
} from './rk-algos'

describe('RK · 经典 Runge–Kutta (RK4)', () => {
  it('方法 id 常量（新 id 未入库，勿 methodById）', () => {
    expect(METHOD_RK).toBe('method-runge-kutta')
    expect(METHOD_ALGO_RK4).toBe('method-algo-rk4')
    expect(RK_PARENT).toBe(METHOD_RK)
    expect(RK_METHOD_IDS).toContain(METHOD_ALGO_RK4)
  })

  it('y′=−y：RK4 单步与多步逼近 e^{−t}，且优于 Euler', () => {
    const y0 = 1
    const dt = 0.1
    // 单步
    const y1e = eulerStep(y0, 0, dt, decayOde)
    const y1r = rk4Step(y0, 0, dt, decayOde)
    const exact1 = decayExact(y0, dt)
    expect(Math.abs(y1r - exact1)).toBeLessThan(Math.abs(y1e - exact1))
    expect(Math.abs(y1r - exact1)).toBeLessThan(1e-6)

    // 多步到 t=1（n * dt = 1）
    const n = 10
    const { y: yR, t: tR } = integrateScalar(y0, 0, dt, n, decayOde, 'rk4')
    const { y: yE } = integrateScalar(y0, 0, dt, n, decayOde, 'euler')
    expect(tR).toBeCloseTo(1, 12)
    const exact = decayExact(y0, 1)
    expect(Math.abs(yR - exact)).toBeLessThan(1e-6)
    expect(Math.abs(yR - exact)).toBeLessThan(Math.abs(yE - exact) * 0.1)
  })

  it('谐振子：RK4 能量漂移远小于 Euler', () => {
    const omega = 1
    const f = harmonicField(omega)
    const dt = 0.05
    const steps = 200
    let yR = new Float64Array([1, 0])
    let yE = new Float64Array([1, 0])
    const E0 = harmonicEnergy(1, 0, omega)
    let t = 0
    for (let i = 0; i < steps; i++) {
      yR = new Float64Array(rk4StepVec(yR, t, dt, f))
      yE = new Float64Array(eulerStepVec(yE, t, dt, f))
      t += dt
    }
    const dR = Math.abs(harmonicEnergy(yR[0]!, yR[1]!, omega) - E0) / E0
    const dE = Math.abs(harmonicEnergy(yE[0]!, yE[1]!, omega) - E0) / E0
    expect(dR).toBeLessThan(1e-4)
    expect(dE).toBeGreaterThan(dR * 10)
  })

  it('runRk4Sample：ok、误差/能量优于 Euler、methodId/familyId', () => {
    const r = runRk4Sample()
    expect(r.methodId).toBe(METHOD_ALGO_RK4)
    expect(r.familyId).toBe(METHOD_RK)
    expect(r.familyId).toBe('method-runge-kutta')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.decayRk4Better).toBe(true)
    expect(r.oscRk4Better).toBe(true)
    expect(r.decayRk4Err).toBeLessThan(r.decayEulerErr)
    expect(r.energyDriftRk4).toBeLessThan(r.energyDriftEuler)
    expect(r.decayRk4Err).toBeLessThan(1e-6)
    expect(r.energyDriftRk4).toBeLessThan(1e-4)
  })
})

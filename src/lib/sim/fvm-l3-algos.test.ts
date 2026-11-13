import { describe, it, expect } from 'vitest'
import {
  FVM_PARENT,
  METHOD_ALGO_FVM_HLLC,
  consToPrim,
  contactSpeed,
  hllcFlux,
  primToCons,
  runFvmHllcSample,
  soundSpeed,
  waveSpeeds,
} from './fvm-l3-algos'
import { methodById } from '../../data/methods/methods'

describe('有限体积 L3 · HLLC 近似 Riemann 1D', () => {
  it('方法 id 对齐 FVM catalog', () => {
    expect(FVM_PARENT).toBe('method-finite-volume')
    expect(METHOD_ALGO_FVM_HLLC).toBe('method-algo-fvm-hllc-stub')
    expect(methodById(FVM_PARENT)).toBeDefined()
    expect(methodById(METHOD_ALGO_FVM_HLLC)?.parentId).toBe(FVM_PARENT)
  })

  it('prim↔cons 互逆（静止理想气体）', () => {
    const w = { rho: 1.2, u: 0.3, p: 0.9 }
    const U = primToCons(w)
    const back = consToPrim(U)
    expect(back.rho).toBeCloseTo(w.rho, 12)
    expect(back.u).toBeCloseTo(w.u, 12)
    expect(back.p).toBeCloseTo(w.p, 12)
  })

  it('相同左右态 HLLC 通量 = 物理通量', () => {
    const w = { rho: 1, u: 0.5, p: 1 }
    const U = primToCons(w)
    const F = hllcFlux(U, U)
    // F_ρ = ρu
    expect(F.rho).toBeCloseTo(w.rho * w.u, 10)
    expect(F.mom).toBeCloseTo(w.rho * w.u * w.u + w.p, 10)
  })

  it('波速 SL < SM < SR（Sod）', () => {
    const wL = { rho: 1, u: 0, p: 1 }
    const wR = { rho: 0.125, u: 0, p: 0.1 }
    const { SL, SR } = waveSpeeds(wL, wR)
    const SM = contactSpeed(wL, wR, SL, SR)
    expect(SL).toBeLessThan(SM)
    expect(SM).toBeLessThan(SR)
    expect(soundSpeed(wL)).toBeGreaterThan(soundSpeed(wR))
  })

  it('runFvmHllcSample：质量守恒、有限、中间态合理', () => {
    const r = runFvmHllcSample({ n: 128, cfl: 0.35, steps: 50 })
    expect(r.methodId).toBe(METHOD_ALGO_FVM_HLLC)
    expect(r.familyId).toBe(FVM_PARENT)
    expect(r.finite).toBe(true)
    expect(r.massErr).toBeLessThan(1e-10)
    expect(r.intermediateOk).toBe(true)
    expect(r.rhoMidF).toBeLessThan(r.rhoL0)
    expect(r.rhoMidF).toBeGreaterThan(r.rhoR0 * 0.4)
  })
})

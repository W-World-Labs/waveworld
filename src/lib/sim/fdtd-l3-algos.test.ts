import { describe, it, expect } from 'vitest'
import {
  FDTD_L3_METHOD_IDS,
  FDTD_L3_PARENT,
  METHOD_ALGO_FDTD_CONDUCTIVITY,
  createFdtd1dConductive,
  fdtd1dEnergy,
  fdtd1dStep,
  injectGaussianE,
  runFdtdConductivitySample,
} from './fdtd-l3-algos'
import { methodById } from '../../data/methods/methods'

describe('FDTD L3 · 1D 电导损耗 Yee', () => {
  it('方法 id 常量（conductivity 为未入库新 id）', () => {
    expect(FDTD_L3_PARENT).toBe('method-fdtd')
    expect(METHOD_ALGO_FDTD_CONDUCTIVITY).toBe('method-algo-fdtd-conductivity')
    expect(FDTD_L3_METHOD_IDS).toContain(METHOD_ALGO_FDTD_CONDUCTIVITY)
    expect(methodById(FDTD_L3_PARENT)).toBeDefined()
    expect(methodById(FDTD_L3_PARENT)!.role).toBe('family')
  })

  it('createFdtd1dConductive：σ=0 时 ca=1', () => {
    const f = createFdtd1dConductive({ nE: 16, sigma: 0, S: 0.5 })
    expect(f.ca).toBeCloseTo(1, 12)
    expect(f.cb).toBeGreaterThan(0)
    expect(f.nH).toBe(15)
    expect(f.E.length).toBe(16)
    expect(f.H.length).toBe(15)
  })

  it('σ>0：ca ∈ (0,1)，能量衰减', () => {
    const f = createFdtd1dConductive({ nE: 48, sigma: 0.08, S: 0.5 })
    expect(f.ca).toBeGreaterThan(0)
    expect(f.ca).toBeLessThan(1)
    injectGaussianE(f, 1, 4)
    const e0 = fdtd1dEnergy(f)
    expect(e0).toBeGreaterThan(0)
    for (let t = 0; t < 80; t++) fdtd1dStep(f)
    const ef = fdtd1dEnergy(f)
    expect(Number.isFinite(ef)).toBe(true)
    expect(ef).toBeLessThan(e0)
    expect(ef).toBeGreaterThanOrEqual(0)
  })

  it('σ=0 PEC 腔：多步后能量近似守恒', () => {
    const f = createFdtd1dConductive({ nE: 48, sigma: 0, S: 0.5 })
    injectGaussianE(f, 1, 4)
    const e0 = fdtd1dEnergy(f)
    for (let t = 0; t < 100; t++) fdtd1dStep(f)
    const ef = fdtd1dEnergy(f)
    // 交错能量代理有 O(S²) 微颤，允许小相对漂移
    expect(Math.abs(ef - e0) / e0).toBeLessThan(0.08)
  })

  it('runFdtdConductivitySample：有损衰减、无损守恒', () => {
    const r = runFdtdConductivitySample({ nE: 64, steps: 120, sigma: 0.05 })
    expect(r.methodId).toBe(METHOD_ALGO_FDTD_CONDUCTIVITY)
    expect(r.familyId).toBe(FDTD_L3_PARENT)
    expect(r.finite).toBe(true)
    expect(r.lossDecayed).toBe(true)
    expect(r.lossMonotone).toBe(true)
    expect(r.losslessConserved).toBe(true)
    expect(r.lossLessThanLossless).toBe(true)
    expect(r.Efloss).toBeLessThan(r.E0loss)
    expect(r.Efloss).toBeGreaterThanOrEqual(0)
  })
})

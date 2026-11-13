import { describe, it, expect } from 'vitest'
import {
  FVM_FLUX_ID,
  FVM_PARENT,
  fvmStep1d,
  laxFriedrichsFlux,
  runFvmFluxSample,
  runFvmSample,
  sumMass,
  upwindFlux,
} from './fvm-algos'
import { methodById } from '../../data/methods/methods'

describe('有限体积 FVM · 面通量', () => {
  it('方法 id 常量对齐目录父族', () => {
    expect(FVM_PARENT).toBe('method-finite-volume')
    expect(FVM_FLUX_ID).toBe('method-algo-fvm-flux')
    const m = methodById(FVM_PARENT)
    expect(m).toBeDefined()
    expect(m!.role).toBe('family')
    expect(methodById(FVM_FLUX_ID)?.parentId).toBe(FVM_PARENT)
  })

  it('迎风通量：a>0 取左，a<0 取右', () => {
    expect(upwindFlux(2, 5, 1)).toBe(2)
    expect(upwindFlux(2, 5, -3)).toBe(-15)
    expect(upwindFlux(2, 5, 0)).toBe(0)
  })

  it('LF 通量在 uL=uR 时等于 a·u', () => {
    expect(laxFriedrichsFlux(3, 3, 2)).toBeCloseTo(6, 12)
  })

  it('周期均匀场一步后仍均匀、质量守恒', () => {
    const u = new Float64Array(16).fill(1.5)
    const next = fvmStep1d(u, 1, 0.1, 0.02)
    for (let i = 0; i < 16; i++) expect(next[i]).toBeCloseTo(1.5, 10)
    expect(sumMass(next)).toBeCloseTo(sumMass(u), 10)
  })

  it('runFvmFluxSample：质量守恒、有限、峰衰减或不发散', () => {
    const r = runFvmFluxSample()
    expect(r.methodId).toBe(FVM_FLUX_ID)
    expect(r.finite).toBe(true)
    expect(r.massErr).toBeLessThan(1e-10)
    expect(r.peakF).toBeGreaterThan(0)
    expect(r.peakF).toBeLessThanOrEqual(r.peak0 * 1.01)
  })

  it('runFvmSample 族入口有限', () => {
    const r = runFvmSample()
    expect(r.methodId).toBe(FVM_PARENT)
    expect(r.finite).toBe(true)
    expect(r.massErr).toBeLessThan(1e-10)
  })
})

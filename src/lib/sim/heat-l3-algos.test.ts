import { describe, it, expect } from 'vitest'
import {
  HEAT_L3_PARENT,
  METHOD_ALGO_HEAT_CRANK_NICOLSON,
  STABLE_R,
  crankNicolsonStep1D,
  ftcsStep1D,
  gaussianIC,
  runCrankNicolsonSample,
} from './heat-l3-algos'
import { methodById } from '../../data/methods/methods'

describe('热扩散 L3 · Crank–Nicolson 1D', () => {
  it('方法 id 常量（CN 为未入库新 id）', () => {
    expect(HEAT_L3_PARENT).toBe('method-heat-ftcs')
    expect(METHOD_ALGO_HEAT_CRANK_NICOLSON).toBe('method-algo-heat-crank-nicolson')
    expect(STABLE_R).toBe(0.25)
    expect(methodById(HEAT_L3_PARENT)).toBeDefined()
  })

  it('CN 单步：均匀场保持，峰值不增', () => {
    const flat = new Float64Array(16).fill(0)
    flat[0] = 0
    flat[15] = 0
    for (let i = 1; i < 15; i++) flat[i] = 1
    // 端点 0、内部 1 非均匀——改用真均匀
    const u = new Float64Array(16).fill(0.5)
    u[0] = 0.5
    u[15] = 0.5
    const next = crankNicolsonStep1D(u, 0.3)
    for (let i = 0; i < 16; i++) expect(next[i]).toBeCloseTo(0.5, 10)

    const g = gaussianIC(32)
    const max0 = Math.max(...g)
    const cn = crankNicolsonStep1D(g, 0.2)
    expect(Math.max(...cn)).toBeLessThanOrEqual(max0 + 1e-12)
    expect(cn.every(Number.isFinite)).toBe(true)
  })

  it('小 r 下 CN 与 FTCS 同号扩散（峰值下降）', () => {
    const u0 = gaussianIC(40)
    const r = 0.15
    const cn = crankNicolsonStep1D(u0, r)
    const ft = ftcsStep1D(u0, r)
    const max0 = Math.max(...u0)
    expect(Math.max(...cn)).toBeLessThan(max0)
    expect(Math.max(...ft)).toBeLessThan(max0)
  })

  it('runCrankNicolsonSample：同 r 下 CN 比 FTCS 更准，大 r 稳定', () => {
    const r = runCrankNicolsonSample(48, 0.2, 30)
    expect(r.methodId).toBe(METHOD_ALGO_HEAT_CRANK_NICOLSON)
    expect(r.familyId).toBe(HEAT_L3_PARENT)
    expect(r.finite).toBe(true)
    expect(r.cnMoreAccurate).toBe(true)
    expect(r.cnErr).toBeLessThan(r.ftcsErr)
    expect(r.largeR.cnFinite).toBe(true)
    expect(r.largeR.cnMaxDropped).toBe(true)
    expect(r.largeR.r).toBeGreaterThan(r.stableR)
  })
})

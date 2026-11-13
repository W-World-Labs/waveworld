import { describe, it, expect } from 'vitest'
import {
  METHOD_MULTIGRID,
  METHOD_ALGO_MG_WCYCLE,
  MG_L2_METHOD_IDS,
  MG_L2_PARENT,
  wcycle1d,
  runMgWcycleSample,
} from './multigrid-l2-algos'
import {
  residual1d,
  norm2,
  vcycle1d,
  gaussSeidelSmooth1d,
} from './multigrid-algos'

describe('几何多重网格 L2 · W-cycle', () => {
  it('方法 id 常量（新 id 未入库，勿 methodById）', () => {
    expect(METHOD_MULTIGRID).toBe('method-multigrid')
    expect(METHOD_ALGO_MG_WCYCLE).toBe('method-algo-mg-wcycle')
    expect(MG_L2_PARENT).toBe(METHOD_MULTIGRID)
    expect(MG_L2_METHOD_IDS).toContain(METHOD_ALGO_MG_WCYCLE)
  })

  it('一次 W-cycle 残差显著下降', () => {
    const n = 33
    const h = 1 / (n - 1)
    const f = new Float64Array(n)
    for (let i = 0; i < n; i++) f[i] = Math.sin(Math.PI * i * h)
    f[0] = 0
    f[n - 1] = 0
    const u = new Float64Array(n)
    const r0 = norm2(residual1d(u, f, h))
    wcycle1d(u, f, h, { nu1: 2, nu2: 2 })
    const r1 = norm2(residual1d(u, f, h))
    expect(r1).toBeLessThan(r0 * 0.25)
    expect(r1).toBeGreaterThan(0)
  })

  it('W-cycle 残差 ≤ 同 nu 单次 V-cycle', () => {
    const n = 33
    const h = 1 / (n - 1)
    const f = new Float64Array(n)
    for (let i = 0; i < n; i++) f[i] = Math.sin(Math.PI * i * h)
    f[0] = 0
    f[n - 1] = 0
    const nu1 = 2
    const nu2 = 2

    const uW = new Float64Array(n)
    wcycle1d(uW, f, h, { nu1, nu2 })
    const rW = norm2(residual1d(uW, f, h))

    const uV = new Float64Array(n)
    vcycle1d(uV, f, h, { nu1, nu2 })
    const rV = norm2(residual1d(uV, f, h))

    expect(rW).toBeLessThanOrEqual(rV * (1 + 1e-9))
  })

  it('W-cycle 优于同等前+后光滑次数的纯细网格 GS', () => {
    const n = 33
    const h = 1 / (n - 1)
    const f = new Float64Array(n)
    for (let i = 0; i < n; i++) f[i] = Math.sin(Math.PI * i * h)
    f[0] = 0
    f[n - 1] = 0
    const nu1 = 2
    const nu2 = 2

    const uW = new Float64Array(n)
    wcycle1d(uW, f, h, { nu1, nu2 })
    const rW = norm2(residual1d(uW, f, h))

    const uS = new Float64Array(n)
    gaussSeidelSmooth1d(uS, f, h, nu1 + nu2)
    const rS = norm2(residual1d(uS, f, h))

    expect(rW).toBeLessThan(rS)
  })

  it('runMgWcycleSample：残差下降、不劣于 V、ok', () => {
    const r = runMgWcycleSample()
    expect(r.methodId).toBe(METHOD_ALGO_MG_WCYCLE)
    expect(r.familyId).toBe(METHOD_MULTIGRID)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.residualDecreased).toBe(true)
    expect(r.betterOrEqualThanV).toBe(true)
    expect(r.residualAfterW).toBeLessThan(r.residual0)
    expect(r.residualAfterW).toBeLessThanOrEqual(r.residualAfterV * (1 + 1e-9))
    expect(r.residualRatioW).toBeLessThan(0.5)
    expect(r.midU).toBeGreaterThan(0)
    expect(r.analyticMid).toBeCloseTo(1 / (Math.PI * Math.PI), 12)
  })
})

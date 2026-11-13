import { describe, it, expect } from 'vitest'
import {
  METHOD_MULTIGRID,
  METHOD_ALGO_MG_RESTRICT,
  METHOD_ALGO_MG_VCYCLE,
  MG_METHOD_IDS,
  norm2,
  maxAbs,
  applyPoisson1d,
  residual1d,
  restrictFullWeighting1d,
  prolongLinear1d,
  jacobiSmooth1d,
  gaussSeidelSmooth1d,
  vcycle1d,
  runMgRestrictSample,
  runMgVcycleSample,
} from './multigrid-algos'

describe('几何多重网格 · 1D Poisson FD', () => {
  it('方法 id 常量（全未入库新 id — 勿 methodById）', () => {
    expect(METHOD_MULTIGRID).toBe('method-multigrid')
    expect(METHOD_ALGO_MG_RESTRICT).toBe('method-algo-mg-restrict')
    expect(METHOD_ALGO_MG_VCYCLE).toBe('method-algo-mg-vcycle')
    expect(MG_METHOD_IDS).toContain(METHOD_ALGO_MG_RESTRICT)
    expect(MG_METHOD_IDS).toContain(METHOD_ALGO_MG_VCYCLE)
    // 父族/子 id 均未入库 — 勿 methodById(METHOD_MULTIGRID) 等
  })

  describe('限制 / 延拓', () => {
    it('常数场：全权限制与线性延拓精确', () => {
      const c = 2.25
      const fine = new Float64Array(17)
      fine.fill(c)
      const coarse = restrictFullWeighting1d(fine)
      expect(coarse.length).toBe(9)
      for (let i = 0; i < coarse.length; i++) {
        expect(coarse[i]).toBeCloseTo(c, 14)
      }
      const coarseC = new Float64Array(9)
      coarseC.fill(c)
      const back = prolongLinear1d(coarseC)
      expect(back.length).toBe(17)
      for (let i = 0; i < back.length; i++) {
        expect(back[i]).toBeCloseTo(c, 14)
      }
    })

    it('线性场延拓后限制/往返误差机器精度级', () => {
      const nc = 9
      const hc = 1 / (nc - 1)
      const coarse = new Float64Array(nc)
      for (let i = 0; i < nc; i++) coarse[i] = 1 + 2 * i * hc
      const fine = prolongLinear1d(coarse)
      // 延拓应精确再生线性
      const hf = 1 / (fine.length - 1)
      for (let i = 0; i < fine.length; i++) {
        expect(fine[i]).toBeCloseTo(1 + 2 * i * hf, 12)
      }
      const r = restrictFullWeighting1d(fine)
      for (let i = 0; i < nc; i++) {
        expect(r[i]).toBeCloseTo(coarse[i]!, 12)
      }
    })

    it('高频锯齿限制后范数衰减', () => {
      const nf = 17
      const fine = new Float64Array(nf)
      for (let i = 1; i < nf - 1; i++) fine[i] = i % 2 === 0 ? 1 : -1
      const coarse = restrictFullWeighting1d(fine)
      expect(norm2(coarse)).toBeLessThan(norm2(fine) * 0.5)
    })

    it('runMgRestrictSample：ok 且 methodId/familyId 对齐', () => {
      const r = runMgRestrictSample()
      expect(r.methodId).toBe(METHOD_ALGO_MG_RESTRICT)
      expect(r.familyId).toBe(METHOD_MULTIGRID)
      expect(r.constantsExact).toBe(true)
      expect(r.constRestrictErr).toBeLessThan(1e-14)
      expect(r.constProlongErr).toBeLessThan(1e-14)
      expect(r.linearRoundtripMaxErr).toBeLessThan(1e-12)
      expect(r.highFreqAtten).toBeLessThan(0.5)
      expect(r.ok).toBe(true)
    })
  })

  describe('光滑与残差', () => {
    it('applyPoisson1d：u=x(1−x)/2 时 Au ≈ 1', () => {
      const n = 33
      const h = 1 / (n - 1)
      const u = new Float64Array(n)
      for (let i = 0; i < n; i++) {
        const x = i * h
        u[i] = (x * (1 - x)) / 2
      }
      const Au = new Float64Array(n)
      applyPoisson1d(u, Au, h)
      // 解析 −u″=1；FD 对二次精确
      for (let i = 1; i < n - 1; i++) {
        expect(Au[i]).toBeCloseTo(1, 10)
      }
    })

    it('GS 光滑若干步后残差下降', () => {
      const n = 17
      const h = 1 / (n - 1)
      const f = new Float64Array(n)
      for (let i = 0; i < n; i++) f[i] = Math.sin(Math.PI * i * h)
      f[0] = 0
      f[n - 1] = 0
      const u = new Float64Array(n)
      const r0 = norm2(residual1d(u, f, h))
      gaussSeidelSmooth1d(u, f, h, 5)
      const r1 = norm2(residual1d(u, f, h))
      expect(r1).toBeLessThan(r0)
      expect(r1).toBeGreaterThan(0)
    })

    it('Jacobi(ω=2/3) 光滑残差下降', () => {
      const n = 17
      const h = 1 / (n - 1)
      const f = new Float64Array(n)
      f.fill(1)
      f[0] = 0
      f[n - 1] = 0
      const u = new Float64Array(n)
      const r0 = norm2(residual1d(u, f, h))
      jacobiSmooth1d(u, f, h, 8, 2 / 3)
      const r1 = norm2(residual1d(u, f, h))
      expect(r1).toBeLessThan(r0)
    })
  })

  describe('V-cycle', () => {
    it('一次 V-cycle 残差显著下降', () => {
      const n = 33
      const h = 1 / (n - 1)
      const f = new Float64Array(n)
      for (let i = 0; i < n; i++) f[i] = Math.sin(Math.PI * i * h)
      f[0] = 0
      f[n - 1] = 0
      const u = new Float64Array(n)
      const r0 = norm2(residual1d(u, f, h))
      vcycle1d(u, f, h, { nu1: 2, nu2: 2 })
      const r1 = norm2(residual1d(u, f, h))
      expect(r1).toBeLessThan(r0 * 0.25)
      expect(maxAbs(u)).toBeGreaterThan(0)
    })

    it('V-cycle 优于同等次数纯细网格光滑', () => {
      const n = 33
      const h = 1 / (n - 1)
      const f = new Float64Array(n)
      for (let i = 0; i < n; i++) f[i] = Math.sin(Math.PI * i * h)
      f[0] = 0
      f[n - 1] = 0
      const nu1 = 2
      const nu2 = 2

      const uV = new Float64Array(n)
      vcycle1d(uV, f, h, { nu1, nu2 })
      const rV = norm2(residual1d(uV, f, h))

      const uS = new Float64Array(n)
      gaussSeidelSmooth1d(uS, f, h, nu1 + nu2)
      const rS = norm2(residual1d(uS, f, h))

      expect(rV).toBeLessThan(rS)
    })

    it('runMgVcycleSample：残差下降、优于纯光滑、ok', () => {
      const r = runMgVcycleSample()
      expect(r.methodId).toBe(METHOD_ALGO_MG_VCYCLE)
      expect(r.familyId).toBe(METHOD_MULTIGRID)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.residualDecreased).toBe(true)
      expect(r.betterThanSmoothOnly).toBe(true)
      expect(r.residualAfterV).toBeLessThan(r.residual0)
      expect(r.residualAfterV).toBeLessThan(r.residualAfterSmoothOnly)
      expect(r.residualRatioV).toBeLessThan(0.5)
      // 一次 V-cycle 尚未收敛到解析中点，但应同号且量级合理
      expect(r.midU).toBeGreaterThan(0)
      expect(r.analyticMid).toBeCloseTo(1 / (Math.PI * Math.PI), 12)
    })
  })
})

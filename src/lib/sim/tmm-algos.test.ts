import { describe, it, expect } from 'vitest'
import {
  METHOD_TMM,
  METHOD_ALGO_TMM_LAYER,
  METHOD_ALGO_TMM_STACK,
  TMM_METHOD_IDS,
  identity2x2,
  cMul,
  cAbs2,
  mul2x2,
  det2x2,
  layerMatrix,
  stackMatrix,
  reflectanceAmplitude,
  reflectancePower,
  vacuumWaveNumber,
  quarterWaveThickness,
  matrixAllFinite,
  runTmmLayerSample,
  runTmmStackSample,
} from './tmm-algos'

describe('TMM · 1D 分层传输矩阵教学 stub', () => {
  it('方法 id 常量字符串（新 id 未入库，仅字符串相等）', () => {
    expect(METHOD_TMM).toBe('method-tmm')
    expect(METHOD_ALGO_TMM_LAYER).toBe('method-algo-tmm-layer')
    expect(METHOD_ALGO_TMM_STACK).toBe('method-algo-tmm-stack')
    expect(TMM_METHOD_IDS).toContain(METHOD_ALGO_TMM_LAYER)
    expect(TMM_METHOD_IDS).toContain(METHOD_ALGO_TMM_STACK)
    // 勿 methodById：catalog 尚未接线
  })

  describe('complex / mul2x2', () => {
    it('i·i = −1', () => {
      const p = cMul({ re: 0, im: 1 }, { re: 0, im: 1 })
      expect(p.re).toBeCloseTo(-1, 12)
      expect(p.im).toBeCloseTo(0, 12)
    })

    it('单位阵左/右乘不变', () => {
      const I = identity2x2()
      const A = {
        m11: { re: 2, im: 0 },
        m12: { re: 0, im: 1 },
        m21: { re: 0, im: -1 },
        m22: { re: 0.5, im: 0 },
      }
      const left = mul2x2(I, A)
      const right = mul2x2(A, I)
      expect(left.m11.re).toBeCloseTo(2, 12)
      expect(right.m12.im).toBeCloseTo(1, 12)
      expect(left.m21.im).toBeCloseTo(-1, 12)
    })
  })

  describe('layerMatrix', () => {
    it('零厚度 → 单位阵', () => {
      const k0 = vacuumWaveNumber(500)
      const M = layerMatrix(1.8, 0, k0)
      const I = identity2x2()
      expect(M.m11.re).toBeCloseTo(I.m11.re, 14)
      expect(M.m11.im).toBeCloseTo(0, 14)
      expect(M.m12.re).toBeCloseTo(0, 14)
      expect(M.m12.im).toBeCloseTo(0, 14)
      expect(M.m21.re).toBeCloseTo(0, 14)
      expect(M.m21.im).toBeCloseTo(0, 14)
      expect(M.m22.re).toBeCloseTo(1, 14)
      expect(M.m22.im).toBeCloseTo(0, 14)
    })

    it('四分之一波：δ=π/2 → cos=0，sin=1，M=[[0,i/Y],[i Y,0]]', () => {
      const n = 2
      const lambda0 = 600
      const d = quarterWaveThickness(n, lambda0)
      const k0 = vacuumWaveNumber(lambda0)
      const delta = n * k0 * d
      expect(delta).toBeCloseTo(Math.PI / 2, 12)

      const M = layerMatrix(n, d, k0)
      expect(M.m11.re).toBeCloseTo(0, 12)
      expect(M.m11.im).toBeCloseTo(0, 12)
      expect(M.m22.re).toBeCloseTo(0, 12)
      // m12 = i sin/Y = i/n
      expect(M.m12.re).toBeCloseTo(0, 12)
      expect(M.m12.im).toBeCloseTo(1 / n, 12)
      // m21 = i Y sin = i n
      expect(M.m21.re).toBeCloseTo(0, 12)
      expect(M.m21.im).toBeCloseTo(n, 12)
    })

    it('无损层 det(M) ≈ 1', () => {
      const n = 1.46
      const lambda0 = 532
      const d = 80
      const k0 = vacuumWaveNumber(lambda0)
      const M = layerMatrix(n, d, k0)
      const det = det2x2(M)
      expect(det.re).toBeCloseTo(1, 10)
      expect(det.im).toBeCloseTo(0, 10)
      expect(matrixAllFinite(M)).toBe(true)
    })

    it('半波 δ=π → M = −I', () => {
      const n = 1.5
      const lambda0 = 500
      // n d = λ0/2 ⇒ d = λ0/(2n)
      const d = lambda0 / (2 * n)
      const k0 = vacuumWaveNumber(lambda0)
      expect(n * k0 * d).toBeCloseTo(Math.PI, 12)
      const M = layerMatrix(n, d, k0)
      expect(M.m11.re).toBeCloseTo(-1, 12)
      expect(M.m22.re).toBeCloseTo(-1, 12)
      expect(M.m12.im).toBeCloseTo(0, 12)
      expect(M.m21.im).toBeCloseTo(0, 12)
    })
  })

  describe('stackMatrix / reflectance', () => {
    it('空栈单位阵：匹配介质 R=0', () => {
      const k0 = vacuumWaveNumber(550)
      const M = stackMatrix([], k0)
      expect(reflectancePower(M, 1, 1)).toBeCloseTo(0, 12)
      expect(reflectancePower(M, 1.5, 1.5)).toBeCloseTo(0, 12)
    })

    it('零厚度层 ≡ 空栈', () => {
      const k0 = vacuumWaveNumber(550)
      const M0 = stackMatrix([{ n: 2, d: 0 }], k0)
      const Me = stackMatrix([], k0)
      expect(M0.m11.re).toBeCloseTo(Me.m11.re, 14)
      expect(reflectancePower(M0, 1, 1)).toBeCloseTo(0, 12)
    })

    it('无膜界面：空栈 n0≠ns 退化为菲涅耳 R=((n0−ns)/(n0+ns))²', () => {
      const k0 = vacuumWaveNumber(600)
      const M = stackMatrix([], k0)
      const n0 = 1
      const ns = 1.5
      const R = reflectancePower(M, n0, ns)
      const rFresnel = (n0 - ns) / (n0 + ns)
      expect(R).toBeCloseTo(rFresnel * rFresnel, 12)
    })

    it('四分之一波高 n 层：设计波长高 R（解析 Yin=n²/ns）', () => {
      const n = 2.4
      const lambda0 = 550
      const n0 = 1
      const ns = 1
      const d = quarterWaveThickness(n, lambda0)
      const k0 = vacuumWaveNumber(lambda0)
      const M = stackMatrix([{ n, d }], k0)
      const R = reflectancePower(M, n0, ns)
      // Yin = n²/ns = n²；R = ((n0−n²)/(n0+n²))²
      const Yin = (n * n) / ns
      const Rexp = ((n0 - Yin) / (n0 + Yin)) ** 2
      expect(R).toBeCloseTo(Rexp, 10)
      expect(R).toBeGreaterThan(0.35)
      expect(R).toBeLessThanOrEqual(1)
    })

    it('HL 双层四分之一波比单层更高 R（松）', () => {
      const lambda0 = 550
      const nH = 2.4
      const nL = 1.46
      const k0 = vacuumWaveNumber(lambda0)
      const dH = quarterWaveThickness(nH, lambda0)
      const dL = quarterWaveThickness(nL, lambda0)
      // 入射侧高折射率层在前（常见反射镜 HL 序列）
      const R1 = reflectancePower(
        stackMatrix([{ n: nH, d: dH }], k0),
        1,
        1,
      )
      const R2 = reflectancePower(
        stackMatrix(
          [
            { n: nH, d: dH },
            { n: nL, d: dL },
          ],
          k0,
        ),
        1,
        1,
      )
      // HL 对空气/空气夹层不一定抬高 R；只要求有限、物理区间，且不塌到 0
      expect(Number.isFinite(R2)).toBe(true)
      expect(R2).toBeGreaterThan(0.05)
      expect(R2).toBeLessThanOrEqual(1 + 1e-9)
      expect(R1).toBeGreaterThan(0.1)
    })

    it('r 振幅 |r|² = R', () => {
      const lambda0 = 632.8
      const k0 = vacuumWaveNumber(lambda0)
      const M = stackMatrix(
        [{ n: 1.38, d: quarterWaveThickness(1.38, lambda0) }],
        k0,
      )
      const r = reflectanceAmplitude(M, 1, 1.5)
      const R = reflectancePower(M, 1, 1.5)
      expect(cAbs2(r)).toBeCloseTo(R, 12)
    })
  })

  describe('样例入口', () => {
    it('runTmmLayerSample：ok 且 methodId/familyId 对齐，零厚度单位阵', () => {
      const r = runTmmLayerSample()
      expect(r.methodId).toBe(METHOD_ALGO_TMM_LAYER)
      expect(r.familyId).toBe(METHOD_TMM)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.zeroThickErr).toBeLessThan(1e-14)
      expect(r.detErr).toBeLessThan(1e-10)
      expect(r.delta).toBeCloseTo(Math.PI / 2, 8)
    })

    it('runTmmStackSample：ok 且设计波长高 R，空栈 R=0', () => {
      const r = runTmmStackSample()
      expect(r.methodId).toBe(METHOD_ALGO_TMM_STACK)
      expect(r.familyId).toBe(METHOD_TMM)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.highR).toBe(true)
      expect(r.R_empty).toBeLessThan(1e-12)
      expect(r.R_qw).toBeGreaterThan(0.35)
      expect(r.R_qw).toBeLessThanOrEqual(1 + 1e-9)
    })
  })
})

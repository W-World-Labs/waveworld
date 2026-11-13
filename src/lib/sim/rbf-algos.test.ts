import { describe, it, expect } from 'vitest'
import {
  METHOD_RBF,
  METHOD_ALGO_RBF_GAUSS,
  METHOD_ALGO_RBF_INTERP,
  RBF_METHOD_IDS,
  RBF_MAX_N,
  gaussianRbf,
  multiquadricRbf,
  rbfPhi,
  rbfCollocationMatrix,
  solveDenseGauss,
  rbfFit,
  rbfEval,
  rbfEvalMany,
  runRbfGaussSample,
  runRbfInterpSample,
} from './rbf-algos'

describe('RBF · 高斯核 + 配置点插值', () => {
  it('方法 id 常量字符串（新 id 未入库，仅字符串相等）', () => {
    expect(METHOD_RBF).toBe('method-rbf')
    expect(METHOD_ALGO_RBF_GAUSS).toBe('method-algo-rbf-gauss')
    expect(METHOD_ALGO_RBF_INTERP).toBe('method-algo-rbf-interp')
    expect(RBF_METHOD_IDS).toContain(METHOD_ALGO_RBF_GAUSS)
    expect(RBF_METHOD_IDS).toContain(METHOD_ALGO_RBF_INTERP)
    // 勿 methodById：catalog 尚未接线
  })

  describe('gaussianRbf / multiquadricRbf', () => {
    it('φ(0)=1，随 r 衰减，偶函数', () => {
      const eps = 1.2
      expect(gaussianRbf(0, eps)).toBeCloseTo(1, 14)
      expect(gaussianRbf(0.5, eps)).toBeLessThan(1)
      expect(gaussianRbf(0.5, eps)).toBeCloseTo(gaussianRbf(-0.5, eps), 14)
      expect(gaussianRbf(2, eps)).toBeLessThan(gaussianRbf(0.5, eps))
      // 解析：exp(−(ε r)²)
      const r = 0.3
      expect(gaussianRbf(r, eps)).toBeCloseTo(
        Math.exp(-(eps * r) * (eps * r)),
        14,
      )
    })

    it('ε≤0 或非有限 → 0', () => {
      expect(gaussianRbf(1, 0)).toBe(0)
      expect(gaussianRbf(1, -1)).toBe(0)
      expect(gaussianRbf(NaN, 1)).toBe(0)
      expect(multiquadricRbf(1, 0)).toBe(0)
    })

    it('multiquadric：φ(0)=c，单调增', () => {
      const c = 0.8
      expect(multiquadricRbf(0, c)).toBeCloseTo(c, 14)
      expect(multiquadricRbf(1, c)).toBeCloseTo(Math.sqrt(1 + c * c), 14)
      expect(multiquadricRbf(2, c)).toBeGreaterThan(multiquadricRbf(1, c))
    })

    it('rbfPhi 分发 kind', () => {
      expect(rbfPhi(0.4, 1.1, 'gaussian')).toBeCloseTo(gaussianRbf(0.4, 1.1), 14)
      expect(rbfPhi(0.4, 1.1, 'multiquadric')).toBeCloseTo(
        multiquadricRbf(0.4, 1.1),
        14,
      )
    })
  })

  describe('solveDenseGauss / collocation', () => {
    it('2×2 单位系精确解', () => {
      const A = new Float64Array([2, 1, 1, 2])
      const b = new Float64Array([4, 5])
      const x = solveDenseGauss(A, b, 2)
      expect(x[0]).toBeCloseTo(1, 12)
      expect(x[1]).toBeCloseTo(2, 12)
    })

    it('Φ 对角 φ(0)=1，非对角 <1（不同中心）', () => {
      const centers = [0, 0.5, 1]
      const Phi = rbfCollocationMatrix(centers, 2, 'gaussian')
      const n = 3
      for (let i = 0; i < n; i++) {
        expect(Phi[i * n + i]).toBeCloseTo(1, 14)
        for (let j = 0; j < n; j++) {
          if (i !== j) expect(Phi[i * n + j]!).toBeLessThan(1)
        }
      }
      // 对称
      expect(Phi[0 * n + 1]).toBeCloseTo(Phi[1 * n + 0]!, 14)
    })

    it('n 超界拒绝', () => {
      const tooMany = Array.from({ length: RBF_MAX_N + 1 }, (_, i) => i)
      expect(() => rbfCollocationMatrix(tooMany, 1)).toThrow()
    })
  })

  describe('rbfFit / rbfEval 插值性质', () => {
    it('在配置点精确再现 f（高斯）', () => {
      const centers = [0, 0.25, 0.5, 0.75, 1]
      const values = centers.map((x) => Math.sin(Math.PI * x) + 0.2 * x)
      const eps = 2.5
      const lambda = rbfFit(centers, values, eps, 'gaussian')
      for (let i = 0; i < centers.length; i++) {
        const s = rbfEval(centers[i]!, centers, lambda, eps, 'gaussian')
        expect(s).toBeCloseTo(values[i]!, 10)
      }
    })

    it('多二次核同样满足插值性质', () => {
      const centers = [0, 0.5, 1]
      const values = [1, -0.5, 2]
      const c = 1
      const lambda = rbfFit(centers, values, c, 'multiquadric')
      const recon = rbfEvalMany(centers, centers, lambda, c, 'multiquadric')
      for (let i = 0; i < 3; i++) {
        expect(recon[i]).toBeCloseTo(values[i]!, 10)
      }
    })

    it('常数场：各中心值为 c 时 s(centers)=c', () => {
      const centers = [0, 1, 2, 3]
      const c = 3.5
      const values = centers.map(() => c)
      const lambda = rbfFit(centers, values, 1.2)
      for (const x of centers) {
        expect(rbfEval(x, centers, lambda, 1.2)).toBeCloseTo(c, 10)
      }
    })
  })

  it('runRbfGaussSample：ok 且 methodId/familyId 对齐', () => {
    const r = runRbfGaussSample({ epsilon: 1.5, r: 0.7 })
    expect(r.methodId).toBe(METHOD_ALGO_RBF_GAUSS)
    expect(r.familyId).toBe(METHOD_RBF)
    expect(r.ok).toBe(true)
    expect(r.phi0).toBeCloseTo(1, 14)
    expect(r.errAt0).toBeLessThan(1e-14)
    expect(r.symmetryErr).toBeLessThan(1e-14)
    expect(r.decays).toBe(true)
    expect(r.mqAt0).toBeCloseTo(r.epsilon, 14)
  })

  it('runRbfInterpSample：ok 且中心插值误差极小', () => {
    const r = runRbfInterpSample({ n: 5, epsilon: 2 })
    expect(r.methodId).toBe(METHOD_ALGO_RBF_INTERP)
    expect(r.familyId).toBe(METHOD_RBF)
    expect(r.ok).toBe(true)
    expect(r.maxInterpErr).toBeLessThan(1e-10)
    expect(r.n).toBe(5)
    expect(r.lambda).toHaveLength(5)
    expect(Number.isFinite(r.midProbeErr)).toBe(true)
  })

  it('runRbfInterpSample multiquadric 路径 ok', () => {
    const r = runRbfInterpSample({ n: 4, kind: 'multiquadric', epsilon: 0.5 })
    expect(r.ok).toBe(true)
    expect(r.kind).toBe('multiquadric')
    expect(r.maxInterpErr).toBeLessThan(1e-10)
  })
})

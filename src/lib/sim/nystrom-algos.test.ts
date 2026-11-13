import { describe, it, expect } from 'vitest'
import {
  METHOD_NYSTROM,
  METHOD_ALGO_NYSTROM_QUAD,
  NYSTROM_METHOD_IDS,
  NYSTROM_MAX_N,
  kernelExpAbs,
  nystromNodes,
  nystromWeights,
  assembleNystromMatrix,
  solveDenseGauss,
  residualInf,
  residualRms,
  samplePhiSinPi,
  applyNystrom,
  runNystromQuadSample,
} from './nystrom-algos'

describe('Nyström · Fredholm 2nd kind + trapezoid/midpoint', () => {
  it('方法 id 常量字符串（新 id 未入库，仅字符串相等）', () => {
    expect(METHOD_NYSTROM).toBe('method-nystrom')
    expect(METHOD_ALGO_NYSTROM_QUAD).toBe('method-algo-nystrom-quad')
    expect(NYSTROM_METHOD_IDS).toContain(METHOD_ALGO_NYSTROM_QUAD)
  })

  describe('kernel / nodes / weights', () => {
    it('K=exp(−|x−y|) 连续对称、对角=1', () => {
      expect(kernelExpAbs(0.3, 0.3)).toBeCloseTo(1, 14)
      expect(kernelExpAbs(0.2, 0.7)).toBeCloseTo(kernelExpAbs(0.7, 0.2), 14)
      expect(kernelExpAbs(0, 1)).toBeCloseTo(Math.exp(-1), 14)
      expect(kernelExpAbs(0.1, 0.4)).toBeLessThan(1)
    })

    it('midpoint 节点在 (0,1)，权和≈1', () => {
      const n = 8
      const x = nystromNodes(n, 'midpoint')
      const w = nystromWeights(n, 'midpoint')
      expect(x[0]).toBeCloseTo(0.5 / n, 14)
      expect(x[n - 1]).toBeCloseTo((n - 0.5) / n, 14)
      let sw = 0
      for (let j = 0; j < n; j++) {
        expect(x[j]!).toBeGreaterThan(0)
        expect(x[j]!).toBeLessThan(1)
        expect(w[j]).toBeCloseTo(1 / n, 14)
        sw += w[j]!
      }
      expect(sw).toBeCloseTo(1, 14)
    })

    it('trapezoid 含端点，权端点半、权和=1', () => {
      const n = 5
      const x = nystromNodes(n, 'trapezoid')
      const w = nystromWeights(n, 'trapezoid')
      expect(x[0]).toBeCloseTo(0, 14)
      expect(x[n - 1]).toBeCloseTo(1, 14)
      const h = 1 / (n - 1)
      expect(w[0]).toBeCloseTo(h / 2, 14)
      expect(w[n - 1]).toBeCloseTo(h / 2, 14)
      expect(w[1]).toBeCloseTo(h, 14)
      let sw = 0
      for (let j = 0; j < n; j++) sw += w[j]!
      expect(sw).toBeCloseTo(1, 14)
    })

    it('n 超界 / 非法拒绝', () => {
      expect(() => nystromNodes(1)).toThrow()
      expect(() => nystromNodes(NYSTROM_MAX_N + 1)).toThrow()
      expect(() => nystromWeights(0)).toThrow()
    })
  })

  describe('assemble / solve', () => {
    it('A_ii = 1 − λ w_i K(x_i,x_i)，非对角 −λ w_j K', () => {
      const n = 4
      const lambda = 0.3
      const { A, x, w } = assembleNystromMatrix(n, lambda, { rule: 'midpoint' })
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const expectA =
            (i === j ? 1 : 0) - lambda * w[j]! * kernelExpAbs(x[i]!, x[j]!)
          expect(A[i * n + j]).toBeCloseTo(expectA, 12)
        }
      }
    })

    it('2×2 稠密 GE 精确解', () => {
      const A = new Float64Array([2, 1, 1, 2])
      const b = new Float64Array([4, 5])
      const z = solveDenseGauss(A, b, 2)
      expect(z[0]).toBeCloseTo(1, 12)
      expect(z[1]).toBeCloseTo(2, 12)
    })

    it('自洽制造解：残差与密度误差极小', () => {
      const n = 10
      const lambda = 0.5
      const { A, x } = assembleNystromMatrix(n, lambda, { rule: 'trapezoid' })
      const phiStar = samplePhiSinPi(x)
      const f = applyNystrom(A, phiStar, n)
      const phi = solveDenseGauss(A, f, n)
      expect(residualInf(A, phi, f, n)).toBeLessThan(1e-10)
      expect(residualRms(A, phi, f, n)).toBeLessThan(1e-10)
      for (let i = 0; i < n; i++) {
        expect(phi[i]).toBeCloseTo(phiStar[i]!, 8)
      }
    })
  })

  it('runNystromQuadSample：ok 且 methodId/familyId 对齐（midpoint）', () => {
    const r = runNystromQuadSample({ n: 12, rule: 'midpoint' })
    expect(r.methodId).toBe(METHOD_ALGO_NYSTROM_QUAD)
    expect(r.familyId).toBe(METHOD_NYSTROM)
    expect(r.ok).toBe(true)
    expect(r.n).toBe(12)
    expect(r.residualInf).toBeLessThan(1e-10)
    expect(r.residualRms).toBeLessThan(1e-10)
    expect(r.densityErr).toBeLessThan(1e-10)
    expect(r.maxAbsPhi).toBeGreaterThan(0.5)
    expect(r.diagShiftMax).toBeGreaterThan(0)
    expect(r.diagShiftMax).toBeLessThan(1)
  })

  it('runNystromQuadSample：trapezoid 亦 ok；n≤16', () => {
    const r = runNystromQuadSample({ n: 16, rule: 'trapezoid', lambda: 0.25 })
    expect(r.ok).toBe(true)
    expect(r.n).toBe(16)
    expect(r.rule).toBe('trapezoid')
    expect(r.residualInf).toBeLessThan(1e-9)
  })
})

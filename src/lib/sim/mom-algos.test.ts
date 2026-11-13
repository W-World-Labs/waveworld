import { describe, it, expect } from 'vitest'
import {
  METHOD_MOM,
  METHOD_ALGO_MOM_IMPEDANCE,
  METHOD_ALGO_MOM_SOLVE,
  MOM_METHOD_IDS,
  MOM_MAX_N,
  MOM_DEFAULT_LENGTH,
  momSegmentCenters,
  momImpedanceKernel,
  momSelfTerm,
  momImpedanceMatrix,
  solveDenseGauss,
  momConstantVoltage,
  momSolveCurrent,
  momCurrentSum,
  momInputImpedance,
  momResidualInf,
  runMomImpedanceSample,
  runMomSolveSample,
} from './mom-algos'

describe('MoM · 1D pulse impedance + ZI=V', () => {
  it('方法 id 常量字符串（新 id 未入库，仅字符串相等）', () => {
    expect(METHOD_MOM).toBe('method-mom')
    expect(METHOD_ALGO_MOM_IMPEDANCE).toBe('method-algo-mom-impedance')
    expect(METHOD_ALGO_MOM_SOLVE).toBe('method-algo-mom-solve')
    expect(MOM_METHOD_IDS).toContain(METHOD_ALGO_MOM_IMPEDANCE)
    expect(MOM_METHOD_IDS).toContain(METHOD_ALGO_MOM_SOLVE)
  })

  describe('momSegmentCenters / kernel / self', () => {
    it('均匀中心：x_m=(m+0.5)h', () => {
      const n = 4
      const L = 2
      const x = momSegmentCenters(n, L)
      const h = L / n
      expect(x).toHaveLength(n)
      for (let m = 0; m < n; m++) {
        expect(x[m]).toBeCloseTo((m + 0.5) * h, 14)
      }
    })

    it('n 超界 / 非法 length 拒绝', () => {
      expect(() => momSegmentCenters(0)).toThrow()
      expect(() => momSegmentCenters(MOM_MAX_N + 1)).toThrow()
      expect(() => momSegmentCenters(2, 0)).toThrow()
      expect(() => momSegmentCenters(2, -1)).toThrow()
    })

    it('核：对角 self，非对角 1/|dx|', () => {
      expect(momImpedanceKernel(0, 3.5)).toBe(3.5)
      expect(momImpedanceKernel(0.5, 9)).toBeCloseTo(2, 14)
      expect(momImpedanceKernel(2, 1)).toBeCloseTo(0.5, 14)
    })

    it('selfTerm = 2 selfScale / h', () => {
      expect(momSelfTerm(0.25, 1)).toBeCloseTo(8, 14)
      expect(momSelfTerm(1, 2)).toBeCloseTo(4, 14)
      expect(momSelfTerm(0.25)).toBeCloseTo(16, 14) // default selfScale=2
    })
  })

  describe('momImpedanceMatrix', () => {
    it('对称、对角 self、最近邻 1/h', () => {
      const n = 3
      const L = 1
      const h = L / n
      const centers = momSegmentCenters(n, L)
      const self = momSelfTerm(h)
      const Z = momImpedanceMatrix(centers, self)
      for (let m = 0; m < n; m++) {
        expect(Z[m * n + m]).toBeCloseTo(self, 14)
        for (let j = 0; j < n; j++) {
          expect(Z[m * n + j]).toBeCloseTo(Z[j * n + m]!, 14)
          if (m !== j) {
            const dx = Math.abs(centers[m]! - centers[j]!)
            expect(Z[m * n + j]).toBeCloseTo(1 / dx, 14)
          }
        }
      }
      expect(Z[0 * n + 1]).toBeCloseTo(1 / h, 14)
    })

    it('无 selfTerm 时由中心距推断', () => {
      const centers = [0.125, 0.375, 0.625, 0.875]
      const Z = momImpedanceMatrix(centers)
      const h = 0.25
      expect(Z[0]).toBeCloseTo(momSelfTerm(h), 14)
    })

    it('n 超界拒绝', () => {
      const tooMany = Array.from({ length: MOM_MAX_N + 1 }, (_, i) => i)
      expect(() => momImpedanceMatrix(tooMany)).toThrow()
    })
  })

  describe('solveDenseGauss / momSolveCurrent', () => {
    it('2×2 单位系精确解', () => {
      const A = new Float64Array([2, 1, 1, 2])
      const b = new Float64Array([4, 5])
      const x = solveDenseGauss(A, b, 2)
      expect(x[0]).toBeCloseTo(1, 12)
      expect(x[1]).toBeCloseTo(2, 12)
    })

    it('Z I = V 残差极小（恒压）', () => {
      const n = 4
      const centers = momSegmentCenters(n, MOM_DEFAULT_LENGTH)
      const Z = momImpedanceMatrix(centers)
      const V0 = 2
      const V = momConstantVoltage(n, V0)
      const I = momSolveCurrent(Z, V, n)
      expect(momResidualInf(Z, I, V, n)).toBeLessThan(1e-10)
      for (let i = 0; i < n; i++) {
        expect(Number.isFinite(I[i]!)).toBe(true)
      }
    })

    it('恒压向量全为 V0', () => {
      const V = momConstantVoltage(3, -0.5)
      expect(Array.from(V)).toEqual([-0.5, -0.5, -0.5])
    })
  })

  describe('current sum / Zin toy', () => {
    it('momCurrentSum 与 momInputImpedance', () => {
      expect(momCurrentSum([1, 2, 3])).toBeCloseTo(6, 14)
      expect(momInputImpedance(1, 0.5)).toBeCloseTo(2, 14)
      expect(momInputImpedance(1, 0)).toBe(Infinity)
    })
  })

  it('runMomImpedanceSample：ok 且 methodId/familyId 对齐', () => {
    const r = runMomImpedanceSample({ n: 4 })
    expect(r.methodId).toBe(METHOD_ALGO_MOM_IMPEDANCE)
    expect(r.familyId).toBe(METHOD_MOM)
    expect(r.ok).toBe(true)
    expect(r.symmetryErr).toBeLessThan(1e-14)
    expect(r.diagonallyDominant).toBe(true)
    expect(r.nearestOff).toBeCloseTo(1 / r.h, 12)
    expect(r.centers).toHaveLength(4)
  })

  it('runMomSolveSample：ok、残差小、Zin 有限', () => {
    const r = runMomSolveSample({ n: 5, V0: 1 })
    expect(r.methodId).toBe(METHOD_ALGO_MOM_SOLVE)
    expect(r.familyId).toBe(METHOD_MOM)
    expect(r.ok).toBe(true)
    expect(r.residualInf).toBeLessThan(1e-10)
    expect(r.current).toHaveLength(5)
    expect(Number.isFinite(r.currentSum)).toBe(true)
    expect(Number.isFinite(r.Zin)).toBe(true)
    expect(Math.abs(r.Iin)).toBeGreaterThan(0)
    // Zin = V0 / Iin
    expect(r.Zin).toBeCloseTo(r.V0 / r.Iin, 10)
  })

  it('runMomSolveSample n=1 路径 ok', () => {
    const r = runMomSolveSample({ n: 1, V0: 3 })
    expect(r.ok).toBe(true)
    expect(r.currentSum).toBeCloseTo(r.Iin, 14)
    // Z_11 I = V0 ⇒ I = V0 / self
    const self = momSelfTerm(MOM_DEFAULT_LENGTH)
    expect(r.Iin).toBeCloseTo(3 / self, 12)
  })
})

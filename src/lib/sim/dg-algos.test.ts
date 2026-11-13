import { describe, it, expect } from 'vitest'
import {
  METHOD_DG,
  METHOD_ALGO_DG_MASS_LOCAL,
  METHOD_ALGO_DG_UPWIND_FLUX,
  DG_METHOD_IDS,
  localMassMatrixP1Ref,
  localMassMatrixP1,
  localMassMatrixModalP1,
  quadraticForm2,
  isSpd2x2,
  dgUpwindFlux,
  dgWeakResidualP0,
  dgElementStepP0,
  dgVolumeStiffnessP1,
  dgWeakResidualP1,
  runDgMassLocalSample,
  runDgUpwindFluxSample,
} from './dg-algos'

describe('DG 1D · 局部质量 + 迎风通量教学桩', () => {
  it('方法 id 常量（全未入库新 id — 勿 methodById）', () => {
    expect(METHOD_DG).toBe('method-dg')
    expect(METHOD_ALGO_DG_MASS_LOCAL).toBe('method-algo-dg-mass-local')
    expect(METHOD_ALGO_DG_UPWIND_FLUX).toBe('method-algo-dg-upwind-flux')
    expect(DG_METHOD_IDS).toContain(METHOD_ALGO_DG_MASS_LOCAL)
    expect(DG_METHOD_IDS).toContain(METHOD_ALGO_DG_UPWIND_FLUX)
    // 父族/子 id 均未入库 — 勿 methodById(METHOD_DG) 等
  })

  describe('局部质量矩阵', () => {
    it('参考元 P1：M_ref = [[2/3,1/3],[1/3,2/3]]', () => {
      const M = localMassMatrixP1Ref()
      expect(M[0]).toBeCloseTo(2 / 3, 12)
      expect(M[1]).toBeCloseTo(1 / 3, 12)
      expect(M[2]).toBeCloseTo(1 / 3, 12)
      expect(M[3]).toBeCloseTo(2 / 3, 12)
    })

    it('物理元：对角 h/3、非对角 h/6；对角正且 SPD', () => {
      const h = 0.4
      const M = localMassMatrixP1(h)
      expect(M[0]).toBeCloseTo(h / 3, 12)
      expect(M[1]).toBeCloseTo(h / 6, 12)
      expect(M[2]).toBeCloseTo(h / 6, 12)
      expect(M[3]).toBeCloseTo(h / 3, 12)
      expect(M[0]).toBeGreaterThan(0)
      expect(M[3]).toBeGreaterThan(0)
      expect(isSpd2x2(M)).toBe(true)
      expect(quadraticForm2(M, 1, 0)).toBeGreaterThan(0)
      expect(quadraticForm2(M, 0, 1)).toBeGreaterThan(0)
      expect(quadraticForm2(M, 1, -1)).toBeGreaterThan(0)
    })

    it('模态 P1：对角 (h, h/3)，非对角 0，SPD', () => {
      const h = 0.5
      const M = localMassMatrixModalP1(h)
      expect(M[0]).toBeCloseTo(h, 12)
      expect(M[3]).toBeCloseTo(h / 3, 12)
      expect(M[1]).toBeCloseTo(0, 12)
      expect(M[2]).toBeCloseTo(0, 12)
      expect(isSpd2x2(M)).toBe(true)
    })

    it('h 非法抛错', () => {
      expect(() => localMassMatrixP1(0)).toThrow()
      expect(() => localMassMatrixP1(-1)).toThrow()
      expect(() => localMassMatrixModalP1(0)).toThrow()
    })
  })

  describe('迎风数值通量', () => {
    it('a>0 取左态，a<0 取右态，a=0 为零', () => {
      expect(dgUpwindFlux(2, 5, 1)).toBe(2)
      expect(dgUpwindFlux(2, 5, -3)).toBe(-15)
      expect(dgUpwindFlux(2, 5, 0)).toBe(0)
      expect(dgUpwindFlux(4, 1, 2.5)).toBeCloseTo(2.5 * 4, 12)
      expect(dgUpwindFlux(4, 1, -0.5)).toBeCloseTo(-0.5 * 1, 12)
    })

    it('P0 弱残差：均匀场 R=0；a>0 时 R=a(u−uLeft)', () => {
      expect(dgWeakResidualP0(3, 3, 3, 1.2)).toBeCloseTo(0, 12)
      expect(dgWeakResidualP0(1, 3, 0, 2)).toBeCloseTo(2 * (3 - 1), 12)
      // a<0：FL=a·u, FR=a·uRight → R = a(uRight − u)
      expect(dgWeakResidualP0(1, 3, 0, -2)).toBeCloseTo(-2 * (0 - 3), 12)
    })

    it('P0 单元一步：均匀场不变', () => {
      const u = dgElementStepP0(2, 2, 2, 1, 0.25, 0.05)
      expect(u).toBeCloseTo(2, 12)
    })

    it('P1 体积刚度行和与通量耦合有限', () => {
      const S = dgVolumeStiffnessP1(1)
      // 行和：第一行 a，第二行 −a（常数场体积贡献抵消梯度）
      expect(S[0]! + S[1]!).toBeCloseTo(1, 12)
      expect(S[2]! + S[3]!).toBeCloseTo(-1, 12)
      const [R0, R1] = dgWeakResidualP1(1, 1, 1, 1, 1)
      // 均匀场：体积 + 迎风面通量相互抵消 → 残差 0
      expect(R0).toBeCloseTo(0, 12)
      expect(R1).toBeCloseTo(0, 12)
    })
  })

  describe('样例入口', () => {
    it('runDgMassLocalSample：SPD、对角正、ok', () => {
      const r = runDgMassLocalSample(0.25)
      expect(r.methodId).toBe(METHOD_ALGO_DG_MASS_LOCAL)
      expect(r.familyId).toBe(METHOD_DG)
      expect(r.diagPositive).toBe(true)
      expect(r.spdNodal).toBe(true)
      expect(r.spdModal).toBe(true)
      expect(r.nodalDiagOk).toBe(true)
      expect(r.nodalOffOk).toBe(true)
      expect(r.modalDiagOk).toBe(true)
      expect(r.quadPositive).toBe(true)
      expect(r.ok).toBe(true)
    })

    it('runDgUpwindFluxSample：选侧正确、ok', () => {
      const r = runDgUpwindFluxSample()
      expect(r.methodId).toBe(METHOD_ALGO_DG_UPWIND_FLUX)
      expect(r.familyId).toBe(METHOD_DG)
      expect(r.choosesLeft).toBe(true)
      expect(r.choosesRight).toBe(true)
      expect(r.fluxPos).toBeCloseTo(r.aPos * r.uL, 12)
      expect(r.fluxNeg).toBeCloseTo(r.aNeg * r.uR, 12)
      expect(r.finite).toBe(true)
      expect(r.ok).toBe(true)
    })
  })
})

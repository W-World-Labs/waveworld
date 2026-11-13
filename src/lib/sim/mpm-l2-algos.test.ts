import { describe, it, expect } from 'vitest'
import {
  METHOD_MPM,
  METHOD_ALGO_MPM_USL_STRESS,
  MPM_L2_METHOD_IDS,
  hatWeightGrad,
  particleVelocityGradient1d,
  uslUpdateStress1d,
  uslUpdateParticles1d,
  p2gInternalForce1d,
  runMpmUslStressSample,
  type MpmUslParticle1d,
} from './mpm-l2-algos'

describe('MPM L2 · USL 应力/变形更新', () => {
  it('方法 id 常量字符串（新 id 未入库，仅字符串相等）', () => {
    expect(METHOD_MPM).toBe('method-mpm')
    expect(METHOD_ALGO_MPM_USL_STRESS).toBe('method-algo-mpm-usl-stress')
    expect(MPM_L2_METHOD_IDS).toContain(METHOD_ALGO_MPM_USL_STRESS)
    // 勿 methodById：catalog 尚未接线
  })

  describe('hatWeightGrad / velocity gradient', () => {
    it('单元内左右节点梯度为 ±1/h', () => {
      const h = 1
      const x0 = 0
      const x_p = 3.3
      expect(hatWeightGrad(x_p, 3, h, x0)).toBeCloseTo(-1 / h, 12)
      expect(hatWeightGrad(x_p, 4, h, x0)).toBeCloseTo(1 / h, 12)
      expect(hatWeightGrad(x_p, 0, h, x0)).toBe(0)
    })

    it('线性速度场：L = ε̇ 精确', () => {
      const nNodes = 16
      const h = 0.5
      const x0 = 0
      const rate = 1.2
      const nodeV = new Float64Array(nNodes)
      for (let i = 0; i < nNodes; i++) nodeV[i] = rate * (x0 + i * h)
      for (const x of [1.1, 3.25, 5.0]) {
        expect(particleVelocityGradient1d(x, nodeV, h, x0)).toBeCloseTo(rate, 12)
      }
    })

    it('常速度场：L = 0', () => {
      const nNodes = 10
      const h = 1
      const nodeV = new Float64Array(nNodes)
      nodeV.fill(3.5)
      expect(particleVelocityGradient1d(2.3, nodeV, h, 0)).toBeCloseTo(0, 12)
      expect(particleVelocityGradient1d(5.8, nodeV, h, 0)).toBeCloseTo(0, 12)
    })
  })

  describe('uslUpdateStress1d', () => {
    it('F0=1, L 常：F=1+dt L，σ=E(F−1)', () => {
      const p: MpmUslParticle1d = { m: 1, x: 0, v: 0, F: 1, sigma: 0 }
      const dt = 0.02
      const L = 0.5
      const E = 200
      const r = uslUpdateStress1d(p, L, dt, E)
      expect(r.F).toBeCloseTo(1 + dt * L, 12)
      expect(r.strain).toBeCloseTo(dt * L, 12)
      expect(r.sigma).toBeCloseTo(E * dt * L, 12)
      expect(r.J).toBeCloseTo(r.F, 12)
    })

    it('复合更新：F ← (1+dt L) F_old', () => {
      const p: MpmUslParticle1d = { m: 1, x: 0, v: 0, F: 1.1, sigma: 0 }
      const r = uslUpdateStress1d(p, 0.2, 0.1, 50)
      expect(r.F).toBeCloseTo(1.1 * (1 + 0.02), 12)
      expect(r.sigma).toBeCloseTo(50 * (r.F - 1), 12)
    })

    it('rho0 给出时 ρ = ρ0/|F|', () => {
      const p: MpmUslParticle1d = { m: 1, x: 0, v: 0, F: 1, sigma: 0 }
      const r = uslUpdateStress1d(p, 1, 0.1, 1, { rho0: 2 })
      expect(r.rho).toBeCloseTo(2 / r.F, 12)
    })
  })

  describe('uslUpdateParticles1d / p2gInternalForce1d', () => {
    it('批量拉伸与单粒子一致', () => {
      const h = 1
      const nNodes = 12
      const E = 100
      const dt = 0.01
      const rate = 0.4
      const nodeV = new Float64Array(nNodes)
      for (let i = 0; i < nNodes; i++) nodeV[i] = rate * i * h
      const particles: MpmUslParticle1d[] = [
        { m: 1, x: 3.2, v: 0, F: 1, sigma: 0 },
        { m: 1, x: 7.1, v: 0, F: 1, sigma: 0 },
      ]
      const out = uslUpdateParticles1d(particles, nodeV, h, dt, E)
      const Fex = 1 + rate * dt
      expect(out[0]!.F).toBeCloseTo(Fex, 12)
      expect(out[1]!.F).toBeCloseTo(Fex, 12)
      expect(out[0]!.sigma).toBeCloseTo(E * (Fex - 1), 12)
    })

    it('均匀 σ 时内力反对称/有限', () => {
      const h = 1
      const nNodes = 8
      const particles: MpmUslParticle1d[] = [
        { m: 1, x: 3.5, v: 0, F: 1, sigma: 2 },
      ]
      const f = p2gInternalForce1d(particles, nNodes, h, 0, { V0: 1 })
      let sum = 0
      let any = false
      for (let i = 0; i < nNodes; i++) {
        sum += f[i]!
        if (f[i]! !== 0) any = true
        expect(Number.isFinite(f[i]!)).toBe(true)
      }
      // 线性 hat：∂N_L + ∂N_R = 0 → 总力 0
      expect(sum).toBeCloseTo(0, 12)
      expect(any).toBe(true)
    })
  })

  describe('样例入口', () => {
    it('runMpmUslStressSample：ok 且 methodId/familyId 对齐', () => {
      const r = runMpmUslStressSample()
      expect(r.methodId).toBe(METHOD_ALGO_MPM_USL_STRESS)
      expect(r.familyId).toBe(METHOD_MPM)
      expect(r.ok).toBe(true)
      expect(r.finite).toBe(true)
      expect(r.gradErr).toBeLessThan(1e-12)
      expect(r.stretchFErr).toBeLessThan(1e-12)
      expect(r.stretchStressErr).toBeLessThan(1e-12)
      expect(r.rigidFErr).toBeLessThan(1e-12)
      expect(r.rigidStressErr).toBeLessThan(1e-12)
    })
  })
})

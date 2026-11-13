import { describe, it, expect } from 'vitest'
import {
  METHOD_MPM,
  METHOD_ALGO_MPM_PIC_TRANSFER,
  METHOD_ALGO_MPM_G2P,
  MPM_METHOD_IDS,
  linearHat,
  hatWeight,
  particleNodeWeights,
  p2gMassMomentum1d,
  g2pPicVelocity1d,
  g2pVelocity1d,
  totalParticleMass,
  totalGridMass,
  totalParticleMomentum,
  totalGridMomentum,
  runMpmPicTransferSample,
  runMpmG2pSample,
  type MpmParticle1d,
} from './mpm-algos'

describe('MPM · 1D P2G / G2P 教学 stub', () => {
  it('方法 id 常量字符串（新 id 未入库，仅字符串相等）', () => {
    expect(METHOD_MPM).toBe('method-mpm')
    expect(METHOD_ALGO_MPM_PIC_TRANSFER).toBe('method-algo-mpm-pic-transfer')
    expect(METHOD_ALGO_MPM_G2P).toBe('method-algo-mpm-g2p')
    expect(MPM_METHOD_IDS).toContain(METHOD_ALGO_MPM_PIC_TRANSFER)
    expect(MPM_METHOD_IDS).toContain(METHOD_ALGO_MPM_G2P)
    // 勿 methodById：catalog 尚未接线
  })

  describe('linearHat / hatWeight', () => {
    it('N(0)=1，|ξ|≥1 为 0，|ξ|<1 线性衰减', () => {
      expect(linearHat(0)).toBe(1)
      expect(linearHat(0.5)).toBeCloseTo(0.5, 12)
      expect(linearHat(-0.25)).toBeCloseTo(0.75, 12)
      expect(linearHat(1)).toBe(0)
      expect(linearHat(-1)).toBe(0)
      expect(linearHat(1.5)).toBe(0)
    })

    it('相邻节点权重之和 = 1（单元内）', () => {
      const h = 1
      const x0 = 0
      const x_p = 3.3
      const w0 = hatWeight(x_p, 3, h, x0)
      const w1 = hatWeight(x_p, 4, h, x0)
      expect(w0 + w1).toBeCloseTo(1, 12)
      expect(w0).toBeCloseTo(0.7, 12)
      expect(w1).toBeCloseTo(0.3, 12)
    })

    it('particleNodeWeights：frac 正确', () => {
      const r = particleNodeWeights(5.25, 17, 1, 0)
      expect(r.iL).toBe(5)
      expect(r.iR).toBe(6)
      expect(r.wL).toBeCloseTo(0.75, 12)
      expect(r.wR).toBeCloseTo(0.25, 12)
    })
  })

  describe('P2G mass/momentum', () => {
    it('单粒子：质量分到两节点且总和守恒', () => {
      const particles: MpmParticle1d[] = [{ m: 2, x: 1.25, v: 3 }]
      const { nodeMass, nodeMomentum, particleMass, gridMass } =
        p2gMassMomentum1d(particles, 8, 1, 0)
      expect(particleMass).toBe(2)
      expect(gridMass).toBeCloseTo(2, 12)
      expect(nodeMass[1]!).toBeCloseTo(2 * 0.75, 12)
      expect(nodeMass[2]!).toBeCloseTo(2 * 0.25, 12)
      expect(nodeMomentum[1]!).toBeCloseTo(2 * 3 * 0.75, 12)
      expect(nodeMomentum[2]!).toBeCloseTo(2 * 3 * 0.25, 12)
      expect(totalGridMass(nodeMass)).toBeCloseTo(totalParticleMass(particles), 12)
      expect(totalGridMomentum(nodeMomentum)).toBeCloseTo(
        totalParticleMomentum(particles),
        12,
      )
    })

    it('多粒子：总质量/总动量守恒', () => {
      const particles: MpmParticle1d[] = [
        { m: 1, x: 2.1, v: 1 },
        { m: 3, x: 4.0, v: -2 },
        { m: 0.5, x: 6.7, v: 0.5 },
      ]
      const r = p2gMassMomentum1d(particles, 12, 1, 0)
      expect(r.gridMass).toBeCloseTo(r.particleMass, 12)
      expect(r.particleMass).toBeCloseTo(4.5, 12)
      expect(totalGridMomentum(r.nodeMomentum)).toBeCloseTo(
        totalParticleMomentum(particles),
        12,
      )
    })

    it('节点速度 = 动量/质量', () => {
      const particles: MpmParticle1d[] = [
        { m: 1, x: 3.0, v: 2 },
        { m: 1, x: 3.0, v: 4 },
      ]
      const r = p2gMassMomentum1d(particles, 8, 1, 0)
      // 两粒子同位：节点 3 得全部质量 2，动量 1*2+1*4=6 → v=3
      expect(r.nodeMass[3]!).toBeCloseTo(2, 12)
      expect(r.nodeVelocity[3]!).toBeCloseTo(3, 12)
    })
  })

  describe('G2P', () => {
    it('常数网格速度：PIC 原样返回', () => {
      const nNodes = 10
      const h = 1
      const nodeV = new Float64Array(nNodes)
      nodeV.fill(1.5)
      const particles: MpmParticle1d[] = [
        { m: 1, x: 2.3, v: 0 },
        { m: 1, x: 5.8, v: 9 },
      ]
      const v = g2pVelocity1d(particles, nodeV, h, 0, { picBlend: 1 })
      expect(v[0]).toBeCloseTo(1.5, 12)
      expect(v[1]).toBeCloseTo(1.5, 12)
      expect(g2pPicVelocity1d(2.3, nodeV, h, 0)).toBeCloseTo(1.5, 12)
    })

    it('线性网格速度：hat 精确插值', () => {
      const nNodes = 16
      const h = 0.5
      const x0 = 0
      const slope = 2
      const nodeV = new Float64Array(nNodes)
      for (let i = 0; i < nNodes; i++) nodeV[i] = slope * (x0 + i * h)
      for (const x of [1.1, 3.25, 5.0]) {
        const got = g2pPicVelocity1d(x, nodeV, h, x0)
        expect(got).toBeCloseTo(slope * x, 12)
      }
    })

    it('picBlend=0 + 旧网格：FLIP 增量更新', () => {
      const particles: MpmParticle1d[] = [{ m: 1, x: 2.5, v: 1.0 }]
      const nNodes = 8
      const h = 1
      const vOld = new Float64Array(nNodes)
      const vNew = new Float64Array(nNodes)
      vOld.fill(0)
      vNew.fill(0.4)
      // FLIP: v + (vPicNew − vPicOld) = 1 + (0.4 − 0) = 1.4
      const v = g2pVelocity1d(particles, vNew, h, 0, {
        picBlend: 0,
        nodeVelocityOld: vOld,
      })
      expect(v[0]).toBeCloseTo(1.4, 12)
    })

    it('picBlend=0.5：PIC 与 FLIP 中点', () => {
      const particles: MpmParticle1d[] = [{ m: 1, x: 2.5, v: 1.0 }]
      const nNodes = 8
      const h = 1
      const vOld = new Float64Array(nNodes)
      const vNew = new Float64Array(nNodes)
      vOld.fill(0)
      vNew.fill(0.4)
      // FLIP=1.4, PIC=0.4 → blend 0.5 → 0.9
      const v = g2pVelocity1d(particles, vNew, h, 0, {
        picBlend: 0.5,
        nodeVelocityOld: vOld,
      })
      expect(v[0]).toBeCloseTo(0.9, 12)
    })
  })

  describe('样例入口', () => {
    it('runMpmPicTransferSample：ok 且 methodId/familyId 对齐，质量守恒', () => {
      const r = runMpmPicTransferSample()
      expect(r.methodId).toBe(METHOD_ALGO_MPM_PIC_TRANSFER)
      expect(r.familyId).toBe(METHOD_MPM)
      expect(r.ok).toBe(true)
      expect(r.massErr).toBeLessThan(1e-12)
      expect(r.momentumErr).toBeLessThan(1e-12)
      expect(r.particleMass).toBeGreaterThan(0)
      expect(r.gridMass).toBeCloseTo(r.particleMass, 12)
    })

    it('runMpmG2pSample：ok 且常数/线性场精确', () => {
      const r = runMpmG2pSample()
      expect(r.methodId).toBe(METHOD_ALGO_MPM_G2P)
      expect(r.familyId).toBe(METHOD_MPM)
      expect(r.ok).toBe(true)
      expect(r.constFieldErr).toBeLessThan(1e-12)
      expect(r.linearFieldErr).toBeLessThan(1e-12)
      expect(r.blendFinite).toBe(true)
    })
  })
})

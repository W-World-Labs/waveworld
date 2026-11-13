import { describe, it, expect } from 'vitest'
import {
  METHOD_PERIDYNAMICS,
  METHOD_ALGO_PD_BOND_FORCE,
  METHOD_ALGO_PD_DILATATION,
  PD_METHOD_IDS,
  restXi,
  bondStretch,
  withinHorizon,
  criticalStretchMu,
  bondForceDensity1d,
  bondForceDensityDamaged1d,
  netBondForce1d,
  localDilatation1d,
  applyUniformStrain1d,
  runPdBondForceSample,
  runPdDilatationSample,
} from './peridynamics-algos'

describe('Peridynamics · 键基 1D（视界 / 伸长 / 键力 / 损伤）', () => {
  it('方法 id 常量（全未入库新 id — 勿 methodById）', () => {
    expect(METHOD_PERIDYNAMICS).toBe('method-peridynamics')
    expect(METHOD_ALGO_PD_BOND_FORCE).toBe('method-algo-pd-bond-force')
    expect(METHOD_ALGO_PD_DILATATION).toBe('method-algo-pd-dilatation')
    expect(PD_METHOD_IDS).toContain(METHOD_ALGO_PD_BOND_FORCE)
    expect(PD_METHOD_IDS).toContain(METHOD_ALGO_PD_DILATATION)
    // 父族/子 id 均未入库 — 勿 methodById(METHOD_PERIDYNAMICS) 等
  })

  describe('键伸长 s', () => {
    it('均匀拉伸：s = ε', () => {
      const eps = 0.03
      // x0: 0,1 → x: 0, 1+ε
      expect(bondStretch(0, 1, 0, 1 + eps)).toBeCloseTo(eps, 12)
      expect(restXi(0, 2)).toBe(2)
    })

    it('压缩：s < 0', () => {
      expect(bondStretch(0, 1, 0, 0.9)).toBeCloseTo(-0.1, 12)
    })

    it('|ξ|=0 → s=0', () => {
      expect(bondStretch(1, 1, 1, 1.1)).toBe(0)
    })
  })

  describe('视界 δ', () => {
    it('|ξ|≤δ 内，>δ 外', () => {
      expect(withinHorizon(0, 1, 1.5)).toBe(true)
      expect(withinHorizon(0, 1.5, 1.5)).toBe(true)
      expect(withinHorizon(0, 2, 1.5)).toBe(false)
      expect(withinHorizon(0, 1, 0)).toBe(false)
    })
  })

  describe('键力密度', () => {
    it('均匀应变 → 力线性响应 f = c·s·e', () => {
      const c = 3
      const delta = 2
      const eps = 0.02
      const r1 = bondForceDensity1d(0, 1, 0, 1 + eps, c, delta, 1)
      const r2 = bondForceDensity1d(0, 1, 0, 1 + 2 * eps, c, delta, 1)
      expect(r1.s).toBeCloseTo(eps, 12)
      expect(r1.fi).toBeCloseTo(c * eps, 12) // e = +1
      expect(r2.fi).toBeCloseTo(2 * r1.fi, 10)
      expect(Math.abs(r2.fi)).toBeGreaterThan(Math.abs(r1.fi))
    })

    it('视界外力为零', () => {
      const r = bondForceDensity1d(0, 5, 0, 5.1, 10, 2, 1)
      expect(r.active).toBe(false)
      expect(r.fi).toBe(0)
    })

    it('拉伸时 j 在右：f_i > 0（吸引）', () => {
      const r = bondForceDensity1d(0, 1, 0, 1.05, 1, 2, 1)
      expect(r.fi).toBeGreaterThan(0)
    })

    it('压缩时 j 在右：f_i < 0（排斥）', () => {
      const r = bondForceDensity1d(0, 1, 0, 0.95, 1, 2, 1)
      expect(r.fi).toBeLessThan(0)
    })
  })

  describe('临界伸长损伤', () => {
    it('μ：s≤s0 → 1，s>s0 → 0', () => {
      expect(criticalStretchMu(0.01, 0.05)).toBe(1)
      expect(criticalStretchMu(0.05, 0.05)).toBe(1)
      expect(criticalStretchMu(0.06, 0.05)).toBe(0)
    })

    it('s>s0 断键：力为 0', () => {
      const s0 = 0.04
      const ok = bondForceDensityDamaged1d(0, 1, 0, 1.02, 5, 2, s0)
      const br = bondForceDensityDamaged1d(0, 1, 0, 1.1, 5, 2, s0)
      expect(ok.mu).toBe(1)
      expect(ok.fi).not.toBe(0)
      expect(br.broken).toBe(true)
      expect(br.mu).toBe(0)
      expect(br.fi).toBe(0)
    })
  })

  describe('局部膨胀 θ', () => {
    it('均匀应变内部 θ ≈ ε', () => {
      const n = 15
      const dx = 1
      const eps = 0.015
      const delta = 2.5
      const x0 = new Float64Array(n)
      for (let i = 0; i < n; i++) x0[i] = i * dx
      const x = applyUniformStrain1d(x0, eps)
      const mid = 7
      const { theta, nBonds } = localDilatation1d(x0, x, mid, delta)
      expect(nBonds).toBeGreaterThan(0)
      expect(theta).toBeCloseTo(eps, 12)
    })
  })

  describe('净力求和', () => {
    it('对称邻居均匀应变：中点净力 ≈ 0', () => {
      const n = 11
      const eps = 0.02
      const delta = 2.1
      const c = 1
      const x0 = new Float64Array(n)
      for (let i = 0; i < n; i++) x0[i] = i
      const x = applyUniformStrain1d(x0, eps)
      const mid = 5
      const { Fi, nActive } = netBondForce1d(x0, x, mid, c, delta)
      expect(nActive).toBeGreaterThan(0)
      expect(Math.abs(Fi)).toBeLessThan(1e-12)
    })
  })

  describe('样例入口', () => {
    it('runPdBondForceSample：ok 且 methodId/familyId 对齐', () => {
      const r = runPdBondForceSample()
      expect(r.methodId).toBe(METHOD_ALGO_PD_BOND_FORCE)
      expect(r.familyId).toBe(METHOD_PERIDYNAMICS)
      expect(r.ok).toBe(true)
      expect(r.farForce).toBe(0)
      expect(r.linearRatio).toBeCloseTo(2, 8)
      expect(r.fi).toBeGreaterThan(0)
    })

    it('runPdDilatationSample：ok、θ≈ε、超临界断键', () => {
      const r = runPdDilatationSample()
      expect(r.methodId).toBe(METHOD_ALGO_PD_DILATATION)
      expect(r.familyId).toBe(METHOD_PERIDYNAMICS)
      expect(r.ok).toBe(true)
      expect(r.thetaErr).toBeLessThan(1e-12)
      expect(r.forceAboveS0).toBe(0)
      expect(r.muAbove).toBe(0)
      expect(r.broken).toBe(true)
      expect(Math.abs(r.forceBelowS0)).toBeGreaterThan(0)
    })
  })
})

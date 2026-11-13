import { describe, it, expect } from 'vitest'
import {
  METHOD_SPH,
  METHOD_ALGO_SPH_PRESSURE_FORCE,
  METHOD_ALGO_SPH_ART_VISC,
  SPH_L2_METHOD_IDS,
  cubicSplineGradW1d,
  sphPressureForcePair,
  sphPressureForce,
  sphPressureForceAll,
  monaghanArtVisc,
  runSphPressureForceSample,
  runSphArtViscSample,
} from './sph-l2-algos'
import { cubicSplineGradW } from './sph-algos'

describe('SPH L2 · 压强力 + Monaghan 人工粘性', () => {
  it('方法 id 常量字符串（新 id 未入库，仅字符串相等）', () => {
    expect(METHOD_SPH).toBe('method-sph')
    expect(METHOD_ALGO_SPH_PRESSURE_FORCE).toBe('method-algo-sph-pressure-force')
    expect(METHOD_ALGO_SPH_ART_VISC).toBe('method-algo-sph-art-visc')
    expect(SPH_L2_METHOD_IDS).toContain(METHOD_ALGO_SPH_PRESSURE_FORCE)
    expect(SPH_L2_METHOD_IDS).toContain(METHOD_ALGO_SPH_ART_VISC)
    // 勿 methodById：catalog 尚未接线
  })

  describe('cubicSplineGradW1d', () => {
    it('自对 / 支撑外 = 0，且反对称', () => {
      const h = 1
      expect(cubicSplineGradW1d(0, 0, h)).toBe(0)
      expect(cubicSplineGradW1d(0, 3 * h, h)).toBe(0)
      const g = cubicSplineGradW1d(0, 0.5, h)
      expect(g).not.toBe(0)
      expect(cubicSplineGradW1d(0.5, 0, h)).toBeCloseTo(-g, 14)
      // 与径向导 × 符号一致
      const r = 0.5
      expect(g).toBeCloseTo(cubicSplineGradW(r / h, h) * (-1), 14)
    })
  })

  describe('压强力', () => {
    it('两粒子等质量：作用-反作用 F0 = −F1，且互斥', () => {
      const h = 1
      const x = [0, 0.4]
      const m = [1, 1]
      const P = [2, 2]
      const rho = [1, 1]
      const F0 = sphPressureForce(x, m, P, rho, h, 0)
      const F1 = sphPressureForce(x, m, P, rho, h, 1)
      expect(F0 + F1).toBeCloseTo(0, 12)
      // x0 < x1 → F0 向左、F1 向右
      expect(F0).toBeLessThan(0)
      expect(F1).toBeGreaterThan(0)
      const all = sphPressureForceAll(x, m, P, rho, h)
      expect(all[0]).toBeCloseTo(F0, 14)
      expect(all[1]).toBeCloseTo(F1, 14)
    })

    it('pair 与全求和一致；自对为零', () => {
      const h = 1.2
      const pair = sphPressureForcePair(0, 0.3, 1.5, 1, 1, 1, 1, h)
      expect(pair).not.toBe(0)
      expect(sphPressureForcePair(0, 0, 1, 1, 1, 1, 1, h)).toBe(0)
      // 反作用：等 m 时 F_ij = −F_ji
      const back = sphPressureForcePair(0.3, 0, 1.5, 1, 1, 1, 1, h)
      expect(pair + back).toBeCloseTo(0, 12)
    })

    it('P 增大 → |F| 增大', () => {
      const h = 1
      const f1 = Math.abs(sphPressureForcePair(0, 0.5, 1, 1, 1, 1, 1, h))
      const f2 = Math.abs(sphPressureForcePair(0, 0.5, 1, 3, 3, 1, 1, h))
      expect(f2).toBeGreaterThan(f1)
      expect(f2 / f1).toBeCloseTo(3, 10)
    })
  })

  describe('Monaghan 人工粘性', () => {
    it('分离 / 静止时 Π = 0', () => {
      const h = 1
      // 分离：xi < xj，vi 向左、vj 向右 → r<0? r=xi-xj<0, v=vi-vj<0 → vr>0
      expect(monaghanArtVisc(0, 0.5, -1, 1, 1, 1, h)).toBe(0)
      expect(monaghanArtVisc(0, 0.5, 0, 0, 1, 1, h)).toBe(0)
      // r>0 且相对速度分离（vi>vj 且 r>0 → vr>0）
      expect(monaghanArtVisc(0.5, 0, 1, -1, 1, 1, h)).toBe(0)
    })

    it('接近时 Π > 0，且随 |v| 增大', () => {
      const h = 1
      // xi=0, xj=0.5 → r=-0.5；接近 vi=+v, vj=-v → v=2v, vr<0
      const p1 = monaghanArtVisc(0, 0.5, 0.5, -0.5, 1, 1, h)
      const p2 = monaghanArtVisc(0, 0.5, 1.5, -1.5, 1, 1, h)
      expect(p1).toBeGreaterThan(0)
      expect(p2).toBeGreaterThan(p1)
    })

    it('解析 μ 与 Π（α,β 指定）', () => {
      const h = 1
      const eps = 0.01
      const alpha = 1
      const beta = 2
      const c = 1
      const rho = 1
      const xi = 0
      const xj = 0.4
      const vi = 1
      const vj = -1
      const r = xi - xj
      const v = vi - vj
      const vr = v * r
      expect(vr).toBeLessThan(0)
      const mu = (h * vr) / (r * r + eps * h * h)
      const expected = (-alpha * c * mu + beta * mu * mu) / rho
      const got = monaghanArtVisc(xi, xj, vi, vj, rho, rho, h, {
        alpha,
        beta,
        c,
        eps,
      })
      expect(got).toBeCloseTo(expected, 12)
    })
  })

  it('runSphPressureForceSample：ok 且反对称斥力', () => {
    const r = runSphPressureForceSample({ h: 1, dx: 0.4, P: 1.5 })
    expect(r.methodId).toBe(METHOD_ALGO_SPH_PRESSURE_FORCE)
    expect(r.familyId).toBe(METHOD_SPH)
    expect(r.ok).toBe(true)
    expect(r.repulsive).toBe(true)
    expect(r.antiSymErr).toBeLessThan(1e-12)
    expect(r.F0).toBeLessThan(0)
    expect(r.F1).toBeGreaterThan(0)
  })

  it('runSphArtViscSample：接近 Π>0、分离/静止 =0', () => {
    const r = runSphArtViscSample({ h: 1.1, vApproach: 0.8 })
    expect(r.methodId).toBe(METHOD_ALGO_SPH_ART_VISC)
    expect(r.familyId).toBe(METHOD_SPH)
    expect(r.ok).toBe(true)
    expect(r.PiApproach).toBeGreaterThan(0)
    expect(r.PiSeparate).toBe(0)
    expect(r.PiRest).toBe(0)
  })
})

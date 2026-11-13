// src/lib/sim/afm.ts soft-core / LJ 力护栏 + 恒力反馈环
import { describe, it, expect } from 'vitest'
import { ljForce, LJ_MIN, afmScanResult, AFM_SAMPLES } from './afm'

describe('ljForce: tip–sample LJ with soft-core floor', () => {
  it('finite at d=0 (clamped to 0.2·σ)', () => {
    const f = ljForce(0, 1, 1)
    expect(Number.isFinite(f)).toBe(true)
    expect(f).toBeGreaterThan(0) // near-contact → repulsion
  })

  it('zero near LJ_MIN (d0 = σ·2^(1/6))', () => {
    const d0 = LJ_MIN(1)
    expect(ljForce(d0, 1, 1)).toBeCloseTo(0, 6)
  })

  it('sign correct: repulsion when close, attraction when far', () => {
    const d0 = LJ_MIN(1)
    expect(ljForce(d0 * 0.85, 1, 1)).toBeGreaterThan(0) // 近 → 排斥
    expect(ljForce(d0 * 1.5, 1, 1)).toBeLessThan(0)     // 远 → 吸引
  })
})

describe('afmScanResult: 恒力模式 PI 反馈环', () => {
  it('结果形状与既有契约一致', () => {
    const r = afmScanResult({ base: 2.6, k: 6 })
    for (const ch of [r.surface, r.gaps, r.forces, r.deflections, r.topography, r.errors])
      expect(ch).toHaveLength(AFM_SAMPLES)
  })

  it('反馈锁定：实测偏转 ≈ 设定偏转（残余误差小）', () => {
    const r = afmScanResult({ base: 2.6, k: 6 })
    const maxErr = Math.max(...r.errors.map(Math.abs))
    expect(maxErr).toBeLessThan(1e-4) // 残余 ≪ 设定值本身（~23）
  })

  it('形貌通道跟踪真实表面：topography − surface ≈ 恒定接触间隙', () => {
    const r = afmScanResult({ base: 2.6, k: 6 })
    for (let i = 0; i < AFM_SAMPLES; i++) {
      // 锁定后针尖高度 = 表面 + 设定间隙（0.9σ），形貌误差 < 0.01σ
      expect(Math.abs(r.topography[i]! - r.surface[i]! - 0.9)).toBeLessThan(0.01)
      // 实测间隙即锁定间隙
      expect(Math.abs(r.gaps[i]! - 0.9)).toBeLessThan(0.01)
      // 实测力 ≈ 设定力（偏转 = F/k 锁定于 setpoint）
      expect(r.forces[i]! / 6).toBeCloseTo(r.setpoint, 4)
    }
  })

  it('形貌随表面起伏（不是固定在基座高度的开环输出）', () => {
    const r = afmScanResult({ base: 2.6, k: 6 })
    const topoRange = Math.max(...r.topography) - Math.min(...r.topography)
    expect(topoRange).toBeGreaterThan(1) // 表面台阶 ~1.1σ + 原子峰
  })

  it('不同劲度 k 与起始进针高度下均收敛', () => {
    for (const k of [2, 20]) {
      for (const base of [2.1, 3.2]) {
        const r = afmScanResult({ base, k })
        const maxErr = Math.max(...r.errors.map(Math.abs))
        expect(maxErr).toBeLessThan(1e-3)
      }
    }
  })
})

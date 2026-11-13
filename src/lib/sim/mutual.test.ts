import { describe, it, expect } from 'vitest'
import {
  couplingCoefficient,
  turnsRatio,
  transformerSecondaryVoltage,
  mutualStep,
  type MutualState,
} from './mutual'

describe('mutual — 互感 / 变压器', () => {
  // ① 耦合系数 k = M / √(L₁L₂)，并验边界 k∈[0,1]（M ≤ √(L₁L₂)）
  it('couplingCoefficient = M/√(L₁L₂)，且物理范围 k∈[0,1]', () => {
    expect(couplingCoefficient(0.5, 1, 1)).toBeCloseTo(0.5, 9)
    expect(couplingCoefficient(2, 4, 1)).toBeCloseTo(1.0, 9) // M=√(L1L2)=2 → k=1
    expect(couplingCoefficient(0, 4, 1)).toBeCloseTo(0.0, 9)
    // 任意合法 M≤√(L1L2) → k∈[0,1]
    for (const M of [0, 0.3, 0.7, 1.0]) {
      const k = couplingCoefficient(M, 2, 0.5) // √(L1L2)=1
      expect(k).toBeGreaterThanOrEqual(0)
      expect(k).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  // ② 理想变压器空载电压比 V₂/V₁ = n = √(L₂/L₁)
  it('turnsRatio = √(L₂/L₁) 且 transformerSecondaryVoltage = V₁·n', () => {
    expect(turnsRatio(1, 4)).toBeCloseTo(2, 9) // 升压 1:2
    expect(turnsRatio(4, 1)).toBeCloseTo(0.5, 9) // 降压 2:1
    const V1 = 12
    const L1 = 1, L2 = 9 // n=3
    expect(transformerSecondaryVoltage(V1, L1, L2)).toBeCloseTo(V1 * 3, 9)
    // V₂/V₁ 等于匝比
    expect(transformerSecondaryVoltage(V1, L1, L2) / V1).toBeCloseTo(turnsRatio(L1, L2), 9)
  })

  // ③ k=0（M=0）解耦：初级激励时次级电流恒为 0
  it('M=0 解耦：仅初级激励，次级电流恒为 0', () => {
    let s: MutualState = { i1: 0, i2: 0 }
    const p = { L1: 1, L2: 1, M: 0, R1: 1, R2: 1, V1: 10, V2: 0 }
    // 时间常数 τ=L/R=1s；积分到 ~15τ 以充分逼近直流稳态
    for (let n = 0; n < 15000; n++) {
      s = mutualStep(s, p, 0.001)
      expect(s.i2).toBeCloseTo(0, 12) // 次级始终为 0
    }
    // 初级达稳态 i1 → V1/R1
    expect(s.i1).toBeCloseTo(p.V1 / p.R1, 3)
  })

  // ④ 能量传递：k>0 时初级激励经互感在次级回路产生电流
  it('k>0：初级激励经互感在次级感生出非零电流', () => {
    let s: MutualState = { i1: 0, i2: 0 }
    const p = { L1: 1, L2: 1, M: 0.5, R1: 1, R2: 1, V1: 10, V2: 0 }
    let peakAbsI2 = 0
    // 积分到 ~15τ 以越过暂态、充分逼近直流稳态
    for (let n = 0; n < 15000; n++) {
      s = mutualStep(s, p, 0.001)
      peakAbsI2 = Math.max(peakAbsI2, Math.abs(s.i2))
    }
    // 暂态期间次级被感应出明显电流
    expect(peakAbsI2).toBeGreaterThan(0.01)
    // 直流稳态下互感不再传能，次级电流回落到 ~0
    expect(s.i2).toBeCloseTo(0, 2)
    expect(s.i1).toBeCloseTo(p.V1 / p.R1, 2)
  })

  // ⑤ k→1 完全耦合极限：行列式趋零仍数值稳健（不产生 NaN/Inf）
  it('k→1 完全耦合极限数值稳健（无 NaN/Inf）', () => {
    // M 取近上限 √(L1L2)，但实现内部应对 k 设上限以保持稳定
    let s: MutualState = { i1: 0, i2: 0 }
    const L1 = 1, L2 = 1
    const M = Math.sqrt(L1 * L2) * 0.999 // 接近完全耦合
    const p = { L1, L2, M, R1: 1, R2: 1, V1: 10, V2: 0 }
    for (let n = 0; n < 5000; n++) {
      s = mutualStep(s, p, 0.0005)
      expect(Number.isFinite(s.i1)).toBe(true)
      expect(Number.isFinite(s.i2)).toBe(true)
    }
    expect(Number.isFinite(s.i1)).toBe(true)
    expect(Number.isFinite(s.i2)).toBe(true)
  })
})

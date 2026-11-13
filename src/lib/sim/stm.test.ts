import { describe, it, expect } from 'vitest'
import { tunnelCurrent, gapFromCurrent, scanConstantHeight, scanConstantCurrent } from './stm'

describe('tunnelCurrent — I = I0·exp(−2κd)', () => {
  it('d=0 时 I=I0（黄金值）', () => {
    expect(tunnelCurrent(0, 5, 1)).toBeCloseTo(1, 12)
    expect(tunnelCurrent(0, 12.3, 4.2)).toBeCloseTo(4.2, 12)
  })

  it('随 d 单调减小', () => {
    const I1 = tunnelCurrent(0.1, 10, 1)
    const I2 = tunnelCurrent(0.2, 10, 1)
    const I3 = tunnelCurrent(0.3, 10, 1)
    expect(I2).toBeLessThan(I1)
    expect(I3).toBeLessThan(I2)
  })

  it('指数衰减：d 增 ln10/(2κ) → 电流 ×0.1（数量级灵敏度）', () => {
    const kappa = 11.5, I0 = 1
    const step = Math.log(10) / (2 * kappa) // ≈ 0.1nm
    const Ia = tunnelCurrent(0.5, kappa, I0)
    const Ib = tunnelCurrent(0.5 + step, kappa, I0)
    expect(Ib / Ia).toBeCloseTo(0.1, 10)
  })
})

describe('gapFromCurrent — tunnelCurrent 的逆', () => {
  it('正反互逆（往返一致）', () => {
    const d = 0.42, kappa = 9, I0 = 3
    const I = tunnelCurrent(d, kappa, I0)
    expect(gapFromCurrent(I, kappa, I0)).toBeCloseTo(d, 12)
  })
})

describe('scanConstantHeight — 各点电流', () => {
  it('表面越高（间距越小）电流越大', () => {
    const surface = [0, 0.1, 0.2]
    const I = scanConstantHeight(surface, 1, 10, 1)
    expect(I[0]).toBeLessThan(I[1]) // h=0 间距大 → 电流小
    expect(I[1]).toBeLessThan(I[2])
    // 与解析值一致
    expect(I[2]).toBeCloseTo(tunnelCurrent(0.8, 10, 1), 12)
  })
})

describe('scanConstantCurrent — 针高轨迹跟随表面', () => {
  it('针高 = 表面 + 恒定间距，轨迹形状跟随起伏', () => {
    const surface = [0, 0.05, 0.12, 0.08, 0]
    const setCurrent = 0.2, kappa = 8, I0 = 1
    const tip = scanConstantCurrent(surface, setCurrent, kappa, I0)
    const gap = gapFromCurrent(setCurrent, kappa, I0)
    // 每点针高减去表面 = 恒定间距
    for (let i = 0; i < surface.length; i++) {
      expect(tip[i] - surface[i]).toBeCloseTo(gap, 12)
    }
    // 轨迹与表面差异是常数 → 完全相关（峰对峰、谷对谷）
    const peakIdx = surface.indexOf(Math.max(...surface))
    const tipPeak = tip.indexOf(Math.max(...tip))
    expect(tipPeak).toBe(peakIdx)
  })

  it('反解针高在该高度处确实得到 setCurrent', () => {
    const surface = [0, 0.1, 0.3]
    const setCurrent = 0.15, kappa = 10, I0 = 1
    const tip = scanConstantCurrent(surface, setCurrent, kappa, I0)
    for (let i = 0; i < surface.length; i++) {
      expect(tunnelCurrent(tip[i] - surface[i], kappa, I0)).toBeCloseTo(setCurrent, 12)
    }
  })
})

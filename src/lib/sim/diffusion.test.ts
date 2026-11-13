// src/lib/sim/diffusion.test.ts
import { describe, it, expect } from 'vitest'
import { linearFit, diffusionEinstein } from './diffusion'

describe('linearFit: 最小二乘', () => {
  it('完美直线 y=3x+2 → slope=3, intercept=2, r2=1', () => {
    const x = [0, 1, 2, 3, 4], y = [2, 5, 8, 11, 14]
    const f = linearFit(x, y)
    expect(f.slope).toBeCloseTo(3, 9)
    expect(f.intercept).toBeCloseTo(2, 9)
    expect(f.r2).toBeCloseTo(1, 9)
  })
})

describe('diffusionEinstein: D = slope/(2·dim)', () => {
  it('线性 MSD=4t（dim=2）→ D=slope/4=1', () => {
    const t = Array.from({ length: 50 }, (_, i) => i * 0.01)
    const msd = t.map((tt) => 4 * tt)
    const { D, slope } = diffusionEinstein(t, msd, 2)
    expect(slope).toBeCloseTo(4, 6)
    expect(D).toBeCloseTo(1, 6) // 4/(2·2)
  })
  it('跳过前段弹道（skipFraction）只拟合扩散尾段', () => {
    const t = Array.from({ length: 100 }, (_, i) => i * 0.01)
    // 前段弹道 ~t²，后段扩散 ~线性：用分段近似，验证 skip 后斜率更接近扩散段
    const msd = t.map((tt) => (tt < 0.3 ? tt * tt * 10 : 6 * tt - 0.6))
    const { D, nFit } = diffusionEinstein(t, msd, 2, { skipFraction: 0.4 })
    expect(nFit).toBeLessThan(100) // 跳过了前段
    expect(D).toBeGreaterThan(1.0) // 扩散段斜率 6 → D≈1.5
  })
})

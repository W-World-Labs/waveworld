import { describe, it, expect } from 'vitest'
import {
  WAVE_PARENT,
  runLaplacianSineSample,
  runWaveCflSample,
} from './wave-algos'

describe('二维波动 FD 方法族模块', () => {
  it('父方法 id 常量对齐目录', () => {
    expect(WAVE_PARENT).toBe('method-wave-fd')
  })

  it('正弦模 Laplacian：峰值处为负，量级贴近 −2k²', () => {
    const r = runLaplacianSineSample(33)
    expect(r.uPeak).toBeGreaterThan(0.9) // 中心 sin≈1
    expect(r.lapPeak).toBeLessThan(0)
    // 均匀场 Laplacian = 0
    expect(r.uniformLap).toBeCloseTo(0, 9)
    // 离散比 continuous 应接近（相对误差 < 5%）
    expect(r.ratio).toBeCloseTo(r.continuousRatio, 2)
    expect(Math.abs(r.ratio - r.continuousRatio) / Math.abs(r.continuousRatio)).toBeLessThan(
      0.05,
    )
  })

  it('蛙跳 CFL：残差≈0、能量有限且不爆炸', () => {
    const r = runWaveCflSample(30)
    expect(r.a).toBeLessThanOrEqual(0.5)
    expect(r.residualMax).toBeLessThan(1e-5)
    expect(r.finite).toBe(true)
    expect(r.energy0).toBeGreaterThan(0)
    expect(r.energyF).toBeGreaterThan(0)
    // 无阻尼从静止释放：位移能量不应大幅放大
    expect(r.energyF).toBeLessThan(r.energy0 * 2)
  })
})

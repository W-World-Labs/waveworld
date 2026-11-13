import { describe, it, expect } from 'vitest'
import {
  erf, erfc, heatStepSolution, diffusionLength,
  initHeat1D, ftcsStep, maxErfcError,
} from './heaterfc'

describe('误差函数', () => {
  it('erf 已知值：erf(0)=0、erf(1)≈0.8427、erf(2)≈0.9953、奇函数', () => {
    expect(erf(0)).toBeCloseTo(0, 6)
    expect(erf(1)).toBeCloseTo(0.842701, 5)
    expect(erf(2)).toBeCloseTo(0.995322, 5)
    expect(erf(-1)).toBeCloseTo(-erf(1), 9)
  })
  it('erfc(0)=1、erfc(1)≈0.1573、erfc+erf=1', () => {
    expect(erfc(0)).toBeCloseTo(1, 6)
    expect(erfc(1)).toBeCloseTo(0.157299, 5)
    expect(erf(0.7) + erfc(0.7)).toBeCloseTo(1, 9)
  })
})

describe('阶跃热扩散解析解', () => {
  it('界面处 T=0.5；对称；远离界面趋 1/0', () => {
    expect(heatStepSolution(5, 1, 0.5, 5)).toBeCloseTo(0.5, 9)        // x=x0
    expect(heatStepSolution(3, 1, 0.5, 5)).toBeGreaterThan(0.5)        // 热侧
    expect(heatStepSolution(7, 1, 0.5, 5)).toBeLessThan(0.5)           // 冷侧
    // 关于界面反对称：T(x0−d)+T(x0+d)=1
    expect(heatStepSolution(3, 1, 0.5, 5) + heatStepSolution(7, 1, 0.5, 5)).toBeCloseTo(1, 9)
  })
  it('扩散长度 √(κt)：t 翻 4 倍 → 长度翻 2 倍', () => {
    expect(diffusionLength(4, 0.5)).toBeCloseTo(2 * diffusionLength(1, 0.5), 9)
  })
})

describe('★ 对拍护栏：FTCS 数值剖面落在 erfc 精确曲线上', () => {
  it('从解析 erfc(t0) 起演化 → 各时刻最大偏差 < 0.005（浏览器内定量科学）', () => {
    // 大域(长 20、界面在 10)使扩散前沿在测试时长内永不到边界 → 远场恒 1/0，隔离内部解算精度
    const h = initHeat1D(401, 20, 0.5, 10, 0.2) // 从 t0=0.2 的解析剖面起（已平滑可解析）
    const checkpoints = [300, 800, 1800, 3000]
    let maxErr = 0
    for (let step = 1; step <= 3000; step++) {
      ftcsStep(h)
      if (checkpoints.includes(step)) maxErr = Math.max(maxErr, maxErfcError(h))
    }
    // FTCS 一致 + 稳定，数值解逐点贴合解析 erfc 的时间演化
    expect(maxErr).toBeLessThan(0.005)
  })
  it('界面中点 T 恒为 0.5（解析反对称守恒）', () => {
    const h = initHeat1D(201, 10, 0.5, 5)
    for (let s = 0; s < 1000; s++) ftcsStep(h)
    const mid = h.T[100] // x=5=界面
    expect(mid).toBeCloseTo(0.5, 2)
  })
})

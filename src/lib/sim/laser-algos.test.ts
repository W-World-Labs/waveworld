import { describe, it, expect } from 'vitest'
import {
  LASER_PARENT,
  runSteadySample,
  runStepSample,
  runThresholdSample,
} from './laser-algos'
import { DEFAULT, thresholdPump } from './laser'

describe('激光速率方程方法族模块', () => {
  it('父方法 id 常量对齐目录', () => {
    expect(LASER_PARENT).toBe('method-laser-rate')
  })

  it('阈值泵浦：thresholdPump() > 0 且与 DEFAULT 公式一致', () => {
    const { Pth } = runThresholdSample()
    expect(Pth).toBeGreaterThan(0)
    expect(Pth).toBeCloseTo(1 / (DEFAULT.B * DEFAULT.tauC) / DEFAULT.tauN, 10)
    // 直接 shipped 入口与样例一致
    expect(thresholdPump()).toBe(Pth)
  })

  it('稳态：阈下光子近零，阈上起振且远大于阈下', () => {
    const r = runSteadySample()
    expect(r.Pth).toBeGreaterThan(0)
    expect(r.below).toBeLessThan(1)
    expect(r.above).toBeGreaterThan(r.below * 20)
    expect(Number.isFinite(r.above)).toBe(true)
  })

  it('步进：若干 laserStep 后 N、S 有限非负', () => {
    const r = runStepSample(50)
    expect(r.finite).toBe(true)
    expect(r.nonNeg).toBe(true)
    expect(r.N).toBeGreaterThanOrEqual(0)
    expect(r.S).toBeGreaterThanOrEqual(0)
    // 阈上泵浦短程后应出现正光子
    expect(r.S).toBeGreaterThan(0)
  })
})

import { describe, it, expect } from 'vitest'
import {
  BIO_DSP_PARENT,
  runMovingAverageSample,
  runNotchSample,
  runRemoveDcSample,
} from './biodsp-algos'

describe('生物电 DSP 二级算法模块', () => {
  it('BIO_DSP_PARENT 对齐 method-algo-biodsp-pipeline', () => {
    expect(BIO_DSP_PARENT).toBe('method-algo-biodsp-pipeline')
  })

  it('removeDC：去直流后均值≈0，放大后方差按 gain²', () => {
    const r = runRemoveDcSample()
    expect(r.meanBefore).toBeGreaterThan(1.5)
    expect(r.meanAfter).toBeCloseTo(0, 6)
    expect(r.varRaw).toBeGreaterThan(0)
    expect(r.varAmplified).toBeCloseTo(r.varRaw * r.gain * r.gain, 2)
  })

  it('movingAverage：平滑后方差明显下降且长度不变', () => {
    const r = runMovingAverageSample()
    expect(r.length).toBe(1500)
    expect(r.win).toBeGreaterThan(1)
    expect(r.varBefore).toBeGreaterThan(0)
    expect(r.varAfter).toBeLessThan(r.varBefore)
    // 非平凡：噪声主导信号被平滑后，方差至少降到原值 60% 以下
    expect(r.varAfter).toBeLessThan(r.varBefore * 0.6)
  })

  it('notch：50 Hz 能量大幅衰减，5 Hz 主信号基本保留', () => {
    const r = runNotchSample()
    expect(r.pow50Before).toBeGreaterThan(0)
    expect(r.pow50After).toBeLessThan(r.pow50Before * 0.1)
    expect(r.pow5After).toBeGreaterThan(r.pow5Before * 0.7)
  })
})

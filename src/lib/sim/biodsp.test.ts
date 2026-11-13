import { describe, it, expect } from 'vitest'
import { removeDC, movingAverage, notch, amplify, mean, variance, powerAt } from './biodsp'

describe('biodsp — 生物电采集 DSP 链路', () => {
  const fs = 1000 // 采样率 1kHz

  // 含 5Hz 主信号 + 50Hz 工频干扰 + 直流偏置的合成信号
  function makeSignal(n: number): number[] {
    const x = new Array<number>(n)
    for (let i = 0; i < n; i++) {
      const t = i / fs
      x[i] =
        2.0 + // 直流偏置（电极极化）
        1.0 * Math.sin(2 * Math.PI * 5 * t) + // 5Hz 生物电主信号
        0.8 * Math.sin(2 * Math.PI * 50 * t) // 50Hz 工频干扰
    }
    return x
  }

  it('removeDC 后均值 ≈ 0', () => {
    const x = makeSignal(2000)
    expect(mean(x)).toBeGreaterThan(1.5) // 原信号有明显直流偏置
    const y = removeDC(x)
    expect(mean(y)).toBeCloseTo(0, 6)
  })

  it('amplify 线性放大：增益作用于每个样本', () => {
    const x = [1, -2, 3, -4]
    const y = amplify(x, 1000)
    expect(y).toEqual([1000, -2000, 3000, -4000])
    // 放大后方差按 gain² 增长
    expect(variance(y)).toBeCloseTo(variance(x) * 1000 * 1000, 3)
  })

  it('movingAverage 降低（噪声信号的）方差', () => {
    // 在缓变信号上叠加高频随机噪声
    const n = 1500
    const x = new Array<number>(n)
    let seed = 12345
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff - 0.5
    }
    for (let i = 0; i < n; i++) {
      x[i] = Math.sin((2 * Math.PI * 3 * i) / fs) + 0.8 * rnd()
    }
    const y = movingAverage(x, 21)
    expect(variance(y)).toBeLessThan(variance(x))
    expect(y.length).toBe(x.length)
  })

  it('notch 显著衰减 50Hz 工频分量的能量', () => {
    const x = makeSignal(2000)
    const before = powerAt(x, fs, 50)
    const y = notch(x, fs, 50)
    const after = powerAt(y, fs, 50)
    // 陷波后 50Hz 能量大幅下降（至少降到原来的 1/10 以下）
    expect(after).toBeLessThan(before * 0.1)
  })

  it('notch 基本保留邻近的 5Hz 主信号', () => {
    const x = makeSignal(2000)
    const before5 = powerAt(x, fs, 5)
    const y = notch(x, fs, 50)
    const after5 = powerAt(y, fs, 5)
    // 5Hz 远离陷波中心，应基本保留（不低于原来的 70%）
    expect(after5).toBeGreaterThan(before5 * 0.7)
  })

  it('完整链路：放大 → 去直流 → 平滑 → 陷波 后 50Hz 几乎消失', () => {
    const x = makeSignal(2000)
    let s = amplify(x, 100)
    s = removeDC(s)
    s = movingAverage(s, 3)
    s = notch(s, fs, 50)
    const finalPow50 = powerAt(s, fs, 50)
    const rawPow50 = powerAt(amplify(x, 100), fs, 50)
    expect(finalPow50).toBeLessThan(rawPow50 * 0.05)
  })
})

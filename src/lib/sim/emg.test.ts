import { describe, it, expect } from 'vitest'
import { emgSample, emgRMS, emgChannel, emgResult, EMG_SAMPLE_RATE, EMG_RMS_WINDOW } from './emg'
import { rng as seededRng } from '../mc'

// 运动单元池（Fuglevand 风格）EMG 模型的断言：
// 募集（size principle）+ 频率编码 → 幅度随驱动单调、静息仅剩基线、
// 低驱动为稀疏 MUAP 尖峰、高驱动为致密干涉模式、双极性。

// 确定性伪随机源（LCG，返回 [0,1)），让测试可复现。
function makeRng(seed = 1) {
  let s = seed >>> 0
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

function rmsOf(x: number[]): number {
  return Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)
}

describe('emgSample — 单点采样', () => {
  it('输出有限（无 NaN / Infinity）', () => {
    const rng = makeRng(42)
    for (let i = 0; i < 1000; i++) {
      const x = emgSample(Math.random(), rng)
      expect(Number.isFinite(x)).toBe(true)
    }
  })

  it('静息(activation=0)采样幅度被基线噪声限制（无运动单元被募集）', () => {
    const rng = makeRng(7)
    let max = 0
    for (let i = 0; i < 2000; i++) max = Math.max(max, Math.abs(emgSample(0, rng)))
    // 基线幅度 0.02，零均值 → 单点幅度恰被基线限制
    expect(max).toBeLessThanOrEqual(0.02 + 1e-12)
    expect(max).toBeGreaterThan(0.01)
  })

  it('双极性：高激活时既有正样本也有负样本（MUAP 模板零均值）', () => {
    const rng = makeRng(99)
    let pos = 0
    let neg = 0
    for (let i = 0; i < 2000; i++) {
      const x = emgSample(0.8, rng)
      if (x > 0.05) pos++
      if (x < -0.05) neg++
    }
    expect(pos).toBeGreaterThan(100)
    expect(neg).toBeGreaterThan(100)
  })
})

describe('emgChannel — 运动单元募集 + 频率编码', () => {
  it('确定性：同一 seed 流产生同一通道', () => {
    expect(emgChannel(0.6, 512, seededRng(9))).toEqual(emgChannel(0.6, 512, seededRng(9)))
  })

  it('a=0 → 纯基线噪声（没有任何 MU 达到募集阈值）', () => {
    const x = emgChannel(0, 2048, seededRng(11))
    expect(Math.max(...x.map(Math.abs))).toBeLessThanOrEqual(0.02 + 1e-12)
    expect(rmsOf(x)).toBeCloseTo(0.02 / Math.sqrt(3), 3)
  })

  it('低激活：稀疏孤立 MUAP 尖峰（少数低阈值单元低频放电）', () => {
    const x = emgChannel(0.08, 4096, seededRng(13))
    const active = x.filter((v) => Math.abs(v) > 3 * 0.02).length / x.length
    // 有真实 MUAP 发放（幅度超过基线）但占空比很低
    expect(active).toBeGreaterThan(0)
    expect(active).toBeLessThan(0.1)
    expect(Math.max(...x.map(Math.abs))).toBeGreaterThan(0.03)
  })

  it('募集 → 致密干涉：超基线样本占比随驱动单调增大', () => {
    const frac = (a: number) =>
      emgChannel(a, 4096, seededRng(17)).filter((v) => Math.abs(v) > 3 * 0.02).length / 4096
    const f = [0.02, 0.15, 0.4, 0.9].map(frac)
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThan(f[i - 1])
    expect(f[3]).toBeGreaterThan(0.5) // 高驱动时大部分样本处于干涉爆发中
  })

  it('峰值幅度随驱动增大（更大 MUAP 幅度的高阈值单元被募集）', () => {
    const peak = (a: number) => Math.max(...emgChannel(a, 4096, seededRng(19)).map(Math.abs))
    expect(peak(0.9)).toBeGreaterThan(peak(0.3))
    expect(peak(0.3)).toBeGreaterThan(peak(0.05))
  })
})

describe('emgRMS — 包络幅度', () => {
  it('高 activation 的 RMS 明显大于低 activation', () => {
    const rmsLow = emgRMS(0.15, 4000, makeRng(123))
    const rmsHigh = emgRMS(0.9, 4000, makeRng(123))
    expect(rmsHigh).toBeGreaterThan(rmsLow * 2)
  })

  it('activation=0 时 RMS 很小（接近基线噪声 RMS）', () => {
    const rms0 = emgRMS(0, 4000, makeRng(321))
    // 均匀[-0.02,0.02]噪声理论 RMS = 0.02/√3 ≈ 0.0115
    expect(rms0).toBeGreaterThan(0)
    expect(rms0).toBeCloseTo(0.02 / Math.sqrt(3), 2)
  })

  it('RMS 随 activation 单调（募集 + 频率编码的包络律）', () => {
    const r1 = emgRMS(0.2, 5000, makeRng(555))
    const r2 = emgRMS(0.5, 5000, makeRng(555))
    const r3 = emgRMS(0.85, 5000, makeRng(555))
    expect(r2).toBeGreaterThan(r1)
    expect(r3).toBeGreaterThan(r2)
  })

  it('满驱动 RMS ≈ 0.35 标定值（数量级检查）', () => {
    const r = emgRMS(1, 8000, makeRng(77))
    expect(r).toBeGreaterThan(0.25)
    expect(r).toBeLessThan(0.5)
  })

  it('n<=0 时 RMS 为 0（边界）', () => {
    expect(emgRMS(0.5, 0, makeRng(1))).toBe(0)
  })
})

describe('emgResult — 场景接口', () => {
  it('返回 2 通道 × samples + 同步 RMS 包络 + baselineRms', () => {
    const r = emgResult({ agonist: 0.6, antag: 0.2, seed: 11, samples: 256 })
    expect(r.channels).toHaveLength(2)
    expect(r.channels[0]).toHaveLength(256)
    expect(r.rms[0]).toHaveLength(256)
    expect(r.sampleRate).toBe(EMG_SAMPLE_RATE)
    expect(r.baselineRms).toBeCloseTo(0.02 / Math.sqrt(3), 12)
    // rms 字段与通道样本一致（64 点滑窗）
    const i = 200
    const expect_rms = Math.sqrt(
      r.channels[0].slice(i - EMG_RMS_WINDOW + 1, i + 1).reduce((s, v) => s + v * v, 0) / EMG_RMS_WINDOW)
    expect(r.rms[0][i]).toBeCloseTo(expect_rms, 12)
  })

  it('同一 seed 可复现；不同 seed 通道不同；主动肌/拮抗肌独立', () => {
    const s = { agonist: 0.6, antag: 0.2, samples: 256 }
    expect(emgResult({ ...s, seed: 11 })).toEqual(emgResult({ ...s, seed: 11 }))
    expect(emgResult({ ...s, seed: 12 }).channels).not.toEqual(emgResult({ ...s, seed: 11 }).channels)
    const r = emgResult({ ...s, seed: 5 })
    expect(r.channels[0]).not.toEqual(r.channels[1])
  })

  it('主动肌 RMS > 拮抗肌 RMS 当 agonist > antag', () => {
    const r = emgResult({ agonist: 0.8, antag: 0.1, seed: 23, samples: 1024 })
    const tail = (x: number[]) => rmsOf(x.slice(256))
    expect(tail(r.channels[0])).toBeGreaterThan(tail(r.channels[1]))
    expect(r.rms[0][1023]).toBeGreaterThan(r.rms[1][1023])
  })
})

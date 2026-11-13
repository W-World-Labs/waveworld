import { describe, it, expect } from 'vitest'
import { BANDS, eegSample, bandPower, dominantBand, measureBandPower, eegResult, EEG_SAMPLE_RATE } from './eeg'

// 限带随机过程 EEG 模型的断言：
// 合成 = 各频带带通滤波白噪声 + 1/f 本底；功率一律为对生成信号的实测（滤波+方差）。

describe('BANDS — 频带定义', () => {
  it('恰好五个经典频带 δθαβγ', () => {
    expect(BANDS.map((b) => b.name)).toEqual(['delta', 'theta', 'alpha', 'beta', 'gamma'])
  })

  it('代表频率正确：α≈10 Hz、δ≈2、γ≈40', () => {
    const f = (n: string) => BANDS.find((b) => b.name === n)!.freq
    expect(f('alpha')).toBeCloseTo(10, 6)
    expect(f('delta')).toBeCloseTo(2, 6)
    expect(f('beta')).toBeCloseTo(20, 6)
    expect(f('gamma')).toBeCloseTo(40, 6)
  })

  it('频率严格递增 δ<θ<α<β<γ', () => {
    for (let i = 1; i < BANDS.length; i++) {
      expect(BANDS[i].freq).toBeGreaterThan(BANDS[i - 1].freq)
    }
  })
})

describe('eegSample — 限带噪声合成电位', () => {
  // 确定性「噪声」源（始终返回 0.5 → 测量噪声=0），让样本可复现
  const zeroNoise = () => 0.5

  it('样本有限（非 NaN / Infinity）且可复现', () => {
    const w = { delta: 1, theta: 1, alpha: 1, beta: 1, gamma: 1 }
    for (let i = 0; i < 50; i++) {
      const v = eegSample(i * 0.01, w)
      expect(Number.isFinite(v)).toBe(true)
    }
    expect(eegSample(0.37, w, zeroNoise)).toBe(eegSample(0.37, w, zeroNoise))
  })

  it('权重全 0 + 零测量噪声 → 只剩小幅 1/f 本底（皮层永不绝对静默）', () => {
    // 无节律活动时输出应远小于任一单位权重的节律幅度
    for (const t of [0.123, 0.5, 1.7]) {
      expect(Math.abs(eegSample(t, {}, zeroNoise))).toBeLessThan(1.5)
    }
  })

  it('是真实的限带过程：纯 alpha 权重的样本测量功率集中在 alpha 带', () => {
    // 连续取通道过程的一段（零噪声），实测功率谱集中
    const n = 4 * EEG_SAMPLE_RATE
    const x = Array.from({ length: n }, (_, i) => eegSample(i / EEG_SAMPLE_RATE, { alpha: 1 }, zeroNoise))
    const p = measureBandPower(x, EEG_SAMPLE_RATE)
    expect(p.alpha).toBeGreaterThan(0.7)
    expect(p.delta).toBeLessThan(0.15)
  })

  it('与 eegResult 通道 0 是同一过程（一致性）', () => {
    const w = { delta: 0.3, theta: 0.5, alpha: 1.6, beta: 0.5, gamma: 0.3 }
    const r = eegResult({ state: 1, noise: 0, seed: 42, samples: 64 })
    for (const i of [0, 10, 33, 63]) {
      expect(eegSample(i / EEG_SAMPLE_RATE, w, zeroNoise)).toBe(r.channels[0][i])
    }
  })
})

describe('measureBandPower — 对信号的实测频带功率', () => {
  it('10 Hz 正弦 → 功率集中在 alpha 带（滤波+方差测量）', () => {
    const x = Array.from({ length: 4 * EEG_SAMPLE_RATE }, (_, i) =>
      Math.sin((2 * Math.PI * 10 * i) / EEG_SAMPLE_RATE))
    const p = measureBandPower(x, EEG_SAMPLE_RATE)
    expect(p.alpha).toBeGreaterThan(0.8)
    const sum = Object.values(p).reduce((s, v) => s + v, 0)
    expect(sum).toBeCloseTo(1, 9)
  })

  it('3 Hz 正弦 → delta 主导；40 Hz 正弦 → gamma/beta 高频段主导', () => {
    const lo = measureBandPower(
      Array.from({ length: 4 * EEG_SAMPLE_RATE }, (_, i) => Math.sin((2 * Math.PI * 3 * i) / EEG_SAMPLE_RATE)),
      EEG_SAMPLE_RATE)
    expect(lo.delta).toBeGreaterThan(0.7)
    const hi = measureBandPower(
      Array.from({ length: 4 * EEG_SAMPLE_RATE }, (_, i) => Math.sin((2 * Math.PI * 40 * i) / EEG_SAMPLE_RATE)),
      EEG_SAMPLE_RATE)
    expect(hi.gamma + hi.beta).toBeGreaterThan(0.9)
  })

  it('全零信号 → 功率全 0', () => {
    const p = measureBandPower(new Array(256).fill(0), EEG_SAMPLE_RATE)
    expect(Object.values(p).every((v) => v === 0)).toBe(true)
  })
})

describe('bandPower / dominantBand — 实测主导频带', () => {
  it('仅 alpha 权重 → 主导频带为 alpha，且其实测功率占绝大部分', () => {
    const w = { alpha: 1 }
    expect(dominantBand(w)).toBe('alpha')
    const p = bandPower(w)
    expect(p.alpha).toBeGreaterThan(0.7)
    expect(p.alpha).toBeLessThanOrEqual(1)
    expect(p.delta).toBeLessThan(0.2)
  })

  it('高 δ 权重（睡眠态）→ 主导频带为 delta', () => {
    expect(dominantBand({ delta: 3, theta: 0.5, alpha: 0.2 })).toBe('delta')
  })

  it('实测功率 ∝ 权重²：权重 2:1 → 功率约 4:1（含统计波动与带间泄漏容差）', () => {
    const p = bandPower({ beta: 2, alpha: 1 })
    expect(p.beta / p.alpha).toBeGreaterThan(2.5)
    expect(p.beta / p.alpha).toBeLessThan(6.5)
    const sum = Object.values(p).reduce((s, x) => s + x, 0)
    expect(sum).toBeCloseTo(1, 9)
  })

  it('功率排序跟随权重排序（实测而非回显输入）', () => {
    const p = bandPower({ delta: 0.5, theta: 1.5, alpha: 0.5, beta: 0.5, gamma: 0.5 })
    expect(p.theta).toBeGreaterThan(p.alpha)
    expect(p.theta).toBeGreaterThan(p.delta)
  })

  it('全 0 权重 → 主导频带为空串，功率全 0', () => {
    expect(dominantBand({})).toBe('')
    const p = bandPower({})
    expect(Object.values(p).every((x) => x === 0)).toBe(true)
  })
})

describe('eegResult — 场景接口与测量一致性', () => {
  const scene = { state: 1, noise: 0.4, seed: 7, samples: 512 }

  it('返回 4 通道 × samples、sampleRate、stateIndex、power、dominant', () => {
    const r = eegResult(scene)
    expect(r.channels).toHaveLength(4)
    r.channels.forEach((c) => expect(c).toHaveLength(512))
    expect(r.sampleRate).toBe(EEG_SAMPLE_RATE)
    expect(r.stateIndex).toBe(1)
    const sum = Object.values(r.power).reduce((s, v) => s + v, 0)
    expect(sum).toBeCloseTo(1, 9)
    for (const b of BANDS) {
      expect(r.power[b.name]).toBeGreaterThanOrEqual(0)
      expect(r.power[b.name]).toBeLessThanOrEqual(1)
    }
    expect(BANDS.map((b) => b.name)).toContain(r.dominant)
  })

  it('完全确定；seed 仅在 noise>0 时影响通道；noise=0 时与 seed 无关', () => {
    expect(eegResult(scene)).toEqual(eegResult(scene))
    expect(eegResult({ ...scene, seed: 8 }).channels).not.toEqual(eegResult(scene).channels)
    expect(eegResult({ ...scene, noise: 0, seed: 8 }).channels)
      .toEqual(eegResult({ ...scene, noise: 0 }).channels)
  })

  it('通道间独立（不同电极非相干成分）', () => {
    const r = eegResult({ ...scene, noise: 0 })
    expect(r.channels[0]).not.toEqual(r.channels[1])
  })

  it('实测主导频带跟随状态权重：清醒→β、闭眼→α、深睡→δ', () => {
    expect(eegResult({ state: 0, noise: 0.1, seed: 3, samples: 1024 }).dominant).toBe('beta')
    expect(eegResult({ state: 1, noise: 0.1, seed: 3, samples: 1024 }).dominant).toBe('alpha')
    expect(eegResult({ state: 3, noise: 0.1, seed: 3, samples: 1024 }).dominant).toBe('delta')
  })

  it('深睡态实测功率 δ>α>β（排序跟随权重）', () => {
    const p = eegResult({ state: 3, noise: 0.1, seed: 5, samples: 1024 }).power
    expect(p.delta).toBeGreaterThan(p.theta)
    expect(p.theta).toBeGreaterThan(p.alpha)
    expect(p.alpha).toBeGreaterThan(p.beta)
  })
})

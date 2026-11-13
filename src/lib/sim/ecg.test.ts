import { describe, it, expect } from 'vitest'
import { ecgWaveform, ecgResult, rrInterval, ECG_WAVES, ECG_SAMPLE_RATE } from './ecg'

// McSharry 动力学模型合成心电的生理学断言：
// R 峰检出心率、P/Q/R/S/T 形态与时序、QRS 随心率变窄、呼吸基线漂移。

const FS = ECG_SAMPLE_RATE

/** 简易 R 峰检测：>半幅的局部最大 + 250ms 不应期，返回样本索引 */
function rPeaks(values: number[]): number[] {
  const mx = Math.max(...values)
  const refractory = Math.round(0.25 * FS)
  const peaks: number[] = []
  for (let i = 1; i < values.length - 1; i++) {
    if (values[i] > 0.5 * mx && values[i] >= values[i - 1] && values[i] > values[i + 1]
      && (peaks.length === 0 || i - peaks[peaks.length - 1] > refractory)) peaks.push(i)
  }
  return peaks
}

/** 在 R 峰后 frac·T 偏移附近窗口内取极值，返回 [值, 相对 R 的相位偏移] */
function extremumNearR(v: number[], r0: number, T: number, lo: number, hi: number, which: 'max' | 'min') {
  let best = which === 'max' ? -Infinity : Infinity
  let bi = 0
  const a = Math.floor(r0 + lo * T * FS)
  const b = Math.min(v.length - 1, Math.ceil(r0 + hi * T * FS))
  for (let i = a; i <= b; i++) {
    if (which === 'max' ? v[i] > best : v[i] < best) { best = v[i]; bi = i }
  }
  return { value: best, phase: (bi - r0) / (T * FS) }
}

describe('rrInterval — RR 间期', () => {
  it('rrInterval = 60/hr', () => {
    expect(rrInterval(60)).toBeCloseTo(1.0, 6)
    expect(rrInterval(75)).toBeCloseTo(0.8, 6)
    expect(rrInterval(120)).toBeCloseTo(0.5, 6)
  })
})

describe('ecgResult — McSharry 合成结果形状', () => {
  it('样本数/采样率/标签/单位/来源字段', () => {
    const r = ecgResult({ hr: 75, samples: 480 })
    expect(r.values).toHaveLength(480)
    expect(r.sampleRate).toBe(FS)
    expect(r.bpm).toBe(75)
    expect(r.rr).toBeCloseTo(0.8, 6)
    expect(r.source).toBe('synthetic')
    expect(r.unit).toBe('mV')
    expect(r.label).toBe('Lead II')
    expect(Number.isFinite(r.mean)).toBe(true)
    expect(r.rms).toBeGreaterThan(0)
  })

  it('完全确定：同一 scene 两次结果一致', () => {
    expect(ecgResult({ hr: 75, samples: 512 })).toEqual(ecgResult({ hr: 75, samples: 512 }))
  })

  it('ecgWaveform 与逐样本 RK4 输出一致（同一积分路径）', () => {
    const hr = 72
    const r = ecgResult({ hr, samples: 240 })
    for (let i = 0; i < 240; i += 17) {
      expect(r.values[i]).toBeCloseTo(ecgWaveform(i / FS, hr), 2)
    }
  })
})

describe('McSharry 心电 — 心率与 R 峰', () => {
  it('R 峰检出心率与 hr 参数一致（θ̇≡ω 精确成立）', () => {
    for (const hr of [60, 75, 120]) {
      const r = ecgResult({ hr, samples: 1440 })
      const peaks = rPeaks(r.values)
      const expected = (1440 / FS) * (hr / 60)
      expect(Math.abs(peaks.length - expected)).toBeLessThanOrEqual(1)
      const rrs = peaks.slice(1).map((p, i) => (p - peaks[i]) / FS)
      const meanRR = rrs.reduce((s, x) => s + x, 0) / rrs.length
      expect(meanRR).toBeCloseTo(rrInterval(hr), 2)
    }
  })

  it('R 峰幅度 ≈1 mV（标定增益），为全局最大', () => {
    const r = ecgResult({ hr: 75, samples: 960 })
    const mx = Math.max(...r.values)
    expect(mx).toBeGreaterThan(0.85)
    expect(mx).toBeLessThan(1.25)
  })

  it('心率升高时 QRS 变窄（ecgsyn 形态缩放 = 真实 QT 缩短）', () => {
    const width = (hr: number) => {
      const r = ecgResult({ hr, samples: 1440 })
      const v = r.values
      const pk = v.indexOf(Math.max(...v))
      const half = v[pk] / 2
      let lo = pk, hi = pk
      while (lo > 0 && v[lo] > half) lo--
      while (hi < v.length - 1 && v[hi] > half) hi++
      return (hi - lo) / FS
    }
    expect(width(120)).toBeLessThan(width(60))
  })
})

describe('McSharry 心电 — PQRST 形态', () => {
  const hr = 75
  const T = rrInterval(hr)
  const r = ecgResult({ hr, samples: 1440 })
  const r0 = rPeaks(r.values)[1] // 取第二个 R 峰，前后窗口完整

  it('P→Q→R→S→T 时间次序正确', () => {
    const P = extremumNearR(r.values, r0, T, -0.3, -0.08, 'max')
    const Q = extremumNearR(r.values, r0, T, -0.08, -0.005, 'min')
    const S = extremumNearR(r.values, r0, T, 0.005, 0.1, 'min')
    const Tw = extremumNearR(r.values, r0, T, 0.1, 0.4, 'max')
    expect(P.phase).toBeLessThan(Q.phase)
    expect(Q.phase).toBeLessThan(0)
    expect(S.phase).toBeGreaterThan(0)
    expect(S.phase).toBeLessThan(Tw.phase)
  })

  it('P 为正相小波、Q/S 为 R 两侧负偏、T 为 R 后正相圆波', () => {
    const P = extremumNearR(r.values, r0, T, -0.3, -0.08, 'max')
    const Q = extremumNearR(r.values, r0, T, -0.08, -0.005, 'min')
    const S = extremumNearR(r.values, r0, T, 0.005, 0.1, 'min')
    const Tw = extremumNearR(r.values, r0, T, 0.1, 0.4, 'max')
    const R = r.values[r0]
    expect(P.value).toBeGreaterThan(0.03)
    expect(P.value).toBeLessThan(0.45)
    expect(Q.value).toBeLessThan(-0.05)
    expect(S.value).toBeLessThan(-0.1)
    expect(Tw.value).toBeGreaterThan(0.1)
    expect(Tw.value).toBeLessThan(0.7)
    // QRS 不对称：S 谷深于 Q（导联 II 典型形态）
    expect(S.value).toBeLessThan(Q.value)
    // P、T 都明显低于 R
    expect(P.value).toBeLessThan(0.5 * R)
    expect(Tw.value).toBeLessThan(0.7 * R)
  })

  it('QRS 比 T 波窄得多（高尖 vs 圆钝）', () => {
    const v = r.values
    const half = v[r0] / 2
    let lo = r0, hi = r0
    while (v[lo] > half) lo--
    while (v[hi] > half) hi++
    const qrsW = (hi - lo) / FS
    const Tw = extremumNearR(v, r0, T, 0.1, 0.4, 'max')
    const thalf = Tw.value / 2
    let tl = r0 + Math.round(Tw.phase * T * FS), tr = tl
    while (tl > r0 && v[tl] > thalf) tl--
    while (tr < v.length - 1 && v[tr] > thalf) tr++
    const tW = (tr - tl) / FS
    expect(tW).toBeGreaterThan(2 * qrsW)
  })
})

describe('McSharry 心电 — 基线漂移与 ECG_WAVES 标注表', () => {
  it('同相位处不同心搏间基线有小幅漂移（呼吸性 z₀ 调制），且漂移有界', () => {
    const hr = 72
    const T = rrInterval(hr)
    const vs = [0, 1, 2, 3, 4, 5].map((b) => ecgWaveform(0.1 * T + b * T, hr))
    const spread = Math.max(...vs) - Math.min(...vs)
    expect(spread).toBeGreaterThan(0.02)
    expect(spread).toBeLessThan(0.5)
  })

  it('ECG_WAVES.R.mu 相位处即 R 峰（外部标注/registry 兼容）', () => {
    const hr = 72
    const T = rrInterval(hr)
    expect(ecgWaveform(ECG_WAVES.R.mu * T, hr)).toBeGreaterThan(0.85)
    // P/T 标称相位处也应有对应正相波
    expect(ecgWaveform(ECG_WAVES.P.mu * T, hr)).toBeGreaterThan(0)
    expect(ecgWaveform(ECG_WAVES.T.mu * T, hr)).toBeGreaterThan(0.05)
  })
})

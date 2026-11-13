/**
 * 生物电信号 · ECG / EMG / EEG 纯函数算法样例入口。
 * 对应 method-algo-ecg-wave / method-algo-emg-signal / method-algo-eeg-rhythm。
 * 一律委托 ecg.ts / emg.ts / eeg.ts 已导出核心，不重实现、不碰 methods.data。
 */
import { ECG_WAVES, ecgWaveform, rrInterval } from './ecg'
import { emgRMS, emgSample } from './emg'
import { bandPower, dominantBand, eegSample } from './eeg'

export const BIOSIG_PARENT = 'method-bioelectric'

export type BiosigAlgoId = 'ecg-wave' | 'emg-signal' | 'eeg-rhythm'

/** 与目录对齐的算法 method id（纯代码侧常量，不读 methods.data）。 */
export const BIOSIG_ALGO_METHOD_IDS: Record<BiosigAlgoId, string> = {
  'ecg-wave': 'method-algo-ecg-wave',
  'emg-signal': 'method-algo-emg-signal',
  'eeg-rhythm': 'method-algo-eeg-rhythm',
}

/** 确定性伪随机 ∈ [0,1)（LCG）。 */
function seededRng(seed0: number): () => number {
  let seed = seed0 >>> 0
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
}

function variance(xs: number[]): number {
  const n = xs.length
  if (n <= 0) return 0
  let m = 0
  for (let i = 0; i < n; i++) m += xs[i]!
  m /= n
  let s = 0
  for (let i = 0; i < n; i++) {
    const d = xs[i]! - m
    s += d * d
  }
  return s / n
}

function peakAbs(xs: number[]): number {
  let p = 0
  for (let i = 0; i < xs.length; i++) {
    const a = Math.abs(xs[i]!)
    if (a > p) p = a
  }
  return p
}

function allFinite(xs: number[]): boolean {
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(xs[i]!)) return false
  }
  return true
}

/**
 * ECG 导联波形样例（method-algo-ecg-wave）：
 * 在若干 RR 周期内密采样 ecgWaveform，记录 R 峰幅度/相位与方差。
 */
export function runEcgSample(
  hr = 75,
  cycles = 3,
  samplesPerCycle = 500,
): {
  length: number
  peak: number
  peakPhase: number
  rMu: number
  variance: number
  finite: boolean
  hr: number
  rr: number
} {
  const rr = rrInterval(hr)
  const n = Math.max(1, Math.floor(cycles * samplesPerCycle))
  const xs = new Array<number>(n)
  let peak = -Infinity
  let peakPhase = 0
  for (let i = 0; i < n; i++) {
    const t = (i / samplesPerCycle) * rr
    const v = ecgWaveform(t, hr)
    xs[i] = v
    if (v > peak) {
      peak = v
      // 归一化到单周期相位 0..1
      peakPhase = (t % rr) / rr
      if (peakPhase < 0) peakPhase += 1
    }
  }
  return {
    length: n,
    peak,
    peakPhase,
    rMu: ECG_WAVES.R.mu,
    variance: variance(xs),
    finite: allFinite(xs),
    hr,
    rr,
  }
}

/**
 * EMG 肌电样例（method-algo-emg-signal）：
 * 低/高激活下 emgSample 轨迹与 emgRMS；高激活方差与 RMS 应更大。
 */
export function runEmgSample(
  n = 2000,
  actLow = 0.15,
  actHigh = 0.9,
  seed = 42,
): {
  length: number
  rmsLow: number
  rmsHigh: number
  varianceLow: number
  varianceHigh: number
  peakHigh: number
  finite: boolean
} {
  const rngTrace = seededRng(seed)
  const low: number[] = new Array(n)
  const high: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    low[i] = emgSample(actLow, rngTrace)
    high[i] = emgSample(actHigh, rngTrace)
  }
  // 独立种子给 RMS，与 emg.test 同口径
  const rmsLow = emgRMS(actLow, n, seededRng(seed + 1))
  const rmsHigh = emgRMS(actHigh, n, seededRng(seed + 1))
  return {
    length: n,
    rmsLow,
    rmsHigh,
    varianceLow: variance(low),
    varianceHigh: variance(high),
    peakHigh: peakAbs(high),
    finite: allFinite(low) && allFinite(high),
  }
}

/**
 * EEG 节律样例（method-algo-eeg-rhythm）：
 * 合成 α 主导信号，检验主导频带、峰值与方差（shipped eegSample/bandPower）。
 */
export function runEegSample(
  n = 1000,
  fs = 250,
  weights: Record<string, number> = { alpha: 1.5, beta: 0.3, theta: 0.2 },
  seed = 7,
): {
  length: number
  peak: number
  variance: number
  dominant: string
  powers: Record<string, number>
  finite: boolean
  fs: number
} {
  const rng = seededRng(seed)
  const xs = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    xs[i] = eegSample(i / fs, weights, rng)
  }
  return {
    length: n,
    peak: peakAbs(xs),
    variance: variance(xs),
    dominant: dominantBand(weights),
    powers: bandPower(weights),
    finite: allFinite(xs),
    fs,
  }
}

/** 按算法键分发样例（纯入口，不查 methods 表）。 */
export function runBiosigAlgo(id: BiosigAlgoId): object {
  switch (id) {
    case 'ecg-wave':
      return runEcgSample()
    case 'emg-signal':
      return runEmgSample()
    case 'eeg-rhythm':
      return runEegSample()
  }
}

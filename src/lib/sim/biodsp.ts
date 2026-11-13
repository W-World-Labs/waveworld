import { rng as seededRng } from '../mc'
import { ecgWaveform } from './ecg'
import { emgSample } from './emg'
import { eegSample } from './eeg'

// 生物电信号链路 —— 采集 DSP 纯函数集
//
// 生物电（ECG/EMG/EEG）采集的典型处理链：
//   原始信号 → 差分放大(amplify) → 去基线(removeDC) → 带通/平滑(movingAverage)
//            → 工频陷波(notch, 50Hz) → 数字化/显示
//
// 本模块只提供对 number[] 信号的纯函数（无 React、无副作用、可导出），
// 供页面动画与 vitest 测试复用。

/** 序列均值 */
export function mean(x: number[]): number {
  if (x.length === 0) return 0
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i]
  return s / x.length
}

/** 序列方差（总体方差，除以 N） */
export function variance(x: number[]): number {
  if (x.length === 0) return 0
  const m = mean(x)
  let s = 0
  for (let i = 0; i < x.length; i++) {
    const d = x[i] - m
    s += d * d
  }
  return s / x.length
}

/**
 * 去基线 / 去直流分量：减去整段均值。
 * 处理后均值 ≈ 0（消除电极极化带来的恒定偏置）。
 */
export function removeDC(x: number[]): number[] {
  const m = mean(x)
  return x.map((v) => v - m)
}

/**
 * 差分放大：整体乘以增益（模拟差分放大器对微弱生物电的放大）。
 * gain 为线性倍数（如 ECG 典型 1000×）。
 */
export function amplify(x: number[], gain: number): number[] {
  return x.map((v) => v * gain)
}

/**
 * 滑动平均（低通平滑）：以 win 为窗长的居中移动平均。
 * 抑制高频噪声 → 降低信号方差。win<=1 时原样返回。
 */
export function movingAverage(x: number[], win: number): number[] {
  const n = x.length
  if (win <= 1 || n === 0) return x.slice()
  const half = Math.floor(win / 2)
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    let cnt = 0
    for (let j = i - half; j <= i + half; j++) {
      if (j >= 0 && j < n) {
        s += x[j]
        cnt++
      }
    }
    out[i] = s / cnt
  }
  return out
}

/**
 * 工频陷波滤波器：衰减 f0（如 50Hz 工频）附近的窄带分量。
 *
 * 采用经典二阶 IIR 陷波（notch / band-stop）双二阶节，零点恰在 ±f0：
 *   传递函数 H(z) = b0·(1 - 2cosω0·z⁻¹ + z⁻²) / (1 - 2r·cosω0·z⁻¹ + r²·z⁻²)
 * r 越接近 1，陷波越窄、对其它频率影响越小。
 *
 * @param x   输入信号
 * @param fs  采样率(Hz)
 * @param f0  陷波中心频率(Hz)，如 50
 */
export function notch(x: number[], fs: number, f0: number): number[] {
  const n = x.length
  if (n === 0) return []
  const w0 = (2 * Math.PI * f0) / fs
  const cosw = Math.cos(w0)
  const r = 0.985 // 极点半径：越接近 1 陷波越尖锐

  // 零点在单位圆上 (半径 1)，极点在半径 r 上，角度同为 ±ω0
  const b0 = 1
  const b1 = -2 * cosw
  const b2 = 1
  const a1 = -2 * r * cosw
  const a2 = r * r

  // 直接 II 型转置结构滤波
  const out = new Array<number>(n)
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < n; i++) {
    const xi = x[i]
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    out[i] = yi
    x2 = x1
    x1 = xi
    y2 = y1
    y1 = yi
  }
  return out
}

/**
 * 估计信号在频率 f 处的能量（通过与该频率正弦/余弦相关，
 * 即单点 DFT 的幅度平方）。用于比较陷波前后某频率分量强弱。
 */
export function powerAt(x: number[], fs: number, f: number): number {
  const n = x.length
  if (n === 0) return 0
  let re = 0
  let im = 0
  for (let i = 0; i < n; i++) {
    const ph = (2 * Math.PI * f * i) / fs
    re += x[i] * Math.cos(ph)
    im += x[i] * Math.sin(ph)
  }
  re /= n
  im /= n
  return re * re + im * im
}

export type BioPipelineScene = { source: 'ECG' | 'EMG' | 'EEG'; seed: number }
export const BIO_SAMPLES = 600, BIO_SAMPLE_RATE = 1000, BIO_NOTCH_HZ = 50, BIO_SMOOTH_WINDOW = 7, BIO_GAIN = 40
export function bioPipelineResult(scene: BioPipelineScene) {
  const random = seededRng(scene.seed)
  const raw = Array.from({ length: BIO_SAMPLES }, (_, i) => {
    const t = i / BIO_SAMPLE_RATE
    const signal = scene.source === 'ECG' ? ecgWaveform(t, 75) + 0.06 * (random() - 0.5)
      : scene.source === 'EMG' ? emgSample(0.5 + 0.5 * Math.sin(3 * Math.PI * t), random)
        : eegSample(t, { alpha: 0.35, theta: 0.25 }, random)
    return signal + 0.6 + 0.5 * Math.sin(2 * Math.PI * BIO_NOTCH_HZ * t)
  })
  const amp = amplify(raw, BIO_GAIN), dc = removeDC(amp), smooth = movingAverage(dc, BIO_SMOOTH_WINDOW)
  const filtered = notch(smooth, BIO_SAMPLE_RATE, BIO_NOTCH_HZ)
  return { series: [raw, amp, dc, smooth, filtered], rawMean: mean(raw),
    rawPeak: Math.max(...raw.map(Math.abs)), finalPeak: Math.max(...filtered.map(Math.abs)) }
}

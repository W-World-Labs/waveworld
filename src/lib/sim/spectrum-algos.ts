/**
 * 频谱观测方法族 · 电磁 / 声 / 振动 并行谱带纯函数入口。
 * 对应 method-spectrum-viewer 下 spectrum-band 并行变体：
 *   method-algo-spectrum-em | method-algo-spectrum-sound | method-algo-spectrum-vibration
 * 不编辑 methods.data；真实 f–λ–波速关系：product = f·λ ≈ 波速。
 */
import { childrenOf, parallelGroup } from '../../data/methods/methods'

export const SPECTRUM_PARENT = 'method-spectrum-viewer'
export const SPECTRUM_BAND_GROUP = 'spectrum-band'

/** 并行谱带种类（与三个 parallel-variant 对齐）。 */
export type SpectrumBandKind = 'em' | 'sound' | 'vibration'

export const SPECTRUM_BAND_METHOD_IDS: Record<SpectrumBandKind, string> = {
  em: 'method-algo-spectrum-em',
  sound: 'method-algo-spectrum-sound',
  vibration: 'method-algo-spectrum-vibration',
}

/** 真空中电磁波速（教学用 3e8 m/s）。 */
export const C_EM = 3e8

/** 空气中声速代表值（20 °C 附近）m/s。 */
export const V_SOUND = 343

export type SpectrumBandSample = {
  f: number
  lambda: number
  /** f · λ，应接近该谱带波速 */
  product: number
  kind: SpectrumBandKind
}

// ── 频率–波长 纯助手 ────────────────────────────────────────────────────────

/** 电磁波：f = c / λ。 */
export function emFreqFromLambda(lambda: number, c: number = C_EM): number {
  if (!(lambda > 0)) throw new Error('lambda must be positive')
  return c / lambda
}

/** 电磁波：λ = c / f。 */
export function emLambdaFromFreq(f: number, c: number = C_EM): number {
  if (!(f > 0)) throw new Error('f must be positive')
  return c / f
}

/** 声波：f = v / λ。 */
export function soundFreqFromLambda(lambda: number, v: number = V_SOUND): number {
  if (!(lambda > 0)) throw new Error('lambda must be positive')
  return v / lambda
}

/** 声波：λ = v / f。 */
export function soundLambdaFromFreq(f: number, v: number = V_SOUND): number {
  if (!(f > 0)) throw new Error('f must be positive')
  return v / f
}

/**
 * 弦振动第 n 阶模态频率：
 *   f_n = (n / (2L)) · √(T/μ)
 * L 长度 (m)，T 张力 (N)，μ 线密度 (kg/m)，n 正整数。
 */
export function stringModalFreq(
  n: number,
  L: number,
  T: number,
  mu: number,
): number {
  if (!(n >= 1) || !Number.isFinite(n)) throw new Error('n must be ≥ 1')
  if (!(L > 0) || !(T > 0) || !(mu > 0)) throw new Error('L, T, mu must be positive')
  return (n / (2 * L)) * Math.sqrt(T / mu)
}

/** 弦上第 n 阶波长：λ_n = 2L / n。 */
export function stringModalLambda(n: number, L: number): number {
  if (!(n >= 1) || !Number.isFinite(n)) throw new Error('n must be ≥ 1')
  if (!(L > 0)) throw new Error('L must be positive')
  return (2 * L) / n
}

/** 弦上波速 v = √(T/μ)。 */
export function stringWaveSpeed(T: number, mu: number): number {
  if (!(T > 0) || !(mu > 0)) throw new Error('T, mu must be positive')
  return Math.sqrt(T / mu)
}

/**
 * 简谐振子固有频率：f = √(k/m) / (2π)。
 * k 刚度 (N/m)，m 质量 (kg)。
 */
export function shoFreq(k: number, m: number): number {
  if (!(k > 0) || !(m > 0)) throw new Error('k, m must be positive')
  return Math.sqrt(k / m) / (2 * Math.PI)
}

// ── 代表样例 ────────────────────────────────────────────────────────────────

/**
 * 按谱带种类跑代表 f–λ 样例；product = f·λ 应 ≈ 波速。
 * - em：可见光 λ=500 nm，c=3e8
 * - sound：中频 λ=1 m，v=343
 * - vibration：弦基模（L=1, T=100, μ=0.01）→ v=√(T/μ)=100
 */
export function runSpectrumBandSample(kind: SpectrumBandKind): SpectrumBandSample {
  switch (kind) {
    case 'em': {
      // 可见光中心附近 500 nm
      const lambda = 500e-9
      const f = emFreqFromLambda(lambda)
      return { f, lambda, product: f * lambda, kind }
    }
    case 'sound': {
      // ~343 Hz 中低频，λ = 1 m
      const lambda = 1
      const f = soundFreqFromLambda(lambda)
      return { f, lambda, product: f * lambda, kind }
    }
    case 'vibration': {
      // 弦基模：v = √(T/μ) = 100 m/s，f₁ = v/(2L) = 50 Hz，λ₁ = 2L = 2 m
      const L = 1
      const T = 100
      const mu = 0.01
      const n = 1
      const f = stringModalFreq(n, L, T, mu)
      const lambda = stringModalLambda(n, L)
      return { f, lambda, product: f * lambda, kind }
    }
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

/** 三谱带并行：各跑一次代表样例。 */
export function compareSpectrumBands(): Record<SpectrumBandKind, SpectrumBandSample> {
  return {
    em: runSpectrumBandSample('em'),
    sound: runSpectrumBandSample('sound'),
    vibration: runSpectrumBandSample('vibration'),
  }
}

/** 该 kind 对应的期望波速（product 对拍目标）。 */
export function expectedWaveSpeed(kind: SpectrumBandKind): number {
  switch (kind) {
    case 'em':
      return C_EM
    case 'sound':
      return V_SOUND
    case 'vibration':
      // 与 runSpectrumBandSample('vibration') 默认 T, μ 一致
      return stringWaveSpeed(100, 0.01)
    default: {
      const _exhaustive: never = kind
      return _exhaustive
    }
  }
}

export function spectrumChildCount(): number {
  return childrenOf(SPECTRUM_PARENT).length
}

export function spectrumBandParallelCount(): number {
  return parallelGroup(SPECTRUM_BAND_GROUP).length
}

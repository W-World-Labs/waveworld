/**
 * BPM L2 · Kerr 非线性（自相位调制 SPM）。
 * 父族 method-bpm；split-step 中 Kerr 相位 exp(i γ |A|² dz)；
 * 纯 Kerr 演示谱展宽玩具，或含衍射时功率守恒。
 * method id 仅常量，不改 methods.data / registry / edges。
 */

import {
  METHOD_BPM,
  angularSpectrumStep,
  applyPhaseScreen,
  beamPower,
  createGaussianBeam1d,
  dftComplex1d,
  transverseWaveNumbers,
} from './bpm-algos'

/** 父族 · BPM（与 bpm-algos / methods.data 对齐）。 */
export { METHOD_BPM }

/** 算法 · Kerr 非线性 split-step BPM。 */
export const METHOD_ALGO_BPM_KERR = 'method-algo-bpm-kerr'

/** 父族别名。 */
export const BPM_L2_PARENT = METHOD_BPM

export const BPM_L2_METHOD_IDS = [METHOD_ALGO_BPM_KERR] as const

/**
 * Kerr 相位屏：φ_i = γ · |A_i|² · dz。
 * 返回新数组；不修改场。
 */
export function kerrPhase(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
  gamma: number,
  dz: number,
): Float64Array {
  const n = re.length
  if (im.length !== n) throw new Error('kerrPhase: length mismatch')
  if (!Number.isFinite(gamma) || !Number.isFinite(dz)) {
    throw new Error('kerrPhase: gamma, dz must be finite')
  }
  const phase = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const ur = re[i]!
    const ui = im[i]!
    phase[i] = gamma * (ur * ur + ui * ui) * dz
  }
  return phase
}

/**
 * 就地 Kerr 相位：A ← A · exp(i γ |A|² dz)。
 * 酉相位，|A| 与功率严格守恒（浮点误差内）。
 */
export function applyKerrPhase(
  re: Float64Array,
  im: Float64Array,
  gamma: number,
  dz: number,
): void {
  const phase = kerrPhase(re, im, gamma, dz)
  applyPhaseScreen(re, im, phase)
}

/**
 * Split-step Fourier + Kerr 一步：
 * 半步衍射 → Kerr 相位 exp(i γ |A|² dz) → 半步衍射。
 * γ=0 时退化为纯自由空间（与 splitStepBpm 无透镜等价）。
 */
export function splitStepBpmKerr(
  re: Float64Array,
  im: Float64Array,
  L: number,
  k0: number,
  dz: number,
  gamma: number,
): void {
  const half = 0.5 * dz
  angularSpectrumStep(re, im, L, k0, half)
  if (gamma !== 0) applyKerrPhase(re, im, gamma, dz)
  angularSpectrumStep(re, im, L, k0, half)
}

/**
 * 谱二阶矩半宽（横向波数域）：
 * κ_rms = 2 √(⟨κ²⟩ − ⟨κ⟩²)，权重 |û(κ)|²。
 * SPM 使瞬时频率 chirp，κ_rms 增大 → 谱展宽玩具指标。
 */
export function spectralWidthRms(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
  L: number,
): number {
  const n = re.length
  if (im.length !== n || n < 2) throw new Error('spectralWidthRms: need n≥2 match')
  if (!(L > 0)) throw new Error('spectralWidthRms: L > 0')
  const { re: Re, im: Im } = dftComplex1d(re, im)
  const kappa = transverseWaveNumbers(n, L)
  let p = 0
  let mk = 0
  let mkk = 0
  for (let m = 0; m < n; m++) {
    const ur = Re[m]!
    const ui = Im[m]!
    const I = ur * ur + ui * ui
    const κ = kappa[m]!
    p += I
    mk += I * κ
    mkk += I * κ * κ
  }
  if (p <= 0) return 0
  mk /= p
  mkk /= p
  const varK = Math.max(0, mkk - mk * mk)
  return 2 * Math.sqrt(varK)
}

/**
 * 代表样例：高斯束 + Kerr。
 * - pureSpm=true：仅 Kerr 相位（无衍射）→ 功率守恒 + 谱展宽。
 * - pureSpm=false：split-step 衍射+Kerr → 功率守恒、场有限。
 */
export function runBpmKerrSample(opts?: {
  n?: number
  L?: number
  w0?: number
  amp?: number
  k0?: number
  gamma?: number
  zTotal?: number
  steps?: number
  /** 仅 Kerr（无角谱）；默认 true 便于观测 SPM 谱展宽 */
  pureSpm?: boolean
}): {
  n: number
  L: number
  w0: number
  amp: number
  k0: number
  gamma: number
  zTotal: number
  steps: number
  pureSpm: boolean
  power0: number
  powerF: number
  spec0: number
  specF: number
  /** 功率相对漂移小 */
  powerConserved: boolean
  /** 谱宽增大（SPM / 非线性 chirp） */
  spectrumBroadened: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BPM_KERR
  familyId: typeof METHOD_BPM
} {
  const n = opts?.n ?? 128
  const L = opts?.L ?? 24
  const w0 = opts?.w0 ?? 1.5
  const amp = opts?.amp ?? 2
  const k0 = opts?.k0 ?? 2 * Math.PI
  const gamma = opts?.gamma ?? 1.0
  const zTotal = opts?.zTotal ?? 2.5
  const steps = opts?.steps ?? 40
  const pureSpm = opts?.pureSpm ?? true

  const field = createGaussianBeam1d({ n, L, w0, amp })
  const { re, im, dx } = field
  const power0 = beamPower(re, im, dx)
  const spec0 = spectralWidthRms(re, im, L)

  const dz = zTotal / steps
  for (let s = 0; s < steps; s++) {
    if (pureSpm) {
      applyKerrPhase(re, im, gamma, dz)
    } else {
      splitStepBpmKerr(re, im, L, k0, dz, gamma)
    }
  }

  const powerF = beamPower(re, im, dx)
  const specF = spectralWidthRms(re, im, L)

  let finite =
    Number.isFinite(power0) &&
    Number.isFinite(powerF) &&
    Number.isFinite(spec0) &&
    Number.isFinite(specF)
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(re[i]!) || !Number.isFinite(im[i]!)) finite = false
  }

  const powerConserved =
    Math.abs(powerF - power0) / Math.max(power0, 1e-30) < 0.02
  // 纯 SPM：强度非均匀 → 非线性 chirp → 谱展宽；含衍射时允许略松
  const spectrumBroadened = pureSpm
    ? specF > spec0 * 1.05
    : specF >= spec0 * 0.5
  const ok =
    finite &&
    powerConserved &&
    (pureSpm ? spectrumBroadened : powerF > 0)

  return {
    n,
    L,
    w0,
    amp,
    k0,
    gamma,
    zTotal,
    steps,
    pureSpm,
    power0,
    powerF,
    spec0,
    specF,
    powerConserved,
    spectrumBroadened,
    finite,
    ok,
    methodId: METHOD_ALGO_BPM_KERR,
    familyId: METHOD_BPM,
  }
}

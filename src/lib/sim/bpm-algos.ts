/**
 * Beam Propagation Method（BPM）· 傍轴 split-step Fourier。
 * 横向 1D 包络 u(x,z)：半步衍射（角谱）+ 折射率/非线性相位 + 半步衍射；
 * 亦可纯自由空间 Fresnel / angular-spectrum 整步。
 * method id 仅常量，不改 methods.data / registry / edges。
 */

/** 父族 · BPM。 */
export const METHOD_BPM = 'method-bpm'

/** 算法 · split-step Fourier BPM。 */
export const METHOD_ALGO_BPM_SPLIT_STEP = 'method-algo-bpm-split-step'

export const BPM_METHOD_IDS = [METHOD_ALGO_BPM_SPLIT_STEP] as const

/** 复场（横向格点）。 */
export interface ComplexField1d {
  readonly n: number
  /** 物理域长度 L（周期格，x∈[−L/2, L/2)）。 */
  readonly L: number
  readonly dx: number
  readonly re: Float64Array
  readonly im: Float64Array
}

/** 傍轴波数 k0 = 2π / λ（约化单位常取 λ=1 → k0=2π）。 */
export interface BpmParams {
  readonly k0: number
}

/**
 * 傅里叶波数 κ_m（物理域长度 L）。
 * m=0..n−1 映射到 [−⌊(n−1)/2⌋ .. ⌊n/2⌋]；偶 n 时 Nyquist 保留。
 */
export function transverseWaveNumbers(n: number, L: number): Float64Array {
  if (!(n >= 2) || !Number.isInteger(n)) {
    throw new Error('transverseWaveNumbers: n integer ≥ 2')
  }
  if (!(L > 0)) throw new Error('transverseWaveNumbers: L > 0')
  const kappa = new Float64Array(n)
  for (let m = 0; m < n; m++) {
    const k = m <= n / 2 ? m : m - n
    kappa[m] = (2 * Math.PI * k) / L
  }
  return kappa
}

/** 复序列朴素 DFT：X[k]=Σ_n x[n] exp(−2π i k n / N)。 */
export function dftComplex1d(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
): { re: Float64Array; im: Float64Array } {
  const n = re.length
  if (n < 2 || im.length !== n) throw new Error('dftComplex1d: length mismatch / need ≥ 2')
  const outRe = new Float64Array(n)
  const outIm = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    let rk = 0
    let ik = 0
    for (let j = 0; j < n; j++) {
      const ang = (-2 * Math.PI * k * j) / n
      const c = Math.cos(ang)
      const s = Math.sin(ang)
      const xr = re[j]!
      const xi = im[j]!
      // (xr+i xi)(c+i s) with s = sin(−θ) = −sin θ… ang already negative
      rk += xr * c - xi * s
      ik += xr * s + xi * c
    }
    outRe[k] = rk
    outIm[k] = ik
  }
  return { re: outRe, im: outIm }
}

/** 逆 DFT（含 1/N）：x[n]=(1/N) Σ_k X[k] exp(+2π i k n / N)。 */
export function idftComplex1d(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
): { re: Float64Array; im: Float64Array } {
  const n = re.length
  if (n < 2 || im.length !== n) throw new Error('idftComplex1d: length mismatch / need ≥ 2')
  const outRe = new Float64Array(n)
  const outIm = new Float64Array(n)
  for (let j = 0; j < n; j++) {
    let rj = 0
    let ij = 0
    for (let k = 0; k < n; k++) {
      const ang = (2 * Math.PI * k * j) / n
      const c = Math.cos(ang)
      const s = Math.sin(ang)
      const Xr = re[k]!
      const Xi = im[k]!
      rj += Xr * c - Xi * s
      ij += Xr * s + Xi * c
    }
    outRe[j] = rj / n
    outIm[j] = ij / n
  }
  return { re: outRe, im: outIm }
}

/**
 * 角谱 / Fresnel 衍射整步（谱域）：
 * û(κ) ← û(κ) · exp(−i κ² Δz / (2 k0))
 * 傍轴自由空间传播算子。
 */
export function angularSpectrumStep(
  re: Float64Array,
  im: Float64Array,
  L: number,
  k0: number,
  dz: number,
): void {
  if (!(k0 > 0)) throw new Error('angularSpectrumStep: k0 > 0')
  const n = re.length
  if (im.length !== n) throw new Error('angularSpectrumStep: length mismatch')
  const { re: Re, im: Im } = dftComplex1d(re, im)
  const kappa = transverseWaveNumbers(n, L)
  for (let m = 0; m < n; m++) {
    const κ = kappa[m]!
    // phase φ = −κ² dz / (2 k0)
    const phi = (-(κ * κ) * dz) / (2 * k0)
    const c = Math.cos(phi)
    const s = Math.sin(phi)
    const ur = Re[m]!
    const ui = Im[m]!
    Re[m] = ur * c - ui * s
    Im[m] = ur * s + ui * c
  }
  const inv = idftComplex1d(Re, Im)
  re.set(inv.re)
  im.set(inv.im)
}

/**
 * 实空间相位：u ← u · exp(i · phase(x))，phase 数组与格点对齐。
 * 折射率：phase = k0 · Δn(x) · dz；Kerr：phase = γ |u|² dz 等。
 */
export function applyPhaseScreen(
  re: Float64Array,
  im: Float64Array,
  phase: ArrayLike<number>,
): void {
  const n = re.length
  if (im.length !== n || phase.length !== n) {
    throw new Error('applyPhaseScreen: length mismatch')
  }
  for (let i = 0; i < n; i++) {
    const phi = phase[i]!
    const c = Math.cos(phi)
    const s = Math.sin(phi)
    const ur = re[i]!
    const ui = im[i]!
    re[i] = ur * c - ui * s
    im[i] = ur * s + ui * c
  }
}

/**
 * Split-step Fourier 一步：
 * 半步衍射 → 折射率/非线性相位 → 半步衍射。
 * deltaN[i] 为 Δn(x)；缺省 0（纯自由空间，等价整步角谱）。
 */
export function splitStepBpm(
  re: Float64Array,
  im: Float64Array,
  L: number,
  k0: number,
  dz: number,
  deltaN?: ArrayLike<number> | null,
): void {
  const half = 0.5 * dz
  angularSpectrumStep(re, im, L, k0, half)
  if (deltaN && deltaN.length === re.length) {
    const phase = new Float64Array(re.length)
    for (let i = 0; i < re.length; i++) {
      phase[i] = k0 * deltaN[i]! * dz
    }
    applyPhaseScreen(re, im, phase)
  }
  angularSpectrumStep(re, im, L, k0, half)
}

/**
 * 一维高斯束腰：u(x) = A exp(−x²/w0²)（复振幅实值初场）。
 * 强度 |u|² 的 1/e² 半宽为 w0。
 */
export function createGaussianBeam1d(opts?: {
  n?: number
  L?: number
  w0?: number
  amp?: number
}): ComplexField1d {
  const n = opts?.n ?? 128
  const L = opts?.L ?? 20
  const w0 = opts?.w0 ?? 1.2
  const amp = opts?.amp ?? 1
  if (!(n >= 8) || !Number.isInteger(n)) throw new Error('createGaussianBeam1d: n integer ≥ 8')
  if (!(L > 0) || !(w0 > 0)) throw new Error('createGaussianBeam1d: L,w0 > 0')
  const dx = L / n
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    // x ∈ [−L/2, L/2)
    const x = (i + 0.5) * dx - L / 2
    const r = x / w0
    re[i] = amp * Math.exp(-r * r)
    im[i] = 0
  }
  return { n, L, dx, re, im }
}

/** 光学功率代理 P = Σ |u|² · dx。 */
export function beamPower(re: ArrayLike<number>, im: ArrayLike<number>, dx: number): number {
  let s = 0
  const n = re.length
  for (let i = 0; i < n; i++) {
    const ur = re[i]!
    const ui = im[i]!
    s += ur * ur + ui * ui
  }
  return s * dx
}

/**
 * 强度二阶矩半宽：w_rms = 2 √(⟨x²⟩ − ⟨x⟩²)，
 * 对 |u|²∝exp(−2x²/w0²) 时 w_rms ≈ w0（1/e² 半径）。
 */
export function beamWidthRms(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
  L: number,
): number {
  const n = re.length
  const dx = L / n
  let p = 0
  let mx = 0
  let mxx = 0
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * dx - L / 2
    const ur = re[i]!
    const ui = im[i]!
    const I = ur * ur + ui * ui
    p += I
    mx += I * x
    mxx += I * x * x
  }
  if (p <= 0) return 0
  mx /= p
  mxx /= p
  const varX = Math.max(0, mxx - mx * mx)
  // |u|² = A exp(−2 x²/w0²) → σ² = w0²/4 → w0 = 2σ
  return 2 * Math.sqrt(varX)
}

/** 瑞利距离 z_R = k0 · w0² / 2（= π w0² / λ）。 */
export function rayleighRange(k0: number, w0: number): number {
  return (k0 * w0 * w0) / 2
}

/**
 * 代表样例：自由空间高斯束 split-step 传播，
 * 束宽随 z 增大（衍射）；功率近似守恒；可选弱透镜相位不破坏有限性。
 */
export function runBpmSplitStepSample(opts?: {
  n?: number
  L?: number
  w0?: number
  k0?: number
  /** 总传播距离（缺省 ~ 1.5 z_R） */
  zTotal?: number
  steps?: number
  /** 若 true，加弱二次相位透镜（Δn∝−x²）演示 split 非线性支路 */
  withLens?: boolean
}): {
  n: number
  L: number
  w0: number
  k0: number
  zTotal: number
  steps: number
  zR: number
  width0: number
  widthF: number
  power0: number
  powerF: number
  /** 束宽增大（衍射） */
  widthGrew: boolean
  /** 功率相对漂移小 */
  powerConserved: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_BPM_SPLIT_STEP
  familyId: typeof METHOD_BPM
} {
  const n = opts?.n ?? 128
  const L = opts?.L ?? 24
  const w0 = opts?.w0 ?? 1.5
  const k0 = opts?.k0 ?? 2 * Math.PI // λ=1
  const zR = rayleighRange(k0, w0)
  const zTotal = opts?.zTotal ?? 1.5 * zR
  const steps = opts?.steps ?? 24
  const withLens = opts?.withLens ?? false

  const field = createGaussianBeam1d({ n, L, w0, amp: 1 })
  const { re, im, dx } = field
  const width0 = beamWidthRms(re, im, L)
  const power0 = beamPower(re, im, dx)

  const dz = zTotal / steps
  let deltaN: Float64Array | null = null
  if (withLens) {
    // 弱负透镜 Δn = −α x²，α 小以免强聚焦
    deltaN = new Float64Array(n)
    const alpha = 0.002 / (w0 * w0)
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * dx - L / 2
      deltaN[i] = -alpha * x * x
    }
  }

  for (let s = 0; s < steps; s++) {
    splitStepBpm(re, im, L, k0, dz, deltaN)
  }

  const widthF = beamWidthRms(re, im, L)
  const powerF = beamPower(re, im, dx)

  let finite = Number.isFinite(width0) && Number.isFinite(widthF) && Number.isFinite(power0)
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(re[i]!) || !Number.isFinite(im[i]!)) finite = false
  }

  // 自由空间：解析 w(z)=w0√(1+(z/zR)²)；允许数值/周期域误差
  const widthGrew = widthF > width0 * 1.05
  const powerConserved =
    Math.abs(powerF - power0) / Math.max(power0, 1e-30) < 0.02
  // 自由空间要求明显展宽；透镜支路只要求有限+功率守恒
  const ok =
    finite && powerConserved && (withLens ? widthF > 0 : widthF > width0 * 1.15)

  return {
    n,
    L,
    w0,
    k0,
    zTotal,
    steps,
    zR,
    width0,
    widthF,
    power0,
    powerF,
    widthGrew,
    powerConserved,
    finite,
    ok,
    methodId: METHOD_ALGO_BPM_SPLIT_STEP,
    familyId: METHOD_BPM,
  }
}

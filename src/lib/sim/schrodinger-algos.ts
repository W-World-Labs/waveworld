/**
 * 1D time-dependent Schrödinger · split-operator / Strang teaching stubs.
 * Periodic grid: kinetic half-step in Fourier, potential phase, kinetic half-step.
 * ħ = 1, m = 1 atomic units unless noted.
 * method id 仅常量，不改 methods.data / registry / edges.
 */

/** 父族 · TDSE / Schrödinger. */
export const METHOD_SCHRODINGER = 'method-schrodinger'

/** 算法 · split-operator (Strang) free evolution. */
export const METHOD_ALGO_TDSE_SPLIT = 'method-algo-tdse-split'

/** 算法 · probability density / normalize / conservation. */
export const METHOD_ALGO_TDSE_PROB = 'method-algo-tdse-prob'

export const SCHRODINGER_METHOD_IDS = [
  METHOD_ALGO_TDSE_SPLIT,
  METHOD_ALGO_TDSE_PROB,
] as const

/** 复波函数（周期格点）。 */
export interface Wavefunction1d {
  readonly n: number
  /** 物理域长度 L（周期格，x∈[−L/2, L/2)）。 */
  readonly L: number
  readonly dx: number
  readonly re: Float64Array
  readonly im: Float64Array
}

/**
 * 傅里叶波数 k_m（物理域长度 L）。
 * m=0..n−1 映射到 [−⌊(n−1)/2⌋ .. ⌊n/2⌋]。
 */
export function fourierMomenta(n: number, L: number): Float64Array {
  if (!(n >= 2) || !Number.isInteger(n)) {
    throw new Error('fourierMomenta: n integer ≥ 2')
  }
  if (!(L > 0)) throw new Error('fourierMomenta: L > 0')
  const k = new Float64Array(n)
  for (let m = 0; m < n; m++) {
    const mode = m <= n / 2 ? m : m - n
    k[m] = (2 * Math.PI * mode) / L
  }
  return k
}

/** 复序列朴素 DFT：Ψ[k]=Σ_j ψ[j] exp(−2π i k j / N)。 */
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
      rk += xr * c - xi * s
      ik += xr * s + xi * c
    }
    outRe[k] = rk
    outIm[k] = ik
  }
  return { re: outRe, im: outIm }
}

/** 逆 DFT（含 1/N）。 */
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
 * 动能传播一步（谱域，T = k²/(2m)）：
 * ψ̂(k) ← ψ̂(k) · exp(−i T τ)，ħ=1。
 * 就地更新 re/im（实空间波函数）。
 */
export function kineticStep(
  re: Float64Array,
  im: Float64Array,
  L: number,
  tau: number,
  mass: number = 1,
): void {
  if (!(mass > 0)) throw new Error('kineticStep: mass > 0')
  const n = re.length
  if (im.length !== n) throw new Error('kineticStep: length mismatch')
  const { re: Re, im: Im } = dftComplex1d(re, im)
  const kArr = fourierMomenta(n, L)
  for (let m = 0; m < n; m++) {
    const k = kArr[m]!
    // T = k² / (2m)，φ = T · τ
    const phi = ((k * k) / (2 * mass)) * tau
    const c = Math.cos(phi)
    const s = Math.sin(phi)
    // exp(−i φ) · (ur + i ui)
    const ur = Re[m]!
    const ui = Im[m]!
    Re[m] = ur * c + ui * s
    Im[m] = ui * c - ur * s
  }
  const inv = idftComplex1d(Re, Im)
  re.set(inv.re)
  im.set(inv.im)
}

/**
 * 势能相位：ψ ← ψ · exp(−i V(x) τ)，ħ=1。
 * V 与格点对齐；|ψ| 不变。
 */
export function potentialPhase(
  re: Float64Array,
  im: Float64Array,
  V: ArrayLike<number>,
  tau: number,
): void {
  const n = re.length
  if (im.length !== n || V.length !== n) {
    throw new Error('potentialPhase: length mismatch')
  }
  for (let i = 0; i < n; i++) {
    const phi = V[i]! * tau
    const c = Math.cos(phi)
    const s = Math.sin(phi)
    const ur = re[i]!
    const ui = im[i]!
    // exp(−i φ) · (ur + i ui)
    re[i] = ur * c + ui * s
    im[i] = ui * c - ur * s
  }
}

/**
 * Strang split-operator 一步：
 * 动能半步 → 势能相位（全步）→ 动能半步。
 * V 缺省或 null 时为自由演化（V=0，等价整步动能）。
 */
export function splitOperatorStep(
  re: Float64Array,
  im: Float64Array,
  L: number,
  dt: number,
  V?: ArrayLike<number> | null,
  mass: number = 1,
): void {
  const half = 0.5 * dt
  kineticStep(re, im, L, half, mass)
  if (V && V.length === re.length) {
    potentialPhase(re, im, V, dt)
  }
  kineticStep(re, im, L, half, mass)
}

/** ρ_i = |ψ_i|²（概率密度，离散格点值，不含 dx）。 */
export function probabilityDensity(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
): Float64Array {
  const n = re.length
  if (im.length !== n) throw new Error('probabilityDensity: length mismatch')
  const rho = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const ur = re[i]!
    const ui = im[i]!
    rho[i] = ur * ur + ui * ui
  }
  return rho
}

/**
 * 总概率 P = Σ |ψ|² · dx（应 ≈ 1 若已归一）。
 */
export function totalProbability(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
  dx: number,
): number {
  let s = 0
  const n = re.length
  if (im.length !== n) throw new Error('totalProbability: length mismatch')
  for (let i = 0; i < n; i++) {
    const ur = re[i]!
    const ui = im[i]!
    s += ur * ur + ui * ui
  }
  return s * dx
}

/**
 * 就地归一化：ψ ← ψ / √(Σ |ψ|² dx)，使 P=1。
 * 返回归一化前的总概率。
 */
export function normalizeWavefunction(
  re: Float64Array,
  im: Float64Array,
  dx: number,
): number {
  const p = totalProbability(re, im, dx)
  if (!(p > 0)) throw new Error('normalizeWavefunction: non-positive probability')
  const inv = 1 / Math.sqrt(p)
  const n = re.length
  for (let i = 0; i < n; i++) {
    re[i]! *= inv
    im[i]! *= inv
  }
  return p
}

/**
 * |ψ|² 二阶矩宽度：w_rms = 2 √(⟨x²⟩ − ⟨x⟩²)
 * （与 BPM 束宽同一约定，便于对照自由包展宽）。
 */
export function packetWidthRms(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
  L: number,
): number {
  const n = re.length
  if (im.length !== n) throw new Error('packetWidthRms: length mismatch')
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
  return 2 * Math.sqrt(varX)
}

/**
 * 一维高斯波包（可带动量 k0）：
 * ψ(x) ∝ exp(−(x−x0)²/(4 σ²)) · exp(i k0 x)
 * 使 |ψ|² 为 σ 尺度高斯；默认归一化 P=1。
 */
export function createGaussianPacket1d(opts?: {
  n?: number
  L?: number
  sigma?: number
  x0?: number
  k0?: number
  normalize?: boolean
}): Wavefunction1d {
  const n = opts?.n ?? 128
  const L = opts?.L ?? 40
  const sigma = opts?.sigma ?? 1.5
  const x0 = opts?.x0 ?? 0
  const k0 = opts?.k0 ?? 0
  const doNorm = opts?.normalize ?? true
  if (!(n >= 8) || !Number.isInteger(n)) {
    throw new Error('createGaussianPacket1d: n integer ≥ 8')
  }
  if (!(L > 0) || !(sigma > 0)) {
    throw new Error('createGaussianPacket1d: L, sigma > 0')
  }
  const dx = L / n
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  // 振幅：|ψ|² ∝ exp(−(x−x0)²/(2σ²)) → ψ ∝ exp(−(x−x0)²/(4σ²))
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * dx - L / 2
    const dx0 = x - x0
    const amp = Math.exp(-(dx0 * dx0) / (4 * sigma * sigma))
    const c = Math.cos(k0 * x)
    const s = Math.sin(k0 * x)
    re[i] = amp * c
    im[i] = amp * s
  }
  if (doNorm) normalizeWavefunction(re, im, dx)
  return { n, L, dx, re, im }
}

/**
 * 代表样例 · split-operator 自由高斯包：
 * 动能传播后包宽增大；概率近似守恒。
 */
export function runTdseSplitSample(opts?: {
  n?: number
  L?: number
  sigma?: number
  k0?: number
  mass?: number
  tTotal?: number
  steps?: number
  /** 若 true，加弱谐振子 V=½ ω² x² 演示势能支路 */
  withPotential?: boolean
}): {
  n: number
  L: number
  sigma: number
  k0: number
  mass: number
  tTotal: number
  steps: number
  width0: number
  widthF: number
  prob0: number
  probF: number
  /** 包宽增大（自由扩散） */
  widthGrew: boolean
  /** 概率相对漂移小 */
  probConserved: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_TDSE_SPLIT
  familyId: typeof METHOD_SCHRODINGER
} {
  const n = opts?.n ?? 128
  const L = opts?.L ?? 48
  const sigma = opts?.sigma ?? 1.5
  const k0 = opts?.k0 ?? 0.5
  const mass = opts?.mass ?? 1
  // 自由高斯 σ(t)=σ √(1+(t/(2 m σ²))²)；取足够时间使明显展宽
  const tTotal = opts?.tTotal ?? 8
  const steps = opts?.steps ?? 40
  const withPotential = opts?.withPotential ?? false

  const wf = createGaussianPacket1d({ n, L, sigma, k0, normalize: true })
  const { re, im, dx } = wf
  const width0 = packetWidthRms(re, im, L)
  const prob0 = totalProbability(re, im, dx)

  let V: Float64Array | null = null
  if (withPotential) {
    // 弱谐振子 V = ½ κ x²，κ 小以免束缚压制展宽判定
    V = new Float64Array(n)
    const kappa = 0.02
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * dx - L / 2
      V[i] = 0.5 * kappa * x * x
    }
  }

  const dt = tTotal / steps
  for (let s = 0; s < steps; s++) {
    splitOperatorStep(re, im, L, dt, V, mass)
  }

  const widthF = packetWidthRms(re, im, L)
  const probF = totalProbability(re, im, dx)

  let finite =
    Number.isFinite(width0) &&
    Number.isFinite(widthF) &&
    Number.isFinite(prob0) &&
    Number.isFinite(probF)
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(re[i]!) || !Number.isFinite(im[i]!)) finite = false
  }

  const widthGrew = widthF > width0 * 1.05
  const probConserved = Math.abs(probF - prob0) / Math.max(prob0, 1e-30) < 0.02
  // 自由：要求明显展宽；势场支路只要求有限 + 概率守恒
  const ok =
    finite &&
    probConserved &&
    (withPotential ? widthF > 0 : widthF > width0 * 1.15)

  return {
    n,
    L,
    sigma,
    k0,
    mass,
    tTotal,
    steps,
    width0,
    widthF,
    prob0,
    probF,
    widthGrew,
    probConserved,
    finite,
    ok,
    methodId: METHOD_ALGO_TDSE_SPLIT,
    familyId: METHOD_SCHRODINGER,
  }
}

/**
 * 代表样例 · 概率密度：归一后 P≈1；自由演化后仍守恒；ρ=|ψ|²≥0。
 */
export function runTdseProbSample(opts?: {
  n?: number
  L?: number
  sigma?: number
  steps?: number
  tTotal?: number
}): {
  n: number
  L: number
  sigma: number
  steps: number
  tTotal: number
  prob0: number
  probF: number
  rhoMin: number
  rhoSumDx: number
  /** 归一后 |P−1| 小 */
  normalized: boolean
  /** 演化后概率守恒 */
  conserved: boolean
  /** ρ 非负 */
  nonNegative: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_TDSE_PROB
  familyId: typeof METHOD_SCHRODINGER
} {
  const n = opts?.n ?? 96
  const L = opts?.L ?? 40
  const sigma = opts?.sigma ?? 1.2
  const steps = opts?.steps ?? 24
  const tTotal = opts?.tTotal ?? 4

  // 故意不归一的高斯 → 先 normalize
  const wf = createGaussianPacket1d({
    n,
    L,
    sigma,
    k0: 0.3,
    normalize: false,
  })
  const { re, im, dx } = wf
  const rawP = normalizeWavefunction(re, im, dx)
  const prob0 = totalProbability(re, im, dx)
  const rho0 = probabilityDensity(re, im)

  let rhoMin = Infinity
  let rhoSum = 0
  for (let i = 0; i < n; i++) {
    const r = rho0[i]!
    if (r < rhoMin) rhoMin = r
    rhoSum += r
  }
  const rhoSumDx = rhoSum * dx

  const dt = tTotal / steps
  for (let s = 0; s < steps; s++) {
    splitOperatorStep(re, im, L, dt, null, 1)
  }
  const probF = totalProbability(re, im, dx)
  const rhoF = probabilityDensity(re, im)
  for (let i = 0; i < n; i++) {
    if (rhoF[i]! < rhoMin) rhoMin = rhoF[i]!
  }

  const normalized = Math.abs(prob0 - 1) < 1e-12 && rawP > 0
  const conserved = Math.abs(probF - prob0) / Math.max(prob0, 1e-30) < 1e-10
  const nonNegative = rhoMin >= -1e-15
  const ok = normalized && conserved && nonNegative && Number.isFinite(probF)

  return {
    n,
    L,
    sigma,
    steps,
    tTotal,
    prob0,
    probF,
    rhoMin,
    rhoSumDx,
    normalized,
    conserved,
    nonNegative,
    ok,
    methodId: METHOD_ALGO_TDSE_PROB,
    familyId: METHOD_SCHRODINGER,
  }
}

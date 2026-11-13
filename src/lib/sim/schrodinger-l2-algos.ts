/**
 * Schrödinger L2 · TDSE imaginary-time evolution (ground-state projection).
 * e^{-τ H} damps excited components; energy decreases for harmonic well / free box.
 * Reuse split-operator skeleton with real damping (+τ) instead of unitary (−iτ).
 * method id 仅常量，不改 methods.data / registry / edges.
 */

import {
  METHOD_SCHRODINGER,
  fourierMomenta,
  dftComplex1d,
  idftComplex1d,
  createGaussianPacket1d,
  normalizeWavefunction,
  totalProbability,
  packetWidthRms,
} from './schrodinger-algos'

/** 父族 · TDSE / Schrödinger（与 schrodinger-algos 对齐）。 */
export { METHOD_SCHRODINGER }

/** 算法 · imaginary-time split-operator（投影基态）。 */
export const METHOD_ALGO_TDSE_IMAG = 'method-algo-tdse-imag'

/** 父族别名。 */
export const SCHRODINGER_L2_PARENT = METHOD_SCHRODINGER

export const SCHRODINGER_L2_METHOD_IDS = [METHOD_ALGO_TDSE_IMAG] as const

/**
 * 虚时动能传播：ψ̂(k) ← ψ̂(k) · exp(− T τ)，T = k²/(2m)，ħ=1。
 * 高 k 指数衰减（扩散型），就地更新实空间 re/im。
 */
export function kineticStepImag(
  re: Float64Array,
  im: Float64Array,
  L: number,
  tau: number,
  mass: number = 1,
): void {
  if (!(mass > 0)) throw new Error('kineticStepImag: mass > 0')
  if (!Number.isFinite(tau)) throw new Error('kineticStepImag: tau finite')
  const n = re.length
  if (im.length !== n) throw new Error('kineticStepImag: length mismatch')
  const { re: Re, im: Im } = dftComplex1d(re, im)
  const kArr = fourierMomenta(n, L)
  for (let m = 0; m < n; m++) {
    const k = kArr[m]!
    const T = (k * k) / (2 * mass)
    const damp = Math.exp(-T * tau)
    Re[m] = Re[m]! * damp
    Im[m] = Im[m]! * damp
  }
  const inv = idftComplex1d(Re, Im)
  re.set(inv.re)
  im.set(inv.im)
}

/**
 * 虚时势能阻尼：ψ ← ψ · exp(− V(x) τ)。
 * V 大处振幅衰减；|ψ| 一般不守恒。
 */
export function potentialDampImag(
  re: Float64Array,
  im: Float64Array,
  V: ArrayLike<number>,
  tau: number,
): void {
  const n = re.length
  if (im.length !== n || V.length !== n) {
    throw new Error('potentialDampImag: length mismatch')
  }
  if (!Number.isFinite(tau)) throw new Error('potentialDampImag: tau finite')
  for (let i = 0; i < n; i++) {
    const damp = Math.exp(-V[i]! * tau)
    re[i] = re[i]! * damp
    im[i] = im[i]! * damp
  }
}

/**
 * Strang 虚时 split-operator 一步：
 * 动能半步 exp(−T τ/2) → 势能全步 exp(−V τ) → 动能半步。
 * V 缺省或 null 时为自由虚时演化（仅动能阻尼）。
 */
export function splitOperatorImagStep(
  re: Float64Array,
  im: Float64Array,
  L: number,
  dtau: number,
  V?: ArrayLike<number> | null,
  mass: number = 1,
): void {
  const half = 0.5 * dtau
  kineticStepImag(re, im, L, half, mass)
  if (V && V.length === re.length) {
    potentialDampImag(re, im, V, dtau)
  }
  kineticStepImag(re, im, L, half, mass)
}

/**
 * 期望能量 ⟨H⟩ = ⟨T⟩ + ⟨V⟩（ħ=1,m 可设）。
 * ⟨T⟩ 由谱域 |ψ̂|² 加权 T(k)；⟨V⟩ 由实空间 |ψ|² 加权 V。
 * 归一化无关（比值）；P=0 时返回 0。
 */
export function expectationEnergy(
  re: ArrayLike<number>,
  im: ArrayLike<number>,
  L: number,
  V?: ArrayLike<number> | null,
  mass: number = 1,
): number {
  const n = re.length
  if (im.length !== n) throw new Error('expectationEnergy: length mismatch')
  if (!(L > 0) || !(mass > 0)) {
    throw new Error('expectationEnergy: L, mass > 0')
  }

  let pSum = 0
  for (let i = 0; i < n; i++) {
    const ur = re[i]!
    const ui = im[i]!
    pSum += ur * ur + ui * ui
  }
  if (!(pSum > 0)) return 0

  let vExp = 0
  if (V && V.length === n) {
    let vSum = 0
    for (let i = 0; i < n; i++) {
      const ur = re[i]!
      const ui = im[i]!
      vSum += (ur * ur + ui * ui) * V[i]!
    }
    vExp = vSum / pSum
  }

  const { re: Re, im: Im } = dftComplex1d(re, im)
  const kArr = fourierMomenta(n, L)
  let tNum = 0
  let tDen = 0
  for (let m = 0; m < n; m++) {
    const wr = Re[m]!
    const wi = Im[m]!
    const w = wr * wr + wi * wi
    const k = kArr[m]!
    const T = (k * k) / (2 * mass)
    tNum += w * T
    tDen += w
  }
  const tExp = tDen > 0 ? tNum / tDen : 0
  return tExp + vExp
}

/**
 * 谐振子势 V = ½ κ x²（m=1 时 κ=ω²），域心为 x=0。
 */
export function harmonicPotential1d(
  n: number,
  L: number,
  kappa: number,
): Float64Array {
  if (!(n >= 2) || !Number.isInteger(n)) {
    throw new Error('harmonicPotential1d: n integer ≥ 2')
  }
  if (!(L > 0)) throw new Error('harmonicPotential1d: L > 0')
  const dx = L / n
  const V = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * dx - L / 2
    V[i] = 0.5 * kappa * x * x
  }
  return V
}

/**
 * 代表样例 · 虚时 TDSE：
 * 非基态高斯包 + 谐振子势（或自由），虚时演化后能量下降；
 * 每步归一化（投影惯例）。
 */
export function runTdseImagSample(opts?: {
  n?: number
  L?: number
  /** 初态高斯宽度（偏离谐振子基态尺度时能量更高）。 */
  sigma?: number
  /** 谐振子 κ（V=½κx²）；0 时自由粒子。 */
  kappa?: number
  mass?: number
  tauTotal?: number
  steps?: number
}): {
  n: number
  L: number
  sigma: number
  kappa: number
  mass: number
  tauTotal: number
  steps: number
  energy0: number
  energyF: number
  /** 能量相对下降量 (E0−EF)/max(|E0|,ε) */
  energyDropRel: number
  /** 能量单调下降（末 < 初） */
  energyDecreased: boolean
  width0: number
  widthF: number
  probF: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_TDSE_IMAG
  familyId: typeof METHOD_SCHRODINGER
} {
  const n = opts?.n ?? 128
  const L = opts?.L ?? 24
  const sigma = opts?.sigma ?? 2.5
  const kappa = opts?.kappa ?? 1
  const mass = opts?.mass ?? 1
  const tauTotal = opts?.tauTotal ?? 4
  const steps = opts?.steps ?? 40

  const wf = createGaussianPacket1d({
    n,
    L,
    sigma,
    k0: 0,
    x0: 0.4,
    normalize: true,
  })
  const { re, im, dx } = wf

  const V =
    kappa > 0 ? harmonicPotential1d(n, L, kappa) : null

  const energy0 = expectationEnergy(re, im, L, V, mass)
  const width0 = packetWidthRms(re, im, L)

  const dtau = tauTotal / steps
  for (let s = 0; s < steps; s++) {
    splitOperatorImagStep(re, im, L, dtau, V, mass)
    normalizeWavefunction(re, im, dx)
  }

  const energyF = expectationEnergy(re, im, L, V, mass)
  const widthF = packetWidthRms(re, im, L)
  const probF = totalProbability(re, im, dx)

  let finite =
    Number.isFinite(energy0) &&
    Number.isFinite(energyF) &&
    Number.isFinite(width0) &&
    Number.isFinite(widthF) &&
    Number.isFinite(probF)
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(re[i]!) || !Number.isFinite(im[i]!)) finite = false
  }

  const energyDecreased = energyF < energy0 - 1e-9
  const energyDropRel =
    (energy0 - energyF) / Math.max(Math.abs(energy0), 1e-30)
  // 谐振子：能量应明显下降；自由：动能阻尼亦使 E 下降
  const ok =
    finite &&
    energyDecreased &&
    energyDropRel > 0.02 &&
    Math.abs(probF - 1) < 1e-10

  return {
    n,
    L,
    sigma,
    kappa,
    mass,
    tauTotal,
    steps,
    energy0,
    energyF,
    energyDropRel,
    energyDecreased,
    width0,
    widthF,
    probF,
    finite,
    ok,
    methodId: METHOD_ALGO_TDSE_IMAG,
    familyId: METHOD_SCHRODINGER,
  }
}

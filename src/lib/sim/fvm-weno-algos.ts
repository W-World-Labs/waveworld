/**
 * 有限体积 · WENO3 界面重构（Jiang–Shu r=2，三阶）。
 * 从单元平均重构界面左/右态；光滑区达三阶，间断处 ENO 自适应。
 * method id 仅常量，不改 methods.data / edges。
 */
import { FVM_PARENT } from './fvm-algos'

export { FVM_PARENT }

/** 父族 · 有限体积。 */
export const FVM_WENO_PARENT = FVM_PARENT

/** WENO3 界面重构。 */
export const METHOD_ALGO_FVM_WENO3 = 'method-algo-fvm-weno3'

export const FVM_WENO_METHOD_IDS = [METHOD_ALGO_FVM_WENO3] as const

/** WENO 分母保护（Jiang–Shu 经典 1e−6）。 */
export const WENO_EPS = 1e-6

/**
 * WENO3 左态 u⁻_{i+1/2}：模板 {i−1,i,i+1}。
 *
 * 候选：
 *   u⁽⁰⁾ = −½ u_{i−1} + ³⁄₂ u_i
 *   u⁽¹⁾ =  ½ u_i + ½ u_{i+1}
 * 理想权 γ₀=⅓, γ₁=⅔；β_r = (Δu)²。
 * 周期边界。
 */
export function weno3Left(u: Float64Array, i: number): number {
  const n = u.length
  const im = (i - 1 + n) % n
  const ip = (i + 1) % n
  const um = u[im]!
  const ui = u[i]!
  const up = u[ip]!

  const p0 = -0.5 * um + 1.5 * ui
  const p1 = 0.5 * ui + 0.5 * up

  const b0 = (ui - um) * (ui - um)
  const b1 = (up - ui) * (up - ui)

  const a0 = (1 / 3) / (WENO_EPS + b0) ** 2
  const a1 = (2 / 3) / (WENO_EPS + b1) ** 2
  const s = a0 + a1
  return (a0 / s) * p0 + (a1 / s) * p1
}

/**
 * WENO3 右态 u⁺_{i+1/2}：模板 {i,i+1,i+2}。
 *
 * 候选：
 *   u⁽⁰⁾ = ½ u_i + ½ u_{i+1}
 *   u⁽¹⁾ = ³⁄₂ u_{i+1} − ½ u_{i+2}
 * 理想权 γ₀=⅔, γ₁=⅓（与左态镜像）。
 * 周期边界。
 */
export function weno3Right(u: Float64Array, i: number): number {
  const n = u.length
  const ip = (i + 1) % n
  const ip2 = (i + 2) % n
  const ui = u[i]!
  const up = u[ip]!
  const up2 = u[ip2]!

  const p0 = 0.5 * ui + 0.5 * up
  const p1 = 1.5 * up - 0.5 * up2

  const b0 = (up - ui) * (up - ui)
  const b1 = (up2 - up) * (up2 - up)

  const a0 = (2 / 3) / (WENO_EPS + b0) ** 2
  const a1 = (1 / 3) / (WENO_EPS + b1) ** 2
  const s = a0 + a1
  return (a0 / s) * p0 + (a1 / s) * p1
}

/** 全部界面左态 u⁻_{i+1/2}，i=0..n−1。 */
export function weno3LeftAll(u: Float64Array): Float64Array {
  const n = u.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = weno3Left(u, i)
  return out
}

/** 全部界面右态 u⁺_{i+1/2}，i=0..n−1。 */
export function weno3RightAll(u: Float64Array): Float64Array {
  const n = u.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = weno3Right(u, i)
  return out
}

/**
 * 光滑正弦 sin(2πx) 的精确单元平均（周期 [0,1]）：
 * ū_i = (1/h) ∫_{x_i−h/2}^{x_i+h/2} sin(2πx) dx
 *     = [sin(π h)/(π h)] sin(2π x_i)，x_i = (i+½)h。
 */
export function sineCellAverages(n: number): Float64Array {
  const h = 1 / n
  const sinc = Math.sin(Math.PI * h) / (Math.PI * h)
  const u = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const xc = (i + 0.5) * h
    u[i] = sinc * Math.sin(2 * Math.PI * xc)
  }
  return u
}

/** 界面 x_{i+1/2} = (i+1)/n 上的精确 sin(2πx)。 */
export function sineFaceExact(n: number): Float64Array {
  const h = 1 / n
  const f = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    f[i] = Math.sin(2 * Math.PI * (i + 1) * h)
  }
  return f
}

/** 周期总变差 TV(u) = Σ |u_{i+1}−u_i|。 */
export function totalVariation(u: ArrayLike<number>): number {
  const n = u.length
  if (n === 0) return 0
  let tv = 0
  for (let i = 0; i < n; i++) {
    const ip = (i + 1) % n
    tv += Math.abs(u[ip]! - u[i]!)
  }
  return tv
}

/**
 * 样例：光滑正弦重构误差 + 间断阶跃 TVB/有限性。
 */
export function runFvmWeno3Sample(opts?: {
  nSmooth?: number
  nDisc?: number
}): {
  nSmooth: number
  nDisc: number
  /** 光滑左态 max |u⁻ − exact| */
  leftMaxErr: number
  /** 光滑右态 max |u⁺ − exact| */
  rightMaxErr: number
  /** 间断重构后全部有限 */
  discFinite: boolean
  /** 原场 TV */
  tv0: number
  /** 左态序列 TV（周期） */
  tvLeft: number
  /** 右态序列 TV */
  tvRight: number
  /** TVB-ish：重构 TV 不超过原 TV 的宽松倍数 */
  tvbOk: boolean
  methodId: typeof METHOD_ALGO_FVM_WENO3
  familyId: typeof FVM_WENO_PARENT
} {
  const nSmooth = opts?.nSmooth ?? 64
  const nDisc = opts?.nDisc ?? 80

  const uS = sineCellAverages(nSmooth)
  const exact = sineFaceExact(nSmooth)
  let leftMaxErr = 0
  let rightMaxErr = 0
  for (let i = 0; i < nSmooth; i++) {
    const eL = Math.abs(weno3Left(uS, i) - exact[i]!)
    const eR = Math.abs(weno3Right(uS, i) - exact[i]!)
    if (eL > leftMaxErr) leftMaxErr = eL
    if (eR > rightMaxErr) rightMaxErr = eR
  }

  // 间断：两档阶跃（周期域上两个跳变）
  const uD = new Float64Array(nDisc)
  for (let i = 0; i < nDisc; i++) {
    uD[i] = i < nDisc / 2 ? 1 : 0
  }
  const left = weno3LeftAll(uD)
  const right = weno3RightAll(uD)
  let discFinite = true
  for (let i = 0; i < nDisc; i++) {
    if (!Number.isFinite(left[i]!) || !Number.isFinite(right[i]!)) {
      discFinite = false
      break
    }
  }
  const tv0 = totalVariation(uD)
  const tvLeft = totalVariation(left)
  const tvRight = totalVariation(right)
  // WENO 在跳变附近允许有限过冲，但不应指数放大 TV
  const tvbOk = tvLeft <= 4 * tv0 + 1e-9 && tvRight <= 4 * tv0 + 1e-9

  return {
    nSmooth,
    nDisc,
    leftMaxErr,
    rightMaxErr,
    discFinite,
    tv0,
    tvLeft,
    tvRight,
    tvbOk,
    methodId: METHOD_ALGO_FVM_WENO3,
    familyId: FVM_WENO_PARENT,
  }
}

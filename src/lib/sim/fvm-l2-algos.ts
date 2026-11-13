/**
 * 有限体积二级 · Burgers 1D 激波 + minmod 斜率限制重构 / Lax–Friedrichs。
 * 扩展 fvm-algos 的面通量：MUSCL-minmod 重构 + 局部 LF 通量，
 * Rankine–Hugoniot 熵激波速度 s=(uL+uR)/2。
 * method id 仅常量，不改 methods.data。
 */
import { FVM_PARENT, sumMass } from './fvm-algos'

export { FVM_PARENT, sumMass }

/** 二级 · 斜率限制重构 FVM。 */
export const METHOD_ALGO_FVM_LIMITER = 'method-algo-fvm-limiter'

export const FVM_L2_METHOD_IDS = [METHOD_ALGO_FVM_LIMITER] as const

/** minmod(a,b) = ½(sign a + sign b)·min(|a|,|b|)。 */
export function minmod(a: number, b: number): number {
  if (a * b <= 0) return 0
  return Math.abs(a) < Math.abs(b) ? a : b
}

/** 三参数 minmod。 */
export function minmod3(a: number, b: number, c: number): number {
  return minmod(a, minmod(b, c))
}

/** Burgers 物理通量 f(u)=u²/2。 */
export function burgersFlux(u: number): number {
  return 0.5 * u * u
}

/**
 * 局部 Lax–Friedrichs 数值通量（Burgers）：
 * F* = ½(fL+fR) − ½ α (uR−uL)，α = max(|uL|,|uR|)。
 */
export function burgersLfFlux(uL: number, uR: number): number {
  const alpha = Math.max(Math.abs(uL), Math.abs(uR))
  return 0.5 * (burgersFlux(uL) + burgersFlux(uR)) - 0.5 * alpha * (uR - uL)
}

/**
 * 单元中心 minmod 斜率：σ_i = minmod((u_i−u_{i−1})/dx, (u_{i+1}−u_i)/dx)。
 * 周期边界。
 */
export function minmodSlopes(u: Float64Array, dx: number): Float64Array {
  const n = u.length
  const s = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const im = (i - 1 + n) % n
    const ip = (i + 1) % n
    const left = (u[i]! - u[im]!) / dx
    const right = (u[ip]! - u[i]!) / dx
    s[i] = minmod(left, right)
  }
  return s
}

/**
 * MUSCL 界面态：面 i+1/2 左态 u_i + ½ dx σ_i，右态 u_{i+1} − ½ dx σ_{i+1}。
 */
export function reconstructInterface(
  u: Float64Array,
  sigma: Float64Array,
  dx: number,
  i: number,
): { uL: number; uR: number } {
  const n = u.length
  const ip = (i + 1) % n
  const uL = u[i]! + 0.5 * dx * sigma[i]!
  const uR = u[ip]! - 0.5 * dx * sigma[ip]!
  return { uL, uR }
}

/**
 * Burgers 1D FVM 一步（周期）：minmod 重构 + LF 通量。
 * u_i^{n+1} = u_i − (dt/dx)(F_{i+1/2} − F_{i−1/2})
 */
export function burgersMinmodStep(
  u: Float64Array,
  dx: number,
  dt: number,
): Float64Array {
  const n = u.length
  const sigma = minmodSlopes(u, dx)
  const F = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const { uL, uR } = reconstructInterface(u, sigma, dx, i)
    F[i] = burgersLfFlux(uL, uR)
  }
  const next = new Float64Array(n)
  const c = dt / dx
  for (let i = 0; i < n; i++) {
    const iL = (i - 1 + n) % n
    next[i] = u[i]! - c * (F[i]! - F[iL]!)
  }
  return next
}

/**
 * 一阶 LF（无限制重构）一步，对照用。
 */
export function burgersLfStep(u: Float64Array, dx: number, dt: number): Float64Array {
  const n = u.length
  const F = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const ip = (i + 1) % n
    F[i] = burgersLfFlux(u[i]!, u[ip]!)
  }
  const next = new Float64Array(n)
  const c = dt / dx
  for (let i = 0; i < n; i++) {
    const iL = (i - 1 + n) % n
    next[i] = u[i]! - c * (F[i]! - F[iL]!)
  }
  return next
}

/** Rankine–Hugoniot 激波速度（Burgers）：s = (uL+uR)/2。 */
export function burgersShockSpeed(uL: number, uR: number): number {
  return 0.5 * (uL + uR)
}

/**
 * 样例：Riemann 激波 (uL>uR)，minmod-LF 推进；
 * 数值激波位置 ≈ s·T，满足熵条件 uL > s > uR，质量守恒。
 */
export function runFvmLimiterSample(opts?: {
  n?: number
  uL?: number
  uR?: number
  cfl?: number
  steps?: number
}): {
  n: number
  uL: number
  uR: number
  shockSpeed: number
  shockPos0: number
  shockPosF: number
  expectedPos: number
  posErr: number
  mass0: number
  massF: number
  massErr: number
  /** 熵条件 uL > s > uR */
  entropyOk: boolean
  finite: boolean
  methodId: typeof METHOD_ALGO_FVM_LIMITER
  familyId: typeof FVM_PARENT
} {
  const n = opts?.n ?? 128
  const uL = opts?.uL ?? 1.5
  const uR = opts?.uR ?? 0.2
  const cfl = opts?.cfl ?? 0.4
  const steps = opts?.steps ?? 60
  const dx = 1 / n
  const s = burgersShockSpeed(uL, uR)
  const aMax = Math.max(Math.abs(uL), Math.abs(uR), Math.abs(s))
  const dt = (cfl * dx) / Math.max(aMax, 1e-12)

  // 初值：中点附近 Riemann
  const shockPos0 = 0.3
  const u = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * dx
    u[i] = x < shockPos0 ? uL : uR
  }
  const mass0 = sumMass(u) * dx

  let cur: Float64Array = new Float64Array(u)
  for (let k = 0; k < steps; k++) cur = new Float64Array(burgersMinmodStep(cur, dx, dt))

  const massF = sumMass(cur) * dx
  const mid = 0.5 * (uL + uR)
  // 激波位置：u 从 uL 侧首次降到 mid 以下的界面
  let shockPosF = shockPos0
  for (let i = 0; i < n - 1; i++) {
    if (cur[i]! >= mid && cur[i + 1]! < mid) {
      // 线性插值
      const t = (cur[i]! - mid) / (cur[i]! - cur[i + 1]! + 1e-30)
      shockPosF = (i + 0.5 + t) * dx
      break
    }
  }
  const T = steps * dt
  const expectedPos = shockPos0 + s * T
  // 周期域 wrap（一般不会）
  let exp = expectedPos
  while (exp > 1) exp -= 1
  while (exp < 0) exp += 1

  let finite = true
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(cur[i]!)) {
      finite = false
      break
    }
  }

  return {
    n,
    uL,
    uR,
    shockSpeed: s,
    shockPos0,
    shockPosF,
    expectedPos: exp,
    posErr: Math.abs(shockPosF - exp),
    mass0,
    massF,
    massErr: Math.abs(massF - mass0),
    entropyOk: uL > s && s > uR,
    finite,
    methodId: METHOD_ALGO_FVM_LIMITER,
    familyId: FVM_PARENT,
  }
}

/**
 * 有限体积四级 · 1D Burgers Roe 近似 Riemann 通量。
 * â = (uL+uR)/2，F_roe = ½(F_L+F_R) − ½|â|(uR−uL)；可选 Harten 熵修正。
 * method id 仅常量；catalog 子节点 method-algo-fvm-roe-stub（可未入库）。
 */
import { FVM_PARENT, sumMass, upwindFlux } from './fvm-algos'
import { burgersFlux } from './fvm-l2-algos'

export { FVM_PARENT, sumMass, upwindFlux, burgersFlux }

/** 四级 · Roe 近似 Riemann。 */
export const METHOD_ALGO_FVM_ROE = 'method-algo-fvm-roe-stub'

export const FVM_L4_METHOD_IDS = [METHOD_ALGO_FVM_ROE] as const

/** Roe 平均波速（Burgers）：â = (uL + uR)/2。 */
export function roeAverageBurgers(uL: number, uR: number): number {
  return 0.5 * (uL + uR)
}

/**
 * Harten 熵修正：|λ|_ε = (λ²/ε + ε)/2 当 |λ| < ε，否则 |λ|。
 * 避免 sonic rarefaction 处数值粘性过小。
 */
export function hartenEntropyFix(absLambda: number, eps: number): number {
  if (eps <= 0) return absLambda
  if (absLambda >= eps) return absLambda
  return 0.5 * ((absLambda * absLambda) / eps + eps)
}

/**
 * Burgers Roe 数值通量：
 * F* = ½(f(uL)+f(uR)) − ½ |â|_ε (uR − uL)，f(u)=½ u²。
 * eps>0 时对 |â| 施加 Harten 修正。
 */
export function burgersRoeFlux(uL: number, uR: number, eps = 0): number {
  const aHat = roeAverageBurgers(uL, uR)
  const absA = hartenEntropyFix(Math.abs(aHat), eps)
  return 0.5 * (burgersFlux(uL) + burgersFlux(uR)) - 0.5 * absA * (uR - uL)
}

/**
 * 标量线性迎风（对照）：用 Roe 平均速度选向，F = â · u_upwind。
 * 注意对 Burgers 非线性这不是守恒通量；仅作数值对照。
 */
export function burgersUpwindByRoeSpeed(uL: number, uR: number): number {
  const a = roeAverageBurgers(uL, uR)
  // 物理通量迎风：f(u_upwind)
  if (a > 0) return burgersFlux(uL)
  if (a < 0) return burgersFlux(uR)
  return 0.5 * (burgersFlux(uL) + burgersFlux(uR))
}

/**
 * Burgers 1D FVM 一步（周期）：Roe 通量。
 * u_i^{n+1} = u_i − (dt/dx)(F_{i+1/2} − F_{i−1/2})
 */
export function burgersRoeStep(
  u: Float64Array,
  dx: number,
  dt: number,
  eps = 0,
): Float64Array {
  const n = u.length
  const F = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const ip = (i + 1) % n
    F[i] = burgersRoeFlux(u[i]!, u[ip]!, eps)
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
 * 样例：Burgers 左右间断 Riemann + Roe 若干步。
 * 通量有限；与纯迎风对照；激波质量守恒。
 */
export function runFvmRoeSample(opts?: {
  n?: number
  uL?: number
  uR?: number
  cfl?: number
  steps?: number
  eps?: number
}): {
  n: number
  uL: number
  uR: number
  fluxShock: number
  fluxSmooth: number
  fluxFinite: boolean
  /** 相同左右态：Roe = 物理通量 */
  consistentOk: boolean
  /** 与迎风对照：激波面通量有限且同号 */
  vsUpwindOk: boolean
  mass0: number
  massF: number
  massErr: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_FVM_ROE
  familyId: typeof FVM_PARENT
} {
  const n = opts?.n ?? 128
  const uL = opts?.uL ?? 1.5
  const uR = opts?.uR ?? 0.25
  const cfl = opts?.cfl ?? 0.4
  const steps = opts?.steps ?? 50
  const eps = opts?.eps ?? 1e-3
  const dx = 1 / n

  // 单界面 Roe 通量（激波 uL > uR）
  const fluxShock = burgersRoeFlux(uL, uR, eps)
  const fluxUp = burgersUpwindByRoeSpeed(uL, uR)
  // 相同态一致性
  const fluxSmooth = burgersRoeFlux(uL, uL, eps)
  const consistentOk = Math.abs(fluxSmooth - burgersFlux(uL)) < 1e-12
  const fluxFinite = Number.isFinite(fluxShock) && Number.isFinite(fluxUp)
  // 激波：Roe 与迎风同号且量级可比
  const vsUpwindOk =
    fluxFinite &&
    Math.sign(fluxShock || 1) === Math.sign(fluxUp || 1) &&
    Math.abs(fluxShock - fluxUp) < Math.max(Math.abs(fluxShock), Math.abs(fluxUp), 1) * 2

  const aMax = Math.max(Math.abs(uL), Math.abs(uR), Math.abs(roeAverageBurgers(uL, uR)))
  const dt = (cfl * dx) / Math.max(aMax, 1e-12)

  const u = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * dx
    u[i] = x < 0.4 ? uL : uR
  }
  const mass0 = sumMass(u) * dx

  let cur = new Float64Array(u)
  for (let s = 0; s < steps; s++) {
    cur = new Float64Array(burgersRoeStep(cur, dx, dt, eps))
  }

  const massF = sumMass(cur) * dx
  let finite = true
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(cur[i]!)) {
      finite = false
      break
    }
  }

  const massErr = Math.abs(massF - mass0)
  const ok =
    finite &&
    fluxFinite &&
    consistentOk &&
    vsUpwindOk &&
    massErr < 1e-10

  return {
    n,
    uL,
    uR,
    fluxShock,
    fluxSmooth,
    fluxFinite,
    consistentOk,
    vsUpwindOk,
    mass0,
    massF,
    massErr,
    finite,
    ok,
    methodId: METHOD_ALGO_FVM_ROE,
    familyId: FVM_PARENT,
  }
}

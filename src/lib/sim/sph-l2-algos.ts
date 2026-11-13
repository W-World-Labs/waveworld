/**
 * SPH L2 · 压强力 + Monaghan 人工粘性（纯算法核）。
 * 1D Monaghan 形式：
 *   F_i ≈ −Σ_j m_j (P_i/ρ_i² + P_j/ρ_j²) ∇W_ij
 *   Π_ij = (−α c̄ μ + β μ²)/ρ̄  （仅 v·r < 0），μ = h (v·r)/(r²+ε h²)
 * method id 仅常量；catalog / methods.data / moduleRegistry / edges 不在此接线。
 */
import { METHOD_SPH, cubicSplineGradW } from './sph-algos'

export { METHOD_SPH, cubicSplineGradW }

/** 子算法 · 1D Monaghan 压强力。 */
export const METHOD_ALGO_SPH_PRESSURE_FORCE = 'method-algo-sph-pressure-force'

/** 子算法 · Monaghan 人工粘性 Π_ij。 */
export const METHOD_ALGO_SPH_ART_VISC = 'method-algo-sph-art-visc'

export const SPH_L2_METHOD_IDS = [
  METHOD_ALGO_SPH_PRESSURE_FORCE,
  METHOD_ALGO_SPH_ART_VISC,
] as const

/**
 * 1D 有符号核梯度 ∇_i W_ij = (dW/dr) · (x_i − x_j)/r。
 * cubicSplineGradW 返回径向 dW/dr ≤ 0。
 */
export function cubicSplineGradW1d(xi: number, xj: number, h: number): number {
  const dx = xi - xj
  const r = Math.abs(dx)
  if (!(h > 0) || !Number.isFinite(dx) || r < 1e-30) return 0
  const dWdr = cubicSplineGradW(r / h, h)
  if (dWdr === 0) return 0 // avoid -0 from 0 * sign
  return dWdr * (dx / r)
}

/**
 * 单对压强力贡献（作用在 i 上，来自 j）：
 * F_ij = − m_j (P_i/ρ_i² + P_j/ρ_j²) ∇W_ij
 */
export function sphPressureForcePair(
  xi: number,
  xj: number,
  mj: number,
  Pi: number,
  Pj: number,
  rhoi: number,
  rhoj: number,
  h: number,
): number {
  if (!(h > 0) || !(rhoi > 0) || !(rhoj > 0) || !Number.isFinite(mj)) return 0
  const grad = cubicSplineGradW1d(xi, xj, h)
  if (grad === 0) return 0
  const A = Pi / (rhoi * rhoi) + Pj / (rhoj * rhoj)
  return -mj * A * grad
}

/**
 * 粒子 i 的总压强力：F_i = Σ_{j≠i} F_ij。
 * x/m/P/rho 等长。
 */
export function sphPressureForce(
  x: ArrayLike<number>,
  m: ArrayLike<number>,
  P: ArrayLike<number>,
  rho: ArrayLike<number>,
  h: number,
  i: number,
): number {
  const n = x.length
  if (i < 0 || i >= n || m.length !== n || P.length !== n || rho.length !== n) {
    return 0
  }
  if (!(h > 0)) return 0
  const xi = x[i]!
  const Pi = P[i]!
  const rhoi = rho[i]!
  if (!(rhoi > 0)) return 0
  let Fi = 0
  for (let j = 0; j < n; j++) {
    if (j === i) continue
    Fi += sphPressureForcePair(xi, x[j]!, m[j]!, Pi, P[j]!, rhoi, rho[j]!, h)
  }
  return Fi
}

/** 全部粒子压强力。 */
export function sphPressureForceAll(
  x: ArrayLike<number>,
  m: ArrayLike<number>,
  P: ArrayLike<number>,
  rho: ArrayLike<number>,
  h: number,
): Float64Array {
  const n = x.length
  const F = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    F[i] = sphPressureForce(x, m, P, rho, h, i)
  }
  return F
}

/**
 * Monaghan 人工粘性 Π_ij（标量）：
 *   若 v_ij · r_ij ≥ 0（分离）→ 0
 *   否则 μ = h (v·r)/(r² + ε h²)，
 *        Π = (−α c̄ μ + β μ²) / ρ̄
 * 其中 v = v_i−v_j，r = x_i−x_j，ρ̄=(ρ_i+ρ_j)/2，c̄ 为声速（常数或平均）。
 */
export function monaghanArtVisc(
  xi: number,
  xj: number,
  vi: number,
  vj: number,
  rhoi: number,
  rhoj: number,
  h: number,
  opts?: {
    alpha?: number
    beta?: number
    c?: number
    /** 软化 ε，缺省 0.01 */
    eps?: number
  },
): number {
  if (!(h > 0) || !(rhoi > 0) || !(rhoj > 0)) return 0
  const r = xi - xj
  const v = vi - vj
  const vr = v * r
  if (!(vr < 0)) return 0

  const alpha = opts?.alpha ?? 1
  const beta = opts?.beta ?? 2
  const c = opts?.c ?? 1
  const eps = opts?.eps ?? 0.01
  const r2 = r * r
  const mu = (h * vr) / (r2 + eps * h * h)
  const rhoBar = 0.5 * (rhoi + rhoj)
  if (!(rhoBar > 0) || !Number.isFinite(mu)) return 0
  // μ < 0 when approaching → −α c μ > 0；β μ² ≥ 0
  return (-alpha * c * mu + beta * mu * mu) / rhoBar
}

/**
 * 压强力样例：两等质量粒子，P>0 互斥；验证作用-反作用 F0+F1≈0，
 * 且低密高压侧被推开（斥力）。
 */
export function runSphPressureForceSample(opts?: {
  h?: number
  m?: number
  rho?: number
  P?: number
  /** 粒子间距（须 < 2h 才有核支撑） */
  dx?: number
}): {
  h: number
  m: number
  rho: number
  P: number
  x0: number
  x1: number
  F0: number
  F1: number
  /** |F0 + F1| 作用-反作用残差 */
  antiSymErr: number
  /** 两粒子互相排斥：F0 < 0 < F1（x0 < x1） */
  repulsive: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_SPH_PRESSURE_FORCE
  familyId: typeof METHOD_SPH
} {
  const h = opts?.h ?? 1
  const m = opts?.m ?? 1
  const rho = opts?.rho ?? 1
  const P = opts?.P ?? 1
  const dx = opts?.dx ?? 0.5 * h
  const x0 = 0
  const x1 = dx
  const x = [x0, x1]
  const mass = [m, m]
  const press = [P, P]
  const dens = [rho, rho]
  const F0 = sphPressureForce(x, mass, press, dens, h, 0)
  const F1 = sphPressureForce(x, mass, press, dens, h, 1)
  const antiSymErr = Math.abs(F0 + F1)
  const repulsive = F0 < 0 && F1 > 0
  const ok =
    Number.isFinite(F0) &&
    Number.isFinite(F1) &&
    antiSymErr < 1e-12 &&
    repulsive &&
    Math.abs(F0) > 0

  return {
    h,
    m,
    rho,
    P,
    x0,
    x1,
    F0,
    F1,
    antiSymErr,
    repulsive,
    ok,
    methodId: METHOD_ALGO_SPH_PRESSURE_FORCE,
    familyId: METHOD_SPH,
  }
}

/**
 * 人工粘性样例：接近时 Π>0，分离时 Π=0。
 */
export function runSphArtViscSample(opts?: {
  h?: number
  alpha?: number
  beta?: number
  c?: number
  eps?: number
  rho?: number
  /** 接近相对速度幅度 */
  vApproach?: number
}): {
  h: number
  alpha: number
  beta: number
  c: number
  rho: number
  /** 接近：v·r < 0 */
  PiApproach: number
  /** 分离：v·r > 0 */
  PiSeparate: number
  /** 静止 */
  PiRest: number
  ok: boolean
  methodId: typeof METHOD_ALGO_SPH_ART_VISC
  familyId: typeof METHOD_SPH
} {
  const h = opts?.h ?? 1
  const alpha = opts?.alpha ?? 1
  const beta = opts?.beta ?? 2
  const c = opts?.c ?? 1
  const eps = opts?.eps ?? 0.01
  const rho = opts?.rho ?? 1
  const vApproach = opts?.vApproach ?? 1
  const xi = 0
  const xj = 0.5 * h
  // r = xi−xj < 0；接近时 vi>0、vj<0 → v·r < 0
  const PiApproach = monaghanArtVisc(xi, xj, vApproach, -vApproach, rho, rho, h, {
    alpha,
    beta,
    c,
    eps,
  })
  // 分离：反向
  const PiSeparate = monaghanArtVisc(xi, xj, -vApproach, vApproach, rho, rho, h, {
    alpha,
    beta,
    c,
    eps,
  })
  const PiRest = monaghanArtVisc(xi, xj, 0, 0, rho, rho, h, {
    alpha,
    beta,
    c,
    eps,
  })
  const ok =
    Number.isFinite(PiApproach) &&
    PiApproach > 0 &&
    PiSeparate === 0 &&
    PiRest === 0

  return {
    h,
    alpha,
    beta,
    c,
    rho,
    PiApproach,
    PiSeparate,
    PiRest,
    ok,
    methodId: METHOD_ALGO_SPH_ART_VISC,
    familyId: METHOD_SPH,
  }
}

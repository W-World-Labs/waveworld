/**
 * 相场二级 · 退化/变迁移率 M(φ) Allen–Cahn。
 * M(φ)=M0(1−φ²)_+：体相 |φ|≈1 时冻结，界面处驱动能量下降。
 * 可选双障碍投影 φ↦[−1,1]。method id 仅常量；不改 catalog / registry / edges。
 */
import {
  METHOD_PHASEFIELD,
  doubleWellFp,
  fieldAllFinite,
  fieldMinMax,
  initTanhInterface1d,
  interfaceEnergy1d,
  laplacian1d,
} from './phasefield-algos'

export {
  METHOD_PHASEFIELD,
  doubleWellFp,
  fieldAllFinite,
  fieldMinMax,
  initTanhInterface1d,
  interfaceEnergy1d,
  laplacian1d,
}

/** 二级 · 变迁移率 / 退化迁移率 Allen–Cahn。 */
export const METHOD_ALGO_PF_MOBILITY = 'method-algo-pf-mobility'

export const PHASEFIELD_L2_METHOD_IDS = [METHOD_ALGO_PF_MOBILITY] as const

/**
 * 退化迁移率 M(φ) = M0 · max(1 − φ², 0)。
 * 体相 |φ|≥1 时 M=0；界面 |φ|<1 时平滑过渡。
 */
export function mobilityDegenerate(phi: number, M0: number): number {
  if (!Number.isFinite(phi) || !Number.isFinite(M0)) return NaN
  const t = 1 - phi * phi
  return t > 0 ? M0 * t : 0
}

/**
 * 双障碍投影：φ ↦ clamp(φ, −1, 1)。
 * 与 obstacle potential 的子微分投影对应（教学 stub）。
 */
export function projectDoubleObstacle(
  phi: ArrayLike<number>,
  out?: Float64Array,
): Float64Array {
  const n = phi.length
  const res = out && out.length === n ? out : new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const p = phi[i]!
    if (p < -1) res[i] = -1
    else if (p > 1) res[i] = 1
    else res[i] = p
  }
  return res
}

/**
 * 变迁移率 Allen–Cahn 显式 FTCS 单步：
 *   φ_t = M(φ) (ε² φ_xx − f'(φ))
 *   M(φ) = M0 (1−φ²)_+
 * 可选投影到 [−1,1]。
 */
export function allenCahnMobilityStep1d(
  phi: Float64Array,
  dx: number,
  dt: number,
  M0: number,
  eps: number,
  out?: Float64Array,
  project = false,
): Float64Array {
  const n = phi.length
  const next = out && out.length === n ? out : new Float64Array(n)
  if (n === 0) return next
  const lap = laplacian1d(phi, dx)
  const eps2 = eps * eps
  for (let i = 0; i < n; i++) {
    const p = phi[i]!
    const M = mobilityDegenerate(p, M0)
    const rhs = M * (eps2 * lap[i]! - doubleWellFp(p))
    next[i] = p + dt * rhs
  }
  if (project) projectDoubleObstacle(next, next)
  return next
}

/**
 * 点态迁移率场 M_i = M(φ_i)。
 */
export function mobilityField(
  phi: ArrayLike<number>,
  M0: number,
  out?: Float64Array,
): Float64Array {
  const n = phi.length
  const res = out && out.length === n ? out : new Float64Array(n)
  for (let i = 0; i < n; i++) res[i] = mobilityDegenerate(phi[i]!, M0)
  return res
}

/** 平均迁移率 ⟨M⟩。 */
export function meanMobility(phi: ArrayLike<number>, M0: number): number {
  const n = phi.length
  if (n === 0) return 0
  let s = 0
  for (let i = 0; i < n; i++) s += mobilityDegenerate(phi[i]!, M0)
  return s / n
}

/**
 * 变迁移率样例：tanh 界面 + 扰动 → 若干步。
 * - 界面能下降（能量耗散梯度流）
 * - 体相 |φ|≈1 处 M≈0，序参量有界
 * - 场有限
 */
export function runPfMobilitySample(opts?: {
  n?: number
  L?: number
  eps?: number
  M0?: number
  dt?: number
  steps?: number
  project?: boolean
}): {
  n: number
  dx: number
  dt: number
  steps: number
  energy0: number
  energyF: number
  energyDrop: number
  meanM0: number
  meanMF: number
  phiMin: number
  phiMax: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_PF_MOBILITY
  familyId: typeof METHOD_PHASEFIELD
} {
  const n = opts?.n ?? 96
  const L = opts?.L ?? 6
  const eps = opts?.eps ?? 0.15
  const M0 = opts?.M0 ?? 1
  const project = opts?.project ?? false
  const dx = L / Math.max(n - 1, 1)
  // 显式 AC：dt ≲ dx² / (2 M0 ε²)，再用 max M ≤ M0
  const dtSafe =
    0.15 * (dx * dx) / Math.max(2 * M0 * eps * eps, 1e-30)
  const dt = opts?.dt ?? Math.min(4e-4, dtSafe)
  const steps = opts?.steps ?? 120

  const phi = initTanhInterface1d(n, L, eps)
  for (let i = 0; i < n; i++) {
    phi[i]! += 0.1 * Math.sin((2 * Math.PI * i) / n)
  }

  const energy0 = interfaceEnergy1d(phi, dx, eps)
  const meanM0 = meanMobility(phi, M0)
  const buf = new Float64Array(n)
  for (let s = 0; s < steps; s++) {
    allenCahnMobilityStep1d(phi, dx, dt, M0, eps, buf, project)
    for (let i = 0; i < n; i++) phi[i] = buf[i]!
  }
  const energyF = interfaceEnergy1d(phi, dx, eps)
  const energyDrop = energy0 - energyF
  const meanMF = meanMobility(phi, M0)
  const { min: phiMin, max: phiMax } = fieldMinMax(phi)
  const finite = fieldAllFinite(phi)
  const inBound = phiMin >= -1.6 && phiMax <= 1.6
  // 能量应下降（显式容差）；退化 M 仍为梯度流
  const energyOk =
    energyDrop >= -1e-6 && energyF < energy0 * 1.01 + 1e-9
  const ok =
    finite &&
    inBound &&
    Number.isFinite(energy0) &&
    Number.isFinite(energyF) &&
    energyOk &&
    energy0 > 0 &&
    meanM0 > 0

  return {
    n,
    dx,
    dt,
    steps,
    energy0,
    energyF,
    energyDrop,
    meanM0,
    meanMF,
    phiMin,
    phiMax,
    finite,
    ok,
    methodId: METHOD_ALGO_PF_MOBILITY,
    familyId: METHOD_PHASEFIELD,
  }
}

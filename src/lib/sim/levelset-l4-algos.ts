/**
 * 水平集四级 · SDF 重新初始化（伪时间 redistancing）。
 * φ_τ = S(φ0) (1 − |∇φ|)，1D 迎风 / 廉价 Godunov 哈密顿量。
 * method id 仅常量；catalog 子节点 method-algo-levelset-reinit（可未入库）。
 */
import { METHOD_LEVEL_SET } from './levelset-algos'

export { METHOD_LEVEL_SET }

/** 四级 · 水平集 reinit / redistancing。 */
export const METHOD_ALGO_LEVELSET_REINIT = 'method-algo-levelset-reinit'

export const LEVELSET_L4_METHOD_IDS = [METHOD_ALGO_LEVELSET_REINIT] as const

/** 符号函数（Sussman）：s = φ / √(φ² + ε²)。 */
export function smoothSign(phi: number, eps: number): number {
  return phi / Math.sqrt(phi * phi + eps * eps)
}

/**
 * 1D Godunov / 迎风 |φ_x|：
 * s≥0（外扩）→ √(max(max(Dm,0)², min(Dp,0)²))
 * s<0（内缩）→ √(max(max(Dp,0)², min(Dm,0)²))
 */
export function godunovGradMag1d(Dm: number, Dp: number, s: number): number {
  let a: number
  let b: number
  if (s >= 0) {
    a = Math.max(Dm, 0)
    b = Math.min(Dp, 0)
  } else {
    a = Math.max(Dp, 0)
    b = Math.min(Dm, 0)
  }
  return Math.sqrt(Math.max(a * a, b * b))
}

/**
 * 1D 单步 reinit：φ ← φ + dτ · S(φ0) · (1 − |∇φ|)
 * 等价 φ ← φ − dτ · S(φ0) · (|∇φ| − 1)。边界单侧差分。
 */
export function reinitStep1d(
  phi: Float64Array,
  phi0: Float64Array,
  dx: number,
  dtau: number,
): Float64Array {
  const n = phi.length
  const out = new Float64Array(n)
  const eps = dx
  for (let i = 0; i < n; i++) {
    const p = phi[i]!
    const Dm = i > 0 ? (p - phi[i - 1]!) / dx : (phi[Math.min(n - 1, i + 1)]! - p) / dx
    const Dp = i < n - 1 ? (phi[i + 1]! - p) / dx : (p - phi[Math.max(0, i - 1)]!) / dx
    // 端点塌缩时用可用方向
    const dm = i > 0 ? Dm : Dp
    const dp = i < n - 1 ? Dp : Dm
    const s = smoothSign(phi0[i]!, eps)
    const g = godunovGradMag1d(dm, dp, s)
    out[i] = p + dtau * s * (1 - g)
  }
  return out
}

/**
 * 对非 SDF 1D 场做若干 reinit 步，使 |φ_x| → 1。
 */
export function reinitialize1d(
  phi: Float64Array,
  dx: number,
  steps = 60,
  cfl = 0.45,
): Float64Array {
  const dtau = cfl * dx
  const phi0 = new Float64Array(phi)
  let cur = new Float64Array(phi)
  for (let s = 0; s < steps; s++) {
    cur = new Float64Array(reinitStep1d(cur, phi0, dx, dtau))
  }
  return cur
}

/**
 * 1D 解析符号距离：界面在 x0，φ = x − x0。
 */
export function sample1dSignedDistance(
  n: number,
  opts?: { x0?: number; L?: number },
): { phi: Float64Array; dx: number; x0: number; L: number } {
  const L = opts?.L ?? 1
  const x0 = opts?.x0 ?? 0.5
  const dx = L / (n - 1)
  const phi = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    phi[i] = i * dx - x0
  }
  return { phi, dx, x0, L }
}

/**
 * 中心差分 |φ_x| 相对 1 的残差（内点）。
 * - skipBand：跳过界面邻域 |x−x0|<skipBand（差分跨零点不稳）
 * - maxDist：仅统计 |x−x0|≤maxDist（reinit 特征只传到伪时间长度内）
 */
export function gradMagResidual1d(
  phi: ArrayLike<number>,
  dx: number,
  opts?: { skipBand?: number; maxDist?: number; x0?: number },
): { meanAbsGrad: number; meanRes: number; maxRes: number; samples: number } {
  const n = phi.length
  const skipBand = opts?.skipBand ?? 0
  const maxDist = opts?.maxDist
  const x0 = opts?.x0
  let sumG = 0
  let sumRes = 0
  let maxRes = 0
  let count = 0
  for (let i = 1; i < n - 1; i++) {
    if (x0 !== undefined) {
      const dist = Math.abs(i * dx - x0)
      if (skipBand > 0 && dist < skipBand) continue
      if (maxDist !== undefined && dist > maxDist) continue
    }
    const g = Math.abs((phi[i + 1]! - phi[i - 1]!) / (2 * dx))
    const res = Math.abs(g - 1)
    sumG += g
    sumRes += res
    if (res > maxRes) maxRes = res
    count++
  }
  return {
    meanAbsGrad: count ? sumG / count : 0,
    meanRes: count ? sumRes / count : 0,
    maxRes,
    samples: count,
  }
}

/**
 * 样例：扰动 1D SDF（缩放破坏 |∇φ|=1），reinit 后远离界面 |dφ/dx|≈1。
 */
export function runLevelsetReinitSample(opts?: {
  n?: number
  scale?: number
  steps?: number
  cfl?: number
}): {
  n: number
  scale: number
  steps: number
  meanAbsGrad0: number
  meanAbsGradF: number
  meanRes0: number
  meanResF: number
  /** 扰动后梯度偏离 1；reinit 后接近 1 */
  improved: boolean
  nearUnit: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_LEVELSET_REINIT
  familyId: typeof METHOD_LEVEL_SET
} {
  const n = opts?.n ?? 129
  const scale = opts?.scale ?? 2.5
  const cfl = opts?.cfl ?? 0.45
  const x0 = 0.5
  const { phi, dx } = sample1dSignedDistance(n, { x0 })
  // 伪时间覆盖半域，保证整段 |∇φ| 可被 reinit
  const Ttarget = 0.55
  const steps = opts?.steps ?? Math.ceil(Ttarget / (cfl * dx)) + 10

  // 缩放破坏 |∇φ|=1（符号与零等值面保留）
  const pert = new Float64Array(n)
  for (let i = 0; i < n; i++) pert[i] = scale * phi[i]!

  const skipBand = 3 * dx
  // 在 reinit 特征可达带内评估（略小于 T）
  const maxDist = Math.min(0.4, steps * cfl * dx * 0.85)
  const r0 = gradMagResidual1d(pert, dx, { skipBand, maxDist, x0 })
  const restored = reinitialize1d(pert, dx, steps, cfl)
  const rF = gradMagResidual1d(restored, dx, { skipBand, maxDist, x0 })

  let finite = true
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(restored[i]!)) {
      finite = false
      break
    }
  }

  // 界面零点仍在 x0 附近（符号保留）
  const mid = (n / 2) | 0
  const interfaceOk =
    Math.sign(restored[Math.max(0, mid - 2)]!) !==
      Math.sign(restored[Math.min(n - 1, mid + 2)]!) ||
    Math.abs(restored[mid]!) < 2 * dx

  const improved = rF.meanRes < r0.meanRes * 0.5
  const nearUnit = Math.abs(rF.meanAbsGrad - 1) < 0.15 && rF.meanRes < 0.2
  const ok = finite && improved && nearUnit && interfaceOk && rF.samples > 8

  return {
    n,
    scale,
    steps,
    meanAbsGrad0: r0.meanAbsGrad,
    meanAbsGradF: rF.meanAbsGrad,
    meanRes0: r0.meanRes,
    meanResF: rF.meanRes,
    improved,
    nearUnit,
    finite,
    ok,
    methodId: METHOD_ALGO_LEVELSET_REINIT,
    familyId: METHOD_LEVEL_SET,
  }
}

/**
 * Vlasov 二级 · 速度空间加速（半拉格朗日 v 流）。
 * 固定 E(x)：f_t + a(x) f_v = 0，a=(q/m)E；
 * 特征线 v* = v − a Δt，线性插值（域外 0）。
 * method id 仅常量；不改 catalog / registry / edges。
 */
import {
  METHOD_VLASOV,
  createVlasovGrid,
  depositGaussianBlob,
  densityFromF,
  phaseFinite,
  phaseMass,
  positionAt,
  velocityAt,
  type VlasovGrid,
} from './vlasov-algos'

export {
  METHOD_VLASOV,
  createVlasovGrid,
  depositGaussianBlob,
  densityFromF,
  phaseFinite,
  phaseMass,
  positionAt,
  velocityAt,
}
export type { VlasovGrid }

/** 二级 · v 方向加速（给定 E(x)）。 */
export const METHOD_ALGO_VLASOV_ACCEL = 'method-algo-vlasov-accel'

export const VLASOV_L2_METHOD_IDS = [METHOD_ALGO_VLASOV_ACCEL] as const

/**
 * 固定 ix，在速度 v 处线性插值 f；v 超出 [vmin,vmax) 返回 0。
 * 格点为单元中心：v_j = vmin + (j+½) dv。
 */
export function sampleFv(g: VlasovGrid, ix: number, v: number): number {
  const { Nv, dv, vmin, vmax, f } = g
  if (!(v >= vmin && v < vmax)) return 0
  // 连续指标：j = (v − vmin)/dv − ½
  const xi = (v - vmin) / dv - 0.5
  let j0 = Math.floor(xi)
  const frac = xi - j0
  if (j0 < -1 || j0 >= Nv) return 0
  const base = ix * Nv
  if (j0 < 0) {
    // 左外插区：仅 j=0 有权
    return f[base]! * Math.max(0, 1 - (0 - xi))
  }
  if (j0 >= Nv - 1) {
    if (j0 === Nv - 1) {
      // 在最后一格内：向右无邻居 → 衰减到 0
      return f[base + Nv - 1]! * (1 - frac)
    }
    return 0
  }
  return f[base + j0]! * (1 - frac) + f[base + j0 + 1]! * frac
}

/**
 * 半拉格朗日 v 加速：∂f/∂t + a(x) ∂f/∂v = 0，a=(q/m)E(x)。
 * f*(x,v) = f(x, v − a Δt)；域外插值取 0。就地更新。
 *
 * 注：用户 PDE 写作 f_t − (q/m)E f_v = 0 时对应 a=−(q/m)E；
 * 此处采用标准 Vlasov 形式 f_t + a f_v = 0（a=(q/m)E），
 * 符号由 qOverM 的正负吸收。
 */
export function accelSemiLagrangian(
  g: VlasovGrid,
  E: ArrayLike<number>,
  qOverM: number,
  dt: number,
): void {
  const { Nx, Nv, f } = g
  if (E.length < Nx) throw new Error('accelSemiLagrangian: E length < Nx')
  const next = new Float64Array(Nx * Nv)
  for (let ix = 0; ix < Nx; ix++) {
    const a = qOverM * E[ix]!
    for (let iv = 0; iv < Nv; iv++) {
      const v = velocityAt(g, iv)
      next[ix * Nv + iv] = sampleFv(g, ix, v - a * dt)
    }
  }
  f.set(next)
}

/**
 * 一阶迎风 v 流（固定 E）：∂f/∂t + a ∂f/∂v = 0。
 * a>0：f_j ← f_j − c (f_j − f_{j−1})，c = a dt/dv
 * a<0：迎风取 +v；域外 ghost=0。
 */
export function accelUpwind(
  g: VlasovGrid,
  E: ArrayLike<number>,
  qOverM: number,
  dt: number,
): void {
  const { Nx, Nv, dv, f } = g
  if (E.length < Nx) throw new Error('accelUpwind: E length < Nx')
  const next = new Float64Array(Nx * Nv)
  for (let ix = 0; ix < Nx; ix++) {
    const a = qOverM * E[ix]!
    const c = (a * dt) / dv
    const base = ix * Nv
    for (let iv = 0; iv < Nv; iv++) {
      const fi = f[base + iv]!
      if (c >= 0) {
        const fim = iv > 0 ? f[base + iv - 1]! : 0
        next[base + iv] = fi - c * (fi - fim)
      } else {
        const fip = iv < Nv - 1 ? f[base + iv + 1]! : 0
        next[base + iv] = fi - c * (fip - fi)
      }
    }
  }
  f.set(next)
}

/**
 * 速度质心 ⟨v⟩_f = (∫ v f dx dv) / (∫ f dx dv)。
 */
export function velocityCentroid(g: VlasovGrid): number {
  const { Nx, Nv, dx, dv, f } = g
  let num = 0
  let den = 0
  for (let ix = 0; ix < Nx; ix++) {
    for (let iv = 0; iv < Nv; iv++) {
      const w = f[ix * Nv + iv]! * dx * dv
      num += velocityAt(g, iv) * w
      den += w
    }
  }
  return den > 0 ? num / den : 0
}

/**
 * 构造常值电场 E(x)=E0（长度 Nx）。
 */
export function constantEField(Nx: number, E0: number): Float64Array {
  const E = new Float64Array(Nx)
  E.fill(E0)
  return E
}

/**
 * v 加速样例：v 方向高斯 blob + 常值 E → 质心沿 a=(q/m)E 漂移。
 * - 质量松守恒（域边界泄漏容差）
 * - 速度质心按 a·steps·dt 移动
 * - 场有限
 */
export function runVlasovAccelSample(opts?: {
  Nx?: number
  Nv?: number
  dt?: number
  steps?: number
  E0?: number
  qOverM?: number
  v0?: number
}): {
  mass0: number
  massF: number
  massRelErr: number
  vMean0: number
  vMeanF: number
  vShift: number
  expectedShift: number
  accelerated: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_VLASOV_ACCEL
  familyId: typeof METHOD_VLASOV
} {
  const Nx = opts?.Nx ?? 24
  const Nv = opts?.Nv ?? 48
  const dt = opts?.dt ?? 0.015
  const steps = opts?.steps ?? 18
  const E0 = opts?.E0 ?? 0.5
  const qOverM = opts?.qOverM ?? 1
  const v0 = opts?.v0 ?? 0

  // 较宽 v 域，避免加速后触边
  const g = createVlasovGrid(Nx, Nv, 1, -1.5, 1.5)
  depositGaussianBlob(g, 0.5, v0, 0.12, 0.1, 1)
  const mass0 = phaseMass(g)
  const vMean0 = velocityCentroid(g)

  const E = constantEField(Nx, E0)
  for (let s = 0; s < steps; s++) accelSemiLagrangian(g, E, qOverM, dt)

  const massF = phaseMass(g)
  const vMeanF = velocityCentroid(g)
  const massRelErr =
    Math.abs(massF - mass0) / Math.max(Math.abs(mass0), 1e-30)
  const vShift = vMeanF - vMean0
  const expectedShift = qOverM * E0 * steps * dt
  const finite = phaseFinite(g) && Number.isFinite(massF) && Number.isFinite(vMeanF)
  // 加速方向正确且幅度合理（插值耗散允许 30% 偏差）
  const accelerated =
    Math.sign(vShift) === Math.sign(expectedShift) &&
    Math.abs(vShift) > 0.3 * Math.abs(expectedShift) &&
    Math.abs(vShift) > 1e-3
  // 域内质量松守恒
  const ok = finite && massRelErr < 0.12 && accelerated && massF > 0

  return {
    mass0,
    massF,
    massRelErr,
    vMean0,
    vMeanF,
    vShift,
    expectedShift,
    accelerated,
    finite,
    ok,
    methodId: METHOD_ALGO_VLASOV_ACCEL,
    familyId: METHOD_VLASOV,
  }
}

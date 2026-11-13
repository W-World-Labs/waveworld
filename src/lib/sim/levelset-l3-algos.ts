/**
 * 水平集三级 · 自 φ 恢复平均曲率 κ=∇·(∇φ/|∇φ|)。
 * 圆 SDF：解析 κ=1/R（2D）；教学骨架。
 * method id 仅常量；catalog 子节点 method-algo-levelset-curvature。
 */
import {
  METHOD_LEVEL_SET,
  sampleCircleSdf,
  signedDistanceCircle,
} from './levelset-algos'

export { METHOD_LEVEL_SET, signedDistanceCircle }

/** 三级 · 平均曲率。 */
export const METHOD_ALGO_LEVELSET_CURVATURE = 'method-algo-levelset-curvature'

export const LEVELSET_L3_METHOD_IDS = [METHOD_ALGO_LEVELSET_CURVATURE] as const

/**
 * 中心差分 ∇φ 与 |∇φ|（内点；边界夹取）。
 */
export function gradPhi(
  phi: ArrayLike<number>,
  nx: number,
  ny: number,
  dx: number,
  dy: number,
  i: number,
  j: number,
): { gx: number; gy: number; mag: number } {
  const im = Math.max(0, i - 1)
  const ip = Math.min(nx - 1, i + 1)
  const jm = Math.max(0, j - 1)
  const jp = Math.min(ny - 1, j + 1)
  const gx = (phi[j * nx + ip]! - phi[j * nx + im]!) / ((ip - im) * dx || dx)
  const gy = (phi[jp * nx + i]! - phi[jm * nx + i]!) / ((jp - jm) * dy || dy)
  const mag = Math.hypot(gx, gy)
  return { gx, gy, mag }
}

/**
 * 平均曲率 κ = ∇·(∇φ / |∇φ|)。
 * 用 n=∇φ/(|∇φ|+ε) 的中心散度；ε 防零梯度。
 */
export function meanCurvatureAt(
  phi: ArrayLike<number>,
  nx: number,
  ny: number,
  dx: number,
  dy: number,
  i: number,
  j: number,
  eps = 1e-8,
): number {
  // n 在左右/上下半点，再差分散度
  const nAt = (ii: number, jj: number) => {
    const g = gradPhi(phi, nx, ny, dx, dy, ii, jj)
    const den = g.mag + eps
    return { nx: g.gx / den, ny: g.gy / den }
  }
  const im = Math.max(0, i - 1)
  const ip = Math.min(nx - 1, i + 1)
  const jm = Math.max(0, j - 1)
  const jp = Math.min(ny - 1, j + 1)
  const nR = nAt(ip, j)
  const nL = nAt(im, j)
  const nU = nAt(i, jp)
  const nD = nAt(i, jm)
  const dnx = (nR.nx - nL.nx) / ((ip - im) * dx || dx)
  const dny = (nU.ny - nD.ny) / ((jp - jm) * dy || dy)
  return dnx + dny
}

/**
 * 界面带 |φ|<band 内曲率采样均值。
 */
export function sampleCurvatureNearInterface(
  phi: Float64Array,
  nx: number,
  ny: number,
  dx: number,
  dy: number,
  band: number,
): { meanK: number; samples: number; maxAbsK: number } {
  let sum = 0
  let n = 0
  let maxAbs = 0
  for (let j = 2; j < ny - 2; j++) {
    for (let i = 2; i < nx - 2; i++) {
      const p = phi[j * nx + i]!
      if (Math.abs(p) > band) continue
      const k = meanCurvatureAt(phi, nx, ny, dx, dy, i, j)
      if (!Number.isFinite(k)) continue
      sum += k
      n++
      if (Math.abs(k) > maxAbs) maxAbs = Math.abs(k)
    }
  }
  return { meanK: n ? sum / n : 0, samples: n, maxAbsK: maxAbs }
}

/**
 * 圆 SDF 曲率样例：界面附近 mean(κ) ≈ 1/R。
 */
export function runLevelsetCurvatureSample(opts?: {
  n?: number
  R?: number
}): {
  n: number
  R: number
  analyticK: number
  meanK: number
  relErr: number
  samples: number
  ok: boolean
  methodId: typeof METHOD_ALGO_LEVELSET_CURVATURE
  familyId: typeof METHOD_LEVEL_SET
} {
  const n = opts?.n ?? 65
  const R = opts?.R ?? 0.28
  const { phi, dx, dy } = sampleCircleSdf(n, n, {
    cx: 0.5,
    cy: 0.5,
    R,
  })
  const analyticK = 1 / R
  const band = 2.5 * Math.max(dx, dy)
  const { meanK, samples } = sampleCurvatureNearInterface(
    phi,
    n,
    n,
    dx,
    dy,
    band,
  )
  const relErr = Math.abs(meanK - analyticK) / analyticK
  return {
    n,
    R,
    analyticK,
    meanK,
    relErr,
    samples,
    ok: samples > 8 && relErr < 0.15,
    methodId: METHOD_ALGO_LEVELSET_CURVATURE,
    familyId: METHOD_LEVEL_SET,
  }
}

/**
 * 有限元三级 · 共轭梯度（CG）解 SPD 三对角 Poisson（1D FEM/FD）。
 * 残差单调下降；与 Thomas 直接解对照。
 * method id 仅常量，不改 methods.data / moduleRegistry。
 */
import {
  FEM_L2_PARENT,
  assemblePoisson1d,
  solveTridiag,
  analyticPoisson1d,
  type FemTridiagSystem,
} from './fem-l2-algos'

export {
  FEM_L2_PARENT,
  assemblePoisson1d,
  solveTridiag,
  analyticPoisson1d,
}
export type { FemTridiagSystem }

/** 父族（与 methods.data 中 method-fem 对齐）。 */
export const FEM_L3_PARENT = FEM_L2_PARENT

/** 三级 · 共轭梯度解 SPD 系统。 */
export const METHOD_ALGO_FEM_CG = 'method-algo-fem-cg'

export const FEM_L3_METHOD_IDS = [METHOD_ALGO_FEM_CG] as const

/** y = A x，A 为三对角（a 下、b 主、c 上；a[0]/c[n-1] 未用）。 */
export function tridiagMatVec(
  a: Float64Array | number[],
  b: Float64Array | number[],
  c: Float64Array | number[],
  x: Float64Array | number[],
  y: Float64Array,
): void {
  const n = b.length
  for (let i = 0; i < n; i++) {
    let s = b[i]! * x[i]!
    if (i > 0) s += a[i]! * x[i - 1]!
    if (i < n - 1) s += c[i]! * x[i + 1]!
    y[i] = s
  }
}

/** ‖v‖₂ */
export function norm2(v: Float64Array | number[]): number {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!
  return Math.sqrt(s)
}

/** 点积 */
export function dot(u: Float64Array | number[], v: Float64Array | number[]): number {
  let s = 0
  for (let i = 0; i < u.length; i++) s += u[i]! * v[i]!
  return s
}

export type CgResult = {
  x: Float64Array
  /** 每步残差 ‖r‖₂（含初值） */
  residuals: number[]
  iterations: number
  converged: boolean
}

/**
 * 共轭梯度解 A x = d，A 对称正定三对角。
 * 初值 x0 缺省 0；tol 相对/绝对混合：‖r‖ < tol · max(1, ‖d‖)。
 */
export function conjugateGradientTridiag(
  a: Float64Array | number[],
  b: Float64Array | number[],
  c: Float64Array | number[],
  d: Float64Array | number[],
  opts?: { maxIter?: number; tol?: number; x0?: Float64Array },
): CgResult {
  const n = b.length
  if (a.length !== n || c.length !== n || d.length !== n) {
    throw new Error('conjugateGradientTridiag: length mismatch')
  }
  const maxIter = opts?.maxIter ?? Math.max(2 * n, 50)
  const tol = opts?.tol ?? 1e-12
  const x = opts?.x0 ? new Float64Array(opts.x0) : new Float64Array(n)

  const r = new Float64Array(n)
  const Ap = new Float64Array(n)
  const p = new Float64Array(n)

  // r = d − A x
  tridiagMatVec(a, b, c, x, Ap)
  for (let i = 0; i < n; i++) r[i] = d[i]! - Ap[i]!
  for (let i = 0; i < n; i++) p[i] = r[i]!

  const residuals: number[] = []
  let rsold = dot(r, r)
  residuals.push(Math.sqrt(rsold))
  const bNorm = Math.max(norm2(d), 1)
  const thresh = tol * bNorm

  let iterations = 0
  let converged = residuals[0]! < thresh

  if (!converged) {
    for (let k = 0; k < maxIter; k++) {
      tridiagMatVec(a, b, c, p, Ap)
      const pAp = dot(p, Ap)
      if (!(pAp > 0) || !Number.isFinite(pAp)) break
      const alpha = rsold / pAp
      for (let i = 0; i < n; i++) {
        x[i]! += alpha * p[i]!
        r[i]! -= alpha * Ap[i]!
      }
      const rsnew = dot(r, r)
      const rn = Math.sqrt(rsnew)
      residuals.push(rn)
      iterations = k + 1
      if (rn < thresh) {
        converged = true
        break
      }
      const beta = rsnew / rsold
      for (let i = 0; i < n; i++) p[i] = r[i]! + beta * p[i]!
      rsold = rsnew
    }
  }

  return { x, residuals, iterations, converged }
}

/**
 * CG 解 1D FEM Poisson −u″=f，齐次 Dirichlet。
 */
export function solvePoisson1dCg(
  M: number,
  f = 1,
  opts?: { maxIter?: number; tol?: number },
): {
  u: Float64Array
  h: number
  system: FemTridiagSystem
  cg: CgResult
} {
  const system = assemblePoisson1d(M, f)
  const cg = conjugateGradientTridiag(
    system.a,
    system.b,
    system.c,
    system.d,
    opts,
  )
  return { u: cg.x, h: system.h, system, cg }
}

/**
 * 样例：CG 残差下降，逼近 Thomas 直接解与解析中点。
 */
export function runFemCgSample(
  M = 32,
  fLoad = 1,
): {
  M: number
  iterations: number
  residual0: number
  residualF: number
  residualDecreased: boolean
  /** 与 Thomas 解的 max |Δu| */
  vsThomasMax: number
  midU: number
  analyticMid: number
  errMid: number
  converged: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_FEM_CG
  familyId: typeof FEM_L3_PARENT
} {
  const system = assemblePoisson1d(M, fLoad)
  const cg = conjugateGradientTridiag(
    system.a,
    system.b,
    system.c,
    system.d,
    { tol: 1e-12, maxIter: Math.max(4 * M, 100) },
  )
  const thomas = solveTridiag(system.a, system.b, system.c, system.d)

  let vsThomasMax = 0
  let finite = true
  for (let i = 0; i < M; i++) {
    const du = Math.abs(cg.x[i]! - thomas[i]!)
    if (du > vsThomasMax) vsThomasMax = du
    if (!Number.isFinite(cg.x[i]!)) finite = false
  }

  const residual0 = cg.residuals[0]!
  const residualF = cg.residuals[cg.residuals.length - 1]!
  const residualDecreased =
    residualF < residual0 * 0.01 || residualF < 1e-10

  const midIdx = Math.floor(M / 2)
  const midU = cg.x[midIdx]!
  const xMid = (midIdx + 1) * system.h
  const analyticMid = analyticPoisson1d(xMid, fLoad)
  const errMid = Math.abs(midU - analyticMid)

  const ok =
    residualDecreased &&
    vsThomasMax < 1e-8 &&
    errMid < 1e-2 &&
    finite &&
    cg.converged

  return {
    M,
    iterations: cg.iterations,
    residual0,
    residualF,
    residualDecreased,
    vsThomasMax,
    midU,
    analyticMid,
    errMid,
    converged: cg.converged,
    finite,
    ok,
    methodId: METHOD_ALGO_FEM_CG,
    familyId: FEM_L3_PARENT,
  }
}

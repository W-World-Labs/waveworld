/**
 * 无迹卡尔曼 UKF · Sigma 点 + 无迹变换纯函数。
 * 2n+1 点经非线性 f 后恢复均值/协方差；免雅可比。
 * method id 仅常量；catalog 子节点 method-algo-ukf-sigma。
 */
import { METHOD_KALMAN } from './ekf-algos'

export { METHOD_KALMAN }

/** UKF sigma 点变换原子。 */
export const METHOD_ALGO_UKF_SIGMA = 'method-algo-ukf-sigma'

export const UKF_METHOD_IDS = [METHOD_ALGO_UKF_SIGMA] as const

export type UkfWeights = {
  n: number
  lambda: number
  Wm: Float64Array
  Wc: Float64Array
  c: number // √(n+λ)
}

/**
 * 标准 UKF 权重（Julier）：α 散布、β 先验、κ 次级。
 * λ = α²(n+κ) − n；c = √(n+λ)。
 */
export function ukfWeights(
  n: number,
  alpha = 1e-3,
  beta = 2,
  kappa = 0,
): UkfWeights {
  if (n < 1) throw new Error('ukfWeights: n ≥ 1')
  const lambda = alpha * alpha * (n + kappa) - n
  const c = Math.sqrt(n + lambda)
  const Wm = new Float64Array(2 * n + 1)
  const Wc = new Float64Array(2 * n + 1)
  Wm[0] = lambda / (n + lambda)
  Wc[0] = Wm[0]! + (1 - alpha * alpha + beta)
  const w = 1 / (2 * (n + lambda))
  for (let i = 1; i <= 2 * n; i++) {
    Wm[i] = w
    Wc[i] = w
  }
  return { n, lambda, Wm, Wc, c }
}

/**
 * 1D：sqrtP = √P（标量）。
 * nD：对角协方差 √P_ii（教学；非对角需 Cholesky）。
 */
export function sqrtDiagP(P: Float64Array): Float64Array {
  const s = new Float64Array(P.length)
  for (let i = 0; i < P.length; i++) {
    if (!(P[i]! >= 0)) throw new Error('P must be ≥ 0 on diagonal')
    s[i] = Math.sqrt(P[i]!)
  }
  return s
}

/**
 * 生成 2n+1 sigma 点（对角 P）：
 * χ₀ = x
 * χ_i = x + c · e_i √P_ii
 * χ_{i+n} = x − c · e_i √P_ii
 * 返回 (2n+1)×n 行主序扁平数组。
 */
export function sigmaPoints(
  x: Float64Array,
  Pdiag: Float64Array,
  c: number,
): Float64Array {
  const n = x.length
  if (Pdiag.length !== n) throw new Error('Pdiag length must match x')
  const sqrtP = sqrtDiagP(Pdiag)
  const out = new Float64Array((2 * n + 1) * n)
  // χ0
  for (let j = 0; j < n; j++) out[j] = x[j]!
  for (let i = 0; i < n; i++) {
    const rowP = (1 + i) * n
    const rowM = (1 + n + i) * n
    for (let j = 0; j < n; j++) {
      const d = i === j ? c * sqrtP[i]! : 0
      out[rowP + j] = x[j]! + d
      out[rowM + j] = x[j]! - d
    }
  }
  return out
}

/** 取第 i 个 sigma 点（长度 n）。 */
export function sigmaRow(chi: Float64Array, n: number, i: number): Float64Array {
  const row = new Float64Array(n)
  const base = i * n
  for (let j = 0; j < n; j++) row[j] = chi[base + j]!
  return row
}

/**
 * 无迹变换：Y_i = f(χ_i)，再加权均值/协方差。
 * f: R^n → R^m；此处 m=n 同维（状态传播教学）。
 */
export function unscentedTransform(
  chi: Float64Array,
  n: number,
  Wm: Float64Array,
  Wc: Float64Array,
  f: (x: Float64Array) => Float64Array,
  Qdiag?: Float64Array,
): { yMean: Float64Array; Pdiag: Float64Array; Y: Float64Array } {
  const nSig = 2 * n + 1
  const y0 = f(sigmaRow(chi, n, 0))
  const m = y0.length
  const Y = new Float64Array(nSig * m)
  for (let j = 0; j < m; j++) Y[j] = y0[j]!
  for (let i = 1; i < nSig; i++) {
    const yi = f(sigmaRow(chi, n, i))
    for (let j = 0; j < m; j++) Y[i * m + j] = yi[j]!
  }
  const yMean = new Float64Array(m)
  for (let i = 0; i < nSig; i++) {
    for (let j = 0; j < m; j++) yMean[j]! += Wm[i]! * Y[i * m + j]!
  }
  const Pdiag = new Float64Array(m)
  for (let i = 0; i < nSig; i++) {
    for (let j = 0; j < m; j++) {
      const d = Y[i * m + j]! - yMean[j]!
      Pdiag[j]! += Wc[i]! * d * d
    }
  }
  if (Qdiag) {
    for (let j = 0; j < m; j++) Pdiag[j]! += Qdiag[j] ?? 0
  }
  return { yMean, Pdiag, Y }
}

/**
 * 1D 非线性 f(x)=x² 无迹变换：对拍解析
 * E[x²]=μ²+σ²，Var(x²)=…（高斯四阶矩）。
 */
export function runUkfSigmaSample(opts?: {
  mu?: number
  sigma?: number
  alpha?: number
}): {
  n: number
  nSigma: number
  mu: number
  sigma: number
  yMean: number
  analyticMean: number
  meanErr: number
  Pyy: number
  analyticVar: number
  varRelErr: number
  ok: boolean
  methodId: typeof METHOD_ALGO_UKF_SIGMA
  familyId: typeof METHOD_KALMAN
} {
  const mu = opts?.mu ?? 1.2
  const sigma = opts?.sigma ?? 0.4
  const alpha = opts?.alpha ?? 0.5 // 稍大便于数值稳定演示
  const n = 1
  const w = ukfWeights(n, alpha, 2, 0)
  const x = new Float64Array([mu])
  const P = new Float64Array([sigma * sigma])
  const chi = sigmaPoints(x, P, w.c)
  const { yMean, Pdiag } = unscentedTransform(
    chi,
    n,
    w.Wm,
    w.Wc,
    (z) => new Float64Array([z[0]! * z[0]!]),
  )
  // 高斯：E[x²]=μ²+σ²；Var(x²)=2σ⁴+4μ²σ²
  const analyticMean = mu * mu + sigma * sigma
  const analyticVar = 2 * sigma ** 4 + 4 * mu * mu * sigma * sigma
  const meanErr = Math.abs(yMean[0]! - analyticMean)
  const varRelErr =
    analyticVar > 0 ? Math.abs(Pdiag[0]! - analyticVar) / analyticVar : 0
  return {
    n,
    nSigma: 2 * n + 1,
    mu,
    sigma,
    yMean: yMean[0]!,
    analyticMean,
    meanErr,
    Pyy: Pdiag[0]!,
    analyticVar,
    varRelErr,
    ok: meanErr < 1e-9 && varRelErr < 0.25,
    methodId: METHOD_ALGO_UKF_SIGMA,
    familyId: METHOD_KALMAN,
  }
}

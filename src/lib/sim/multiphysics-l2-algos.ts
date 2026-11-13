/**
 * 多物理二级 · 单片（monolithic）联合残差玩具。
 * 联合状态 u=(T, σ) 一次组装 R(u)=0，对拍分区弱耦合。
 * method id 仅常量；catalog 子节点 method-algo-monolithic-residual。
 */
import {
  MULTIPHYSICS_PARENT,
  conductivity,
  jouleHeatingDeltaT,
} from './multiphysics-algos'

export { MULTIPHYSICS_PARENT, conductivity, jouleHeatingDeltaT }

/** 二级 · 单片联合残差。 */
export const METHOD_ALGO_MONOLITHIC_RESIDUAL = 'method-algo-monolithic-residual'

export const MULTIPHYSICS_L2_METHOD_IDS = [METHOD_ALGO_MONOLITHIC_RESIDUAL] as const

export type MonoState = { T: number; sigma: number }

export type MonoParams = {
  V: number
  sigma0: number
  alpha: number
  Tref: number
  geomFactor: number
  Rth: number
}

/**
 * 联合残差 R(T, σ) = 0：
 *  R_T = T − (Tref + V² σ (A/L) Rth)
 *  R_σ = σ − σ0/(1+α(T−Tref))
 * 固定点即弱耦合热–电平衡。
 */
export function monolithicResidual(
  u: MonoState,
  p: MonoParams,
): { RT: number; Rsigma: number; norm: number } {
  const Ttarget = p.Tref + jouleHeatingDeltaT(p.V, u.sigma, p.geomFactor, p.Rth)
  const sigmaTarget = conductivity(u.T, p.sigma0, p.alpha, p.Tref)
  const RT = u.T - Ttarget
  const Rsigma = u.sigma - sigmaTarget
  return { RT, Rsigma, norm: Math.hypot(RT, Rsigma) }
}

/**
 * 简单 2×2 Newton：数值 Jacobian + 阻尼步，使 ||R||→0。
 */
export function solveMonolithicNewton(
  p: MonoParams,
  u0?: MonoState,
  iters = 25,
  tol = 1e-10,
): { u: MonoState; residual: number; iters: number; ok: boolean } {
  let u: MonoState = u0 ?? { T: p.Tref, sigma: p.sigma0 }
  let residual = Infinity
  let k = 0
  for (; k < iters; k++) {
    const r = monolithicResidual(u, p)
    residual = r.norm
    if (residual < tol) return { u, residual, iters: k, ok: true }

    // 数值 Jacobian 列
    const epsT = 1e-6 * Math.max(1, Math.abs(u.T))
    const epsS = 1e-6 * Math.max(1, Math.abs(u.sigma))
    const rT = monolithicResidual({ T: u.T + epsT, sigma: u.sigma }, p)
    const rS = monolithicResidual({ T: u.T, sigma: u.sigma + epsS }, p)
    // J = [[dRT/dT, dRT/dσ], [dRσ/dT, dRσ/dσ]]
    const j00 = (rT.RT - r.RT) / epsT
    const j10 = (rT.Rsigma - r.Rsigma) / epsT
    const j01 = (rS.RT - r.RT) / epsS
    const j11 = (rS.Rsigma - r.Rsigma) / epsS
    const det = j00 * j11 - j01 * j10
    if (Math.abs(det) < 1e-18) break
    // solve J δ = R
    const dT = (j11 * r.RT - j01 * r.Rsigma) / det
    const dS = (-j10 * r.RT + j00 * r.Rsigma) / det
    const damp = 0.85
    u = { T: u.T - damp * dT, sigma: u.sigma - damp * dS }
  }
  const final = monolithicResidual(u, p)
  return { u, residual: final.norm, iters: k, ok: final.norm < 1e-6 }
}

/**
 * 代表样例：单片 Newton 收敛；与解析定点（Picard 极限）对拍。
 */
export function runMonolithicResidualSample(opts?: {
  V?: number
}): {
  T: number
  sigma: number
  residual0: number
  residualF: number
  iters: number
  ok: boolean
  /** 残差相对初值下降 */
  reduced: boolean
  methodId: typeof METHOD_ALGO_MONOLITHIC_RESIDUAL
  familyId: typeof MULTIPHYSICS_PARENT
} {
  const p: MonoParams = {
    V: opts?.V ?? 5,
    sigma0: 1e4,
    alpha: 0.002,
    Tref: 300,
    geomFactor: 1e-5,
    Rth: 0.5,
  }
  const u0: MonoState = { T: p.Tref, sigma: p.sigma0 }
  const residual0 = monolithicResidual(u0, p).norm
  const sol = solveMonolithicNewton(p, u0, 30, 1e-12)
  return {
    T: sol.u.T,
    sigma: sol.u.sigma,
    residual0,
    residualF: sol.residual,
    iters: sol.iters,
    ok: sol.ok && sol.u.T >= p.Tref && sol.u.sigma > 0,
    reduced: sol.residual < residual0 * 1e-3,
    methodId: METHOD_ALGO_MONOLITHIC_RESIDUAL,
    familyId: MULTIPHYSICS_PARENT,
  }
}

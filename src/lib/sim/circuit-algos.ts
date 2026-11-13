/**
 * 集总电路方法族 · 一级细分算法单元（纯函数）。
 * 对应 method-lumped-circuit 下的子方法：
 *   method-algo-series-rlc / method-algo-rc-rl-transient / method-algo-mutual
 * 在既有 rlc / transient / mutual 核心上提供统一的「子算法」入口，供目录嵌套与对拍测试。
 */

import { WasmTransient } from './wasm-fields'

import {
  dampingRatio,
  energy,
  resonantFreq,
  simulate as simulateRlc,
  type RlcParams,
  type RlcState,
} from './rlc'
import {
  couplingCoefficient,
  simulate as simulateMutual,
  type MutualParams,
  type MutualState,
} from './mutual'
import {
  firstOrderStep,
  rcCharge,
  timeConstantRC,
  type RcParams,
  type RcState,
} from './transient'

/** 与 methods.data 子节点 id 对齐的算法键 */
export type LumpedAlgoId =
  | 'series-rlc-rk4'
  | 'rc-rl-transient'
  | 'mutual-coupled'

export const LUMPED_ALGO_METHOD_IDS: Record<LumpedAlgoId, string> = {
  'series-rlc-rk4': 'method-algo-series-rlc',
  'rc-rl-transient': 'method-algo-rc-rl-transient',
  'mutual-coupled': 'method-algo-mutual',
}

export const LUMPED_PARENT_METHOD_ID = 'method-lumped-circuit'

/**
 * 串联 RLC · RK4：欠阻尼自由衰减一步序列，返回末态与解析 ω₀。
 * 代表输入：L=1e-3 H, C=1e-6 F, R 小阻尼, V=0, 初值 q=1e-6, i=0。
 */
export function runSeriesRlcSample(steps = 200, dt = 1e-7): {
  final: RlcState
  omega0: number
  zeta: number
  energy0: number
  energyF: number
} {
  const p: RlcParams = { L: 1e-3, R: 2, C: 1e-6, V: 0 }
  let s: RlcState = { q: 1e-6, i: 0 }
  const energy0 = energy(s, p)
  s = simulateRlc(s, p, dt, steps).at(-1)!
  return {
    final: s,
    omega0: resonantFreq(p.L, p.C),
    zeta: dampingRatio(p.R, p.L, p.C),
    energy0,
    energyF: energy(s, p),
  }
}

/**
 * RC 暂态：解析充电在 t=τ 应 ≈ 0.632 V0；数值 RK4 从 0 积分到 τ 对拍。
 */
export function runRcTransientSample(): {
  analyticAtTau: number
  numericAtTau: number
  tau: number
  V0: number
} {
  const owner = new WasmTransient()
  const V0 = 5
  const R = 1e3
  const C = 1e-6
  const tau = timeConstantRC(R, C)
  const analyticAtTau = rcCharge(tau, V0, R, C)
  const p: RcParams = { V: V0, R, C }
  let s: RcState = { Vc: 0 }
  const dt = tau / 400
  for (let i = 0; i < 400; i++) s = firstOrderStep(s, p, dt, owner)
  return { analyticAtTau, numericAtTau: s.Vc, tau, V0 }
}

/**
 * 互感耦合：给定 L1,L2,M 计算 k，并 RK4 推进空载次级一步序列。
 */
export function runMutualSample(steps = 100, dt = 1e-5): {
  k: number
  final: MutualState
} {
  const L1 = 0.01
  const L2 = 0.01
  const M = 0.008
  const p: MutualParams = {
    L1, L2, M, R1: 1, R2: 1, V1: 1, V2: 0,
  }
  let s: MutualState = { i1: 0, i2: 0 }
  s = simulateMutual(s, p, dt, steps).at(-1)!
  return { k: couplingCoefficient(M, L1, L2), final: s }
}

/** 统一分发：按子算法 id 跑代表样例（供注册表 / 测试驱动真实入口）。 */
export function runLumpedAlgo(id: LumpedAlgoId): unknown {
  switch (id) {
    case 'series-rlc-rk4':
      return runSeriesRlcSample()
    case 'rc-rl-transient':
      return runRcTransientSample()
    case 'mutual-coupled':
      return runMutualSample()
    default: {
      const _exhaustive: never = id
      return _exhaustive
    }
  }
}

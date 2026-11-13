/**
 * 集总电路 · 二级算法：串联 RLC 并行积分器（Euler ‖ RK4）。
 * 不注册 methods.data；method id 仅作字符串常量供未来目录挂接。
 * RK4 对应既有 method-algo-series-rlc（即 method-algo-rlc-rk4 语义）；
 * Euler 为新 id method-algo-rlc-euler（registry 可跳过）。
 */
import {
  energy,
  simulate,
  type RlcParams,
  type RlcState,
} from './rlc'

/** 父族（与 methods.data 中 series-rlc 的 parentId 对齐）。 */
export const CIRCUIT_L2_PARENT = 'method-lumped-circuit'

/**
 * RK4 路径的方法 id —— 已存在于 methods.data 的 method-algo-series-rlc
 *（语义别名 method-algo-rlc-rk4，不新增 registry 节点）。
 */
export const CIRCUIT_L2_RK4_METHOD_ID = 'method-algo-series-rlc'

/** 显式欧拉路径的方法 id（仅常量，不写入 methods.data）。 */
export const CIRCUIT_L2_EULER_METHOD_ID = 'method-algo-rlc-euler'

/** 无阻尼默认参数：纯数值能量漂移对比（R=0 时物理守恒）。 */
const DEFAULT_P: RlcParams = { L: 1, R: 0, C: 1, V: 0 }
const DEFAULT_S0: RlcState = { q: 1, i: 0 }

/**
 * 显式欧拉单步（粗积分器对照）：
 *   q ← q + dt·i
 *   i ← i + dt·(V − R·i − q/C)/L
 * 不修改入参。相对 RK4 在 R=0 时能量漂移明显更大。
 */
export function rlcEulerStep(state: RlcState, p: RlcParams, dt: number): RlcState {
  const { q, i } = state
  const di = (p.V - p.R * i - q / p.C) / p.L
  return {
    q: q + dt * i,
    i: i + dt * di,
  }
}

export interface RlcIntegratorSample {
  final: RlcState
  energy0: number
  energyF: number
  /** |E_f − E_0| / E_0（相对能量漂移） */
  drift: number
  steps: number
  dt: number
}

function sampleParams(
  p?: Partial<RlcParams>,
  s0?: Partial<RlcState>,
): { p: RlcParams; s0: RlcState } {
  return {
    p: { ...DEFAULT_P, ...p },
    s0: { ...DEFAULT_S0, ...s0 },
  }
}

/**
 * 串联 RLC · 显式欧拉多样本：固定步长积分后返回末态与能量漂移。
 */
export function runEulerRlcSample(
  steps = 2000,
  dt = 0.02,
  pIn?: Partial<RlcParams>,
  s0In?: Partial<RlcState>,
): RlcIntegratorSample {
  const { p, s0 } = sampleParams(pIn, s0In)
  let s: RlcState = { ...s0 }
  const energy0 = energy(s, p)
  for (let n = 0; n < steps; n++) s = rlcEulerStep(s, p, dt)
  const energyF = energy(s, p)
  const drift = energy0 > 0 ? Math.abs(energyF - energy0) / energy0 : 0
  return { final: s, energy0, energyF, drift, steps, dt }
}

/**
 * 串联 RLC · RK4 多样本：委托既有 rlcStep，同初值/步数/步长便于与欧拉对拍。
 */
export function runRk4RlcSample(
  steps = 2000,
  dt = 0.02,
  pIn?: Partial<RlcParams>,
  s0In?: Partial<RlcState>,
): RlcIntegratorSample {
  const { p, s0 } = sampleParams(pIn, s0In)
  let s: RlcState = { ...s0 }
  const energy0 = energy(s, p)
  s = simulate(s, p, dt, steps).at(-1)!
  const energyF = energy(s, p)
  const drift = energy0 > 0 ? Math.abs(energyF - energy0) / energy0 : 0
  return { final: s, energy0, energyF, drift, steps, dt }
}

/**
 * 并行积分器对拍：同一 (steps, dt, p, s0) 下比较 Euler vs RK4 能量漂移。
 */
export function compareRlcIntegratorEnergyDrift(
  steps = 2000,
  dt = 0.02,
): {
  euler: RlcIntegratorSample
  rk4: RlcIntegratorSample
  /** true 当 RK4 漂移严格小于欧拉（非平凡优势） */
  rk4Better: boolean
} {
  const euler = runEulerRlcSample(steps, dt)
  const rk4 = runRk4RlcSample(steps, dt)
  return {
    euler,
    rk4,
    rk4Better: rk4.drift < euler.drift,
  }
}

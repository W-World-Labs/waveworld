// RC / RL 一阶暂态 —— 解析解 + 数值对拍（纯函数、SI 单位、无副作用）。
//
// 一阶 RC 充放电与 RL 建流是「线性一阶常微分方程」的样板：单一储能元件（电容储电场能 /
// 电感储磁场能）与电阻耗散组成，响应是单指数趋稳，特征时间为时间常数 τ。
//   RC 充电： Vc(t) = V0·(1 − e^(−t/RC))           ODE: dVc/dt = (V − Vc)/(RC)
//   RC 放电： Vc(t) = V0·e^(−t/RC)
//   RL 建流： i(t)  = (V0/R)·(1 − e^(−t/(L/R)))      （电感对电流的「惯性」）
//   τ_RC = RC（秒），τ_RL = L/R（秒）
// 物理事实（任意一阶系统）：t=τ 达到 63.2% 终值、t=5τ 已达 >99% 视为稳态、放电 t=τ 落到 36.8%。
// 参考：Sadiku《Fundamentals of Electric Circuits》一阶电路章；时间常数定义见任意电路学教材。

import { param } from './params'
import { WasmTransient } from './wasm-fields'

/**
 * 「t=τ 时充电达 63.2% 终值」中的 1 − 1/e。
 * 来源：一阶指数响应在一个时间常数处的解析值 1 − e^(−1) ≈ 0.632120559。
 */
export const ONE_MINUS_INV_E = param(
  0.6321205588285577,
  '约化',
  '一阶指数响应 1 − e^(−1)；Sadiku 一阶电路（充电到 63.2%）',
  'node:electrical',
)

/**
 * 「放电/衰减 t=τ 落到 36.8%」中的 1/e。
 * 来源：一阶指数衰减在一个时间常数处的解析值 e^(−1) ≈ 0.367879441。
 */
export const INV_E = param(
  0.36787944117144233,
  '约化',
  '一阶指数衰减 e^(−1)；Sadiku 一阶电路（放电到 36.8%）',
  'node:electrical',
)

/** RC 时间常数 τ = R·C（单位：秒；R[Ω]，C[F]）。 */
export function timeConstantRC(R: number, C: number, owner = new WasmTransient()): number {
  return owner.tauRC(R, C)
}

/** RL 时间常数 τ = L/R（单位：秒；L[H]，R[Ω]）。 */
export function timeConstantRL(L: number, R: number, owner = new WasmTransient()): number {
  return owner.tauRL(L, R)
}

/** RC 充电：电容电压 Vc(t) = V0·(1 − e^(−t/RC))，从 0 趋向 V0。 */
export function rcCharge(t: number, V0: number, R: number, C: number, owner = new WasmTransient()): number {
  return owner.charge(t, V0, R, C)
}

/** RC 放电：电容电压 Vc(t) = V0·e^(−t/RC)，从 V0 趋向 0。 */
export function rcDischarge(t: number, V0: number, R: number, C: number, owner = new WasmTransient()): number {
  return owner.discharge(t, V0, R, C)
}

/** RL 建流：电感电流 i(t) = (V0/R)·(1 − e^(−t/(L/R)))，从 0 趋向稳态 V0/R。 */
export function rlCurrent(t: number, V0: number, R: number, L: number, owner = new WasmTransient()): number {
  return owner.current(t, V0, R, L)
}

/** RC 一阶 ODE 的状态：仅电容电压 Vc[V]。 */
export interface RcState {
  Vc: number
}

/** RC 一阶 ODE 的参数：电源电压 V[V]、电阻 R[Ω]、电容 C[F]。 */
export interface RcParams {
  V: number
  R: number
  C: number
}

/** Classic RK4, evaluated by the shared Rust core. Reuse owner for repeated calls. */
export function firstOrderStep(state: RcState, p: RcParams, dt: number, owner = new WasmTransient()): RcState {
  return { Vc: owner.step(state.Vc, p, dt) }
}

export type TransientScene = { mode: 'rc-charge' | 'rc-discharge' | 'rl'; v0: number; r: number; c: number; l: number }
export const TRANSIENT_SAMPLES = 241
/** SI inputs; one analytic curve spanning 0..5 tau, independent of playback. */
export function transientResult(scene: TransientScene, owner = new WasmTransient()) {
  return owner.solve(scene)
}

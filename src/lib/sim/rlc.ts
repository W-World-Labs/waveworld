// 串联 RLC 谐振电路（电物理 ODE 核心）。
// 回路 KVL：V(t) = L·di/dt + R·i + q/C，配合 dq/dt = i，得到一个二阶线性系统。
// 状态 { q, i }：q 为电容电荷（库仑 C，= C·V_c），i 为回路电流（安培 A）。
//   dq/dt = i
//   L·di/dt = V(t) − R·i − q/C
// 用 RK4 单步积分（二阶系统需精度，显式欧拉在长程会人为注入/耗散能量）。
//
// 参考：David K. Cheng,《Field and Wave Electromagnetics》；
//       Sadiku,《Fundamentals of Electric Circuits》第 8 章「二阶电路」（串联 RLC 的
//       ω₀=1/√(LC)、ζ=（R/2)·√(C/L)、Q=（1/R)·√(L/C) 与欠/临界/过阻尼判据）。

import { param } from './params'
import { WasmOde } from './wasm-fields'

export interface RlcState {
  /** 电容电荷 q（库仑 C，= C·V_c）。 */
  q: number
  /** 回路电流 i（安培 A）。 */
  i: number
}

/** 电路元件参数：电感 L(H)、电阻 R(Ω)、电容 C(F)、外加电压源 V(V)。 */
export interface RlcParams {
  L: number
  R: number
  C: number
  V: number
}

function kernel(state: RlcState, p: RlcParams, dt: number, steps = 0) {
  return new WasmOde({ kind: 'rlc', parameters: [p.L, p.R, p.C, p.V, dt], initial: [state.q, state.i], capacity: steps })
}
function characteristics(L: number, C: number, R = 0) {
  return kernel({ q: 0, i: 0 }, { L, C, R, V: 0 }, 1).read()
}
export function resonantFreq(L: number, C: number): number { return characteristics(L, C)[0] }
export function dampingRatio(R: number, L: number, C: number): number { return characteristics(L, C, R)[1] }
export function qualityFactor(R: number, L: number, C: number): number {
  const read = characteristics(L, C, R)
  return read[5] ? read[2] : Infinity
}
export function dampedFreq(L: number, R: number, C: number): number { return characteristics(L, C, R)[3] }
export function energy(s: RlcState, p: { L: number; C: number }): number {
  return kernel(s, { ...p, R: 0, V: 0 }, 1).read()[4]
}

/** Existing pure helper; product trajectories reuse a persistent Rust/WASM owner. */
export function rlcStep(state: RlcState, p: RlcParams, dt: number): RlcState {
  const run = kernel(state, p, dt); run.step()
  return { q: run.state[0], i: run.state[1] }
}
function states(run: WasmOde): RlcState[] {
  return Array.from({ length: run.completed + 1 }, (_, i) => ({ q: run.values[2 * i], i: run.values[2 * i + 1] }))
}
export function simulate(s0: RlcState, p: RlcParams, dt: number, steps: number): RlcState[] {
  const run = kernel(s0, p, dt, steps)
  if (steps) run.advance(steps)
  return states(run)
}

// —— 带来源的演示默认参数（教科书量级，单位 SI；仅作页面初值/标定，不被核心算法硬编码） ——
// 取一组「LC 谐振演示」常见量级：L=1 H、C=1 F、R 由阻尼比驱动。源自 Sadiku §8 二阶电路例题量级。
export const DEMO = {
  L: param(1, 'H', 'Sadiku《Fundamentals of Electric Circuits》§8 二阶电路（演示量级）', 'node:electrical'),
  C: param(1, 'F', 'Sadiku《Fundamentals of Electric Circuits》§8 二阶电路（演示量级）', 'node:electrical'),
  R: param(0.4, 'Ω', 'Sadiku《Fundamentals of Electric Circuits》§8（欠阻尼演示初值）', 'node:electrical'),
  V: param(1, 'V', '直流阶跃源（单位阶跃演示）', 'node:electrical'),
} as const

/** Bounded page experiment, always restarted from the selected initial condition. */
export type RlcScene = { zeta: number; drive: 'energy' | 'step'; steps: number }
export const RLC_DT = 0.01
export function createRlcScene(scene: RlcScene) {
  return kernel({ q: scene.drive === 'energy' ? 1 : 0, i: 0 },
    { L: 1, C: 1, R: 2 * scene.zeta, V: scene.drive === 'step' ? 1 : 0 }, RLC_DT, scene.steps)
}
export function readRlcScene(run: WasmOde) {
  const read = run.read()
  return { states: states(run), dt: RLC_DT, w0: read[0], z: read[1], Q: read[5] ? read[2] : null }
}
export function rlcResult(scene: RlcScene) {
  const run = createRlcScene(scene); run.advance(scene.steps)
  return readRlcScene(run)
}

// 互感 · 变压器 —— 两耦合电感回路的 ODE 核心
//
// 两个磁耦合回路（变压器）的电路方程（关联参考方向，串联电阻 + 互感 M）：
//   V₁ = R₁·i₁ + L₁·di₁/dt + M·di₂/dt
//   V₂ = R₂·i₂ + M·di₁/dt + L₂·di₂/dt
//
// 写成电感矩阵形式：  [L₁ M; M L₂]·[di₁/dt; di₂/dt] = [V₁−R₁i₁; V₂−R₂i₂]
// 解出 di/dt 需对 2×2 电感矩阵求逆，要求行列式 D = L₁L₂ − M² > 0。
// 用经典 RK4 推进。纯函数、约化/SI 单位、无副作用、无 DOM。
//
// 参考：D. Halliday, R. Resnick, J. Walker, *Fundamentals of Physics*（互感与变压器章）；
//       任一标准电路理论教材（耦合电感、k = M/√(L₁L₂)）。

import { param } from './params'
import { WasmOde } from './wasm-fields'

/** 非奇异上限：完全耦合 k=1 时行列式 D=L₁L₂−M²=0（矩阵奇异），故对 k 设上限。 */
export const K_MAX = param(
  0.99,
  '约化',
  '完全耦合 k=1 使电感矩阵奇异（D=L₁L₂−M²→0），此上限仅保证矩阵非奇异；积分稳定性仍取决于步长',
  'node:electromagnetic',
)

/** 互感回路状态：两回路的瞬时电流。 */
export interface MutualState {
  /** 初级回路电流 i₁（A） */
  i1: number
  /** 次级回路电流 i₂（A） */
  i2: number
}

/** 互感回路参数（SI 单位）。 */
export interface MutualParams {
  /** 初级自感 L₁（H） */
  L1: number
  /** 次级自感 L₂（H） */
  L2: number
  /** 互感 M（H），物理上 0 ≤ M ≤ √(L₁L₂) */
  M: number
  /** 初级回路串联电阻 R₁（Ω） */
  R1: number
  /** 次级回路串联电阻 R₂（Ω） */
  R2: number
  /** 初级激励电压 V₁（V） */
  V1: number
  /** 次级独立激励电压 V₂（V），无独立源的闭合次级取 0 */
  V2: number
}

function kernel(state: MutualState, p: MutualParams, dt: number, steps = 0) {
  return new WasmOde({ kind: 'mutual', parameters: [p.L1, p.L2, p.M, p.R1, p.R2, p.V1, p.V2, dt],
    initial: [state.i1, state.i2, 0, 0], capacity: steps })
}
function characteristics(M: number, L1: number, L2: number, V1 = 0) {
  return kernel({ i1: 0, i2: 0 }, { L1, L2, M, R1: 0, R2: 0, V1, V2: 0 }, 1).read()
}
export function couplingCoefficient(M: number, L1: number, L2: number): number { return characteristics(M, L1, L2)[0] }
export function turnsRatio(L1: number, L2: number): number { return characteristics(0, L1, L2)[1] }
export function transformerSecondaryVoltage(V1: number, L1: number, L2: number): number { return characteristics(0, L1, L2, V1)[2] }

/** Existing pure helper; only Rust clamps M and performs RK4. */
export function mutualStep(state: MutualState, p: MutualParams, dt: number): MutualState {
  const run = kernel(state, p, dt); run.step()
  return { i1: run.state[0], i2: run.state[1] }
}
/** Constant-source teaching trajectories retain the requested unsplit RK4 step. */
export function simulate(state: MutualState, p: MutualParams, dt: number, steps: number): MutualState[] {
  const run = kernel(state, p, dt, steps), states = [{ ...state }]
  for (let step = 0; step < steps; step++) {
    run.step(); states.push({ i1: run.state[0], i2: run.state[1] })
  }
  return states
}

export type MutualScene = { k: number; n: number; mode: 'sine' | 'step'; steps: number }
export const MUTUAL_DT = 1 / 240
/** Two resistively loaded coils, zero initial currents, fixed 10 V / 2 Hz drive. */
export function createMutualScene(scene: MutualScene) {
  return kernel({ i1: 0, i2: 0 }, { L1: 1, L2: scene.n ** 2, M: scene.k * scene.n, R1: 2, R2: 4, V1: 10, V2: 0 }, MUTUAL_DT, scene.steps)
}
export function stepMutualScene(run: WasmOde, scene: MutualScene, count: number) {
  run.advance(count, scene.mode === 'sine', scene.mode === 'sine' ? 4 * Math.PI : 0)
}
export function readMutualScene(run: WasmOde) {
  const read = run.read()
  return { states: Array.from({ length: run.completed + 1 }, (_, i) => ({ i1: run.values[2 * i], i2: run.values[2 * i + 1] })),
    secondaryShare: Array.from(run.shares.subarray(0, run.completed + 1)), dt: MUTUAL_DT, substeps: read[3], k: read[0], n: read[1] }
}
export function mutualResult(scene: MutualScene) {
  const run = createMutualScene(scene); stepMutualScene(run, scene, scene.steps)
  return readMutualScene(run)
}

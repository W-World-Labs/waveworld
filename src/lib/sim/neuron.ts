import { WasmOde } from './wasm-fields'

// FitzHugh–Nagumo（FHN）神经元简化模型：用两个变量复现动作电位的「全或无」、阈值与不应期。
// v 为膜电位类比（快变量，含三次非线性自激发）；w 为恢复变量（慢变量，提供负反馈）。
//   dv/dt = v − v³/3 − w + I
//   dw/dt = 0.08·(v + 0.7 − 0.8·w)
// 静息(I=0) 稳定不动点约在 (v, w) ≈ (−1.20, −0.62)。
// 给一个阈下电流 → v 只小幅偏移后回落；阈上电流越过三次曲线的不稳定支 → 触发大幅尖峰(v>1)后被 w 拉回，
// 这正是「全或无」与不应期的来源。

export interface FHN {
  v: number
  w: number
}

/** 经典 FHN 静息态（I=0 时的稳定不动点近似）。 */
export const RESTING: FHN = { v: -1.2, w: -0.6 }

/** simulate 中刺激电流注入的默认持续步数（短脉冲），其余步长 I=0，便于观察阈值与不应期。 */
export const STIM_STEPS = 30

function kernel(state: FHN, current: number, dt: number, steps = 0, pulses: number[] = [], pulseSteps = 0) {
  return new WasmOde({ kind: 'neuron', parameters: [current, dt, pulseSteps], initial: [state.v, state.w], capacity: steps, pulses })
}
/** Existing pure one-step API invokes the shared Euler update. */
export function fhnStep(s: FHN, I: number, dt: number): FHN {
  const run = kernel(s, I, dt); run.step()
  return { v: run.state[0], w: run.state[1] }
}
export function simulate(I: number, steps: number, dt: number, stim: number = STIM_STEPS): number[] {
  const run = kernel(RESTING, I, dt, steps, stim > 0 ? [0] : [], stim)
  if (steps) run.advance(steps)
  return Array.from(run.values)
}
export function peak(trace: number[]): number {
  if (!trace.length) return -Infinity
  const run = kernel({ v: trace[0], w: 0 }, 0, 1, trace.length - 1)
  run.values.set(trace); run.completed = trace.length - 1
  return run.read()[0]
}

export type NeuronScene = { current: number; steps: number; pulses: number[] }
export const NEURON_DT = 0.06
export const NEURON_PULSE_STEPS = 54
export function createNeuronScene(scene: NeuronScene) {
  return kernel(RESTING, scene.current, NEURON_DT, scene.steps, scene.pulses, NEURON_PULSE_STEPS)
}
export function readNeuronScene(run: WasmOde) {
  const spikes: number[] = []
  for (let step = 1; step <= run.completed; step++) if (run.upward[step]) spikes.push(step)
  return { voltage: Array.from(run.values.subarray(0, run.completed + 1)), spikes, dt: NEURON_DT, peak: run.read()[0] }
}
export function neuronResult(scene: NeuronScene) {
  const run = createNeuronScene(scene); run.advance(scene.steps)
  return readNeuronScene(run)
}

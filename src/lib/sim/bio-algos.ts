/**
 * 生物电方法族 · 子算法入口（挂 method-bioelectric）。
 */
import { fhnStep, peak, simulate } from './neuron'
import { childrenOf } from '../../data/methods/methods'

export const BIO_PARENT = 'method-bioelectric'

export const BIO_CHILD_METHOD_IDS = [
  'method-algo-fhn-neuron',
  'method-algo-ecg-wave',
  'method-algo-emg-signal',
  'method-algo-eeg-rhythm',
] as const

/** FHN：超阈值刺激应产生尖峰（峰值显著高于静息）。 */
export function runFhnSpikeSample(): { tracePeak: number; resting: number } {
  const trace = simulate(1.0, 800, 0.05, 40)
  const resting = trace[0] ?? 0
  return { tracePeak: peak(trace), resting }
}

/** 亚阈值：峰值不应远超静息很多（相对超阈）。 */
export function runFhnSubthreshold(): { peakSuper: number; peakSub: number } {
  const superT = peak(simulate(1.0, 600, 0.05, 30))
  const sub = peak(simulate(0.05, 600, 0.05, 30))
  return { peakSuper: superT, peakSub: sub }
}

export function bioChildCount(): number {
  return childrenOf(BIO_PARENT).length
}

export function runBioCoreCheck(): { fhn: ReturnType<typeof runFhnSpikeSample>; stepped: boolean } {
  let s = { v: 0, w: 0 }
  s = fhnStep(s, 0.5, 0.05)
  return { fhn: runFhnSpikeSample(), stepped: Number.isFinite(s.v) }
}

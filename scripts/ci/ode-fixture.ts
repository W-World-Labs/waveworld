import type { RlcScene } from '../../src/lib/sim/rlc'
import type { MutualScene } from '../../src/lib/sim/mutual'
import type { NeuronScene } from '../../src/lib/sim/neuron'
import type { VibrationScene } from '../../src/lib/sim/spectrum-runnable-algos'

export const rlcScene = (): RlcScene => ({ zeta: 0.15, drive: 'energy', steps: 9 })
export const mutualScene = (): MutualScene => ({ k: 0.99, n: 0.3, mode: 'sine', steps: 9 })
export const neuronScene = (): NeuronScene => ({ current: 0.8, steps: 9, pulses: [0, 4] })
export const vibrationScene = (): VibrationScene => ({ mass: 0.7, stiffness: 123, damping: 0.3, driveFrequency: 2.35, steps: 9 })

export const transientInputs = (['rc-charge', 'rc-discharge', 'rl'] as const).map(mode => ({
  module: 'transient' as const, scene: { mode, v0: 5, r: 1000, c: 1e-4, l: 0.5 },
}))

export const faradayInputs = [
  { omega: 4 * Math.PI, B: 0.3, N: 200, A: 0.01, vBar: 2, bMot: 0.5, lBar: 0.2 },
  { omega: 0.4 * Math.PI, B: 0.05, N: 10, A: 0.001, vBar: 0, bMot: 0.05, lBar: 0.05 },
  { omega: 20 * Math.PI, B: 1, N: 500, A: 0.05, vBar: 10, bMot: 2, lBar: 1 },
].map(scene => ({ module: 'faraday' as const, scene }))

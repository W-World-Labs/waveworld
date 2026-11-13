import type { IsingScene } from '../../src/lib/sim/ising'

export const isingScene = (): IsingScene => ({
  size: 16, temperatures: [0.8, 2, 3.6], seed: 7, hot: true, burnIn: 1, samples: 2,
})

import type { ModuleComputeInput } from '../../src/lib/sim/module-compute'

/** Short snapshots, including the existing product's largest allowed phase. */
export const planeInputs: ModuleComputeInput[] = [
  { module: 'electromagnetic', params: { frequencyHz: 5e14, refractiveIndex: 1.5, ePeak: 2.3, phase0: 0.7 }, timeSeconds: 0.125, xs: [-1, 0, 0.37, 1] },
  { module: 'sound', params: { frequencyHz: 1000, rho: 1.2, c: 343, pPeak: 2, phase0: -0.4 }, timeSeconds: 0.00123, xs: [-2, 0, 0.2, 2] },
  { module: 'emwave3d', params: { waveNumber: 0.7, amplitude: 2.2, time: 1.25 } },
]
export const extremePlaneInputs: ModuleComputeInput[] = [
  { module: 'electromagnetic', params: { frequencyHz: 1e20, refractiveIndex: 100, ePeak: 1e6, phase0: 1e6 }, timeSeconds: 1e6, xs: [-1e20, 0, 1e20] },
  { module: 'sound', params: { frequencyHz: 1e20, rho: 1e-6, c: 1e-6, pPeak: 1e6, phase0: -1e6 }, timeSeconds: 1e6, xs: [-1e20, 0, 1e20] },
  { module: 'emwave3d', params: { waveNumber: 1.6, amplitude: 0, time: 1e6 } },
]

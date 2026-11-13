import type { ModuleComputeInput } from '../../src/lib/sim/module-compute'

export const antennaInputs: ModuleComputeInput[] = [
  { module: 'antennapattern', params: { type: 'directional', ptDbm: 20, gtDbi: 6, grDbi: 6, frequencyHz: 2.4e9, distM: 100 } },
  { module: 'antenna3d', params: { frequencyHz: 2.4e9, ptDbm: 20, distM: 8, elevationDeg: 90, polarizationDeg: 45 } },
  { module: 'phasedarray', params: { n: 12, dOverLambda: 1, steerDeg: 80 } },
]
export const antennaEdgeInputs: ModuleComputeInput[] = [
  { module: 'antennapattern', params: { type: 'isotropic', ptDbm: -10, gtDbi: 0, grDbi: 0, frequencyHz: 1e8, distM: 1 } },
  { module: 'antennapattern', params: { type: 'dipole', ptDbm: 46, gtDbi: 30, grDbi: 30, frequencyHz: 28e9, distM: 1e5 } },
  { module: 'antenna3d', params: { frequencyHz: 1e8, ptDbm: -10, distM: 1, elevationDeg: 90, polarizationDeg: 90 } },
  { module: 'antenna3d', params: { frequencyHz: 28e9, ptDbm: 46, distM: 1e5, elevationDeg: 0, polarizationDeg: 0 } },
  { module: 'antenna3d', params: { frequencyHz: 28e9, ptDbm: 46, distM: 1e5, elevationDeg: 180, polarizationDeg: 0 } },
  { module: 'phasedarray', params: { n: 48, dOverLambda: 1.5, steerDeg: -80 } },
  { module: 'phasedarray', params: { n: 2, dOverLambda: 0.25, steerDeg: 0 } },
]

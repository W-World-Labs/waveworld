import type { ModuleComputeInput } from '../../src/lib/sim/module-compute'

export const detectionInputs: ModuleComputeInput[] = [
  { module: 'radar', scene: { mode: 'pulse', steps: 5, probes: [{ x: 24, y: 100 }, { x: 25, y: 100 }, null, null] } },
  { module: 'laser', pump: 1200, steps: 4 },
  { module: 'nljd', kind: 'semiconductor' },
]
export const detectionEdgeInputs: ModuleComputeInput[] = [
  { module: 'radar', scene: { mode: 'cw', steps: 9, probes: [{ x: 24, y: 100 }, { x: 25, y: 100 }, { x: 120, y: 30 }, { x: 199, y: 199 }] } },
  { module: 'radar', scene: { mode: 'pulse', steps: 1, probes: [null, null, null, null] } },
  { module: 'laser', pump: 0, steps: 1 },
  { module: 'laser', pump: 4000, steps: 65 },
  { module: 'nljd', kind: 'corrosion' },
  { module: 'nljd', kind: 'metal' },
]

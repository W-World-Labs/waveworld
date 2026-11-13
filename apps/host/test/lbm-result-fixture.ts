import { prepareProductLbmUnits } from '@w-sim/solvers-lbm/d3q19';
import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts';

// Synthetic stationary accounting for tests of unrelated Host settlement rules.
// It is deliberately not a computed flow or evidence of physical conservation.
export function stationaryMassReport(): NonNullable<JobResultV1['lbmMassBalance']> {
  return { scope: 'internal-fluid-x', initialMassKg: 1, finalMassKg: 1, inletMassKg: 0, outletMassKg: 0,
    collisionMassChangeKg: 0, balanceResidualKg: 0, maxAbsStepBalanceResidualKg: 0,
    boundaryFinalMassKg: 0.1, inletReconstructionMassKg: 0, outletReconstructionMassKg: 0 };
}

export function fixtureUnits(spec: JobSpecV1) {
  const { units } = prepareProductLbmUnits(spec, spec.model?.referenceLength ?? 1);
  return { dx: units.dx, dt: units.dt };
}

import type { JobResultV1, JobSpecV1 } from './task';
import type { PreparedProductLbm } from '@w-sim/solvers-lbm/d3q19';
import type { PreparedMacInput } from '@w-sim/solvers-lbm/mac3d';
import type { prepareParticleInput } from '../../../../src/lib/sim/particles';
import type { prepareMdInput } from '../../../../src/lib/sim/md';
import type { prepareFdtdInput } from '../../../../src/lib/sim/fdtd';

/** Offline transport shared by Host and the native executor; no service credentials. */
export type ComputeInputFile = { artifactId: string; name: string; bytes: number; sha256: string };
export type ComputeJobFile = {
  schemaVersion: 1;
  jobId: string;
  spec: JobSpecV1;
  maxWallTimeMs: number;
  inputs: ComputeInputFile[];
  lbm?: ComputeLbmInput;
  mac?: ComputeMacInput;
  fdtd?: ReturnType<typeof prepareFdtdInput>;
  md?: ReturnType<typeof prepareMdInput> | ReturnType<typeof prepareParticleInput>;
};
export type ComputeMacInput = PreparedMacInput;
/** Host prepares geometry once; both executors receive identical lattice inputs. */
export type ComputeLbmInput = {
  nx: number; ny: number; nz: number; tau: number; uInlet: number;
  smagorinskyCs: number; turbulenceIntensity: number; freeSlipWalls: boolean;
  groundVelocityLattice?: number;
  density: number; inletVelocity: number; referenceArea: number; solidCells: number;
  forceScale: number; coefficientScale?: number;
  fan?: PreparedProductLbm['fan'];
  thermal?: NonNullable<PreparedProductLbm['thermal']>['thermal'] &
    Pick<NonNullable<PreparedProductLbm['thermal']>, 'ambientC' | 'temperatureScaleC' | 'thermalDiffusivityPhysical'>;
  units: Pick<PreparedProductLbm['units'], 'dx' | 'dt' | 'uLattice' | 'reynoldsPhysical' | 'reynoldsLattice' |
    'requestedViscosityM2s' | 'simulatedViscosityM2s' | 'viscosityMode'>;
};
/** Output IDs and SHA-256 are assigned by Host when it validates and stores bytes. */
export type ComputeOutputFile = { name: string; step?: number; bytes: number; kind: string; contentType: string };
export type ComputeResultFile = {
  schemaVersion: 1;
  jobId: string;
  status: 'succeeded' | 'failed';
  result?: JobResultV1;
  error?: string;
  files: ComputeOutputFile[];
};

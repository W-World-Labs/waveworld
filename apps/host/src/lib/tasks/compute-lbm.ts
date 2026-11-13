import { createHash } from 'node:crypto';
import { decimateFlags, decimatedCellCount, lbmFieldSampleSteps } from '@w-sim/solvers-lbm/d3q19';
import type { JobRecord } from '@/types/task';
import { prepareLbmInput, isNativeLbmJob } from '../../../../../src/lib/sim/lbm-compute';
export { isNativeLbmJob } from '../../../../../src/lib/sim/lbm-compute';
import type { ComputeLbmInput } from '../../types/compute';
import { readArtifactBytes, listArtifacts, saveArtifact } from './artifacts';
import { SpecValidationError } from './validate-spec';
import { decodeModelGeometry } from '../../../../lab/src/lib/models/geometry-contract';
import { decodeFlowSnapshot, flowHasTemperature, flowSnapshotContentType, FLOW_SNAPSHOT_KIND } from '../../../../lab/src/lib/cfd/flow-snapshot';

export function prepareComputeLbm(job: JobRecord): { lbm: ComputeLbmInput; mask: ReturnType<typeof saveArtifact> } {
  if (!isNativeLbmJob(job.spec)) throw new Error('Unsupported native LBM job');
  const source = readArtifactBytes(job.spec.model!.artifactId!);
  if (!source) throw new Error('Model artifact is missing or corrupt');
  if (source.meta.ownerUserId !== job.createdBy && (!source.meta.projectId || source.meta.projectId !== job.projectId)) throw new Error('Model artifact is outside this job scope');
  let prepared;
  try {
    const geometry = decodeModelGeometry(source.data.buffer.slice(source.data.byteOffset, source.data.byteOffset + source.data.byteLength) as ArrayBuffer, source.meta.contentType);
    prepared = prepareLbmInput(job.spec, geometry);
  }
  catch (error) { throw new SpecValidationError(error instanceof Error ? error.message : 'Invalid LBM model or parameters'); }
  const { flags, lbm } = prepared;
  const previous = listArtifacts(job.id).find(item => item.kind === 'lbm-grid-mask');
  if (previous && previous.sha256 !== createHash('sha256').update(flags).digest('hex')) throw new Error('Lattice preparation changed; submit a new job');
  const mask = previous ?? saveArtifact({ jobId: job.id, projectId: job.projectId, ownerUserId: job.createdBy,
    kind: 'lbm-grid-mask', contentType: 'application/octet-stream', data: flags });
  return { lbm, mask };
}

/** Strictly decode before saving a native field as the existing owned artifact. */
export function expectedComputeFlowSteps(job: JobRecord, steps: number, lbm: ComputeLbmInput): number[] {
  if (!Number.isSafeInteger(steps) || steps < 1 || steps > job.spec.run.maxSteps) throw new Error('Invalid native flow steps');
  return lbmFieldSampleSteps(job.spec.run.maxSteps, job.spec.outputs.fieldFrames, decimatedCellCount(lbm.nx, lbm.ny, lbm.nz, job.spec.outputs.fieldStride ?? 1), !!lbm.thermal, job.spec.outputs.fields?.includes('pressure') === true)
    .filter(step => step < steps).concat(steps);
}

export function storeComputeFlow(job: JobRecord, bytes: Uint8Array, steps: number, lbm: ComputeLbmInput, maskId: string) {
  const snapshot = decodeFlowSnapshot(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const mask = readArtifactBytes(maskId);
  const coarse = mask ? decimateFlags(lbm.nx, lbm.ny, lbm.nz, mask.data, job.spec.outputs.fieldStride ?? 1) : null;
  if (!mask || !coarse || snapshot.step !== steps || !Number.isSafeInteger(steps) || steps < 1 || steps > job.spec.run.maxSteps ||
      snapshot.nx !== coarse.nx || snapshot.ny !== coarse.ny || snapshot.nz !== coarse.nz || snapshot.uLattice !== Math.fround(lbm.units.uLattice) ||
      flowHasTemperature(snapshot) !== !!lbm.thermal || (snapshot.hasPressure === true) !== (job.spec.outputs.fields?.includes('pressure') === true) ||
      coarse.flags.length !== snapshot.flags.length || snapshot.flags.some((flag, i) => flag !== coarse.flags[i])) throw new Error('Invalid native flow field');
  const previous = listArtifacts(job.id).find(item => {
    if (item.kind !== FLOW_SNAPSHOT_KIND) return false;
    const saved = readArtifactBytes(item.id);
    if (!saved) throw new Error('Missing native flow result');
    return decodeFlowSnapshot(saved.data.buffer.slice(saved.data.byteOffset, saved.data.byteOffset + saved.data.byteLength) as ArrayBuffer, saved.meta.contentType).step === steps;
  });
  if (previous && previous.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new Error('Conflicting native flow result');
  const artifact = previous ?? saveArtifact({ jobId: job.id, projectId: job.projectId, ownerUserId: job.createdBy,
    kind: FLOW_SNAPSHOT_KIND, contentType: flowSnapshotContentType(snapshot), data: bytes });
  return { artifactId: artifact.id, bytes: artifact.bytes, kind: artifact.kind, contentType: artifact.contentType, step: steps };
}

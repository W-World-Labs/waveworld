import { createHash } from 'node:crypto';
import { MAC_3D_FEATURE } from '@w-sim/contracts';
import { decimateFlags, decimatedCellCount, prepareMacInput, macFieldSampleSteps } from '@w-sim/solvers-lbm/mac3d';
import type { JobRecord, JobResultV1 } from '@/types/task';
import type { ComputeMacInput } from '../../types/compute';
import { readArtifactBytes, listArtifacts, saveArtifact } from './artifacts';
import { ResultValidationError } from './validate-result';
import { SpecValidationError } from './validate-spec';
import { decodeModelGeometry } from '../../../../lab/src/lib/models/geometry-contract';
import { decodeMacFlowSnapshot, decodeMacFlowSequence, assertMacFlowFrames, MAC_FLOW_SNAPSHOT_KIND, MAC_FLOW_SEQUENCE_KIND, MAC_FLOW_SNAPSHOT_CONTENT_TYPE, MAC_FLOW_SEQUENCE_CONTENT_TYPE } from '../../../../lab/src/lib/cfd/mac-flow-snapshot';
import { inflateSequenceArtifact } from './flow-inflate';

function prepareOwnedMac(job: JobRecord) {
  if (job.spec.kind !== 'mac-3d' || job.spec.model?.source !== 'artifact') throw new Error('MAC requires a saved model');
  const source = readArtifactBytes(job.spec.model.artifactId!);
  if (!source || (source.meta.ownerUserId !== job.createdBy && (!source.meta.projectId || source.meta.projectId !== job.projectId))) throw new Error('MAC model is missing or outside this job scope');
  return prepareMacInput(job.spec, decodeModelGeometry(source.data.buffer.slice(source.data.byteOffset, source.data.byteOffset + source.data.byteLength) as ArrayBuffer, source.meta.contentType));
}

export function prepareComputeMac(job: JobRecord) {
  let prepared;
  try { prepared = prepareOwnedMac(job); }
  catch (error) { throw new SpecValidationError(error instanceof Error ? error.message : 'Invalid MAC model or physical parameters'); }
  const { mac, flags } = prepared;
  const previous = listArtifacts(job.id).find(item => item.kind === 'mac-grid-mask');
  if (previous && previous.sha256 !== createHash('sha256').update(flags).digest('hex')) throw new Error('MAC model preparation changed; submit a new job');
  const mask = previous ?? saveArtifact({ jobId: job.id, projectId: job.projectId, ownerUserId: job.createdBy,
    kind: 'mac-grid-mask', contentType: 'application/octet-stream', data: flags });
  return { mac, mask };
}

export function expectedComputeMacSteps(job: JobRecord, steps: number, mac: ComputeMacInput): number[] {
  if (!Number.isSafeInteger(steps) || steps !== job.spec.run.maxSteps) throw new Error('MAC results must complete exactly the requested steps');
  return macFieldSampleSteps(steps, job.spec.outputs.fieldFrames, decimatedCellCount(mac.nx, mac.ny, mac.nz, job.spec.outputs.fieldStride ?? 1), !!mac.thermal);
}

export function storeComputeMacFlow(job: JobRecord, bytes: Uint8Array, step: number, mac: ComputeMacInput, maskId: string) {
  const frame = decodeMacFlowSnapshot(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer), mask = readArtifactBytes(maskId);
  const coarse = mask?.meta.jobId === job.id && mask.meta.kind === 'mac-grid-mask'
    ? decimateFlags(mac.nx, mac.ny, mac.nz, mask.data, job.spec.outputs.fieldStride ?? 1) : null;
  if (!mask || !coarse || frame.step !== step ||
      !expectedComputeMacSteps(job, job.spec.run.maxSteps, mac).includes(step) ||
      frame.nx !== coarse.nx || frame.ny !== coarse.ny || frame.nz !== coarse.nz || frame.displayStride !== (mac.thermal ? 5 : 4) ||
      coarse.flags.length !== frame.flags.length || frame.flags.some((flag, i) => flag !== coarse.flags[i])) throw new Error('Invalid native MAC field');
  const previous = listArtifacts(job.id).find(item => {
    if (item.kind !== MAC_FLOW_SNAPSHOT_KIND) return false;
    const saved = readArtifactBytes(item.id);
    if (!saved) throw new Error('Missing native MAC result');
    return decodeMacFlowSnapshot(saved.data.buffer.slice(saved.data.byteOffset, saved.data.byteOffset + saved.data.byteLength) as ArrayBuffer).step === step;
  });
  if (previous && previous.sha256 !== createHash('sha256').update(bytes).digest('hex')) throw new Error('Conflicting native MAC result');
  const artifact = previous ?? saveArtifact({ jobId: job.id, projectId: job.projectId, ownerUserId: job.createdBy,
    kind: MAC_FLOW_SNAPSHOT_KIND, contentType: MAC_FLOW_SNAPSHOT_CONTENT_TYPE, data: bytes });
  return { artifactId: artifact.id, bytes: artifact.bytes, kind: artifact.kind, contentType: artifact.contentType, step };
}

/** Reprepare the owned model even for final-only/scalar results; no claimed lattice units. */
export function validateComputeMacResult(job: JobRecord, result: JobResultV1): void {
  try {
    const { mac, flags } = prepareOwnedMac(job);
    const spec = job.spec, params = spec.parameters as Record<string, unknown>;
    const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
    const close = (actual: unknown, expected: number) => finite(actual) && Math.abs(actual - expected) <= Math.max(Number.MIN_VALUE, Math.abs(expected) * 1e-9);
    if (result.summary.steps !== spec.run.maxSteps || !Number.isSafeInteger(result.summary.steps) || result.summary.steps < 1 ||
        !finite(result.summary.wallTimeMs) || result.summary.wallTimeMs < 0 || result.summary.method !== 'mac-3d' ||
        result.summary.solverPackage !== 'w-sim-kernels' || result.backend?.id !== 'cpu' ||
        result.derived?.precision !== 'float64' || result.derived?.[MAC_3D_FEATURE] !== 1 ||
        !['rust-native', 'rust-wasm'].includes(String(result.derived?.engine)) ||
        !close(result.derived?.dx, mac.dxMeters) || !close(result.derived?.dt, mac.dtSeconds) ||
        !close(result.derived?.viscosityM2s, mac.kinematicViscosity) || result.derived?.openFaces !== mac.openFaces ||
        result.derived?.cellCount !== flags.length || result.summary.solidCells !== mac.solidCells) throw new Error('MAC result must preserve its executor, model, physical units and full step count');
    const forbidden = ['cd', 'cl', 'dragN', 'liftN', 'sideN', 'reynoldsLattice', 'converged'];
    if (forbidden.some(key => result.summary[key] !== undefined || result.history?.[key] !== undefined)) throw new Error('MAC impulse budgets do not establish model forces or engineering convergence');
    const scalarKeys = ['maxSpeedMps', 'divergenceLinf', 'projectionIterations', 'combinedCfl'] as const;
    if (scalarKeys.some(key => !finite(result.summary[key]) || Number(result.summary[key]) < 0) ||
        !Number.isInteger(result.summary.projectionIterations) || Number(result.summary.projectionIterations) > mac.projectionMaxIterations ||
        result.summary.allowedDivergenceLinf !== mac.absoluteDivergenceTolerance ||
        Number(result.summary.divergenceLinf) > mac.absoluteDivergenceTolerance || Number(result.summary.combinedCfl) > 1) throw new Error('MAC projection and CFL diagnostics exceed submitted limits');
    const readouts = result.mac?.fans;
    if (result.mac?.samplePhase !== 'before-momentum-step' || !Array.isArray(readouts) || readouts.length !== mac.fans.length) throw new Error('MAC requires every submitted fan operating readout and its sampling phase');
    const fanPressure = (index: number, flowM3s: number) => {
      const input = mac.fans[index], points = mac.fanPoints.slice(input.curveOffset, input.curveOffset + input.curveCount), q = flowM3s / input.rpmRatio;
      if (!finite(q) || q < points[0].flowM3s || q > points.at(-1)!.flowM3s) throw new Error('MAC fan flow is outside the submitted curve');
      const upper = points.findIndex(point => point.flowM3s >= q), a = points[Math.max(0, upper - 1)], b = points[upper];
      return (upper === 0 ? b.pressurePa : a.pressurePa + (b.pressurePa - a.pressurePa) * ((q - a.flowM3s) / (b.flowM3s - a.flowM3s))) * input.rpmRatio ** 2;
    };
    readouts.forEach((fan, index) => {
      const input = mac.fans[index], plane = Math.floor(input.centerCells[input.axis] + 0.5);
      if (fan.name !== input.name || fan.plane !== plane || !Number.isSafeInteger(fan.faceCount) || fan.faceCount < 1 ||
          !close(fan.areaM2, fan.faceCount * mac.dxMeters ** 2) ||
          ![fan.flowM3s, fan.pressureRisePa].every(value => finite(value) && value >= 0) ||
          !close(fan.forceN, input.direction * fan.pressureRisePa * fan.areaM2)) throw new Error('Invalid MAC fan geometry or actuator operating readout');
      if (!close(fan.pressureRisePa, fanPressure(index, fan.flowM3s))) throw new Error('MAC fan pressure does not match its submitted P-Q curve and RPM ratio');
    });
    const every = spec.run.forceSampleEvery ?? 20, count = Math.ceil(spec.run.maxSteps / every), history = result.history;
    if (spec.outputs.history && !history) throw new Error('MAC requested history is missing');
    if (history) {
      if (!history.step || history.step.length !== count || history.step.some((step, index) => step !== Math.min((index + 1) * every, spec.run.maxSteps))) throw new Error('MAC history must follow the complete sampling plan including the final step');
      const expected: Record<string, number> = { timeSeconds: spec.run.maxSteps * mac.dtSeconds };
      for (const key of scalarKeys) expected[key] = Number(result.summary[key]);
      readouts.forEach((fan, i) => {
        expected[`fan${i}FlowM3s`] = fan.flowM3s;
        expected[`fan${i}PressurePa`] = fan.pressureRisePa;
        expected[`fan${i}ForceN`] = fan.forceN;
      });
      for (const [key, final] of Object.entries(expected)) {
        const values = history[key];
        if (!values || values.length !== count || !close(values.at(-1), final) || values.some(value => !finite(value) || (!key.endsWith('ForceN') && value < 0))) throw new Error(`MAC history.${key} must preserve each sample and match the final readout`);
      }
      if (history.timeSeconds!.some((time, i) => !close(time, history.step![i] * mac.dtSeconds)) ||
          history.divergenceLinf!.some(value => value > mac.absoluteDivergenceTolerance) || history.combinedCfl!.some(value => value > 1) ||
          history.projectionIterations!.some(value => !Number.isInteger(value) || value > mac.projectionMaxIterations)) throw new Error('MAC history violates physical time, divergence or CFL limits');
      readouts.forEach((fan, index) => history[`fan${index}FlowM3s`]!.forEach((flow, step) => {
        const pressure = history[`fan${index}PressurePa`]![step], force = history[`fan${index}ForceN`]![step];
        if (!close(pressure, fanPressure(index, flow)) || !close(force, mac.fans[index].direction * pressure * fan.areaM2)) throw new Error('MAC fan history must follow its supplied curve and actuator area');
      }));
    }
    if (!!result.thermal !== !!mac.thermal) throw new Error('MAC thermal result must match the submitted mode');
    if (mac.thermal) {
      const thermal = result.thermal!, config = mac.thermal;
      const power = config.mode === 'solid-power' ? config.totalPowerW + (config.materials ?? []).reduce((sum, material) => sum + material.totalPowerW, 0) : 0;
      if (thermal.mode !== config.mode || !close(thermal.sourceEnergyJ, power * mac.dtSeconds * spec.run.maxSteps) ||
          !close(thermal.solidVolumeM3, mac.solidCells * mac.dxMeters ** 3) || thermal.thermalSubsteps > config.maxSubsteps ||
          result.derived?.ambientC !== config.ambientC || result.derived?.temperatureScaleC !== 1) throw new Error('MAC thermal source, volume or substep budget does not match the submitted physics');
      const scale = Math.max(Number.MIN_VALUE, Math.abs(thermal.thermalEnergyJ), Math.abs(thermal.sourceEnergyJ), Math.abs(thermal.boundaryEnergyJ));
      if (Math.abs(thermal.thermalEnergyJ - thermal.sourceEnergyJ - thermal.boundaryEnergyJ - thermal.energyResidualJ) > scale * 1e-9 ||
          Math.abs(thermal.energyResidualJ) > thermal.maxAbsEnergyResidualJ * spec.run.maxSteps + scale * 1e-9) throw new Error('MAC thermal energy ledger does not balance from its ambient initial state');
    }
    const refs = result.artifacts ?? [];
    if (!spec.outputs.fields?.length) { if (refs.length) throw new Error('MAC returned unrequested fields'); return; }
    if (refs.length < 1 || refs.length > 4096 || refs.some(ref => ref.kind !== MAC_FLOW_SNAPSHOT_KIND && ref.kind !== MAC_FLOW_SEQUENCE_KIND) ||
        refs.reduce((sum, ref) => sum + (ref.bytes ?? Infinity), 0) > 256 * 1024 * 1024) throw new Error('MAC fields require a bounded owned artifact sequence');
    const coarse = decimateFlags(mac.nx, mac.ny, mac.nz, flags, spec.outputs.fieldStride ?? 1);
    const frames = [];
    for (const ref of refs) {
      const stored = readArtifactBytes(ref.artifactId);
      const seq = ref.kind === MAC_FLOW_SEQUENCE_KIND;
      if (!stored || stored.meta.jobId !== job.id || stored.meta.ownerUserId !== job.createdBy || stored.meta.projectId !== job.projectId ||
          stored.meta.kind !== ref.kind || stored.meta.contentType !== (seq ? MAC_FLOW_SEQUENCE_CONTENT_TYPE : MAC_FLOW_SNAPSHOT_CONTENT_TYPE) ||
          ref.contentType !== stored.meta.contentType || ref.bytes !== stored.meta.bytes) throw new Error('MAC fields do not belong to this job');
      const data = stored.data;
      if (seq) {
        const raw = inflateSequenceArtifact(data);
        frames.push(...decodeMacFlowSequence(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer));
        continue;
      }
      const frame = decodeMacFlowSnapshot(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
      if (ref.step !== frame.step) throw new Error('MAC artifact step does not match its saved frame');
      frames.push(frame);
    }
    for (const frame of frames) {
      if (frame.nx !== coarse.nx || frame.ny !== coarse.ny || frame.nz !== coarse.nz ||
          frame.displayStride !== (params.thermalEnabled === true ? 5 : 4) || frame.flags.length !== coarse.flags.length ||
          frame.flags.some((flag, i) => flag !== coarse.flags[i])) throw new Error('MAC field differs from the submitted model/grid/thermal mode');
    }
    assertMacFlowFrames(frames, spec, result.summary.steps);
  } catch (error) { throw new ResultValidationError(error instanceof Error ? error.message : 'Invalid MAC result'); }
}

import type { JobKind, JobSpecV1 } from '@/types/task';
import { acceptJobSpec, isBuiltinJobKind, validateMacJobSpec, validateLbmFanComponent, validateLbmGroundBoundary } from '@w-sim/contracts';
import { MODULE_JOB_KIND, readModuleJobInput, registeredModuleJobKindValidator } from '../../../../../src/lib/sim/module-compute';
import { isGpuLbmJob } from '../../../../../src/lib/sim/lbm-compute';

export class SpecValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpecValidationError';
  }
}

/** Accepts all W-Sim built-in multiphysics kinds (not only fluid agent kinds). */
export function isJobKind(k: string): k is JobKind {
  return isBuiltinJobKind(k) || k === MODULE_JOB_KIND;
}

/** 合法的 SolverBackendId 全集（@w-sim/contracts job-spec.ts 同源）。 */
const KNOWN_BACKEND_IDS: ReadonlySet<string> = new Set([
  'webgpu',
  'webgpu-dawn',
  'webgpu-browser',
  'cuda',
  'native-cuda',
  'cpu',
  'cpu-teaching',
]);

/**
 * Kind-aware JobSpecV1 validation shared by host and tuanliu API routes.
 *
 * Envelope (schemaVersion / kind / run / parameters / outputs) is accepted by
 * `@w-sim/contracts` `acceptJobSpec` under builtin-strict mode (extension kinds
 * rejected unless product policy opts in). Kind-specific product rules remain here.
 */
export function validateJobSpec(spec: JobSpecV1): void {
  // Keep the LBM settle-time diagnostic specific and consistent with result
  // validation. The shared contract also rejects non-integer maxSteps, but it
  // runs below and otherwise masks this product-level sampling-bound error.
  if (spec.kind === 'lbm-d3q19' && spec.run && typeof spec.run === 'object') {
    const { forceSampleEvery, warmupSteps } = spec.run;
    if (!Number.isSafeInteger(spec.run.maxSteps) || spec.run.maxSteps < 1 || spec.run.maxSteps > 1_000_000 ||
        (forceSampleEvery !== undefined &&
          (!Number.isSafeInteger(forceSampleEvery) || forceSampleEvery < 1 || forceSampleEvery > 1_000_000)) ||
        (warmupSteps !== undefined &&
          (!Number.isSafeInteger(warmupSteps) || warmupSteps < 0 || warmupSteps > spec.run.maxSteps))) {
      throw new SpecValidationError('LBM run.maxSteps/forceSampleEvery/warmupSteps must satisfy the settled sampling bounds (integer maxSteps 1..1e6, warmup <= maxSteps)');
    }
  }

  // Only this product-owned extension opts in; arbitrary extension kinds stay rejected.
  const accepted = acceptJobSpec(spec, spec?.kind === MODULE_JOB_KIND
    ? { registeredKindValidator: registeredModuleJobKindValidator(spec) }
    : undefined);
  if (!accepted.ok) {
    throw new SpecValidationError(accepted.message);
  }

  // spec.name 直接进入 agent/host 的日志行（[job] claimed name=…）——
  // 控制字符可伪造日志行、超长名撑爆日志与看板。准入即拒。
  if (spec.name !== undefined &&
      (typeof spec.name !== 'string' || spec.name.length > 512 || /[\x00-\x1f\x7f]/.test(spec.name))) {
    throw new SpecValidationError('spec.name must be ≤512 chars without control characters');
  }

  // requirements.backends 的每个令牌必须是已知 SolverBackendId——未知 id
  // 永远无法被任何 agent 领取，准入即拒绝而不是留下僵尸 job。
  const backends = spec.requirements?.backends;
  if (backends !== undefined &&
    (!Array.isArray(backends) || backends.some((b) => typeof b !== 'string' || !KNOWN_BACKEND_IDS.has(b)))) {
    throw new SpecValidationError('requirements.backends must contain only known backend ids');
  }

  const parameters = spec.parameters as Record<string, unknown>;

  if (spec.kind === 'mac-3d') {
    const check = validateMacJobSpec(spec);
    if (!check.ok) throw new SpecValidationError(check.message);
    if (spec.model?.source !== 'artifact' || !spec.model.artifactId) throw new SpecValidationError('MAC publication requires an owned model geometry artifact');
  }

  if (spec.kind === MODULE_JOB_KIND) {
    try {
      readModuleJobInput(spec);
    } catch (error) {
      throw new SpecValidationError(error instanceof Error ? error.message : String(error));
    }
  }

  if (spec.kind === 'lbm-d3q19') {
    if (!spec.model?.source) throw new SpecValidationError('model.source required for lbm-d3q19');
    for (const key of ['referenceLength', 'referenceArea'] as const) {
      const value = spec.model[key];
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
        throw new SpecValidationError(`model.${key} must be finite and positive`);
      }
    }
    if (!parameters.gridPreset) {
      throw new SpecValidationError('parameters.gridPreset required for lbm-d3q19');
    }
    if (typeof parameters.inletVelocity !== 'number') {
      throw new SpecValidationError('parameters.inletVelocity required for lbm-d3q19');
    }
    if (parameters.fan !== undefined) {
      const fan = validateLbmFanComponent(parameters.fan);
      if (!fan.ok) throw new SpecValidationError(fan.message);
    }
    if (parameters.ground !== undefined) {
      const ground = validateLbmGroundBoundary(parameters.ground);
      if (!ground.ok) throw new SpecValidationError(ground.message);
    }
    if (parameters.thermalEnabled === true && !isGpuLbmJob(spec) && (spec.requirements?.backends?.length !== 1 ||
        spec.requirements.backends[0] !== 'cpu' || spec.requirements.precision !== 'mixed')) {
      throw new SpecValidationError('Thermal LBM requires explicit CPU/mixed or WebGPU/float32 execution');
    }
  }

  if (spec.kind === 'fdtd-batch') {
    // Lightweight CFD-class job: model optional (empty domain ok)
    const gridN = parameters.gridN;
    if (typeof gridN === 'number' && (gridN < 8 || gridN > 512)) {
      throw new SpecValidationError('parameters.gridN must be 8–512 when set');
    }
  }

  if (spec.kind === 'export-report') {
    if (!spec.name?.trim() && !parameters.reportType) {
      throw new SpecValidationError('export-report requires name or parameters.reportType');
    }
  }

  if (spec.kind === 'path-experiment') validatePathExperiment(spec.experiment);
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, path: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SpecValidationError(`${path} must be an object`);
  }
  return value as UnknownRecord;
}

function nonEmpty(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new SpecValidationError(`${path} required`);
}

function finiteScalar(value: unknown, path: string): void {
  const valid = typeof value === 'string' || typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value));
  if (!valid) throw new SpecValidationError(`${path} must be a finite scalar`);
}

function source(value: unknown, path: string): void {
  const v = record(value, path);
  if (!['measured', 'literature', 'assumption', 'computed'].includes(String(v.kind))) {
    throw new SpecValidationError(`${path}.kind is invalid`);
  }
  for (const key of ['citation', 'uri', 'note', 'evidenceId', 'locator', 'transform']) {
    if (v[key] !== undefined) nonEmpty(v[key], `${path}.${key}`);
  }
  if (v.sha256 !== undefined && (typeof v.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(v.sha256))) {
    throw new SpecValidationError(`${path}.sha256 must be a 64-character hex digest`);
  }
  if ((v.evidenceId === undefined) !== (v.sha256 === undefined)) {
    throw new SpecValidationError(`${path}.evidenceId and sha256 must be supplied together`);
  }
}

function validatePathExperiment(value: unknown): void {
  const e = record(value, 'experiment');
  nonEmpty(e.experimentId, 'experiment.experimentId');
  nonEmpty(e.title, 'experiment.title');
  if (!Array.isArray(e.materials) || e.materials.length === 0) {
    throw new SpecValidationError('experiment.materials must be a non-empty array');
  }
  const materialIds = new Set<string>();
  e.materials.forEach((item, index) => {
    const p = `experiment.materials[${index}]`;
    const m = record(item, p);
    nonEmpty(m.id, `${p}.id`); nonEmpty(m.name, `${p}.name`); nonEmpty(m.role, `${p}.role`);
    if (materialIds.has(m.id)) throw new SpecValidationError(`${p}.id duplicated`);
    materialIds.add(m.id); source(m.source, `${p}.source`);
  });
  if (!Array.isArray(e.steps) || e.steps.length === 0) {
    throw new SpecValidationError('experiment.steps must be a non-empty array');
  }
  const stepIds = new Set<string>();
  e.steps.forEach((item, index) => {
    const p = `experiment.steps[${index}]`; const s = record(item, p);
    nonEmpty(s.id, `${p}.id`); nonEmpty(s.label, `${p}.label`); nonEmpty(s.mechanism, `${p}.mechanism`);
    if (stepIds.has(s.id)) throw new SpecValidationError(`${p}.id duplicated`);
    stepIds.add(s.id);
    for (const key of ['inputs', 'outputs'] as const) {
      if (!Array.isArray(s[key])) throw new SpecValidationError(`${p}.${key} must be an array`);
      s[key].forEach((entry, i) => nonEmpty(entry, `${p}.${key}[${i}]`));
    }
    const h = record(s.hypothesis, `${p}.hypothesis`);
    if (!['accepted', 'candidate', 'disputed'].includes(String(h.status))) throw new SpecValidationError(`${p}.hypothesis.status is invalid`);
    nonEmpty(h.description, `${p}.hypothesis.description`);
    if (!Array.isArray(h.sources) || h.sources.length === 0) throw new SpecValidationError(`${p}.hypothesis.sources must be non-empty`);
    h.sources.forEach((entry, i) => source(entry, `${p}.hypothesis.sources[${i}]`));
  });
  const parameters = record(e.parameters, 'experiment.parameters');
  for (const [key, item] of Object.entries(parameters)) {
    const p = `experiment.parameters.${key}`; const parameter = record(item, p);
    finiteScalar(parameter.value, `${p}.value`); source(parameter.source, `${p}.source`);
  }
  const model = record(e.model, 'experiment.model');
  nonEmpty(model.id, 'experiment.model.id'); nonEmpty(model.version, 'experiment.model.version');
  if (model.checksum !== undefined && (typeof model.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(model.checksum))) {
    throw new SpecValidationError('experiment.model.checksum must be a lowercase SHA-256');
  }
  if (e.analysis !== undefined) validatePathAnalysis(e.analysis);
  const provenance = record(e.provenance, 'experiment.provenance');
  nonEmpty(provenance.createdAt, 'experiment.provenance.createdAt');
  if (!Number.isFinite(Date.parse(provenance.createdAt))) throw new SpecValidationError('experiment.provenance.createdAt must be an ISO date-time');
  const software = record(provenance.software, 'experiment.provenance.software');
  nonEmpty(software.name, 'experiment.provenance.software.name'); nonEmpty(software.version, 'experiment.provenance.software.version');
}

function finiteArray(value: unknown, path: string, nonNegative = false): number[] {
  if (!Array.isArray(value) || value.length === 0) throw new SpecValidationError(`${path} must be a non-empty array`);
  value.forEach((entry, index) => {
    if (typeof entry !== 'number' || !Number.isFinite(entry) || (nonNegative && entry < 0)) {
      throw new SpecValidationError(`${path}[${index}] must be ${nonNegative ? 'a non-negative ' : 'a '}finite number`);
    }
  });
  return value as number[];
}

function positiveIntegerField(value: unknown, path: string): void {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new SpecValidationError(`${path} must be a positive integer`);
}

function validatePathAnalysis(value: unknown): void {
  const analysis = record(value, 'experiment.analysis');
  if (analysis.calibration === undefined && analysis.uncertainty === undefined) {
    throw new SpecValidationError('experiment.analysis requires calibration or uncertainty');
  }
  if (analysis.calibration !== undefined) {
    const calibration = record(analysis.calibration, 'experiment.analysis.calibration');
    const observations = record(calibration.observations, 'experiment.analysis.calibration.observations');
    if (calibration.evidence !== undefined) source(calibration.evidence, 'experiment.analysis.calibration.evidence');
    if (calibration.evidenceDerivation !== undefined) {
      if (calibration.evidence === undefined) throw new SpecValidationError('experiment.analysis.calibration.evidenceDerivation requires evidence');
      const derivation = record(calibration.evidenceDerivation, 'experiment.analysis.calibration.evidenceDerivation');
      if (derivation.extractor !== 'waveworld.calibration-csv' || derivation.version !== '1') throw new SpecValidationError('experiment.analysis.calibration.evidenceDerivation extractor/version is unsupported');
      const columns = record(derivation.columns, 'experiment.analysis.calibration.evidenceDerivation.columns');
      nonEmpty(columns.time, 'experiment.analysis.calibration.evidenceDerivation.columns.time');
      for (const name of ['T1', 'singletO2']) if (columns[name] !== undefined) nonEmpty(columns[name], `experiment.analysis.calibration.evidenceDerivation.columns.${name}`);
      for (const name of ['sourceSha256', 'observationsSha256']) if (typeof derivation[name] !== 'string' || !/^[a-f0-9]{64}$/.test(derivation[name] as string)) throw new SpecValidationError(`experiment.analysis.calibration.evidenceDerivation.${name} must be a lowercase SHA-256`);
    }
    const time = finiteArray(observations.time, 'experiment.analysis.calibration.observations.time', true);
    if (observations.T1 === undefined && observations.singletO2 === undefined) {
      throw new SpecValidationError('experiment.analysis.calibration.observations requires T1 or singletO2');
    }
    for (const name of ['T1', 'singletO2']) {
      if (observations[name] === undefined) continue;
      const values = finiteArray(observations[name], `experiment.analysis.calibration.observations.${name}`);
      if (values.length !== time.length) throw new SpecValidationError(`experiment.analysis.calibration.observations.${name} length mismatch`);
    }
    const fit = record(calibration.fitParameters, 'experiment.analysis.calibration.fitParameters');
    if (!Object.keys(fit).length) throw new SpecValidationError('experiment.analysis.calibration.fitParameters cannot be empty');
    for (const [name, raw] of Object.entries(fit)) {
      const bound = record(raw, `experiment.analysis.calibration.fitParameters.${name}`);
      if (typeof bound.min !== 'number' || !Number.isFinite(bound.min) || typeof bound.max !== 'number' || !Number.isFinite(bound.max) || bound.max < bound.min) {
        throw new SpecValidationError(`experiment.analysis.calibration.fitParameters.${name} requires finite min <= max`);
      }
      if (bound.gridPoints !== undefined) {
        positiveIntegerField(bound.gridPoints, `experiment.analysis.calibration.fitParameters.${name}.gridPoints`);
        if (Number(bound.gridPoints) < 2) throw new SpecValidationError(`experiment.analysis.calibration.fitParameters.${name}.gridPoints must be >= 2`);
      }
    }
    if (calibration.rounds !== undefined) positiveIntegerField(calibration.rounds, 'experiment.analysis.calibration.rounds');
  }
  if (analysis.uncertainty !== undefined) {
    const uq = record(analysis.uncertainty, 'experiment.analysis.uncertainty');
    if (!Number.isInteger(uq.seed)) throw new SpecValidationError('experiment.analysis.uncertainty.seed must be an integer');
    positiveIntegerField(uq.samples, 'experiment.analysis.uncertainty.samples');
    if (uq.relativeSigma !== undefined && (typeof uq.relativeSigma !== 'number' || !Number.isFinite(uq.relativeSigma) || uq.relativeSigma < 0)) {
      throw new SpecValidationError('experiment.analysis.uncertainty.relativeSigma must be finite and >= 0');
    }
    if (uq.parameters !== undefined) {
      const parameters = record(uq.parameters, 'experiment.analysis.uncertainty.parameters');
      for (const [name, raw] of Object.entries(parameters)) {
        const distribution = record(raw, `experiment.analysis.uncertainty.parameters.${name}`);
        if (distribution.kind === 'uniform') {
          if (typeof distribution.min !== 'number' || !Number.isFinite(distribution.min) || typeof distribution.max !== 'number' || !Number.isFinite(distribution.max) || distribution.max < distribution.min) {
            throw new SpecValidationError(`experiment.analysis.uncertainty.parameters.${name} requires finite min <= max`);
          }
        } else if (distribution.kind === 'normal') {
          if (typeof distribution.sigma !== 'number' || !Number.isFinite(distribution.sigma) || distribution.sigma < 0) throw new SpecValidationError(`experiment.analysis.uncertainty.parameters.${name}.sigma must be finite and >= 0`);
          for (const key of ['min', 'max']) if (distribution[key] !== undefined && (typeof distribution[key] !== 'number' || !Number.isFinite(distribution[key]))) throw new SpecValidationError(`experiment.analysis.uncertainty.parameters.${name}.${key} must be finite`);
          if (typeof distribution.min === 'number' && typeof distribution.max === 'number' && distribution.max < distribution.min) throw new SpecValidationError(`experiment.analysis.uncertainty.parameters.${name} requires min <= max`);
        } else throw new SpecValidationError(`experiment.analysis.uncertainty.parameters.${name}.kind is invalid`);
      }
    }
  }
}

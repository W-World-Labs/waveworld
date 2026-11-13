import type { JobResultV1, JobSpecV1 } from '@/types/task';
import { LBM_MASS_BALANCE_FEATURE } from '@w-sim/contracts';

export class ResultValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResultValidationError';
  }
}

function assertFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ResultValidationError(
      `${path} must be a finite number (got ${typeof value === 'number' ? value : typeof value})`
    );
  }
}

/** Result-reported CUDA-family backend.id values (real GPU execution). */
export function isCudaResultBackendId(id: string): boolean {
  return id === 'cuda' || id === 'w-sim-cuda' || id.startsWith('native-cuda');
}

/** Result-reported host-execution backend.id values (cpu math, never GPU). */
export function isHostResultBackendId(id: string): boolean {
  return id === 'cpu' || id.startsWith('cpu-') || id === 'w-sim-cuda-host' || id === 'host-f64';
}

/**
 * Whether a result's self-reported backend.id satisfies spec.requirements.backends
 * (ANY-OF). Mirrors the agent's canonical predicate: cuda-family ids satisfy
 * cuda|native-cuda|webgpu requirements ('webgpu' means any GPU), host-family
 * ids satisfy 'cpu', webgpu-* ids satisfy the umbrella 'webgpu'; all else is
 * literal. A missing id never satisfies a non-empty requirement.
 */
export function resultBackendAllowed(id: string | undefined, required: readonly string[]): boolean {
  if (required.length === 0) return true;
  if (id === undefined) return false;
  if (required.includes(id)) return true;
  if (isCudaResultBackendId(id)) return required.some((b) => b === 'cuda' || b === 'native-cuda' || b === 'webgpu');
  if (isHostResultBackendId(id)) return required.includes('cpu');
  if (id.startsWith('webgpu')) return required.includes('webgpu');
  return false;
}

function assertOptionalFinite(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  assertFiniteNumber(value, path);
}

/**
 * Validate JobResultV1 before accepting complete.
 * Rejects missing schema, non-finite Cd/Cl (incl. NaN/Infinity), and broken history arrays.
 */
export function validateJobResult(result: unknown): asserts result is JobResultV1 {
  if (!result || typeof result !== 'object') {
    throw new ResultValidationError('result object required');
  }
  const r = result as Partial<JobResultV1>;

  if (r.schemaVersion !== 1) {
    throw new ResultValidationError('result.schemaVersion must be 1');
  }
  // Envelope-level error: a result that declares a failure message cannot
  // settle as succeeded — same honesty gate as readModuleResult's sw guard.
  if (typeof r.error === 'string' && r.error.length > 0) {
    throw new ResultValidationError('result carries an error message and cannot settle as a success');
  }
  if (!r.summary || typeof r.summary !== 'object') {
    throw new ResultValidationError('result.summary required');
  }

  assertFiniteNumber(r.summary.steps, 'result.summary.steps');
  if (!Number.isSafeInteger(r.summary.steps) || r.summary.steps < 0) {
    throw new ResultValidationError('result.summary.steps must be a nonnegative safe integer');
  }
  assertFiniteNumber(r.summary.wallTimeMs, 'result.summary.wallTimeMs');
  if (r.summary.wallTimeMs < 0) {
    throw new ResultValidationError('result.summary.wallTimeMs must be >= 0');
  }

  // Cd/Cl: when present must be finite (NaN/Infinity rejected)
  assertOptionalFinite(r.summary.cd, 'result.summary.cd');
  assertOptionalFinite(r.summary.cl, 'result.summary.cl');
  assertOptionalFinite(r.summary.dragN, 'result.summary.dragN');
  assertOptionalFinite(r.summary.liftN, 'result.summary.liftN');
  assertOptionalFinite(r.summary.sideN, 'result.summary.sideN');
  assertOptionalFinite(r.summary.reynoldsPhysical, 'result.summary.reynoldsPhysical');
  assertOptionalFinite(r.summary.reynoldsLattice, 'result.summary.reynoldsLattice');
  assertOptionalFinite(r.summary.solidCells, 'result.summary.solidCells');

  if (r.lbmMassBalance !== undefined) {
    const mass = r.lbmMassBalance;
    if (!mass || typeof mass !== 'object' || Array.isArray(mass) || mass.scope !== 'internal-fluid-x') {
      throw new ResultValidationError('result.lbmMassBalance.scope must be internal-fluid-x');
    }
    for (const key of ['initialMassKg', 'finalMassKg', 'inletMassKg', 'outletMassKg',
      'collisionMassChangeKg', 'balanceResidualKg', 'maxAbsStepBalanceResidualKg',
      'boundaryFinalMassKg', 'inletReconstructionMassKg', 'outletReconstructionMassKg'] as const) {
      assertFiniteNumber(mass[key], `result.lbmMassBalance.${key}`);
    }
    if (mass.initialMassKg <= 0 || mass.finalMassKg <= 0 || mass.boundaryFinalMassKg < 0 || mass.maxAbsStepBalanceResidualKg < 0) {
      throw new ResultValidationError('LBM initial/final masses must be positive; boundary mass and the maximum absolute step residual must be nonnegative');
    }
  }

  if (r.thermal !== undefined) {
    const t = r.thermal;
    if (!t || typeof t !== 'object' || (t.mode !== 'fixed-temperature' && t.mode !== 'solid-power')) {
      throw new ResultValidationError('result.thermal.mode is invalid');
    }
    for (const key of ['thermalEnergyJ', 'sourceEnergyJ', 'boundaryEnergyJ', 'energyResidualJ',
      'maxAbsEnergyResidualJ', 'solidMaxC', 'fluidMaxC', 'thermalSubsteps', 'solidVolumeM3'] as const) {
      assertFiniteNumber(t[key], `result.thermal.${key}`);
    }
    if (t.sourceEnergyJ < 0 || t.maxAbsEnergyResidualJ < 0 || t.solidVolumeM3 <= 0 ||
        !Number.isSafeInteger(t.thermalSubsteps) || t.thermalSubsteps < 1 || t.solidMaxC <= -273.15 || t.fluidMaxC <= -273.15) {
      throw new ResultValidationError('result.thermal contains invalid physical quantities');
    }
  }

  if (r.history) {
    if (!Array.isArray(r.history.step)) {
      throw new ResultValidationError('result.history.step must be an array');
    }
    const n = r.history.step.length;
    for (const [name, values] of Object.entries(r.history)) {
      if (values === undefined) continue;
      if (!Array.isArray(values) || values.length !== n) {
        throw new ResultValidationError(`result.history.${name} must be an array matching step length`);
      }
      values.forEach((value, index) => assertFiniteNumber(value, `result.history.${name}[${index}]`));
    }
  }

  if (!r.backend || typeof r.backend !== 'object') {
    throw new ResultValidationError('result.backend required');
  }
  if (typeof r.backend.id !== 'string' || !r.backend.id.trim()) {
    throw new ResultValidationError('result.backend.id required');
  }
  // agentId is stamped server-side on complete; when present must be non-empty string
  if (r.backend.agentId != null && (typeof r.backend.agentId !== 'string' || !r.backend.agentId.trim())) {
    throw new ResultValidationError('result.backend.agentId must be a non-empty string when set');
  }

  if (r.artifacts !== undefined && (!Array.isArray(r.artifacts) || r.artifacts.some(artifact =>
      !artifact || typeof artifact.artifactId !== 'string' || !artifact.artifactId ||
      (artifact.step !== undefined && (!Number.isSafeInteger(artifact.step) || artifact.step < 1))))) {
    throw new ResultValidationError('result.artifacts must contain valid references and optional positive integer steps');
  }

  if (r.experiment !== undefined) validatePathResult(r.experiment);
}

/** Validate the submitted LBM sampling plan, without claiming flow/grid convergence. */
export function validateLbmResult(spec: JobSpecV1, result: JobResultV1): void {
  if (spec.kind !== 'lbm-d3q19') return;
  const { steps, wallTimeMs } = result.summary;
  const { maxSteps, forceSampleEvery = 20, warmupSteps = 0, stopWhen } = spec.run;
  if (![maxSteps, forceSampleEvery].every(value => Number.isSafeInteger(value) && value > 0 && value <= 1000000) ||
      !Number.isSafeInteger(warmupSteps) || warmupSteps < 0 || warmupSteps > maxSteps) {
    throw new ResultValidationError('LBM submitted sampling limits must be valid integers');
  }
  if (!Number.isSafeInteger(steps) || steps < 1 || steps > maxSteps || wallTimeMs < 0) {
    throw new ResultValidationError('LBM result steps must be an integer in 1..maxSteps and wall time must be nonnegative');
  }
  if (result.derived?.[LBM_MASS_BALANCE_FEATURE] === 1 && !result.lbmMassBalance) {
    throw new ResultValidationError('LBM mass-balance feature requires the internal-fluid-x mass report');
  }
  const mass = result.lbmMassBalance;
  if (mass) {
    // Compare normalized values to avoid overflowing finite kilogram totals.
    // CPU sums f64 reports; GPU also rounds per-step arithmetic and interval
    // reductions in f32. This step-scaled sanity tolerance is not a rigorous
    // error bound for arbitrary cancelled sums, nor a physical accuracy limit.
    const scale = Math.max(Number.MIN_VALUE, Math.abs(mass.initialMassKg), Math.abs(mass.finalMassKg),
      Math.abs(mass.inletMassKg), Math.abs(mass.outletMassKg), Math.abs(mass.collisionMassChangeKg), Math.abs(mass.balanceResidualKg));
    const unitRoundoff = ['webgpu', 'webgpu-dawn', 'webgpu-browser', 'cuda', 'native-cuda'].includes(result.backend?.id ?? '') ? 2 ** -24 : Number.EPSILON / 2;
    const operations = 8 * steps + 32;
    const tolerance = operations * unitRoundoff / (1 - operations * unitRoundoff);
    const expected = mass.finalMassKg / scale - mass.initialMassKg / scale - mass.inletMassKg / scale +
      mass.outletMassKg / scale - mass.collisionMassChangeKg / scale;
    if (Math.abs(mass.balanceResidualKg / scale - expected) > tolerance) {
      throw new ResultValidationError('LBM mass report has inconsistent final/initial/flux/collision totals and balance residual');
    }
    if (Math.abs(mass.balanceResidualKg) / scale / steps - mass.maxAbsStepBalanceResidualKg / scale > tolerance / steps) {
      throw new ResultValidationError('LBM cumulative mass residual exceeds the reported maximum absolute step residual times completed steps');
    }
  }
  const threshold = stopWhen?.maxCdVariance, window = stopWhen?.window ?? 10;
  if (!Number.isSafeInteger(window) || window < 2 || window > 1000000 ||
      (threshold !== undefined && (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1e100))) {
    throw new ResultValidationError('LBM submitted Cd stopping window and variance threshold are invalid');
  }
  if (steps < maxSteps && (threshold === undefined || steps <= warmupSteps || steps % forceSampleEvery !== 0)) {
    throw new ResultValidationError('LBM early stopping requires a post-warmup Cd sample meeting the submitted variance threshold');
  }
  for (const key of ['cd', 'cl', 'dragN', 'liftN', 'sideN'] as const) {
    if (result.summary[key] !== undefined || (spec.outputs.forces && (key === 'dragN' || key === 'liftN'))) {
      assertFiniteNumber(result.summary[key], `LBM summary.${key}`);
    }
  }
  const history = result.history;
  if (!history) {
    if (spec.outputs.history || threshold !== undefined) {
      throw new ResultValidationError('LBM result requires history for the requested curve or Cd stopping evidence');
    }
    return;
  }
  const fullSamples = steps > warmupSteps ? Math.floor(steps / forceSampleEvery) - Math.floor(warmupSteps / forceSampleEvery) : 0;
  const expectedCount = fullSamples + (steps > warmupSteps && steps % forceSampleEvery !== 0 ? 1 : 0);
  const sampleSteps = history.step;
  if (!sampleSteps || sampleSteps.length !== expectedCount || sampleSteps.some((step, index) => step !==
      (index < fullSamples ? (Math.floor(warmupSteps / forceSampleEvery) + index + 1) * forceSampleEvery : steps))) {
    throw new ResultValidationError('LBM history steps must exactly follow forceSampleEvery after warmup, in increasing integer order, including the final step');
  }
  for (const key of ['cd', 'cl', 'dragN', 'liftN', 'sideN'] as const) {
    const scalar = result.summary[key], values = history[key];
    if (scalar === undefined && values === undefined) continue;
    assertFiniteNumber(scalar, `LBM summary.${key}`);
    if (!values || values.length !== expectedCount) {
      throw new ResultValidationError(`LBM history.${key} must preserve every sampled summary value`);
    }
    if (values.length && values.at(-1) !== scalar) {
      throw new ResultValidationError(`LBM summary.${key} must equal the final sampled interval average`);
    }
  }
  if (steps < maxSteps) {
    const values = history.cd;
    if (threshold === undefined || !values || values.length < window) {
      throw new ResultValidationError('LBM early stopping requires a complete Cd variance window');
    }
    const tail = values.slice(-window), mean = tail.reduce((sum, value) => sum + value, 0) / window;
    const variance = tail.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window;
    if (!Number.isFinite(variance) || variance > threshold) {
      throw new ResultValidationError('LBM early stopping Cd population variance exceeds the submitted threshold');
    }
  }
}

function validatePathResult(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResultValidationError('result.experiment must be an object');
  }
  const e = value as Record<string, unknown>;
  for (const key of ['experimentId', 'modelVersion']) {
    if (typeof e[key] !== 'string' || !e[key].trim()) throw new ResultValidationError(`result.experiment.${key} required`);
  }
  if (!e.outputs || typeof e.outputs !== 'object' || Array.isArray(e.outputs)) throw new ResultValidationError('result.experiment.outputs must be an object');
  for (const [key, item] of Object.entries(e.outputs as Record<string, unknown>)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ResultValidationError(`result.experiment.outputs.${key} must be an object`);
    const output = item as Record<string, unknown>; const v = output.value;
    if (Array.isArray(v)) v.forEach((entry, index) => assertFiniteNumber(entry, `result.experiment.outputs.${key}.value[${index}]`));
    else if (!(typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)))) throw new ResultValidationError(`result.experiment.outputs.${key}.value must be a finite scalar or number array`);
  }
  if (!e.provenance || typeof e.provenance !== 'object' || Array.isArray(e.provenance)) throw new ResultValidationError('result.experiment.provenance required');
  const provenance = e.provenance as Record<string, unknown>;
  if (typeof provenance.computedAt !== 'string' || !Number.isFinite(Date.parse(provenance.computedAt))) throw new ResultValidationError('result.experiment.provenance.computedAt must be an ISO date-time');
  if (typeof provenance.engineVersion !== 'string' || !provenance.engineVersion.trim()) throw new ResultValidationError('result.experiment.provenance.engineVersion required');
}

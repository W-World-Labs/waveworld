import {
  branchFractions,
  defaultPhotoParams,
  initPhotoState,
  rk4Step,
  steadyState,
  type PhotoParams,
  type PhotoState,
} from '../../../../src/lib/sim/photosensitization.ts';

export const PATH_EXPERIMENT_PROTOCOL = 'waveworld.path-experiment/v1' as const;
export const PHOTOSENSITIZATION_RK4_MODEL = {
  id: 'photosensitization-rk4',
  version: '1.0.0',
} as const;
export const PHOTOSENSITIZATION_STEADY_STATE_MODEL = {
  id: 'photosensitization-steady-state',
  version: '1.0.0',
} as const;

/** Structural subset of JobSpecV1, kept independent while task.ts evolves in parallel. */
export interface PathExperimentJobSpecLike {
  schemaVersion: 1;
  kind: string;
  name?: string;
  parameters: object;
  run: { maxSteps: number; forceSampleEvery?: number };
  outputs?: { forces?: boolean; history?: boolean; fields?: string[] };
  experiment?: {
    experimentId: string;
    title: string;
    materials: unknown[];
    steps: unknown[];
    parameters: Record<string, { value: string | number | boolean; unit?: string; source: unknown }>;
    model: { id: string; version: string; checksum?: string };
    provenance: { createdAt: string; software: { name: string; version: string } };
    /** Optional analysis extension; structurally compatible until shared task types adopt it. */
    analysis?: PathExperimentAnalysis;
  };
}

export interface PathExperimentAnalysis {
  calibration?: {
    observations: { time: number[]; T1?: number[]; singletO2?: number[] };
    evidence?: unknown;
    evidenceDerivation?: {
      extractor: 'waveworld.calibration-csv'; version: '1';
      columns: { time: string; T1?: string; singletO2?: string };
      sourceSha256: string; observationsSha256: string;
    };
    fitParameters: Record<string, { min: number; max: number; gridPoints?: number }>;
    rounds?: number;
  };
  uncertainty?: {
    seed: number;
    samples: number;
    /** Default normal perturbation around fitted/base value when no per-parameter distribution is supplied. */
    relativeSigma?: number;
    parameters?: Record<string,
      | { kind: 'uniform'; min: number; max: number }
      | { kind: 'normal'; sigma: number; min?: number; max?: number }
    >;
  };
}

export interface PathExperimentResult {
  schemaVersion: 1;
  summary: {
    steps: number;
    wallTimeMs: number;
  };
  backend: { id: string; agentId: string; deviceName?: string; provenance?: {
    agentBuildId: string; modelImplementationSha256: string; dependencyLockSha256: string;
  } };
  experiment: {
    experimentId: string;
    modelVersion: string;
    outputs: Record<string, {
      value: string | number | boolean | number[];
      unit?: string;
      source?: { kind: 'computed'; note?: string };
    }>;
    provenance: { computedAt: string; engineVersion: string; agentBuildId?: string; modelImplementationSha256?: string; dependencyLockSha256?: string };
  };
}

export interface PathModelExecution {
  steps: number;
  metrics: Record<string, number>;
  series?: Record<string, number[]>;
}

export interface PathModelManifest {
  id: string;
  version: string;
  backends: Array<'cpu' | 'webgpu' | 'webgpu-dawn' | 'webgpu-browser' | 'cuda'>;
  parameters: Record<string, {
    type: 'number' | 'string' | 'boolean';
    required?: boolean;
    min?: number;
    unit?: string;
    description?: string;
  }>;
  outputs: Record<string, { type: 'number' | 'number[]'; unit?: string; description?: string }>;
  analyses?: Array<'calibration' | 'uncertainty'>;
}

export interface PathModelAdapter {
  readonly manifest: PathModelManifest;
  run(input: {
    parameters: Record<string, unknown>;
    analysis?: PathExperimentAnalysis;
    maxSteps: number;
    sampleEvery: number;
    signal?: AbortSignal;
    /** Await progress so heartbeat failures settle the job before it can publish. */
    onProgress?: (progress: { step: number; total: number; message?: string }) => void | Promise<void>;
  }): Promise<PathModelExecution> | PathModelExecution;
}

export interface PathModelImplementationIdentity {
  implementationSha256: string;
  dependencyLockSha256?: string;
  source: 'builtin' | 'external';
}

export class PathModelRegistry {
  private readonly models = new Map<string, PathModelAdapter>();
  private readonly identities = new Map<string, PathModelImplementationIdentity>();
  private frozen = false;

  register(adapter: PathModelAdapter, identity?: PathModelImplementationIdentity): this {
    if (this.frozen) throw new Error('path model registry is frozen');
    validateManifest(adapter.manifest);
    const key = modelKey(adapter.manifest.id, adapter.manifest.version);
    if (this.models.has(key)) throw new Error(`path model already registered: ${key}`);
    this.models.set(key, adapter);
    if (identity) this.identities.set(key, Object.freeze({ ...identity }));
    return this;
  }

  freeze(): this {
    this.frozen = true;
    return this;
  }

  resolve(id: string, version: string): PathModelAdapter {
    const adapter = this.models.get(modelKey(id, version));
    if (!adapter) throw new Error(`unsupported path model: ${id}@${version}`);
    return adapter;
  }

  manifests(): readonly PathModelManifest[] {
    return [...this.models.values()].map((adapter) => adapter.manifest);
  }

  identity(id: string, version: string): PathModelImplementationIdentity | undefined {
    return this.identities.get(modelKey(id, version));
  }
}

export function createDefaultPathModelRegistry(): PathModelRegistry {
  return new PathModelRegistry()
    .register(photosensitizationRk4Adapter)
    .register(photosensitizationSteadyStateAdapter);
}

export async function runPathExperiment(input: {
  spec: PathExperimentJobSpecLike;
  agentId: string;
  buildProvenance?: { agentBuildId: string; modelImplementationSha256: string; dependencyLockSha256: string };
  registry?: PathModelRegistry;
  signal?: AbortSignal;
  onProgress?: (progress: { step: number; total: number; message?: string }) => void | Promise<void>;
  now?: () => number;
}): Promise<PathExperimentResult> {
  if (input.spec.schemaVersion !== 1) throw new Error('path experiment requires JobSpec schemaVersion 1');
  if (input.spec.kind !== 'path-experiment') throw new Error(`expected path-experiment job, got ${input.spec.kind}`);
  const experiment = input.spec.experiment;
  if (!experiment) throw new Error('path experiment descriptor is required');
  const id = experiment.model?.id;
  const version = experiment.model?.version;
  if (!id || !version) throw new Error('path experiment model id and version are required');

  const maxSteps = assertPositiveInteger(input.spec.run.maxSteps, 'run.maxSteps');
  const sampleEvery = input.spec.run.forceSampleEvery == null
    ? 1
    : assertPositiveInteger(input.spec.run.forceSampleEvery, 'run.forceSampleEvery');
  const experimentParameters = Object.fromEntries(
    Object.entries(experiment.parameters).map(([key, parameter]) => [key, parameter.value]),
  );
  const parameters = { ...input.spec.parameters, ...experimentParameters };
  const registry = input.registry ?? createDefaultPathModelRegistry();
  const started = (input.now ?? Date.now)();
  const adapter = registry.resolve(id, version);
  const identity = registry.identity(id, version);
  if (experiment.model.checksum && identity?.implementationSha256 !== experiment.model.checksum) {
    throw new Error(`path model implementation mismatch: expected ${experiment.model.checksum}, got ${identity?.implementationSha256 ?? 'unverified'}`);
  }
  const execution = await adapter.run({
    parameters,
    analysis: experiment.analysis,
    maxSteps,
    sampleEvery,
    signal: input.signal,
    onProgress: input.onProgress,
  });
  const finished = (input.now ?? Date.now)();

  return {
    schemaVersion: 1,
    summary: { steps: execution.steps, wallTimeMs: Math.max(0, finished - started) },
    backend: { id: 'cpu-path-experiment', agentId: input.agentId, ...(input.buildProvenance ? { provenance: {
      ...input.buildProvenance,
      ...(identity ? { modelImplementationSha256: identity.implementationSha256 } : {}),
    } } : {}) },
    experiment: {
      experimentId: experiment.experimentId,
      modelVersion: version,
      outputs: {
        ...Object.fromEntries(Object.entries(execution.metrics).map(([key, value]) => [key, {
          value,
          source: { kind: 'computed', note: PATH_EXPERIMENT_PROTOCOL },
        }])),
        ...Object.fromEntries(Object.entries(execution.series ?? {}).map(([key, value]) => [key, {
          value,
          source: { kind: 'computed', note: PATH_EXPERIMENT_PROTOCOL },
        }])),
      },
      provenance: {
        computedAt: new Date(finished).toISOString(),
        engineVersion: `${PATH_EXPERIMENT_PROTOCOL}:${id}@${version}`,
        ...(input.buildProvenance ? {
          ...input.buildProvenance,
          ...(identity ? { modelImplementationSha256: identity.implementationSha256 } : {}),
        } : {}),
      },
    },
  };
}

const photosensitizationRk4Adapter: PathModelAdapter = {
  manifest: {
    ...PHOTOSENSITIZATION_RK4_MODEL,
    backends: ['cpu'],
    analyses: ['calibration', 'uncertainty'],
    parameters: {
      k_exc: { type: 'number', required: true, min: 0, unit: 's^-1', description: 'Excitation rate' },
      k_f: { type: 'number', required: true, min: 0, unit: 's^-1' },
      k_isc: { type: 'number', required: true, min: 0, unit: 's^-1' },
      k_T: { type: 'number', required: true, min: 0, unit: 's^-1' },
      k_q: { type: 'number', required: true, min: 0, description: 'Type-II quenching rate' },
      k_d: { type: 'number', required: true, min: 0, unit: 's^-1' },
      k_I: { type: 'number', required: true, min: 0, description: 'Type-I transfer rate' },
      O2: { type: 'number', required: true, min: 0 },
      substrate: { type: 'number', required: true, min: 0 },
      cTot: { type: 'number', required: true, min: 0 },
      dt: { type: 'number', required: true, min: 0, unit: 's' },
    },
    outputs: {
      finalT1: { type: 'number' },
      finalSingletO2: { type: 'number' },
      T1: { type: 'number[]' },
      singletO2: { type: 'number[]' },
      time: { type: 'number[]', unit: 's' },
      'calibration.time': { type: 'number[]' },
      'calibration.predictedT1': { type: 'number[]' },
      'calibration.predictedSingletO2': { type: 'number[]' },
    },
  },
  async run({ parameters, analysis, maxSteps, sampleEvery, signal, onProgress }) {
    let p = photoParameters(parameters, maxSteps);
    const analysisMetrics: Record<string, number> = {};
    const analysisSeries: Record<string, number[]> = {};
    if (analysis?.calibration) {
      const calibrated = calibratePhoto(p, analysis.calibration, signal);
      p = calibrated.parameters;
      analysisMetrics['calibration.rmse'] = calibrated.rmse;
      analysisSeries['calibration.time'] = [...analysis.calibration.observations.time];
      if (calibrated.predictions.T1) analysisSeries['calibration.predictedT1'] = calibrated.predictions.T1;
      if (calibrated.predictions.singletO2) analysisSeries['calibration.predictedSingletO2'] = calibrated.predictions.singletO2;
      for (const [key, value] of Object.entries(calibrated.fitted)) {
        analysisMetrics[`fitted.${key}`] = value;
      }
    }
    const sampled: PhotoState[] = [];
    let state = initPhotoState(p);
    sampled.push(state);
    for (let step = 1; step <= p.steps; step++) {
      if (signal?.aborted) throw new DOMException('path experiment aborted', 'AbortError');
      state = rk4Step(state, p, p.dt);
      if (step % sampleEvery === 0 || step === p.steps) sampled.push(state);
      if (step % sampleEvery === 0 || step === p.steps) {
        await onProgress?.({ step, total: p.steps, message: 'photosensitization RK4' });
        throwIfCancelled(signal);
      }
    }
    const ss = steadyState(p);
    const branches = branchFractions(p);
    if (analysis?.uncertainty) {
      Object.assign(analysisMetrics, photoEnsemble(p, analysis.uncertainty, signal));
    }
    return {
      steps: p.steps,
      metrics: {
        ...analysisMetrics,
        finalT1: state.T1,
        finalSingletO2: state.singletO2,
        steadyT1: ss.T1,
        steadySingletO2: ss.singletO2,
        tripletSteadyFraction: ss.phiTss,
        singletO2GenerationRate: ss.genRateSinglet,
        typeIFraction: branches.typeI,
        typeIIFraction: branches.typeII,
        deactivationFraction: branches.deactivation,
      },
      series: {
        ...analysisSeries,
        time: sampled.map((s) => s.t),
        S0: sampled.map((s) => s.S0),
        S1: sampled.map((s) => s.S1),
        T1: sampled.map((s) => s.T1),
        singletO2: sampled.map((s) => s.singletO2),
      },
    };
  },
};

/** Closed-form Jablonski steady state: one analytic solve, independent of RK4 horizon. */
const photosensitizationSteadyStateAdapter: PathModelAdapter = {
  manifest: {
    ...PHOTOSENSITIZATION_STEADY_STATE_MODEL,
    backends: ['cpu'],
    parameters: photosensitizationRk4Adapter.manifest.parameters,
    outputs: {
      steadyS0: { type: 'number' },
      steadyS1: { type: 'number' },
      steadyT1: { type: 'number' },
      steadySingletO2: { type: 'number' },
      tripletSteadyFraction: { type: 'number' },
      singletO2GenerationRate: { type: 'number' },
      typeIFraction: { type: 'number' },
      typeIIFraction: { type: 'number' },
      deactivationFraction: { type: 'number' },
    },
  },
  async run({ parameters, maxSteps, analysis, signal, onProgress }) {
    throwIfCancelled(signal);
    if (analysis?.calibration || analysis?.uncertainty) {
      throw new Error('photosensitization-steady-state does not support calibration or uncertainty analysis');
    }
    const p = photoParameters(parameters, maxSteps);
    const ss = steadyState(p);
    const branches = branchFractions(p);
    throwIfCancelled(signal);
    await onProgress?.({ step: 1, total: 1, message: 'photosensitization analytic steady state' });
    throwIfCancelled(signal);
    return {
      // This plugin performs one closed-form solve; maxSteps is accepted only for unified JobSpec compatibility.
      steps: 1,
      metrics: {
        steadyS0: ss.S0,
        steadyS1: ss.S1,
        steadyT1: ss.T1,
        steadySingletO2: ss.singletO2,
        tripletSteadyFraction: ss.phiTss,
        singletO2GenerationRate: ss.genRateSinglet,
        typeIFraction: branches.typeI,
        typeIIFraction: branches.typeII,
        deactivationFraction: branches.deactivation,
      },
    };
  },
};

function calibratePhoto(
  base: PhotoParams,
  config: NonNullable<PathExperimentAnalysis['calibration']>,
  signal?: AbortSignal,
): { parameters: PhotoParams; fitted: Record<string, number>; rmse: number; predictions: { T1?: number[]; singletO2?: number[] } } {
  validateObservations(config.observations);
  const names = Object.keys(config.fitParameters).sort();
  if (names.length === 0) throw new Error('analysis.calibration.fitParameters cannot be empty');
  let current = { ...base };
  for (const name of names) {
    if (!(name in current) || name === 'steps') throw new Error(`unsupported fit parameter: ${name}`);
    const bound = config.fitParameters[name]!;
    validateBounds(bound.min, bound.max, `fitParameters.${name}`);
    current = { ...current, [name]: clamp(Number(current[name as keyof PhotoParams]), bound.min, bound.max) };
  }
  let bestRmse = photoObservationRmse(current, config.observations, signal);
  const rounds = positiveInteger(config.rounds ?? 3, 'analysis.calibration.rounds');
  const gridSize = names.reduce((size, name) => size * (config.fitParameters[name]!.gridPoints ?? 9), 1);
  if (gridSize <= 50_000) {
    const visit = (index: number, candidate: PhotoParams): void => {
      throwIfCancelled(signal);
      if (index === names.length) {
        const rmse = photoObservationRmse(candidate, config.observations, signal);
        if (rmse < bestRmse) { bestRmse = rmse; current = candidate; }
        return;
      }
      const name = names[index]!;
      const bound = config.fitParameters[name]!;
      const points = positiveInteger(bound.gridPoints ?? 9, `fitParameters.${name}.gridPoints`);
      if (points < 2) throw new Error(`fitParameters.${name}.gridPoints must be >= 2`);
      for (let i = 0; i < points; i++) {
        visit(index + 1, { ...candidate, [name]: bound.min + ((bound.max - bound.min) * i) / (points - 1) });
      }
    };
    visit(0, current);
  }
  for (let round = 1; round < rounds; round++) {
    for (const name of names) {
      throwIfCancelled(signal);
      const bound = config.fitParameters[name]!;
      const points = positiveInteger(bound.gridPoints ?? 9, `fitParameters.${name}.gridPoints`);
      if (points < 2) throw new Error(`fitParameters.${name}.gridPoints must be >= 2`);
      const center = Number(current[name as keyof PhotoParams]);
      const fullWidth = bound.max - bound.min;
      const halfWidth = fullWidth / (2 * Math.pow(2, round));
      const lo = Math.max(bound.min, center - halfWidth);
      const hi = Math.min(bound.max, center + halfWidth);
      let bestValue = center;
      for (let i = 0; i < points; i++) {
        const value = lo + ((hi - lo) * i) / (points - 1);
        const candidate = { ...current, [name]: value };
        const rmse = photoObservationRmse(candidate, config.observations, signal);
        if (rmse < bestRmse || (rmse === bestRmse && value < bestValue)) {
          bestRmse = rmse;
          bestValue = value;
        }
      }
      current = { ...current, [name]: bestValue };
    }
  }
  return {
    parameters: current,
    fitted: Object.fromEntries(names.map((name) => [name, Number(current[name as keyof PhotoParams])])),
    rmse: bestRmse,
    predictions: photoObservationPredictions(current, config.observations, signal),
  };
}

function photoObservationPredictions(
  p: PhotoParams,
  observations: NonNullable<PathExperimentAnalysis['calibration']>['observations'],
  signal?: AbortSignal,
): { T1?: number[]; singletO2?: number[] } {
  const requested = observations.time.map((time, index) => ({ time, index })).sort((a, b) => a.time - b.time);
  const predictedT1 = observations.T1 ? new Array<number>(observations.time.length) : undefined;
  const predictedSingletO2 = observations.singletO2 ? new Array<number>(observations.time.length) : undefined;
  let state = initPhotoState(p);
  let step = 0;
  for (const target of requested) {
    const targetStep = Math.min(p.steps, Math.max(0, Math.round(target.time / p.dt)));
    while (step < targetStep) {
      if ((step & 255) === 0) throwIfCancelled(signal);
      state = rk4Step(state, p, p.dt);
      step++;
    }
    if (predictedT1) predictedT1[target.index] = state.T1;
    if (predictedSingletO2) predictedSingletO2[target.index] = state.singletO2;
  }
  return { ...(predictedT1 ? { T1: predictedT1 } : {}), ...(predictedSingletO2 ? { singletO2: predictedSingletO2 } : {}) };
}

function photoObservationRmse(
  p: PhotoParams,
  observations: NonNullable<PathExperimentAnalysis['calibration']>['observations'],
  signal?: AbortSignal,
): number {
  const predictions = photoObservationPredictions(p, observations, signal);
  let sumSquares = 0;
  let count = 0;
  for (let index = 0; index < observations.time.length; index++) {
    if (observations.T1) {
      const d = predictions.T1![index]! - observations.T1[index]!;
      sumSquares += d * d; count++;
    }
    if (observations.singletO2) {
      const d = predictions.singletO2![index]! - observations.singletO2[index]!;
      sumSquares += d * d; count++;
    }
  }
  return Math.sqrt(sumSquares / count);
}

function photoEnsemble(
  base: PhotoParams,
  config: NonNullable<PathExperimentAnalysis['uncertainty']>,
  signal?: AbortSignal,
): Record<string, number> {
  const samples = positiveInteger(config.samples, 'analysis.uncertainty.samples');
  if (!Number.isInteger(config.seed)) throw new Error('analysis.uncertainty.seed must be an integer');
  const relativeSigma = config.relativeSigma ?? 0.05;
  if (!(relativeSigma >= 0) || !Number.isFinite(relativeSigma)) throw new Error('analysis.uncertainty.relativeSigma must be finite and >= 0');
  const distributions: NonNullable<typeof config.parameters> = config.parameters ?? Object.fromEntries(
    ['k_exc', 'k_q'].map((name) => [name, { kind: 'normal' as const, sigma: Math.abs(base[name as keyof PhotoParams] as number) * relativeSigma, min: 0 }]),
  );
  const rand = seededRandom(config.seed);
  const finalT1: number[] = [];
  const finalSingletO2: number[] = [];
  for (let sample = 0; sample < samples; sample++) {
    throwIfCancelled(signal);
    const params = { ...base };
    for (const name of Object.keys(distributions).sort()) {
      if (!(name in params) || name === 'steps') throw new Error(`unsupported uncertainty parameter: ${name}`);
      const dist = distributions[name]!;
      let value: number;
      if (dist.kind === 'uniform') {
        validateBounds(dist.min, dist.max, `uncertainty.parameters.${name}`);
        value = dist.min + (dist.max - dist.min) * rand();
      } else {
        if (!(dist.sigma >= 0) || !Number.isFinite(dist.sigma)) throw new Error(`uncertainty.parameters.${name}.sigma must be finite and >= 0`);
        value = Number(params[name as keyof PhotoParams]) + dist.sigma * standardNormal(rand);
        value = clamp(value, dist.min ?? -Infinity, dist.max ?? Infinity);
      }
      Object.assign(params, { [name]: value });
    }
    let state = initPhotoState(params);
    for (let step = 0; step < params.steps; step++) {
      if ((step & 255) === 0) throwIfCancelled(signal);
      state = rk4Step(state, params, params.dt);
    }
    finalT1.push(state.T1);
    finalSingletO2.push(state.singletO2);
  }
  const t1q = quantiles(finalT1);
  const o2q = quantiles(finalSingletO2);
  return {
    'uq.seed': config.seed,
    'uq.samples': samples,
    'uq.finalT1.p10': t1q.p10,
    'uq.finalT1.p50': t1q.p50,
    'uq.finalT1.p90': t1q.p90,
    'uq.finalSingletO2.p10': o2q.p10,
    'uq.finalSingletO2.p50': o2q.p50,
    'uq.finalSingletO2.p90': o2q.p90,
  };
}

function validateObservations(observations: NonNullable<PathExperimentAnalysis['calibration']>['observations']): void {
  if (!Array.isArray(observations.time) || observations.time.length === 0) throw new Error('calibration observations.time cannot be empty');
  if (!observations.T1 && !observations.singletO2) throw new Error('calibration needs T1 or singletO2 observations');
  for (const [name, values] of [['time', observations.time], ['T1', observations.T1], ['singletO2', observations.singletO2]] as const) {
    if (!values) continue;
    if (values.length !== observations.time.length) throw new Error(`calibration observations.${name} length mismatch`);
    if (values.some((value) => !Number.isFinite(value) || (name === 'time' && value < 0))) throw new Error(`calibration observations.${name} must be finite`);
  }
}

function quantiles(values: number[]): { p10: number; p50: number; p90: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.round(p * (sorted.length - 1))]!;
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function standardNormal(rand: () => number): number {
  let u = 0; let v = 0; let s = 0;
  do { u = 2 * rand() - 1; v = 2 * rand() - 1; s = u * u + v * v; } while (!(s > 0) || s >= 1);
  return u * Math.sqrt((-2 * Math.log(s)) / s);
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('path experiment aborted', 'AbortError');
}

function validateBounds(min: number, max: number, path: string): void {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new Error(`${path} requires finite min <= max`);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function positiveInteger(value: number, path: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${path} must be a positive integer`);
  return value;
}

function photoParameters(values: Record<string, unknown>, steps: number): PhotoParams {
  const defaults = defaultPhotoParams();
  const result = { ...defaults, steps };
  const fields: Array<Exclude<keyof PhotoParams, 'steps'>> = [
    'k_exc', 'k_f', 'k_isc', 'k_T', 'k_q', 'k_d', 'k_I', 'O2', 'substrate', 'cTot', 'dt',
  ];
  for (const field of fields) {
    if (values[field] === undefined) continue;
    const value = values[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`parameters.${field} must be finite`);
    result[field] = value;
  }
  if (result.dt <= 0 || result.cTot <= 0 || result.k_d <= 0) throw new Error('dt, cTot and k_d must be positive');
  if (fields.some((field) => field !== 'dt' && field !== 'cTot' && result[field] < 0)) {
    throw new Error('rates and concentrations cannot be negative');
  }
  if (result.k_f + result.k_isc <= 0 || result.k_T + result.k_q * result.O2 + result.k_I * result.substrate <= 0) {
    throw new Error('singlet and triplet total decay rates must be positive');
  }
  return result;
}

function modelKey(id: string, version: string): string {
  return `${id}@${version}`;
}

function validateManifest(manifest: PathModelManifest): void {
  if (!manifest.id.trim() || !manifest.version.trim()) throw new Error('path model manifest id and version are required');
  if (manifest.backends.length === 0) throw new Error(`path model ${manifest.id}@${manifest.version} must declare a backend`);
  if (!manifest.parameters || !manifest.outputs) throw new Error(`path model ${manifest.id}@${manifest.version} must declare parameters and outputs`);
  if (manifest.analyses?.some((analysis) => analysis !== 'calibration' && analysis !== 'uncertainty')) throw new Error(`path model ${manifest.id}@${manifest.version} declares an unsupported analysis`);
}

function assertPositiveInteger(value: number, path: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${path} must be a positive integer`);
  return value;
}

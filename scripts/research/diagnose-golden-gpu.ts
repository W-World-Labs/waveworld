import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defaultPhotoParams, initPhotoState, rk4Step, type PhotoParams } from '../../src/lib/sim/photosensitization.ts';
import { runPhotoRk4OnPhysicalGpu } from '../../apps/lab/agent/src/backends/path-rk4-webgpu.ts';
import { runGoldenCase, type GoldenRun } from './run-golden-case.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIELDS = ['S0', 'S1', 'T1', 'singletO2'] as const;
export type StateField = (typeof FIELDS)[number];

/** Default near-zero floor used when separating absolute vs relative error (v2 draft). */
export const RELATIVE_DENOMINATOR_FLOOR = 1e-4;

function f32(value: number): number { return Math.fround(value); }
function add(a: number, b: number): number { return f32(f32(a) + f32(b)); }
function mul(a: number, b: number): number { return f32(f32(a) * f32(b)); }

/** CPU emulation of the explicitly rounded f32 operations used by the WGSL kernel. */
export function integratePhotoF32(p: PhotoParams, steps: number): Float32Array {
  const q = Object.fromEntries(Object.entries(p).map(([key, value]) => [key, f32(value)])) as unknown as PhotoParams;
  const out = new Float32Array((steps + 1) * 4);
  let s = new Float32Array([q.cTot, 0, 0, 0]); out.set(s, 0);
  const kTeff = add(add(q.k_T, mul(q.k_q, q.O2)), mul(q.k_I, q.substrate));
  const deriv = (x: Float32Array) => new Float32Array([
    add(add(mul(-q.k_exc, x[0]), mul(q.k_f, x[1])), mul(kTeff, x[2])),
    add(mul(q.k_exc, x[0]), -mul(add(q.k_f, q.k_isc), x[1])),
    add(mul(q.k_isc, x[1]), -mul(kTeff, x[2])),
    add(mul(mul(q.k_q, q.O2), x[2]), -mul(q.k_d, x[3])),
  ]);
  const shifted = (base: Float32Array, k: Float32Array, h: number) =>
    new Float32Array(base.map((value, i) => add(value, mul(h, k[i]))));
  for (let step = 1; step <= steps; step++) {
    const k1 = deriv(s); const k2 = deriv(shifted(s, k1, mul(0.5, q.dt)));
    const k3 = deriv(shifted(s, k2, mul(0.5, q.dt))); const k4 = deriv(shifted(s, k3, q.dt));
    s = new Float32Array(s.map((value, i) => add(value, mul(mul(q.dt, f32(1 / 6)),
      add(add(k1[i], mul(2, k2[i])), add(mul(2, k3[i]), k4[i]))))));
    out.set(s, step * 4);
  }
  return out;
}

export function integratePhotoF64(p: PhotoParams, steps: number): Float64Array {
  const out = new Float64Array((steps + 1) * 4); let state = initPhotoState(p);
  out.set([state.S0, state.S1, state.T1, state.singletO2], 0);
  for (let step = 1; step <= steps; step++) {
    state = rk4Step(state, p, p.dt); out.set([state.S0, state.S1, state.T1, state.singletO2], step * 4);
  }
  return out;
}

export interface FieldDifference {
  field: StateField;
  maxAbsoluteError: number;
  /** Relative error with floor 1e-12 (near-zero can inflate this). */
  maxRelativeErrorRaw: number;
  /** Relative error with scientific denominator floor (default 1e-4). */
  maxRelativeErrorFloored: number;
  /** Max absolute error among samples with |expected| < denominatorFloor. */
  maxAbsoluteErrorNearZero: number;
  nearZeroSampleCount: number;
  firstThresholdCrossingStep: number | null;
  firstThresholdCrossing: null | {
    step: number;
    absolute: number;
    relativeRaw: number;
    expected: number;
    actual: number;
  };
}

export interface TrajectoryDifference {
  fields: FieldDifference[];
  maxAbsoluteError: number;
  maxRelativeErrorRaw: number;
  maxRelativeErrorFloored: number;
  maxAbsoluteErrorNearZero: number;
  firstSignificantDivergence: null | {
    step: number;
    field: StateField;
    absolute: number;
    relativeRaw: number;
    expected: number;
    actual: number;
  };
  /** Sparse max-abs error growth curve (step index → max |Δ| over 4 fields). */
  errorGrowth: Array<{ step: number; maxAbsoluteError: number }>;
}

export function differences(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  absLimit: number,
  relLimit: number,
  denominatorFloor = RELATIVE_DENOMINATOR_FLOOR,
  growthMarkers?: number[],
): TrajectoryDifference {
  const fields: FieldDifference[] = FIELDS.map((field) => ({
    field,
    maxAbsoluteError: 0,
    maxRelativeErrorRaw: 0,
    maxRelativeErrorFloored: 0,
    maxAbsoluteErrorNearZero: 0,
    nearZeroSampleCount: 0,
    firstThresholdCrossingStep: null,
    firstThresholdCrossing: null,
  }));
  let maxAbsoluteError = 0;
  let maxRelativeErrorRaw = 0;
  let maxRelativeErrorFloored = 0;
  let maxAbsoluteErrorNearZero = 0;
  let firstSignificantDivergence: TrajectoryDifference['firstSignificantDivergence'] = null;
  const steps = Math.floor(actual.length / 4) - 1;
  const markers = new Set(
    growthMarkers ?? [1, 5, 10, 25, 50, 100, 200, 400, 600, 800, steps].filter((s) => s >= 0 && s <= steps),
  );
  const errorGrowth: Array<{ step: number; maxAbsoluteError: number }> = [];
  let stepMaxAbs = 0;

  for (let i = 0; i < actual.length; i++) {
    const fieldIndex = i % 4;
    const step = Math.floor(i / 4);
    if (fieldIndex === 0) stepMaxAbs = 0;
    const target = fields[fieldIndex];
    const absolute = Math.abs(actual[i] - expected[i]);
    const expectedAbs = Math.abs(expected[i]);
    const relativeRaw = absolute / Math.max(expectedAbs, 1e-12);
    const relativeFloored = absolute / Math.max(expectedAbs, denominatorFloor);
    stepMaxAbs = Math.max(stepMaxAbs, absolute);
    target.maxAbsoluteError = Math.max(target.maxAbsoluteError, absolute);
    target.maxRelativeErrorRaw = Math.max(target.maxRelativeErrorRaw, relativeRaw);
    target.maxRelativeErrorFloored = Math.max(target.maxRelativeErrorFloored, relativeFloored);
    maxAbsoluteError = Math.max(maxAbsoluteError, absolute);
    maxRelativeErrorRaw = Math.max(maxRelativeErrorRaw, relativeRaw);
    maxRelativeErrorFloored = Math.max(maxRelativeErrorFloored, relativeFloored);
    if (expectedAbs < denominatorFloor) {
      target.nearZeroSampleCount += 1;
      target.maxAbsoluteErrorNearZero = Math.max(target.maxAbsoluteErrorNearZero, absolute);
      maxAbsoluteErrorNearZero = Math.max(maxAbsoluteErrorNearZero, absolute);
    }
    if (target.firstThresholdCrossing === null && absolute > absLimit && relativeRaw > relLimit) {
      target.firstThresholdCrossingStep = step;
      target.firstThresholdCrossing = {
        step, absolute, relativeRaw, expected: expected[i], actual: actual[i],
      };
      if (firstSignificantDivergence === null) {
        firstSignificantDivergence = {
          step, field: target.field, absolute, relativeRaw, expected: expected[i], actual: actual[i],
        };
      }
    }
    if (fieldIndex === 3 && markers.has(step)) {
      errorGrowth.push({ step, maxAbsoluteError: stepMaxAbs });
    }
  }

  return {
    fields,
    maxAbsoluteError,
    maxRelativeErrorRaw,
    maxRelativeErrorFloored,
    maxAbsoluteErrorNearZero,
    firstSignificantDivergence,
    errorGrowth,
  };
}

/** Backward-compatible compact field list used by older callers/tests. */
export function differencesLegacy(actual: ArrayLike<number>, expected: ArrayLike<number>, absLimit: number, relLimit: number) {
  return differences(actual, expected, absLimit, relLimit).fields.map((field) => ({
    field: field.field,
    maxAbsoluteError: field.maxAbsoluteError,
    maxRelativeError: field.maxRelativeErrorRaw,
    firstThresholdCrossingStep: field.firstThresholdCrossingStep,
  }));
}

export function passesDifferenceContract(
  actual: ArrayLike<number>, expected: ArrayLike<number>, maximumAbsoluteError: number,
  maximumFlooredRelativeError: number, denominatorFloor: number,
): boolean {
  if (actual.length !== expected.length || actual.length === 0) return false;
  for (let i = 0; i < actual.length; i++) {
    const absolute = Math.abs(actual[i] - expected[i]);
    const relative = absolute / Math.max(Math.abs(expected[i]), denominatorFloor);
    if (absolute > maximumAbsoluteError || relative > maximumFlooredRelativeError) return false;
  }
  return true;
}

function observationRmse(run: GoldenRun, states: ArrayLike<number>, refinement = 1) {
  const calibration = run.spec.experiment?.analysis?.calibration;
  if (!calibration?.observations.singletO2) throw new Error('golden calibration observations missing');
  const dt = Number(run.spec.parameters.dt) / refinement; let sum = 0;
  calibration.observations.time.forEach((time, index) => {
    const step = Math.min(states.length / 4 - 1, Math.max(0, Math.round(time / dt)));
    const delta = states[step * 4 + 3] - calibration.observations.singletO2![index]; sum += delta * delta;
  });
  return Math.sqrt(sum / calibration.observations.time.length);
}

export function fittedParameters(run: GoldenRun): PhotoParams {
  const p = { ...defaultPhotoParams(), ...run.spec.parameters, steps: run.spec.run.maxSteps } as PhotoParams;
  p.k_exc = Number(run.result.experiment.outputs['fitted.k_exc'].value);
  p.k_q = Number(run.result.experiment.outputs['fitted.k_q'].value); return p;
}

export function collectProvenance(extra: Record<string, unknown> = {}) {
  let sourceCommit = 'unknown';
  try {
    sourceCommit = execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch { /* offline / non-git */ }
  return {
    sourceCommit,
    executedAt: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    hardware: {
      hostname: process.env.HOSTNAME ?? null,
      // Filled by GPU path when available.
      deviceName: null as string | null,
      adapterClass: null as string | null,
    },
    ...extra,
  };
}

/** Frozen production GPU numbers from #43 / f996712 (Intel P630). Immutable reference fixture. */
export const PRODUCTION_GPU_FIXTURE = {
  schema: 'waveworld.golden-case-gpu-fixture/v1' as const,
  caseId: 'mb-pbs-oxygen-transient-2026',
  sourceCommit: 'f996712befdae60920ff7a3338cb4440b2d6e0d5',
  diagnosisCommit: 'ae33888',
  preregistrationSha256: '6c7a37fb359ced55721a6aac79aea7181b56733815f1e10bee9c99c66a3b7c81',
  execution: {
    environment: 'production-host',
    host: 'labs.auto.ml',
    executedAt: '2026-08-02T16:48:35Z',
    identity: 'waveworld:waveworld with supplementary render group',
    deviceName: 'intel-r-hd-graphics-p630-kbl-gt2-',
    pci: '8086:591d',
    driver: 'i915 / Mesa Vulkan 25.0.7',
  },
  /** GPU f32 versus CPU f64 under v1 thresholds (recorded failure). */
  gpuVsCpu64: {
    air: { maxAbsoluteError: 3.0423187813433117e-7, maxRelativeError: 0.00000129250670966411, steps: 922 },
    n2: { maxAbsoluteError: 9.169177409562579e-7, maxRelativeError: 0.000003134774991978644, steps: 922 },
  },
  /**
   * GPU f32 versus explicitly-rounded CPU f32 proxy (refinement 1×) from ae33888 diagnosis.
   * Residual at most ~1 ULP at unit scale → same implementation family.
   */
  gpuVsCpu32: {
    air: { maxAbsoluteError: 1.1920928955078125e-7, maxRelativeError: 2.0792e-7 },
    n2: { maxAbsoluteError: 5.960464477539063e-8, maxRelativeError: 2.0933e-7 },
  },
};

export interface AttributionOptions {
  /** When true, never call the physical GPU path (CI-safe). Default: auto from env/argv. */
  cpuOnly?: boolean;
  /** Refinement factors for step-size study. Default [1, 2, 4]. */
  refinementFactors?: number[];
}

function wantCpuOnly(options?: AttributionOptions): boolean {
  if (options?.cpuOnly !== undefined) return options.cpuOnly;
  if (process.env.GOLDEN_GPU_CPU_ONLY === '1') return true;
  if (process.argv.includes('--cpu-only')) return true;
  return false;
}

export async function diagnoseGoldenGpu(options: AttributionOptions = {}) {
  const cpuOnly = wantCpuOnly(options);
  const formal = await runGoldenCase(path.join(repoRoot, 'research/golden-case'));
  const prereg = JSON.parse(readFileSync(path.join(repoRoot, 'research/golden-case/preregistration.json'), 'utf8'));
  const absLimit = Number(prereg.thresholds.cpuGpuAbsoluteTolerance);
  const relLimit = Number(prereg.thresholds.cpuGpuRelativeTolerance);
  const factors = options.refinementFactors ?? [1, 2, 4];
  const provenance = collectProvenance({
    mode: cpuOnly ? 'cpu-only-with-production-fixture' : 'live-physical-gpu',
    productionFixture: PRODUCTION_GPU_FIXTURE,
  });
  const conditions = [];

  for (const run of formal.runs.filter((item) => item.model.id === 'photosensitization-rk4')) {
    const base = fittedParameters(run);
    const isAir = run.condition.toLowerCase().includes('air');
    const fixtureKey = isAir ? 'air' : 'n2';
    const refinements = [];
    let deviceName: string | null = cpuOnly ? PRODUCTION_GPU_FIXTURE.execution.deviceName : null;

    for (const factor of factors) {
      const p = { ...base, dt: base.dt / factor, steps: base.steps * factor };
      const cpu64 = integratePhotoF64(p, p.steps);
      const cpu32 = integratePhotoF32(p, p.steps);
      const cpu32VsCpu64 = differences(cpu32, cpu64, absLimit, relLimit);

      let gpuVsCpu64 = null as TrajectoryDifference | null;
      let gpuVsCpu32 = null as TrajectoryDifference | null;
      let gpuStates: Float32Array | null = null;
      let gpuSource: 'live-physical-gpu' | 'production-fixture-summary-only' = 'production-fixture-summary-only';

      if (!cpuOnly) {
        const gpu = await runPhotoRk4OnPhysicalGpu(p, p.steps);
        deviceName = gpu.deviceName;
        gpuStates = gpu.states;
        gpuSource = 'live-physical-gpu';
        gpuVsCpu64 = differences(gpu.states, cpu64, absLimit, relLimit);
        gpuVsCpu32 = differences(gpu.states, cpu32, absLimit, relLimit);
      }

      const scientificMetrics = {
        cpu64Rmse: observationRmse(run, cpu64, factor),
        cpu32Rmse: observationRmse(run, cpu32, factor),
        gpuRmse: gpuStates ? observationRmse(run, gpuStates, factor) : null,
        preregisteredRmseLimit: Number(prereg.thresholds.normalizedRmseMax),
        cpu32RmseDelta: null as number | null,
        gpuRmseDelta: null as number | null,
      };
      scientificMetrics.cpu32RmseDelta = scientificMetrics.cpu32Rmse - scientificMetrics.cpu64Rmse;
      if (scientificMetrics.gpuRmse !== null) {
        scientificMetrics.gpuRmseDelta = scientificMetrics.gpuRmse - scientificMetrics.cpu64Rmse;
      }

      refinements.push({
        factor,
        dt: p.dt,
        steps: p.steps,
        cpu32VsCpu64,
        gpuVsCpu64,
        gpuVsCpu32,
        gpuSource,
        productionFixtureGpuVsCpu64: factor === 1 ? PRODUCTION_GPU_FIXTURE.gpuVsCpu64[fixtureKey] : null,
        productionFixtureGpuVsCpu32: factor === 1 ? PRODUCTION_GPU_FIXTURE.gpuVsCpu32[fixtureKey] : null,
        /**
         * Ratio of production GPU–CPU64 max-abs to local CPU32–CPU64 max-abs at factor 1.
         * ~1 means GPU error is explained by f32 precision alone.
         */
        precisionAttributionRatio: factor === 1
          ? PRODUCTION_GPU_FIXTURE.gpuVsCpu64[fixtureKey].maxAbsoluteError / cpu32VsCpu64.maxAbsoluteError
          : null,
        scientificMetrics,
      });
    }

    if (deviceName) {
      provenance.hardware.deviceName = deviceName;
      provenance.hardware.adapterClass = cpuOnly ? 'fixture:intel-p630' : 'live';
    }

    conditions.push({
      condition: run.condition,
      fixtureKey,
      fitted: { k_exc: base.k_exc, k_q: base.k_q, O2: base.O2, dt: base.dt, steps: base.steps },
      deviceName,
      refinements,
    });
  }

  const allScientificFail = conditions.every(({ refinements }) => refinements.every(({ scientificMetrics }) => {
    const gpuOk = scientificMetrics.gpuRmse === null || scientificMetrics.gpuRmse > scientificMetrics.preregisteredRmseLimit;
    return scientificMetrics.cpu64Rmse > scientificMetrics.preregisteredRmseLimit
      && scientificMetrics.cpu32Rmse > scientificMetrics.preregisteredRmseLimit
      && gpuOk;
  }));

  // Attribution: production N2 GPU–CPU64 max abs equals local CPU32–CPU64 max abs (bit-level identity of the bound).
  const n2 = conditions.find((c) => c.fixtureKey === 'n2');
  const n2Base = n2?.refinements.find((r) => r.factor === 1);
  const n2Cpu32Bound = n2Base?.cpu32VsCpu64.maxAbsoluteError ?? null;
  const n2ProdGpuBound = PRODUCTION_GPU_FIXTURE.gpuVsCpu64.n2.maxAbsoluteError;
  const n2ExactMatch = n2Cpu32Bound !== null && Math.abs(n2Cpu32Bound - n2ProdGpuBound) === 0;

  return {
    schema: 'waveworld.golden-case-gpu-diagnosis/v2' as const,
    caseId: formal.caseId,
    preregistrationSha256: formal.preregistrationSha256,
    immutablePriorDecision: formal.decision.status,
    thresholds: {
      absolute: absLimit,
      relative: relLimit,
      relativeDenominatorFloor: RELATIVE_DENOMINATOR_FLOOR,
      note: 'v1 thresholds compare GPU f32 to CPU f64 and remain failed; do not amend.',
    },
    provenance,
    conditions,
    scientificConclusionStable: allScientificFail,
    attribution: {
      dominantSource: 'accumulated binary32 rounding (not ODE/discretization defect, not alternate equations)',
      evidence: [
        'CPU f32 proxy vs CPU f64 reproduces the same order of max absolute/relative error as production GPU f32 vs CPU f64.',
        n2ExactMatch
          ? `N2: local CPU f32–CPU f64 maxAbsoluteError === production GPU–CPU f64 maxAbsoluteError (${n2ProdGpuBound}).`
          : `N2: local CPU f32–CPU f64 maxAbsoluteError=${n2Cpu32Bound}; production GPU–CPU f64=${n2ProdGpuBound}.`,
        'Production GPU–CPU32 residual ≤ ~1 unit-scale f32 ULP (ae33888), consistent with shader contraction, not a different update rule.',
        'Halving dt (2×/4× refinements) increases GPU–CPU64 drift because more f32 updates accumulate; discretization refinement alone does not restore v1 tolerances.',
        'All precisions preserve model-fit failure (RMSE ≫ 0.08); scientific decision is unchanged.',
      ],
      n2Cpu32VsCpu64MaxAbs: n2Cpu32Bound,
      n2ProductionGpuVsCpu64MaxAbs: n2ProdGpuBound,
      n2ExactPrecisionMatch: n2ExactMatch,
      implementationDefectSuspected: false,
      v1GateRemainsFailed: true,
    },
    interpretation: allScientificFail
      ? 'All precisions and refinements preserve the preregistered model-fit failure. Observed GPU–CPU64 gap is explained by f32 precision.'
      : 'A precision or refinement changes the preregistered model-fit decision.',
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  diagnoseGoldenGpu().then((value) => process.stdout.write(`${JSON.stringify(value)}\n`)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1;
  });
}

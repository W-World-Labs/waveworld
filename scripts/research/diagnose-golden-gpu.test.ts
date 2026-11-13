import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPhotoParams, initPhotoState, rk4Step } from '../../src/lib/sim/photosensitization.ts';
import {
  integratePhotoF32,
  integratePhotoF64,
  differences,
  passesDifferenceContract,
  diagnoseGoldenGpu,
  PRODUCTION_GPU_FIXTURE,
  RELATIVE_DENOMINATOR_FLOOR,
} from './diagnose-golden-gpu.ts';

test('CPU f32 proxy is deterministic, finite and tracks the CPU f64 RK4 trajectory', () => {
  const parameters = { ...defaultPhotoParams(), k_exc: 0.4, k_q: 8, steps: 922 };
  const first = integratePhotoF32(parameters, parameters.steps);
  const second = integratePhotoF32(parameters, parameters.steps);
  assert.deepEqual(first, second);
  assert.equal(first.length, (parameters.steps + 1) * 4);
  assert.ok(first.every(Number.isFinite));

  let state = initPhotoState(parameters); let maxAbsoluteError = 0;
  for (let step = 1; step <= parameters.steps; step++) {
    state = rk4Step(state, parameters, parameters.dt);
    const expected = [state.S0, state.S1, state.T1, state.singletO2];
    expected.forEach((value, field) => {
      maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(first[step * 4 + field] - value));
    });
  }
  assert.ok(maxAbsoluteError > 0, 'proxy must expose f32 rounding rather than silently using f64');
  assert.ok(maxAbsoluteError < 2e-6, `unexpected f32 drift: ${maxAbsoluteError}`);
});

test('draft backend contract rejects a regression above the observed physical-GPU drift', () => {
  const epsilon4 = 4 * 2 ** -23;
  const expected = new Float32Array([1, 0.1, 0.01, 0.001]);
  const withinContract = new Float32Array(expected); withinContract[0] += 2 ** -23;
  assert.equal(passesDifferenceContract(withinContract, expected, epsilon4, epsilon4 / 1e-4, 1e-4), true);

  const regression = new Float32Array(expected); regression[0] += 1e-6;
  assert.equal(passesDifferenceContract(regression, expected, epsilon4, epsilon4 / 1e-4, 1e-4), false);
});

test('trajectory differences separate near-zero absolute error from raw relative error', () => {
  // Reference has a near-zero component; actual drifts by 1e-9 on that component.
  const expected = new Float64Array([1, 0, 0.5, 1e-9]);
  const actual = new Float64Array([1, 0, 0.5, 2e-9]);
  const diff = differences(actual, expected, 1e-12, 1e-12, RELATIVE_DENOMINATOR_FLOOR);
  assert.equal(diff.fields[3].nearZeroSampleCount, 1);
  assert.ok(diff.maxAbsoluteErrorNearZero >= 1e-9 - Number.EPSILON);
  // Raw relative on 1e-9 can be O(1); floored relative must stay tiny.
  assert.ok(diff.fields[3].maxRelativeErrorRaw > 0.5);
  assert.ok(diff.fields[3].maxRelativeErrorFloored < 1e-4);
});

test('N2 CPU f32 vs CPU f64 max abs matches production GPU–CPU64 bound exactly', () => {
  // Golden fitted N2 trajectory: k_exc=2, k_q=8, O2=0.02, steps=922, dt=0.01
  const parameters = {
    ...defaultPhotoParams(),
    k_exc: 2, k_q: 8, O2: 0.02, k_f: 2, k_isc: 3, k_T: 0.2, k_d: 5, k_I: 0.3,
    substrate: 1, cTot: 1, dt: 0.01, steps: 922,
  };
  const cpu32 = integratePhotoF32(parameters, parameters.steps);
  const cpu64 = integratePhotoF64(parameters, parameters.steps);
  const diff = differences(cpu32, cpu64, 1e-9, 1e-7);
  assert.equal(
    diff.maxAbsoluteError,
    PRODUCTION_GPU_FIXTURE.gpuVsCpu64.n2.maxAbsoluteError,
    'CPU f32 reproduces the exact production GPU–CPU64 absolute bound → precision, not alternate kernel',
  );
  assert.equal(
    diff.maxRelativeErrorRaw,
    PRODUCTION_GPU_FIXTURE.gpuVsCpu64.n2.maxRelativeError,
  );
  assert.ok(diff.firstSignificantDivergence !== null);
  assert.equal(diff.firstSignificantDivergence!.step, 6);
  assert.equal(diff.firstSignificantDivergence!.field, 'T1');
  assert.ok(diff.errorGrowth.length >= 5);
  assert.ok(diff.maxAbsoluteErrorNearZero < 1e-11, 'near-zero states do not dominate absolute error');
});

test('Air CPU f32 vs CPU f64 is same order as production GPU–CPU64', () => {
  const parameters = {
    ...defaultPhotoParams(),
    k_exc: 2, k_q: 8, O2: 1, k_f: 2, k_isc: 3, k_T: 0.2, k_d: 5, k_I: 0.3,
    substrate: 1, cTot: 1, dt: 0.01, steps: 922,
  };
  const diff = differences(
    integratePhotoF32(parameters, parameters.steps),
    integratePhotoF64(parameters, parameters.steps),
    1e-9, 1e-7,
  );
  const prod = PRODUCTION_GPU_FIXTURE.gpuVsCpu64.air.maxAbsoluteError;
  const ratio = prod / diff.maxAbsoluteError;
  assert.ok(ratio > 0.5 && ratio < 2, `air precision attribution ratio out of band: ${ratio}`);
  assert.ok(diff.firstSignificantDivergence !== null);
  assert.ok(diff.firstSignificantDivergence!.step <= 20);
});

test('cpu-only diagnosis attributes GPU drift to f32 precision and keeps scientific fail', async () => {
  const report = await diagnoseGoldenGpu({ cpuOnly: true, refinementFactors: [1] });
  assert.equal(report.schema, 'waveworld.golden-case-gpu-diagnosis/v2');
  assert.equal(report.immutablePriorDecision, 'fail');
  assert.equal(report.scientificConclusionStable, true);
  assert.equal(report.attribution.implementationDefectSuspected, false);
  assert.equal(report.attribution.v1GateRemainsFailed, true);
  assert.equal(report.attribution.n2ExactPrecisionMatch, true);
  assert.ok(report.provenance.sourceCommit);
  assert.ok(report.provenance.runtime.node);
  assert.equal(report.conditions.length, 2);

  for (const condition of report.conditions) {
    const base = condition.refinements[0];
    assert.ok(base.cpu32VsCpu64.maxAbsoluteError > 0);
    assert.ok(base.cpu32VsCpu64.firstSignificantDivergence !== null);
    assert.ok(base.scientificMetrics.cpu64Rmse > 0.5);
    assert.ok(base.scientificMetrics.cpu32Rmse > 0.5);
    assert.ok(base.precisionAttributionRatio !== null);
    assert.ok(base.precisionAttributionRatio! > 0.5 && base.precisionAttributionRatio! < 2);
  }
});

test('cpu-only 1/2/4× refinement keeps scientific fail and grows f32–f64 abs drift', async () => {
  const report = await diagnoseGoldenGpu({ cpuOnly: true, refinementFactors: [1, 2, 4] });
  assert.equal(report.scientificConclusionStable, true);
  assert.equal(report.attribution.v1GateRemainsFailed, true);
  assert.equal(report.conditions.length, 2);

  for (const condition of report.conditions) {
    assert.deepEqual(
      condition.refinements.map((r) => r.factor),
      [1, 2, 4],
    );
    let prevAbs = 0;
    for (const refinement of condition.refinements) {
      assert.ok(refinement.scientificMetrics.cpu64Rmse > 0.5);
      assert.ok(refinement.scientificMetrics.cpu32Rmse > 0.5);
      assert.ok(Math.abs(refinement.scientificMetrics.cpu32RmseDelta ?? 0) < 1e-5);
      assert.ok(
        refinement.cpu32VsCpu64.maxAbsoluteError + 1e-18 >= prevAbs,
        `${condition.fixtureKey} factor ${refinement.factor} abs drift decreased`,
      );
      prevAbs = refinement.cpu32VsCpu64.maxAbsoluteError;
    }
  }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultJobSpec, LBM_MASS_BALANCE_FEATURE, type JobResultV1 } from '@w-sim/contracts';
import { validateJobResult, validateLbmResult } from '../src/lib/tasks/validate-result';
import { canonicalizeJobResultForFingerprint, fingerprintJobResult } from '../src/lib/tasks/job-fingerprint';

// A synthetic accounting record tests the acceptance contract, not a computed flow.
const spec = defaultJobSpec({ run: { maxSteps: 3, warmupSteps: 0 }, outputs: { forces: false, history: false } });
function result(): JobResultV1 {
  return { schemaVersion: 1, summary: { steps: 3, wallTimeMs: 0 }, backend: { id: 'cpu' },
    derived: { [LBM_MASS_BALANCE_FEATURE]: 1, cellCount: 175, precision: 'mixed' },
    lbmMassBalance: { scope: 'internal-fluid-x', initialMassKg: 2, finalMassKg: 2.75,
      inletMassKg: 0.5, outletMassKg: 0.25, collisionMassChangeKg: 0,
      balanceResidualKg: 0.5, maxAbsStepBalanceResidualKg: 0.25,
      boundaryFinalMassKg: 1, inletReconstructionMassKg: -0.125, outletReconstructionMassKg: 0.125 } };
}

test('mass report validates finite signed terms without declaring a nonzero residual acceptable physics', () => {
  const candidate = result();
  assert.doesNotThrow(() => validateJobResult(candidate));
  assert.doesNotThrow(() => validateLbmResult(spec, candidate));
  for (const key of Object.keys(candidate.lbmMassBalance!) as Array<keyof NonNullable<JobResultV1['lbmMassBalance']>>) {
    if (key === 'scope') continue;
    for (const value of [undefined, null, '0', NaN, Infinity, -Infinity]) {
      assert.throws(() => validateJobResult({ ...candidate, lbmMassBalance: { ...candidate.lbmMassBalance, [key]: value } }), /lbmMassBalance/);
    }
  }
  for (const value of [null, [], {}, { ...candidate.lbmMassBalance, scope: 'whole-domain' }]) {
    assert.throws(() => validateJobResult({ ...candidate, lbmMassBalance: value }), /lbmMassBalance.scope/);
  }
  for (const key of ['initialMassKg', 'finalMassKg', 'boundaryFinalMassKg', 'maxAbsStepBalanceResidualKg']) {
    assert.throws(() => validateJobResult({ ...candidate, lbmMassBalance: { ...candidate.lbmMassBalance, [key]: -1 } }), /nonnegative/);
  }
  for (const key of ['initialMassKg', 'finalMassKg']) {
    assert.throws(() => validateJobResult({ ...candidate, lbmMassBalance: { ...candidate.lbmMassBalance, [key]: 0 } }), /positive/);
  }
  assert.doesNotThrow(() => validateJobResult({ ...candidate, lbmMassBalance: { ...candidate.lbmMassBalance, boundaryFinalMassKg: 0 } }));
});

test('mass accounting rejects contradictory totals, impossible step maxima and a claimed feature without a report', () => {
  const candidate = result();
  for (const change of [{ balanceResidualKg: 0 }, { maxAbsStepBalanceResidualKg: 0.1 }]) {
    assert.throws(() => validateLbmResult(spec, { ...candidate, lbmMassBalance: { ...candidate.lbmMassBalance!, ...change } }), /mass|residual/i);
  }
  assert.throws(() => validateLbmResult(spec, { ...candidate, lbmMassBalance: undefined }), /mass-balance/);
  assert.throws(() => validateLbmResult({ ...spec, run: { maxSteps: 1000001 } }, candidate), /sampling limits/);
});

test('all mass report fields enter settlement identity; absent reports retain the old canonical shape', () => {
  const candidate = result(), fingerprint = fingerprintJobResult(candidate);
  for (const key of Object.keys(candidate.lbmMassBalance!) as Array<keyof NonNullable<JobResultV1['lbmMassBalance']>>) {
    const changed = { ...candidate, lbmMassBalance: { ...candidate.lbmMassBalance!,
      [key]: key === 'scope' ? 'changed' : candidate.lbmMassBalance![key] + 1 } } as JobResultV1;
    assert.notEqual(fingerprintJobResult(changed), fingerprint, key);
  }
  const old = { ...candidate, lbmMassBalance: undefined };
  assert.equal(Object.hasOwn(canonicalizeJobResultForFingerprint(old), 'lbmMassBalance'), false);
});

test('report consistency allows FP32 rounding at its own scale but still rejects a contradictory GPU total', () => {
  const candidate = result();
  const rounded = { ...candidate, lbmMassBalance: { ...candidate.lbmMassBalance!, balanceResidualKg: 0.500001 } };
  assert.throws(() => validateLbmResult(spec, rounded), /inconsistent/);
  const gpu = { ...rounded, backend: { id: 'webgpu-browser' } };
  assert.doesNotThrow(() => validateLbmResult(spec, gpu));
  assert.throws(() => validateLbmResult(spec, { ...gpu, lbmMassBalance: { ...gpu.lbmMassBalance, balanceResidualKg: 0.6 } }), /inconsistent/);
  const scaled = { ...gpu, lbmMassBalance: { ...gpu.lbmMassBalance } };
  for (const key of Object.keys(scaled.lbmMassBalance) as Array<keyof typeof scaled.lbmMassBalance>) {
    if (key !== 'scope') scaled.lbmMassBalance[key] *= 1e-18;
  }
  assert.doesNotThrow(() => validateLbmResult(spec, scaled), 'kilogram scale must not impose a fixed absolute tolerance');
});

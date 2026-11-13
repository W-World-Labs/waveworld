import assert from 'node:assert/strict';
import test from 'node:test';
import { runGoldenCase, resultSha256 } from './run-golden-case.ts';

test('formal golden run reproduces the preregistered negative conclusion', async () => {
  const first = await runGoldenCase();
  const second = await runGoldenCase();
  const third = await runGoldenCase();
  assert.equal(first.formalRun, true);
  assert.equal(first.runs.length, 4);
  assert.equal(first.decision.status, 'fail');
  assert.equal(first.decision.rk4FitsPass, false);
  assert.equal(first.decision.parameterDifferencePass, false);
  assert.ok(first.decision.normalizedRmseMax > first.decision.threshold.normalizedRmseMax);
  const reproducibleContent = (result: typeof first.runs[number]['result']) => ({
    ...result,
    summary: { ...result.summary, wallTimeMs: 0 },
    experiment: {
      ...result.experiment,
      provenance: { ...result.experiment.provenance, computedAt: 'normalized' },
    },
  });
  const fingerprints = [first, second, third].map((report) => report.runs.map(({ result }) => resultSha256(reproducibleContent(result))));
  assert.deepEqual(fingerprints[1], fingerprints[0]);
  assert.deepEqual(fingerprints[2], fingerprints[0]);
  assert.equal(first.decision.normalizedRmseMax, second.decision.normalizedRmseMax);
  assert.equal(first.decision.normalizedRmseMax, third.decision.normalizedRmseMax);
  for (const run of first.runs) {
    assert.match(run.result.experiment.provenance.modelImplementationSha256 ?? '', /^[a-f0-9]{64}$/);
    assert.match(run.result.experiment.provenance.dependencyLockSha256 ?? '', /^[a-f0-9]{64}$/);
  }
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateJobResult } from '../src/lib/tasks/validate-result.ts';

describe('generic JobResultV1 envelope', () => {
  const result = (steps: number) => ({
    schemaVersion: 1,
    summary: { steps, wallTimeMs: 1 },
    backend: { id: 'cpu' },
  });

  it('accepts integer step counts, including zero for non-iterative results', () => {
    assert.doesNotThrow(() => validateJobResult(result(0)));
    assert.doesNotThrow(() => validateJobResult(result(3)));
  });

  it('rejects fractional, negative, and unsafe step counts', () => {
    for (const steps of [1.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () => validateJobResult(result(steps)),
        /result\.summary\.steps must be a nonnegative safe integer/,
      );
    }
  });

  it('requires finite nonnegative wall time while allowing sub-millisecond values', () => {
    assert.doesNotThrow(() => validateJobResult({ ...result(1), summary: { steps: 1, wallTimeMs: 0 } }));
    assert.doesNotThrow(() => validateJobResult({ ...result(1), summary: { steps: 1, wallTimeMs: 0.25 } }));
    for (const wallTimeMs of [-0.25, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => validateJobResult({ ...result(1), summary: { steps: 1, wallTimeMs } }),
        wallTimeMs < 0 ? /result\.summary\.wallTimeMs must be >= 0/ : /result\.summary\.wallTimeMs must be a finite number/,
      );
    }
  });
});

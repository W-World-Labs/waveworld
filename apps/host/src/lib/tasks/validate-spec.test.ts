/**
 * Unit tests for validateJobSpec wiring to @w-sim/contracts acceptJobSpec.
 * Run: node --import tsx --test src/lib/tasks/validate-spec.test.ts
 * (from apps/lab)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultJobSpec } from '../../types/task.ts';
import { acceptJobSpec } from '@w-sim/contracts';
import { SpecValidationError, validateJobSpec, isJobKind } from './validate-spec.ts';

describe('validateJobSpec + acceptJobSpec wire', () => {
  it('accepts a default fluid JobSpec (envelope + lbm rules)', () => {
    // warmupSteps defaults to 200 in defaultJobSpec — a smaller maxSteps
    // override must also shrink warmup or the spec can never settle.
    const spec = defaultJobSpec({ run: { maxSteps: 10, warmupSteps: 0 } });
    assert.doesNotThrow(() => validateJobSpec(spec));
  });

  it('accepts multiphysics builtin kinds with minimal envelope', () => {
    for (const kind of ['thermal-3d-steady', 'structural-static', 'fdtd-batch'] as const) {
      const spec = defaultJobSpec({
        kind,
        run: { maxSteps: 5 },
        parameters: kind === 'fdtd-batch' ? { gridN: 32 } : {},
        model: undefined,
      });
      // clear lbm-only parameter requirements for non-lbm kinds
      delete (spec.parameters as { gridPreset?: string }).gridPreset;
      delete (spec.parameters as { inletVelocity?: number }).inletVelocity;
      assert.doesNotThrow(() => validateJobSpec(spec), `kind ${kind}`);
    }
  });

  it('rejects bad schemaVersion via acceptJobSpec message', () => {
    const bad = {
      ...defaultJobSpec(),
      schemaVersion: 99 as unknown as 1,
    };
    assert.throws(
      () => validateJobSpec(bad),
      (err: unknown) =>
        err instanceof SpecValidationError && /schemaVersion must be 1/.test(err.message),
    );
  });

  it('rejects unknown kinds under builtin-strict (extension kinds not allowed)', () => {
    const bad = defaultJobSpec({
      kind: 'not-a-real-kind-xyz' as never,
      run: { maxSteps: 1 },
    });
    assert.throws(
      () => validateJobSpec(bad),
      (err: unknown) =>
        err instanceof SpecValidationError && /unknown kind: not-a-real-kind-xyz/.test(err.message),
    );
  });

  it('rejects maxSteps < 1', () => {
    const bad = defaultJobSpec({ run: { maxSteps: 0 } });
    assert.throws(
      () => validateJobSpec(bad),
      (err: unknown) =>
        err instanceof SpecValidationError && /maxSteps/.test(err.message),
    );
  });

  it('rejects spec.name with control characters or extreme length (log-line injection)', () => {
    for (const name of ['ok\nforged-log-line', 'a\rb', 'esc[31mhue', 'x'.repeat(513), 42 as unknown as string]) {
      const bad = defaultJobSpec({ name });
      assert.throws(
        () => validateJobSpec(bad),
        (err: unknown) => err instanceof SpecValidationError && /spec\.name/.test(err.message),
        JSON.stringify(name),
      );
    }
    assert.doesNotThrow(() => validateJobSpec(defaultJobSpec({ name: 'x'.repeat(512) })));
  });

  it('rejects LBM specs that can never settle (sampling bounds at intake)', () => {
    // validateLbmResult enforces maxSteps/forceSampleEvery <= 1e6 and
    // warmupSteps <= maxSteps at complete — a spec violating them burns an
    // agent lease and the full compute before the inevitable rejection.
    for (const run of [
      { maxSteps: 1_000_001 },
      { maxSteps: 10, forceSampleEvery: 0 },
      { maxSteps: 10, warmupSteps: 11 },
      { maxSteps: 10, warmupSteps: -1 },
    ]) {
      const bad = defaultJobSpec({ run });
      assert.throws(
        () => validateJobSpec(bad),
        (err: unknown) => err instanceof SpecValidationError && /sampling bounds/.test(err.message),
        JSON.stringify(run),
      );
    }
    // Boundary + optional-field-free specs still pass.
    assert.doesNotThrow(() => validateJobSpec(defaultJobSpec({ run: { maxSteps: 1_000_000 } })));
    assert.doesNotThrow(() => validateJobSpec(defaultJobSpec({ run: { maxSteps: 10, warmupSteps: 10, forceSampleEvery: 1 } })));
  });

  it('uses shared bad_max_steps and preserves the LBM sampling diagnostic', () => {
    const bad = defaultJobSpec({ run: { maxSteps: 1.5 } });
    const admission = acceptJobSpec(bad);
    assert.equal(admission.ok, false);
    if (!admission.ok) assert.equal(admission.code, 'bad_max_steps');
    assert.throws(
      () => validateJobSpec(bad),
      (err: unknown) => err instanceof SpecValidationError && /LBM.*sampling bounds/.test(err.message),
    );

    const generic = defaultJobSpec({ kind: 'fdtd-batch', run: { maxSteps: 1.5 }, parameters: { gridN: 32 }, model: undefined });
    assert.throws(
      () => validateJobSpec(generic),
      (err: unknown) => err instanceof SpecValidationError && /positive safe integer/.test(err.message),
    );
  });

  it('still enforces lbm-d3q19 kind-specific rules after envelope accept', () => {
    const bare = {
      schemaVersion: 1 as const,
      kind: 'lbm-d3q19' as const,
      parameters: {},
      run: { maxSteps: 10 },
      outputs: { forces: true },
    };
    assert.throws(
      () => validateJobSpec(bare),
      (err: unknown) =>
        err instanceof SpecValidationError && /model\.source required for lbm-d3q19/.test(err.message),
    );
  });

  it('still enforces path-experiment product rules', () => {
    const bare = {
      schemaVersion: 1 as const,
      kind: 'path-experiment' as const,
      parameters: {},
      run: { maxSteps: 10 },
      outputs: { history: true },
      // experiment missing / invalid
    };
    assert.throws(
      () => validateJobSpec(bare),
      (err: unknown) =>
        err instanceof SpecValidationError && /experiment must be an object/.test(err.message),
    );
  });

  it('isJobKind mirrors builtin set', () => {
    assert.equal(isJobKind('lbm-d3q19'), true);
    assert.equal(isJobKind('structural-static'), true);
    assert.equal(isJobKind('custom-extension'), false);
  });
});

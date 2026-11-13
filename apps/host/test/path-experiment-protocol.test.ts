import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const testDb = path.resolve(here, '../../../data/tasks-test-path-experiment.db');

before(() => {
  process.env.TASK_DB_PATH = testDb;
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(testDb + suffix); } catch { /* absent */ }
  }
});

function pathSpec() {
  return {
    schemaVersion: 1 as const,
    kind: 'path-experiment' as const,
    name: 'Ir ultrasound → T1 → ROS',
    parameters: {},
    run: { maxSteps: 1000 },
    outputs: { forces: false, history: true, fields: [] },
    requirements: { backends: ['cpu' as const] },
    experiment: {
      experimentId: 'ir-us-ros-normoxia', title: 'Ir ultrasound ROS — normoxia',
      materials: [
        { id: 'ir-ps', name: 'Ir(III) sensitizer', role: 'sonosensitizer', source: { kind: 'literature' as const, citation: 'Selected Ir complex source' } },
        { id: 'o2', name: 'Oxygen', role: 'ROS substrate', formula: 'O2', source: { kind: 'measured' as const, note: 'Dissolved oxygen measurement' } },
      ],
      steps: [
        { id: 'excite', label: 'Ultrasound excitation', mechanism: 'cavitation/sonoluminescence coupling', inputs: ['ultrasound', 'ir-ps'], outputs: ['ir-s1'], hypothesis: { status: 'candidate' as const, description: 'Candidate coupling route', sources: [{ kind: 'literature' as const, citation: 'Mechanism source' }] } },
        { id: 'isc', label: 'ISC to triplet', mechanism: 'spin-orbit coupling', inputs: ['ir-s1'], outputs: ['ir-t1'], hypothesis: { status: 'accepted' as const, description: 'Triplet population', sources: [{ kind: 'literature' as const, citation: 'Photophysics source' }] } },
        { id: 'ros', label: 'ROS production', mechanism: 'Type I/II transfer', inputs: ['ir-t1', 'o2'], outputs: ['ros'], hypothesis: { status: 'candidate' as const, description: 'Oxygen-dependent branching', sources: [{ kind: 'assumption' as const, note: 'Compared hypothesis' }] } },
      ],
      parameters: {
        ultrasoundFrequency: { value: 1, unit: 'MHz', source: { kind: 'measured' as const } },
        dissolvedOxygen: { value: 200, unit: 'µM', source: { kind: 'measured' as const } },
      },
      model: { id: 'ir-sonodynamic-kinetics', version: '1.0.0', implementation: 'ode' },
      provenance: { createdAt: '2026-08-02T00:00:00.000Z', createdBy: 'test', software: { name: 'WaveWorld', version: '2.0.0' }, notes: 'initial' },
    },
  };
}

describe('path-experiment on unified JobSpecV1/JobResultV1 plane', { concurrency: false }, () => {
  it('rejects missing or mismatched experiment results before settlement', async () => {
    const { createJob, claimJob, getJob, completeJob } = await import('@/lib/tasks/service.ts');
    const spec = pathSpec();
    const result = {
      schemaVersion: 1 as const,
      summary: { steps: 1000, wallTimeMs: 12 },
      backend: { id: 'cpu' },
      experiment: {
        experimentId: spec.experiment.experimentId,
        modelVersion: spec.experiment.model.version,
        outputs: { rosYield: { value: 0.64 } },
        provenance: { computedAt: '2026-08-02T01:00:00.000Z', engineVersion: '1.0.0' },
      },
    };
    const invalidResults = [
      { ...result, experiment: undefined },
      { ...result, experiment: { ...result.experiment, experimentId: 'unrelated-experiment' } },
      { ...result, experiment: { ...result.experiment, modelVersion: '2.0.0' } },
    ];
    for (const invalid of invalidResults) {
      const job = createJob({ spec });
      assert.ok(claimJob({ jobId: job.id, agentId: 'binding-agent', capabilities: {
        backends: ['cpu'], kinds: ['path-experiment'],
        pathModels: [{ id: spec.experiment.model.id, version: spec.experiment.model.version, backends: ['cpu'] }],
      } }));
      assert.throws(
        () => completeJob({ jobId: job.id, agentId: 'binding-agent', result: invalid }),
        (error: unknown) => error instanceof Error &&
          (error as Error & { status: number }).status === 400 && /result\.experiment/.test(error.message),
        'a valid generic envelope is not enough to settle the submitted path',
      );
      assert.equal(getJob(job.id)?.status, 'leased');
      assert.equal(getJob(job.id)?.result, null);
      const completed = completeJob({ jobId: job.id, agentId: 'binding-agent', result });
      assert.equal(completed?.status, 'succeeded');
      assert.equal(completeJob({ jobId: job.id, agentId: 'binding-agent', result })?.id, job.id,
        'a matching result keeps idempotent settlement');
    }
  });

  it('validates, fingerprints, persists, completes and reloads through existing Host flow', async () => {
    const { validateJobSpec } = await import('@/lib/tasks/validate-spec.ts');
    const { fingerprintJobSpec } = await import('@/lib/tasks/job-fingerprint.ts');
    const { createJob, claimJob, completeJob, loadSucceededJobResult } = await import('@/lib/tasks/service.ts');
    const spec = pathSpec();
    assert.doesNotThrow(() => validateJobSpec(spec));
    const fingerprint = fingerprintJobSpec(spec);
    const resubmitted = pathSpec();
    resubmitted.experiment.provenance.createdAt = '2026-08-03T00:00:00.000Z';
    resubmitted.experiment.provenance.createdBy = 'another-user';
    resubmitted.experiment.provenance.notes = 'same compute, different audit note';
    assert.equal(fingerprintJobSpec(resubmitted), fingerprint, 'audit metadata must not defeat compute reuse');
    const changed = pathSpec();
    changed.experiment.parameters.dissolvedOxygen.value = 20;
    assert.notEqual(fingerprintJobSpec(changed), fingerprint, 'path parameters must invalidate compute cache');

    const created = createJob({ spec });
    assert.equal(created.spec.experiment?.steps[2].id, 'ros');
    const claimed = claimJob({ agentId: 'path-agent', capabilities: {
      backends: ['cpu'], kinds: ['path-experiment'],
      pathModels: [{ id: 'ir-sonodynamic-kinetics', version: '1.0.0', backends: ['cpu'] }],
    } });
    assert.equal(claimed?.id, created.id);
    completeJob({ jobId: created.id, agentId: 'path-agent', result: {
      schemaVersion: 1,
      summary: { steps: 1000, wallTimeMs: 12 },
      backend: { id: 'cpu', agentId: 'path-agent' },
      experiment: {
        experimentId: spec.experiment.experimentId,
        modelVersion: spec.experiment.model.version,
        outputs: { tripletPopulation: { value: [0, 0.4, 0.7], unit: 'relative' }, rosYield: { value: 0.64, unit: 'relative' } },
        provenance: { computedAt: '2026-08-02T01:00:00.000Z', engineVersion: '1.0.0' },
      },
    } });
    const loaded = loadSucceededJobResult(created.id);
    assert.deepEqual(loaded?.result.experiment?.outputs.tripletPopulation.value, [0, 0.4, 0.7]);
    assert.equal(loaded?.specFingerprint, fingerprint);
  });

  it('filters path jobs by advertised model id, version and backend before claim', async () => {
    const { createJob, claimJob, cancelJob } = await import('@/lib/tasks/service.ts');
    const queued = createJob({ spec: pathSpec() });
    const base = { backends: ['cpu' as const], kinds: ['path-experiment' as const] };
    assert.equal(claimJob({ agentId: 'no-models', capabilities: base, jobId: queued.id }), null);
    assert.equal(claimJob({ agentId: 'wrong-version', capabilities: {
      ...base, pathModels: [{ id: 'ir-sonodynamic-kinetics', version: '2.0.0', backends: ['cpu'] }],
    }, jobId: queued.id }), null);
    assert.equal(claimJob({ agentId: 'wrong-backend', capabilities: {
      ...base, pathModels: [{ id: 'ir-sonodynamic-kinetics', version: '1.0.0', backends: ['webgpu-dawn'] }],
    }, jobId: queued.id }), null);
    const claimed = claimJob({ agentId: 'matching', capabilities: {
      ...base, pathModels: [{ id: 'ir-sonodynamic-kinetics', version: '1.0.0', backends: ['cpu'] }],
    }, jobId: queued.id });
    assert.equal(claimed?.id, queued.id);
    cancelJob(queued.id);

    const unpinnedSpec = pathSpec();
    const pinnedSpec = { ...unpinnedSpec, experiment: { ...unpinnedSpec.experiment,
      model: { ...unpinnedSpec.experiment.model, checksum: 'a'.repeat(64) },
    } };
    const pinned = createJob({ spec: pinnedSpec });
    assert.equal(claimJob({ agentId: 'wrong-implementation', capabilities: {
      ...base, pathModels: [{ id: 'ir-sonodynamic-kinetics', version: '1.0.0', backends: ['cpu'], implementationSha256: 'b'.repeat(64) }],
    }, jobId: pinned.id }), null);
    assert.equal(claimJob({ agentId: 'exact-implementation', capabilities: {
      ...base, pathModels: [{ id: 'ir-sonodynamic-kinetics', version: '1.0.0', backends: ['cpu'], implementationSha256: 'a'.repeat(64) }],
    }, jobId: pinned.id })?.id, pinned.id);
    cancelJob(pinned.id);
  });

  it('rejects incomplete path specs and non-finite path results', async () => {
    const { validateJobSpec } = await import('@/lib/tasks/validate-spec.ts');
    const { validateJobResult } = await import('@/lib/tasks/validate-result.ts');
    const invalid = pathSpec();
    invalid.experiment.steps = [];
    assert.throws(() => validateJobSpec(invalid), /steps must be a non-empty array/);
    assert.throws(() => validateJobResult({
      schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu', agentId: 'a' },
      experiment: { experimentId: 'x', modelVersion: '1', outputs: { ros: { value: Number.NaN } }, provenance: { computedAt: '2026-08-02T00:00:00Z', engineVersion: '1' } },
    }), /finite scalar/);
  });

  it('validates calibration observations and seeded uncertainty in the shared protocol', async () => {
    const { validateJobSpec } = await import('@/lib/tasks/validate-spec.ts');
    const calibrated: import('@/types/task').JobSpecV1 = pathSpec();
    calibrated.experiment!.analysis = {
      calibration: {
        observations: { time: [0, 0.1, 0.2], T1: [0, 0.2, 0.3] },
        fitParameters: { k_exc: { min: 0.1, max: 1, gridPoints: 7 } },
        rounds: 2,
      },
      uncertainty: {
        seed: 42,
        samples: 50,
        parameters: { k_exc: { kind: 'normal', sigma: 0.05, min: 0 } },
      },
    };
    assert.doesNotThrow(() => validateJobSpec(calibrated));
    calibrated.experiment!.analysis!.calibration!.observations.T1 = [0, 0.2];
    assert.throws(() => validateJobSpec(calibrated), /T1 length mismatch/);
  });
});

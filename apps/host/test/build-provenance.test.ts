import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const testDb = path.resolve(here, '../../../data/tasks-test-build-provenance.db');
const artifacts = path.resolve(here, '../../../data/artifacts-test-build-provenance');
const digest = (char: string) => char.repeat(64);

before(() => {
  process.env.TASK_DB_PATH = testDb;
  process.env.ARTIFACT_ROOT = artifacts;
  Object.assign(process.env, { NODE_ENV: 'production' });
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(testDb + suffix); } catch { /* absent */ } }
  fs.rmSync(artifacts, { recursive: true, force: true });
});

function pathSpec() {
  return {
    schemaVersion: 1 as const, kind: 'path-experiment' as const, name: 'provenance gate',
    parameters: {}, run: { maxSteps: 1 }, outputs: { forces: false, history: false },
    experiment: {
      experimentId: 'provenance-test', title: 'provenance test', materials: [],
      steps: [{ id: 's', label: 'step', mechanism: 'test', inputs: [], outputs: ['y'], hypothesis: { status: 'candidate' as const, description: 'test', sources: [{ kind: 'assumption' as const }] } }],
      parameters: {}, model: { id: 'model-a', version: '1.0.0' },
      provenance: { createdAt: '2026-08-02T00:00:00.000Z', software: { name: 'WaveWorld', version: 'test' } },
    },
  };
}

function result(provenance?: { agentBuildId: string; modelImplementationSha256: string; dependencyLockSha256: string }) {
  return {
    schemaVersion: 1 as const, summary: { steps: 1, wallTimeMs: 1 },
    backend: { id: 'cpu', agentId: 'ignored', ...(provenance ? { provenance } : {}) },
    experiment: {
      experimentId: 'provenance-test', modelVersion: '1.0.0', outputs: { y: { value: 1 } },
      provenance: { computedAt: '2026-08-02T00:00:01.000Z', engineVersion: 'model-a@1.0.0', ...(provenance ?? {}) },
    },
  };
}

describe('production executable build provenance', { concurrency: false }, () => {
  it('marks audit failed when a production path result lacks digests', async () => {
    const { registerAgent } = await import('@/lib/tasks/auth-agent.ts');
    const { createJob, claimJob, completeJob } = await import('@/lib/tasks/service.ts');
    const { getAuditManifestStatus } = await import('@/lib/tasks/audit-manifest.ts');
    const caps = { backends: ['cpu' as const], kinds: ['path-experiment' as const], pathModels: [{ id: 'model-a', version: '1.0.0', backends: ['cpu' as const] }] };
    const { agent } = await registerAgent({ name: 'legacy-agent', capabilities: caps });
    const job = createJob({ spec: pathSpec() });
    assert.equal(claimJob({ agentId: agent.id, capabilities: caps, jobId: job.id })?.id, job.id);
    completeJob({ jobId: job.id, agentId: agent.id, result: result() });
    assert.equal(getAuditManifestStatus(job.id)?.status, 'failed');
    assert.match(getAuditManifestStatus(job.id)?.error ?? '', /lacks executable build provenance/);
  });

  it('records and cross-checks all three digests in a ready audit', async () => {
    const { registerAgent } = await import('@/lib/tasks/auth-agent.ts');
    const { createJob, claimJob, completeJob } = await import('@/lib/tasks/service.ts');
    const { getAuditManifestStatus, verifyAuditManifestArtifact } = await import('@/lib/tasks/audit-manifest.ts');
    const provenance = { agentBuildId: 'release-abc123', modelImplementationSha256: digest('a'), dependencyLockSha256: digest('b') };
    const caps = {
      backends: ['cpu' as const], kinds: ['path-experiment' as const], agentBuildId: provenance.agentBuildId,
      dependencyLockSha256: provenance.dependencyLockSha256,
      pathModels: [{ id: 'model-a', version: '1.0.0', backends: ['cpu' as const], implementationSha256: provenance.modelImplementationSha256 }],
    };
    const { agent } = await registerAgent({ name: 'verified-agent', capabilities: caps });
    const job = createJob({ spec: pathSpec() });
    assert.equal(claimJob({ agentId: agent.id, capabilities: caps, jobId: job.id })?.id, job.id);
    completeJob({ jobId: job.id, agentId: agent.id, result: result(provenance) });
    const audit = getAuditManifestStatus(job.id);
    assert.equal(audit?.status, 'ready');
    const envelope = verifyAuditManifestArtifact(audit!.artifactId!);
    assert.equal(envelope.manifest.compute.agentBuildId, provenance.agentBuildId);
    assert.equal(envelope.manifest.compute.modelImplementationSha256, provenance.modelImplementationSha256);
    assert.equal(envelope.manifest.compute.dependencyLockSha256, provenance.dependencyLockSha256);
  });
});

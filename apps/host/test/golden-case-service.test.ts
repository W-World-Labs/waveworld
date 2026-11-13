import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const database = path.join(root, 'data/tasks-test-golden-service.db');
const artifacts = path.join(root, 'data/artifacts-test-golden-service');

before(() => {
  process.env.TASK_DB_PATH = database; process.env.ARTIFACT_ROOT = artifacts;
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(database + suffix); } catch { /* absent */ } }
  fs.rmSync(artifacts, { recursive: true, force: true });
});

describe('production golden case service', { concurrency: false }, () => {
  it('serializes concurrent first-run requests without duplicate resources', async () => {
    const user = { id: 'golden-concurrent-owner', name: 'Concurrent Owner', workspaceId: 'golden-workspace', createdAt: new Date().toISOString() };
    const { advanceGoldenCase } = await import('../src/lib/golden-case-service.ts');
    const responses = await Promise.all(Array.from({ length: 8 }, () => advanceGoldenCase(user)));
    assert.equal(new Set(responses.map((item) => item.project?.id)).size, 1);
    assert.ok(responses.every((item) => item.stage === 'running' && item.jobs.length === 4));
    const projectId = responses[0].project!.id;
    assert.equal(new Set(responses.flatMap((item) => item.jobs.map((job) => job.id))).size, 4);
    const { listProjectsForUser } = await import('../src/lib/project-service.ts');
    const projects = await listProjectsForUser({ userId: user.id, workspaceId: user.workspaceId, limit: 200 });
    assert.equal(projects.filter((project) => project.settings?.ui?.goldenCaseId === 'mb-pbs-oxygen-transient-2026').length, 1);
    const { listEvidence } = await import('../../../apps/host/src/lib/tasks/evidence.ts');
    assert.equal(listEvidence({ ownerUserId: user.id, projectIds: [projectId] }).length, 2);
  });

  it('idempotently creates, executes, compares and publishes the real case', async () => {
    const user = { id: 'golden-owner', name: 'Golden Owner', workspaceId: 'golden-workspace', createdAt: new Date().toISOString() };
    const { advanceGoldenCase } = await import('../src/lib/golden-case-service.ts');
    const first = await advanceGoldenCase(user); const second = await advanceGoldenCase(user);
    assert.equal(first.stage, 'running'); assert.equal(second.stage, 'running');
    assert.equal(first.project?.id, second.project?.id); assert.equal(second.jobs.length, 4);
    assert.equal(new Set(second.jobs.map((job) => job.id)).size, 4);
    const { listEvidence } = await import('../../../apps/host/src/lib/tasks/evidence.ts');
    assert.equal(listEvidence({ ownerUserId: user.id, projectIds: [second.project!.id] }).length, 2);
    const { listArtifacts } = await import('../../../apps/host/src/lib/tasks/artifacts.ts');
    const contractArtifacts = second.jobs.flatMap((job) => listArtifacts(job.id)).filter((artifact) => artifact.kind.startsWith('golden-case-'));
    assert.deepEqual(contractArtifacts.map((artifact) => artifact.kind).sort(), ['golden-case-decision', 'golden-case-preregistration']);

    const reference = JSON.parse(execFileSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'scripts/research/run-golden-case.ts')],
      { cwd: root, encoding: 'utf8' })) as { runs: Array<{ model: { id: string; version: string };
        spec: import('../../../apps/host/src/types/task.ts').JobSpecV1; result: import('../../../apps/host/src/types/task.ts').JobResultV1 }> };
    const { claimJob, completeJob, getJob } = await import('../../../apps/host/src/lib/tasks/service.ts');
    for (const item of second.jobs) {
      const job = getJob(item.id)!;
      const run = reference.runs.find((candidate) => candidate.spec.experiment?.experimentId === job.spec.experiment?.experimentId)!;
      assert.ok(claimJob({ jobId: job.id, agentId: 'golden-production-agent', capabilities: { backends: ['cpu'], kinds: ['path-experiment'],
        pathModels: [{ id: run.model.id, version: run.model.version, backends: ['cpu'] }] } }));
      assert.equal(completeJob({ jobId: job.id, agentId: 'golden-production-agent', result: run.result })?.status, 'succeeded');
    }
    const published = await advanceGoldenCase(user); const repeated = await advanceGoldenCase(user);
    assert.equal(published.stage, 'published'); assert.equal(repeated.stage, 'published');
    assert.equal(published.comparison?.id, repeated.comparison?.id);
    assert.equal(published.publication?.publicId, repeated.publication?.publicId);
    const { getPublication, readPublicationBundle } = await import('../../../apps/host/src/lib/tasks/publications.ts');
    const publication = getPublication(published.publication!.publicId)!;
    const bundle = readPublicationBundle(publication);
    const { verifyGoldenPublication } = await import('../../../scripts/research/verify-golden-publication.mjs');
    const verified = verifyGoldenPublication(bundle.data);
    assert.equal(verified.ok, true); assert.equal(verified.recalculated.status, 'fail');
  });
});

/**
 * #60: registered agents are not job superusers.
 * Drives shipped requestMayAccessJob / agentMayAccessJob / artifact GET.
 */
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const testDb = path.resolve(here, '../../../data/tasks-test-agent-job-acl.db');
const testRoot = path.resolve(here, '../../../data/artifacts-test-agent-job-acl');

before(() => {
  process.env.TASK_DB_PATH = testDb;
  process.env.ARTIFACT_ROOT = testRoot;
  fs.rmSync(testRoot, { recursive: true, force: true });
  fs.mkdirSync(testRoot, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(testDb + suffix);
    } catch {
      /* absent */
    }
  }
});

function spec(workspaceId = 'default') {
  return {
    schemaVersion: 1 as const,
    kind: 'export-report' as const,
    name: 'acl-job',
    parameters: { reportType: 'audit' },
    run: { maxSteps: 1 },
    outputs: { forces: false, history: false },
    workspaceId,
  };
}

describe('agent job ACL (#60)', { concurrency: false }, () => {
  it('foreign agent cannot read/cancel; leasing agent can', async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    const priorWs = process.env.AGENT_WORKSPACE;
    Object.assign(process.env, { NODE_ENV: 'production' });
    delete process.env.AGENT_WORKSPACE;
    try {
      const { createJob, claimJob, getJob } = await import('@/lib/tasks/service.ts');
      const { registerAgent } = await import('@/lib/tasks/auth-agent.ts');
      const { saveArtifact } = await import('@/lib/tasks/artifacts.ts');
      const {
        agentMayAccessJob,
        agentMayAccessArtifact,
        requestMayAccessJob,
      } = await import('../src/lib/job-sharing.ts');

      const caps = { backends: ['cpu' as const], kinds: ['export-report' as const] };
      const holder = await registerAgent({ name: 'acl-holder', capabilities: caps });
      const stranger = await registerAgent({ name: 'acl-stranger', capabilities: caps });
      const job = createJob({ spec: spec(), createdBy: 'user-alice' });
      assert.equal(job.agentId, null);

      const holderReq = new Request(`http://localhost/api/v1/jobs/${job.id}`, {
        headers: { Authorization: `Bearer ${holder.token}` },
      });
      const strangerReq = new Request(`http://localhost/api/v1/jobs/${job.id}`, {
        headers: { Authorization: `Bearer ${stranger.token}` },
      });

      assert.equal(await requestMayAccessJob(holderReq, job, 'read'), false);
      assert.equal(await requestMayAccessJob(strangerReq, job, 'edit'), false);

      const leased = claimJob({
        agentId: holder.agent.id,
        capabilities: caps,
        jobId: job.id,
      });
      assert.ok(leased);
      assert.equal(leased!.agentId, holder.agent.id);
      const held = getJob(job.id)!;

      assert.equal(agentMayAccessJob(holder.agent, held, 'read'), true);
      assert.equal(agentMayAccessJob(holder.agent, held, 'edit'), true);
      assert.equal(agentMayAccessJob(stranger.agent, held, 'read'), false);
      assert.equal(agentMayAccessJob(stranger.agent, held, 'edit'), false);
      assert.equal(await requestMayAccessJob(holderReq, held, 'read'), true);
      assert.equal(await requestMayAccessJob(holderReq, held, 'edit'), true);
      assert.equal(await requestMayAccessJob(strangerReq, held, 'read'), false);
      assert.equal(await requestMayAccessJob(strangerReq, held, 'edit'), false);

      const cancel = await import('../src/app/api/v1/jobs/[id]/cancel/route.ts');
      const deniedCancel = await cancel.POST(strangerReq, {
        params: Promise.resolve({ id: held.id }),
      });
      assert.equal(deniedCancel.status, 404);

      const artifact = saveArtifact({
        jobId: held.id,
        ownerUserId: 'user-alice',
        kind: 'log',
        contentType: 'text/plain',
        data: Buffer.from('acl-bytes'),
      });
      assert.equal(agentMayAccessArtifact(holder.agent, artifact, held), true);
      assert.equal(agentMayAccessArtifact(stranger.agent, artifact, held), false);

      const artifactRoute = await import('../src/app/api/v1/artifacts/[id]/route.ts');
      const deniedDl = await artifactRoute.GET(
        new Request(`http://localhost/api/v1/artifacts/${artifact.id}`, {
          headers: { Authorization: `Bearer ${stranger.token}` },
        }),
        { params: Promise.resolve({ id: artifact.id }) },
      );
      assert.equal(deniedDl.status, 403);

      const okDl = await artifactRoute.GET(
        new Request(`http://localhost/api/v1/artifacts/${artifact.id}`, {
          headers: { Authorization: `Bearer ${holder.token}` },
        }),
        { params: Promise.resolve({ id: artifact.id }) },
      );
      assert.equal(okDl.status, 200);

      // List surface: agents must scope to a job they hold — no fleet-wide dump.
      const listRoute = await import('../src/app/api/v1/artifacts/route.ts');
      const noJobId = await listRoute.GET(
        new Request('http://localhost/api/v1/artifacts', {
          headers: { Authorization: `Bearer ${holder.token}` },
        }),
      );
      assert.equal(noJobId.status, 400);
      const strangerList = await listRoute.GET(
        new Request(`http://localhost/api/v1/artifacts?jobId=${held.id}`, {
          headers: { Authorization: `Bearer ${stranger.token}` },
        }),
      );
      assert.equal(strangerList.status, 403);
      const holderList = await listRoute.GET(
        new Request(`http://localhost/api/v1/artifacts?jobId=${held.id}`, {
          headers: { Authorization: `Bearer ${holder.token}` },
        }),
      );
      assert.equal(holderList.status, 200);
      const body = (await holderList.json()) as { artifacts: Array<{ jobId: string | null }> };
      assert.ok(body.artifacts.length > 0);
      assert.ok(body.artifacts.every((a) => a.jobId === held.id));
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
      if (priorWs === undefined) delete process.env.AGENT_WORKSPACE;
      else process.env.AGENT_WORKSPACE = priorWs;
    }
  });

  it('claimJob stays workspace-scoped when AGENT_WORKSPACE is set', async () => {
    const priorWs = process.env.AGENT_WORKSPACE;
    process.env.AGENT_WORKSPACE = 'ws-allowed';
    try {
      const { createJob, claimJob } = await import('@/lib/tasks/service.ts');
      const { registerAgent } = await import('@/lib/tasks/auth-agent.ts');
      const caps = { backends: ['cpu' as const], kinds: ['export-report' as const] };
      const { agent } = await registerAgent({ name: 'acl-ws-agent', capabilities: caps });
      const foreign = createJob({ spec: spec('ws-other'), createdBy: 'u' });
      const local = createJob({ spec: spec('ws-allowed'), createdBy: 'u' });
      assert.equal(
        claimJob({ agentId: agent.id, capabilities: caps, jobId: foreign.id }),
        null,
      );
      const got = claimJob({ agentId: agent.id, capabilities: caps, jobId: local.id });
      assert.ok(got);
      assert.equal(got!.id, local.id);
    } finally {
      if (priorWs === undefined) delete process.env.AGENT_WORKSPACE;
      else process.env.AGENT_WORKSPACE = priorWs;
    }
  });

  it('capabilities shape is bounded: oversized arrays/strings rejected at register and update', async () => {
    const { registerAgent, updateAgentCapabilities } = await import('@/lib/tasks/auth-agent.ts');
    // Deliberately-invalid payloads → cast to `never` (assignable to every field type).
    const overEntries = Array.from({ length: 129 }, (_, i) => `b${i}`);
    await assert.rejects(() => registerAgent({ name: 'cap-flood', capabilities: { backends: overEntries } as never }), /non-empty string array/);
    await assert.rejects(() => registerAgent({ name: 'cap-long', capabilities: { backends: ['x'.repeat(200)] } as never }), /non-empty string array/);
    await assert.rejects(() => registerAgent({ name: 'cap-kinds', capabilities: { backends: ['cpu'], kinds: overEntries } as never }), /kinds/);
    const { agent } = await registerAgent({ name: 'cap-ok', capabilities: { backends: ['cpu'] } });
    assert.throws(() => updateAgentCapabilities(agent.id, { backends: ['cpu'], pathModels: overEntries.map(id => ({ id, version: '1', backends: ['cpu' as const] })) }), /path model capability/);
    assert.throws(() => updateAgentCapabilities(agent.id, { backends: ['cpu'], pathModels: [{ id: 'm', version: '1', backends: [] }] }), /path model capability/);
    // registerAgent path enforces the same per-entry pathModels validation
    await assert.rejects(() => registerAgent({ name: 'cap-pm', capabilities: { backends: ['cpu'], pathModels: [{ id: '', version: '1', backends: ['cpu'] }] } }), /path model capability/);
    assert.ok(updateAgentCapabilities(agent.id, { backends: ['cpu'], kinds: ['lbm-d3q19'] }));
  });
});

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directory = mkdtempSync(path.join(tmpdir(), 'waveworld-job-protocol-'));
const previousNodeEnv = process.env.NODE_ENV;
const previousJobRequireAuth = process.env.JOB_REQUIRE_AUTH;
const previousTaskDbPath = process.env.TASK_DB_PATH;
const previousArtifactRoot = process.env.ARTIFACT_ROOT;
process.env.TASK_DB_PATH = path.join(directory, 'tasks.db');
process.env.ARTIFACT_ROOT = path.join(directory, 'artifacts');
Object.assign(process.env, { NODE_ENV: 'test' });
process.env.JOB_REQUIRE_AUTH = '1';

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else Object.assign(process.env, { [name]: value });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
let routes: {
  submit: typeof import('../src/app/api/v1/jobs/route').POST;
  claim: typeof import('../src/app/api/v1/jobs/[id]/claim/route').POST;
  heartbeat: typeof import('../src/app/api/v1/jobs/[id]/heartbeat/route').POST;
  complete: typeof import('../src/app/api/v1/jobs/[id]/complete/route').POST;
  cancel: typeof import('../src/app/api/v1/jobs/[id]/cancel/route').POST;
  getJob: typeof import('../src/app/api/v1/jobs/[id]/route').GET;
  getResult: typeof import('../src/app/api/v1/jobs/[id]/result/route').GET;
  registerAgent: typeof import('../src/lib/tasks/auth-agent').registerAgent;
  devLogin: typeof import('../src/lib/user-auth').devLogin;
};
const agentRequest = (url: string, token: string, body?: unknown) => new Request(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe('Host JobSpecV1 submit-to-settlement HTTP adapter', () => {
  before(async () => {
    const [submitRoute, claimRoute, heartbeatRoute, completeRoute, cancelRoute, jobRoute, resultRoute, auth, userAuth] = await Promise.all([
      import('../src/app/api/v1/jobs/route.ts'),
      import('../src/app/api/v1/jobs/[id]/claim/route.ts'),
      import('../src/app/api/v1/jobs/[id]/heartbeat/route.ts'),
      import('../src/app/api/v1/jobs/[id]/complete/route.ts'),
      import('../src/app/api/v1/jobs/[id]/cancel/route.ts'),
      import('../src/app/api/v1/jobs/[id]/route.ts'),
      import('../src/app/api/v1/jobs/[id]/result/route.ts'),
      import('../src/lib/tasks/auth-agent.ts'),
      import('../src/lib/user-auth.ts'),
    ]);
    routes = {
      submit: submitRoute.POST,
      claim: claimRoute.POST,
      heartbeat: heartbeatRoute.POST,
      complete: completeRoute.POST,
      cancel: cancelRoute.POST,
      getJob: jobRoute.GET,
      getResult: resultRoute.GET,
      registerAgent: auth.registerAgent,
      devLogin: userAuth.devLogin,
    };
  });

  after(() => {
    rmSync(directory, { recursive: true, force: true });
    restoreEnv('TASK_DB_PATH', previousTaskDbPath);
    restoreEnv('ARTIFACT_ROOT', previousArtifactRoot);
    restoreEnv('NODE_ENV', previousNodeEnv);
    restoreEnv('JOB_REQUIRE_AUTH', previousJobRequireAuth);
  });

  it('submits, authenticates claim and heartbeat, rejects malformed result, then settles and retrieves an idempotent result', async () => {
    const user = await routes.devLogin({ name: 'job-protocol-user', workspaceId: 'job-protocol-test' });
    const { agent, token } = await routes.registerAgent({
      name: 'job-protocol-e2e-agent',
      capabilities: { backends: ['cpu'], kinds: ['export-report'] },
    });
    const submitted = await routes.submit(new Request('http://localhost/api/v1/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
      body: JSON.stringify({ spec: {
        schemaVersion: 1,
        kind: 'export-report',
        name: 'protocol route fixture',
        parameters: { reportType: 'status' },
        run: { maxSteps: 2 },
        outputs: {},
        requirements: { backends: ['cpu'] },
      } }),
    }));
    assert.equal(submitted.status, 201, await submitted.clone().text());
    const { job: newJob } = await submitted.json() as { job: { id: string; status: string; createdBy: string } };
    assert.equal(newJob.status, 'queued');
    assert.equal(newJob.createdBy, user.user.id);

    const routeCtx = ctx(newJob.id);
    const claimedResponse = await routes.claim(agentRequest(`http://localhost/api/v1/jobs/${newJob.id}/claim`, token), routeCtx);
    assert.equal(claimedResponse.status, 200, await claimedResponse.clone().text());
    const { job: claimed } = await claimedResponse.json() as { job: { status: string; agentId: string } };
    assert.equal(claimed.status, 'leased');
    assert.equal(claimed.agentId, agent.id);

    const heartbeatResponse = await routes.heartbeat(agentRequest(
      `http://localhost/api/v1/jobs/${newJob.id}/heartbeat`, token,
      { progress: { step: 1, total: 2, message: 'synthetic route check' } },
    ), routeCtx);
    assert.equal(heartbeatResponse.status, 200, await heartbeatResponse.clone().text());
    const { job: running } = await heartbeatResponse.json() as { job: { status: string } };
    assert.equal(running.status, 'running');

    const malformed = await routes.complete(agentRequest(`http://localhost/api/v1/jobs/${newJob.id}/complete`, token, {
      result: { schemaVersion: 1, summary: { steps: 1.5, wallTimeMs: 1 }, backend: { id: 'cpu' } },
    }), routeCtx);
    assert.equal(malformed.status, 400, await malformed.clone().text());
    const { getJob: readJob } = await import('../src/lib/tasks/service.ts');
    assert.equal(readJob(newJob.id)?.status, 'running', 'rejected result must leave the lease completable');

    const result = { schemaVersion: 1, summary: { steps: 2, wallTimeMs: 3 }, backend: { id: 'cpu' } };
    const completed = await routes.complete(agentRequest(`http://localhost/api/v1/jobs/${newJob.id}/complete`, token, { result }), routeCtx);
    assert.equal(completed.status, 200, await completed.clone().text());
    const { job: succeeded } = await completed.json() as { job: { status: string; result: { backend: { agentId?: string } } } };
    assert.equal(succeeded.status, 'succeeded');
    assert.equal(succeeded.result.backend.agentId, agent.id, 'Host stamps the authenticated Agent identity');

    const retried = await routes.complete(agentRequest(`http://localhost/api/v1/jobs/${newJob.id}/complete`, token, { result }), routeCtx);
    assert.equal(retried.status, 200, await retried.clone().text());

    const auth = { headers: { Authorization: `Bearer ${token}` } };
    const detail = await routes.getJob(new Request(`http://localhost/api/v1/jobs/${newJob.id}`, auth), routeCtx);
    assert.equal(detail.status, 200, await detail.clone().text());
    const detailBody = await detail.json() as { job: { status: string; result: unknown } };
    assert.equal(detailBody.job.status, 'succeeded');
    assert.deepEqual(detailBody.job.result, succeeded.result);

    const retrieval = await routes.getResult(new Request(`http://localhost/api/v1/jobs/${newJob.id}/result`, auth), routeCtx);
    assert.equal(retrieval.status, 200, await retrieval.clone().text());
    const stored = await retrieval.json() as { jobId: string; status: string; result: unknown };
    assert.equal(stored.jobId, newJob.id);
    assert.equal(stored.status, 'succeeded');
    assert.deepEqual(stored.result, succeeded.result);
  });

  it('serializes authenticated cancel-vs-complete and reclaims an expired lease before rejecting a stale owner', async () => {
    const user = await routes.devLogin({ name: 'job-race-user', workspaceId: 'job-race-test' });
    const firstAgent = await routes.registerAgent({ name: 'job-race-agent-a', capabilities: { backends: ['cpu'], kinds: ['export-report'] } });
    const secondAgent = await routes.registerAgent({ name: 'job-race-agent-b', capabilities: { backends: ['cpu'], kinds: ['export-report'] } });
    const submit = async (name: string) => {
      const response = await routes.submit(new Request('http://localhost/api/v1/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
        body: JSON.stringify({ spec: {
          schemaVersion: 1,
          kind: 'export-report',
          name,
          parameters: { reportType: 'status' },
          run: { maxSteps: 1 },
          outputs: {},
          requirements: { backends: ['cpu'] },
        } }),
      }));
      assert.equal(response.status, 201, await response.clone().text());
      return (await response.json() as { job: { id: string } }).job.id;
    };
    const result = { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 2 }, backend: { id: 'cpu' } };

    const raceId = await submit('cancel-complete race');
    const raceCtx = ctx(raceId);
    const claimed = await routes.claim(agentRequest(`http://localhost/api/v1/jobs/${raceId}/claim`, firstAgent.token), raceCtx);
    assert.equal(claimed.status, 200, await claimed.clone().text());
    const [completeRace, cancelRace] = await Promise.all([
      routes.complete(agentRequest(`http://localhost/api/v1/jobs/${raceId}/complete`, firstAgent.token, { result }), raceCtx),
      routes.cancel(new Request(`http://localhost/api/v1/jobs/${raceId}/cancel`, {
        method: 'POST', headers: { Authorization: `Bearer ${user.token}` },
      }), raceCtx),
    ]);
    assert.equal(cancelRace.status, 200, await cancelRace.clone().text());
    const { getJob } = await import('../src/lib/tasks/service.ts');
    const raced = getJob(raceId);
    assert.ok(raced?.status === 'succeeded' || raced?.status === 'cancelled');
    if (raced.status === 'succeeded') {
      assert.equal(completeRace.status, 200, await completeRace.clone().text());
      assert.equal((await cancelRace.json() as { job: { status: string } }).job.status, 'succeeded');
    } else {
      assert.equal(completeRace.status, 409, await completeRace.clone().text());
      assert.equal(raced.result, null);
    }

    const leaseId = await submit('expired lease reclaim');
    const leaseCtx = ctx(leaseId);
    const firstClaim = await routes.claim(agentRequest(`http://localhost/api/v1/jobs/${leaseId}/claim`, firstAgent.token), leaseCtx);
    assert.equal(firstClaim.status, 200, await firstClaim.clone().text());
    const firstAttempt = (await firstClaim.json() as { job: { attempt: number } }).job.attempt;
    const { getSqlite } = await import('../src/lib/tasks/db.ts');
    getSqlite().prepare('UPDATE jobs SET lease_expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', leaseId);

    const secondClaim = await routes.claim(agentRequest(`http://localhost/api/v1/jobs/${leaseId}/claim`, secondAgent.token), leaseCtx);
    assert.equal(secondClaim.status, 200, await secondClaim.clone().text());
    const secondClaimed = (await secondClaim.json() as { job: { status: string; agentId: string; attempt: number } }).job;
    assert.equal(secondClaimed.status, 'leased');
    assert.equal(secondClaimed.agentId, secondAgent.agent.id);
    assert.equal(secondClaimed.attempt, firstAttempt + 1, 'expired lease increments the attempt before reassignment');

    const staleComplete = await routes.complete(agentRequest(`http://localhost/api/v1/jobs/${leaseId}/complete`, firstAgent.token, { result }), leaseCtx);
    assert.equal(staleComplete.status, 409, await staleComplete.clone().text());
    assert.equal(getJob(leaseId)?.agentId, secondAgent.agent.id, 'stale owner cannot change the new lease');
    const currentComplete = await routes.complete(agentRequest(`http://localhost/api/v1/jobs/${leaseId}/complete`, secondAgent.token, { result }), leaseCtx);
    assert.equal(currentComplete.status, 200, await currentComplete.clone().text());
    const settled = (await currentComplete.json() as { job: { status: string; result: { backend: { agentId?: string } } } }).job;
    assert.equal(settled.status, 'succeeded');
    assert.equal(settled.result.backend.agentId, secondAgent.agent.id);
  });
});

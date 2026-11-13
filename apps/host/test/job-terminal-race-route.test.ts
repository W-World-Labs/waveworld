import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directory = mkdtempSync(path.join(tmpdir(), 'waveworld-job-terminal-race-'));
const previous = {
  NODE_ENV: process.env.NODE_ENV,
  JOB_REQUIRE_AUTH: process.env.JOB_REQUIRE_AUTH,
  TASK_DB_PATH: process.env.TASK_DB_PATH,
  ARTIFACT_ROOT: process.env.ARTIFACT_ROOT,
};
Object.assign(process.env, {
  NODE_ENV: 'test',
  JOB_REQUIRE_AUTH: '1',
  TASK_DB_PATH: path.join(directory, 'tasks.db'),
  ARTIFACT_ROOT: path.join(directory, 'artifacts'),
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else Object.assign(process.env, { [name]: value });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const agentRequest = (url: string, token: string, body?: unknown) => new Request(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const result = { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 2 }, backend: { id: 'cpu' } };
let routes: {
  submit: typeof import('../src/app/api/v1/jobs/route').POST;
  claim: typeof import('../src/app/api/v1/jobs/[id]/claim/route').POST;
  complete: typeof import('../src/app/api/v1/jobs/[id]/complete/route').POST;
  fail: typeof import('../src/app/api/v1/jobs/[id]/fail/route').POST;
  cancel: typeof import('../src/app/api/v1/jobs/[id]/cancel/route').POST;
  outcome: typeof import('../src/app/api/v1/jobs/[id]/outcome/route').GET;
  detail: typeof import('../src/app/api/v1/jobs/[id]/route').GET;
  registerAgent: typeof import('../src/lib/tasks/auth-agent').registerAgent;
  devLogin: typeof import('../src/lib/user-auth').devLogin;
};

describe('Host terminal job outcomes through authenticated HTTP routes', () => {
  before(async () => {
    const [submit, claim, complete, fail, cancel, outcome, detail, auth, userAuth] = await Promise.all([
      import('../src/app/api/v1/jobs/route.ts'),
      import('../src/app/api/v1/jobs/[id]/claim/route.ts'),
      import('../src/app/api/v1/jobs/[id]/complete/route.ts'),
      import('../src/app/api/v1/jobs/[id]/fail/route.ts'),
      import('../src/app/api/v1/jobs/[id]/cancel/route.ts'),
      import('../src/app/api/v1/jobs/[id]/outcome/route.ts'),
      import('../src/app/api/v1/jobs/[id]/route.ts'),
      import('../src/lib/tasks/auth-agent.ts'),
      import('../src/lib/user-auth.ts'),
    ]);
    routes = {
      submit: submit.POST,
      claim: claim.POST,
      complete: complete.POST,
      fail: fail.POST,
      cancel: cancel.POST,
      outcome: outcome.GET,
      detail: detail.GET,
      registerAgent: auth.registerAgent,
      devLogin: userAuth.devLogin,
    };
  });

  after(() => {
    rmSync(directory, { recursive: true, force: true });
    restoreEnv('TASK_DB_PATH', previous.TASK_DB_PATH);
    restoreEnv('ARTIFACT_ROOT', previous.ARTIFACT_ROOT);
    restoreEnv('NODE_ENV', previous.NODE_ENV);
    restoreEnv('JOB_REQUIRE_AUTH', previous.JOB_REQUIRE_AUTH);
  });

  const setup = async (prefix: string) => {
    const user = await routes.devLogin({ name: `${prefix}-user`, workspaceId: `${prefix}-workspace` });
    const first = await routes.registerAgent({ name: `${prefix}-agent-a`, capabilities: { backends: ['cpu'], kinds: ['export-report'] } });
    const second = await routes.registerAgent({ name: `${prefix}-agent-b`, capabilities: { backends: ['cpu'], kinds: ['export-report'] } });
    return { user, first, second };
  };

  const submit = async (user: { token: string }, name: string) => {
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

  const claim = async (id: string, token: string) => routes.claim(
    agentRequest(`http://localhost/api/v1/jobs/${id}/claim`, token), ctx(id),
  );

  it('keeps cancellation when late complete and fail arrive', async () => {
    const { user, first } = await setup('cancel-first');
    const id = await submit(user, 'cancel then late settlement');
    assert.equal((await claim(id, first.token)).status, 200);

    const cancelled = await routes.cancel(new Request(`http://localhost/api/v1/jobs/${id}/cancel`, {
      method: 'POST', headers: { Authorization: `Bearer ${user.token}` },
    }), ctx(id));
    assert.equal(cancelled.status, 200, await cancelled.clone().text());
    assert.equal((await cancelled.json() as { job: { status: string } }).job.status, 'cancelled');
    const ownerDetail = await routes.detail(new Request(`http://localhost/api/v1/jobs/${id}`, {
      headers: { Authorization: `Bearer ${user.token}` },
    }), ctx(id));
    assert.equal(ownerDetail.status, 200);
    assert.equal((await ownerDetail.json() as { job: { status: string } }).job.status, 'cancelled');

    const lateComplete = await routes.complete(agentRequest(`http://localhost/api/v1/jobs/${id}/complete`, first.token, { result }), ctx(id));
    assert.equal(lateComplete.status, 409, await lateComplete.clone().text());
    const lateFail = await routes.fail(agentRequest(`http://localhost/api/v1/jobs/${id}/fail`, first.token, {
      error: 'late synthetic failure', retryable: false,
    }), ctx(id));
    assert.equal(lateFail.status, 409, await lateFail.clone().text());

    const { getJob } = await import('../src/lib/tasks/service.ts');
    const stored = getJob(id);
    assert.equal(stored?.status, 'cancelled');
    assert.equal(stored?.result, null);
    assert.equal(stored?.error, null);
  });

  it('does not let cancellation overwrite an already completed result', async () => {
    const { user, first, second } = await setup('complete-first');
    const id = await submit(user, 'complete then cancel');
    assert.equal((await claim(id, first.token)).status, 200);

    const completed = await routes.complete(agentRequest(`http://localhost/api/v1/jobs/${id}/complete`, first.token, { result }), ctx(id));
    assert.equal(completed.status, 200, await completed.clone().text());
    const completedJob = (await completed.json() as { job: { status: string; result: unknown } }).job;
    assert.equal(completedJob.status, 'succeeded');

    const cancelled = await routes.cancel(new Request(`http://localhost/api/v1/jobs/${id}/cancel`, {
      method: 'POST', headers: { Authorization: `Bearer ${user.token}` },
    }), ctx(id));
    assert.equal(cancelled.status, 200, await cancelled.clone().text());
    const cancelJob = (await cancelled.json() as { job: { status: string; result: unknown } }).job;
    assert.equal(cancelJob.status, 'succeeded');
    assert.deepEqual(cancelJob.result, completedJob.result);
    const { getJob } = await import('../src/lib/tasks/service.ts');
    assert.equal(getJob(id)?.status, 'succeeded');
    assert.deepEqual(getJob(id)?.result, completedJob.result);
    const receipt = await routes.outcome(new Request(`http://localhost/api/v1/jobs/${id}/outcome?attempt=0`, {
      headers: { Authorization: `Bearer ${first.token}` },
    }), ctx(id));
    assert.deepEqual(await receipt.json(), {
      attempt: 0,
      outcome: { jobId: id, status: 'succeeded', result: completedJob.result },
    }, 'legacy omitted-attempt completion still records a receipt for the current exact lease');
    const detail = await routes.detail(new Request(`http://localhost/api/v1/jobs/${id}`, {
      headers: { Authorization: `Bearer ${user.token}` },
    }), ctx(id));
    assert.equal(detail.status, 200);
    assert.equal((await detail.json() as { job: { status: string } }).job.status, 'succeeded');
    const foreignDetail = await routes.detail(new Request(`http://localhost/api/v1/jobs/${id}`, {
      headers: { Authorization: `Bearer ${second.token}` },
    }), ctx(id));
    assert.equal(foreignDetail.status, 404, 'receipt support must not broaden ordinary job read ACLs');
  });

  it('rejects stale-owner complete and fail after another Agent reclaims the lease', async () => {
    const { user, first, second } = await setup('stale-owner');
    const id = await submit(user, 'expired lease owner change');
    const routeCtx = ctx(id);
    const firstClaim = await claim(id, first.token);
    assert.equal(firstClaim.status, 200, await firstClaim.clone().text());
    const firstAttempt = (await firstClaim.json() as { job: { attempt: number } }).job.attempt;

    const { getSqlite } = await import('../src/lib/tasks/db.ts');
    getSqlite().prepare('UPDATE jobs SET lease_expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', id);
    const reclaimed = await claim(id, second.token);
    assert.equal(reclaimed.status, 200, await reclaimed.clone().text());
    const owner = (await reclaimed.json() as { job: { agentId: string; attempt: number; status: string } }).job;
    assert.equal(owner.status, 'leased');
    assert.equal(owner.agentId, second.agent.id);
    assert.equal(owner.attempt, firstAttempt + 1, 'expired lease increments the attempt before reassignment');

    const staleComplete = await routes.complete(agentRequest(`http://localhost/api/v1/jobs/${id}/complete`, first.token, { result }), routeCtx);
    assert.equal(staleComplete.status, 409, await staleComplete.clone().text());
    const staleFail = await routes.fail(agentRequest(`http://localhost/api/v1/jobs/${id}/fail`, first.token, {
      error: 'stale synthetic failure', retryable: false,
    }), routeCtx);
    assert.equal(staleFail.status, 409, await staleFail.clone().text());

    const { getJob } = await import('../src/lib/tasks/service.ts');
    const stillOwned = getJob(id);
    assert.equal(stillOwned?.agentId, second.agent.id);
    assert.equal(stillOwned?.attempt, firstAttempt + 1);
    assert.equal(stillOwned?.status, 'leased');

    const currentComplete = await routes.complete(agentRequest(`http://localhost/api/v1/jobs/${id}/complete`, second.token, { result }), routeCtx);
    assert.equal(currentComplete.status, 200, await currentComplete.clone().text());
    const settled = (await currentComplete.json() as { job: { status: string; result: { backend: { agentId?: string } } } }).job;
    assert.equal(settled.status, 'succeeded');
    assert.equal(settled.result.backend.agentId, second.agent.id);
  });

  it('returns immutable per-attempt receipts only to the Agent that held that lease', async () => {
    const { user, first, second } = await setup('attempt-receipt');
    const id = await submit(user, 'receipt after requeue');
    const firstClaim = await claim(id, first.token);
    assert.equal(firstClaim.status, 200);
    const firstAttempt = (await firstClaim.json() as { job: { attempt: number } }).job.attempt;
    assert.equal(firstAttempt, 0);

    const failed = await routes.fail(agentRequest(`http://localhost/api/v1/jobs/${id}/fail`, first.token, {
      attempt: firstAttempt, error: 'retry after transient failure', retryable: true,
    }), ctx(id));
    assert.equal(failed.status, 200, await failed.clone().text());
    assert.equal((await failed.json() as { job: { status: string; attempt: number } }).job.status, 'queued');

    const receiptUrl = `http://localhost/api/v1/jobs/${id}/outcome?attempt=${firstAttempt}`;
    const receipt = await routes.outcome(new Request(receiptUrl, { headers: { Authorization: `Bearer ${first.token}` } }), ctx(id));
    assert.equal(receipt.status, 200, await receipt.clone().text());
    assert.deepEqual(await receipt.json(), { attempt: 0, outcome: { jobId: id, status: 'queued' } });
    const ownerDetail = await routes.detail(new Request(`http://localhost/api/v1/jobs/${id}`, {
      headers: { Authorization: `Bearer ${user.token}` },
    }), ctx(id));
    assert.equal(ownerDetail.status, 200);
    assert.equal((await ownerDetail.json() as { job: { status: string } }).job.status, 'queued');

    const foreign = await routes.outcome(new Request(receiptUrl, { headers: { Authorization: `Bearer ${second.token}` } }), ctx(id));
    assert.equal(foreign.status, 404);
    const wrongAttempt = await routes.outcome(new Request(`http://localhost/api/v1/jobs/${id}/outcome?attempt=1`, {
      headers: { Authorization: `Bearer ${first.token}` },
    }), ctx(id));
    assert.equal(wrongAttempt.status, 404);

    const secondClaim = await claim(id, first.token);
    assert.equal(secondClaim.status, 200, await secondClaim.clone().text());
    const secondAttempt = (await secondClaim.json() as { job: { attempt: number } }).job.attempt;
    assert.equal(secondAttempt, 1);

    const stale = await routes.complete(agentRequest(`http://localhost/api/v1/jobs/${id}/complete`, first.token, {
      attempt: firstAttempt, result,
    }), ctx(id));
    assert.equal(stale.status, 409);
    assert.deepEqual((await routes.outcome(new Request(receiptUrl, {
      headers: { Authorization: `Bearer ${first.token}` },
    }), ctx(id))).status, 200, 'reclaim must not overwrite prior lease receipt');

    const finalFail = await routes.fail(agentRequest(`http://localhost/api/v1/jobs/${id}/fail`, first.token, {
      attempt: secondAttempt, error: 'final failure', retryable: false,
    }), ctx(id));
    assert.equal(finalFail.status, 200, await finalFail.clone().text());
    assert.deepEqual(await (await routes.outcome(new Request(`http://localhost/api/v1/jobs/${id}/outcome?attempt=1`, {
      headers: { Authorization: `Bearer ${first.token}` },
    }), ctx(id))).json(), { attempt: 1, outcome: { jobId: id, status: 'failed', error: 'final failure' } });
    assert.deepEqual(await (await routes.outcome(new Request(receiptUrl, {
      headers: { Authorization: `Bearer ${first.token}` },
    }), ctx(id))).json(), { attempt: 0, outcome: { jobId: id, status: 'queued' } },
    'attempt 0 remains immutable after attempt 1 has settled under the same Agent');
    const staleAfterReclaim = await routes.complete(agentRequest(`http://localhost/api/v1/jobs/${id}/complete`, first.token, {
      attempt: firstAttempt, result,
    }), ctx(id));
    assert.equal(staleAfterReclaim.status, 409, 'late attempt 0 write cannot modify settled attempt 1');
  });

  it('records an expired lease receipt before requeueing the next attempt', async () => {
    const { user, first } = await setup('attempt-expiry-receipt');
    const id = await submit(user, 'expiry receipt');
    const claimed = await claim(id, first.token);
    assert.equal(claimed.status, 200);
    const attempt = (await claimed.json() as { job: { attempt: number } }).job.attempt;
    const { getSqlite } = await import('../src/lib/tasks/db.ts');
    getSqlite().prepare('UPDATE jobs SET lease_expires_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', id);
    const { requeueExpiredLeases } = await import('../src/lib/tasks/service.ts');
    assert.equal(requeueExpiredLeases(), 1);
    const receipt = await routes.outcome(new Request(`http://localhost/api/v1/jobs/${id}/outcome?attempt=${attempt}`, {
      headers: { Authorization: `Bearer ${first.token}` },
    }), ctx(id));
    assert.deepEqual(await receipt.json(), { attempt, outcome: { jobId: id, status: 'queued' } });
  });

  it('accepts legacy omitted-attempt fail and records an attempt-zero receipt', async () => {
    const { user, first } = await setup('legacy-fail-receipt');
    const id = await submit(user, 'legacy omitted attempt fail');
    const claimed = await claim(id, first.token);
    assert.equal(claimed.status, 200);
    assert.equal((await claimed.json() as { job: { attempt: number } }).job.attempt, 0);

    const failed = await routes.fail(agentRequest(`http://localhost/api/v1/jobs/${id}/fail`, first.token, {
      error: 'legacy client failure', retryable: false,
    }), ctx(id));
    assert.equal(failed.status, 200, await failed.clone().text());
    const receipt = await routes.outcome(new Request(`http://localhost/api/v1/jobs/${id}/outcome?attempt=0`, {
      headers: { Authorization: `Bearer ${first.token}` },
    }), ctx(id));
    assert.deepEqual(await receipt.json(), {
      attempt: 0,
      outcome: { jobId: id, status: 'failed', error: 'legacy client failure' },
    });
    const detail = await routes.detail(new Request(`http://localhost/api/v1/jobs/${id}`, {
      headers: { Authorization: `Bearer ${user.token}` },
    }), ctx(id));
    assert.equal((await detail.json() as { job: { status: string } }).job.status, 'failed');
  });

  it('persists a cancelled attempt receipt after the job clears its lease owner', async () => {
    const { user, first } = await setup('attempt-cancel-receipt');
    const id = await submit(user, 'cancel receipt');
    const claimed = await claim(id, first.token);
    assert.equal(claimed.status, 200);
    const attempt = (await claimed.json() as { job: { attempt: number } }).job.attempt;
    const cancelled = await routes.cancel(new Request(`http://localhost/api/v1/jobs/${id}/cancel`, {
      method: 'POST', headers: { Authorization: `Bearer ${user.token}` },
    }), ctx(id));
    assert.equal(cancelled.status, 200);
    const receipt = await routes.outcome(new Request(`http://localhost/api/v1/jobs/${id}/outcome?attempt=${attempt}`, {
      headers: { Authorization: `Bearer ${first.token}` },
    }), ctx(id));
    assert.deepEqual(await receipt.json(), { attempt, outcome: { jobId: id, status: 'cancelled' } });
  });
});

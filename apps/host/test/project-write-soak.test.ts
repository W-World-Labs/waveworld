/**
 * Project-scoped writes, publication reviews, share revokes and golden-case
 * advances were reachable without any per-user cap. projectWrite is 60/min
 * shared across member/model/attach/update/delete routes; publicationReview
 * and goldenCaseAdvance are 30/min; share revoke rides the jobShare bucket.
 * Every cap is keyed by the authed user and checked before the body is read.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let dir = '';

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-project-write-'));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
  Object.assign(process.env, { NODE_ENV: 'test' });
});

after(() => {
  delete process.env.TASK_DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

const authed = (userId: string, extra?: Record<string, string>) => ({
  'content-type': 'application/json',
  'x-user-id': userId,
  'x-workspace-id': 'ws-soak',
  ...extra,
});

const projectId = crypto.randomUUID();

describe('project write cap', { concurrency: false }, () => {
  it('70 PATCHes shed after 60; the shared bucket also sheds member writes', async () => {
    const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    const { PATCH } = await import('../src/app/api/v1/projects/[id]/route.ts');
    const params = Promise.resolve({ id: projectId });
    const patch = (userId: string) => PATCH(new Request(`http://localhost/api/v1/projects/${projectId}`, {
      method: 'PATCH',
      headers: authed(userId),
      body: JSON.stringify({ name: `rename-${Math.random()}` }),
    }), { params });

    let allowed = 0;
    let shed = 0;
    for (let i = 0; i < 70; i++) {
      const res = await patch('project-writer');
      if (res.status === 429) {
        shed++;
        assert.ok(Number(res.headers.get('retry-after')) >= 1);
      } else {
        // Cap is before the service call: a missing project answers 404, not 5xx.
        assert.equal(res.status, 404);
        allowed++;
      }
    }
    assert.equal(allowed, 60);
    assert.equal(shed, 10);

    // Same bucket covers member upserts — a saturated writer is shed there too.
    const { POST: memberPost } = await import('../src/app/api/v1/projects/[id]/members/route.ts');
    const memberRes = await memberPost(new Request(`http://localhost/api/v1/projects/${projectId}/members`, {
      method: 'POST',
      headers: authed('project-writer'),
      body: JSON.stringify({ userId: 'peer', role: 'viewer' }),
    }), { params: Promise.resolve({ id: projectId }) });
    assert.equal(memberRes.status, 429);

    // A different user keeps their own bucket.
    const peer = await patch('project-peer');
    assert.equal(peer.status, 404);
  });
});

describe('publication review cap', { concurrency: false }, () => {
  it('35 review creates shed after 30', async () => {
    const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    const { POST } = await import('../src/app/api/v1/publications/[publicId]/reviews/route.ts');
    const publicId = crypto.randomUUID();
    const params = Promise.resolve({ publicId });
    let shed = 0;
    for (let i = 0; i < 35; i++) {
      const res = await POST(new Request(`http://localhost/api/v1/publications/${publicId}/reviews`, {
        method: 'POST',
        headers: authed('reviewer'),
        body: JSON.stringify({ payload: { verdict: 'ok' } }),
      }), { params });
      if (res.status === 429) shed++;
      else assert.notEqual(res.status, 500);
    }
    assert.equal(shed, 5);
  });
});

describe('share revoke cap', { concurrency: false }, () => {
  it('a saturated jobShare bucket sheds revoke before the id check', async () => {
    const {
      resetRateLimitsForTests,
      consumeJobShareLimit,
    } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    for (let i = 0; i < 30; i++) assert.ok(consumeJobShareLimit('share-user').ok);
    const { DELETE } = await import('../src/app/api/v1/shares/[id]/route.ts');
    const shareId = crypto.randomUUID();
    const res = await DELETE(new Request(`http://localhost/api/v1/shares/${shareId}`, {
      method: 'DELETE',
      headers: authed('share-user'),
    }), { params: Promise.resolve({ id: shareId }) });
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('retry-after')) >= 1);
    // A peer user still reaches the handler (404/400 — never 429).
    const peerId = crypto.randomUUID();
    const peer = await DELETE(new Request(`http://localhost/api/v1/shares/${peerId}`, {
      method: 'DELETE',
      headers: authed('share-peer'),
    }), { params: Promise.resolve({ id: peerId }) });
    assert.notEqual(peer.status, 429);
  });
});

describe('golden-case advance cap', { concurrency: false }, () => {
  it('a saturated goldenCaseAdvance bucket sheds advance before any work', async () => {
    const {
      resetRateLimitsForTests,
      consumeGoldenCaseAdvanceLimit,
    } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    for (let i = 0; i < 30; i++) assert.ok(consumeGoldenCaseAdvanceLimit('gc-user').ok);
    const { POST } = await import('../src/app/api/v1/golden-case/route.ts');
    const res = await POST(new Request('http://localhost/api/v1/golden-case', {
      method: 'POST',
      headers: authed('gc-user'),
    }));
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get('retry-after')) >= 1);
  });
});

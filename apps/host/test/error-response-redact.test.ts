/**
 * errorResponse redact contract: deliberate 4xx-shaped throws echo their
 * message (the API contract); internal 5xx faults return a generic
 * 'Internal error' body while console.error keeps server-side diagnostics.
 * SQLite/fs diagnostics — paths, schema names, syscall details — must never
 * reach the client.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { errorResponse, HttpError } from '../src/lib/tasks/http';

describe('errorResponse internals redaction', () => {
  it('plain Error → 500 generic, real error logged server-side', async (t) => {
    const logged: unknown[][] = [];
    t.mock.method(console, 'error', (...args: unknown[]) => logged.push(args));
    const internal = new Error('attempt to write a readonly database: /var/lib/waveworld/tasks.db');
    const res = errorResponse(internal);
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, 'Internal error');
    assert.ok(!body.error!.includes('/var/lib'), 'fs path must never leak');
    assert.ok(!body.error!.includes('readonly'), 'sqlite diagnostic must never leak');
    assert.ok(logged.some((a) => a.includes(internal)), 'real error must reach console.error');
  });

  it('status-shaped 4xx throw keeps its deliberate message', async () => {
    const err = Object.assign(new Error('publicationId does not match request'), { status: 400 });
    const res = errorResponse(err);
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { error?: string }).error, 'publicationId does not match request');
  });

  it('status-shaped 5xx throw keeps status but redacts the message', async (t) => {
    t.mock.method(console, 'error', () => {});
    const err = Object.assign(new Error('upstream wallet db at 10.0.0.4 refused'), { status: 503 });
    const res = errorResponse(err);
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error?: string };
    assert.equal(body.error, 'Internal error');
    assert.ok(!body.error!.includes('10.0.0.4'));
  });

  it('HttpError passes through at any status (deliberate contract)', async () => {
    const res = errorResponse(new HttpError(500, 'artifact storage unavailable'));
    assert.equal(res.status, 500);
    assert.equal(((await res.json()) as { error?: string }).error, 'artifact storage unavailable');
  });

  it('non-Error throw → 500 generic', async (t) => {
    t.mock.method(console, 'error', () => {});
    const res = errorResponse('disk io fail');
    assert.equal(res.status, 500);
    assert.equal(((await res.json()) as { error?: string }).error, 'Internal error');
  });
});

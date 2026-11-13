import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BoundedTelemetryQueue,
  captureRadarException,
  withRadarOperation,
  withRadarRoute,
} from '../src/lib/radar-telemetry.ts';

const incoming = '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01';

function withRadarEnv<T>(run: () => Promise<T>): Promise<T> {
  const old = {
    code: process.env.W_RADAR_CODE,
    endpoint: process.env.W_RADAR_ENDPOINT,
    service: process.env.SERVICE_NAME,
  };
  process.env.W_RADAR_CODE = 'W-WAVEWORLD-76B94EFF';
  process.env.W_RADAR_ENDPOINT = 'https://radar.example.test';
  process.env.SERVICE_NAME = 'waveworld-host';
  return run().finally(() => {
    if (old.code === undefined) delete process.env.W_RADAR_CODE; else process.env.W_RADAR_CODE = old.code;
    if (old.endpoint === undefined) delete process.env.W_RADAR_ENDPOINT; else process.env.W_RADAR_ENDPOINT = old.endpoint;
    if (old.service === undefined) delete process.env.SERVICE_NAME; else process.env.SERVICE_NAME = old.service;
  });
}

test('Host request spans link inbound traceparent using fixed route metadata without exposing request data', async () => {
  await withRadarEnv(async () => {
    const originalFetch = globalThis.fetch;
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input, init) => {
      posts.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response('{}', { status: 202 });
    }) as typeof fetch;
    try {
      const handler = withRadarRoute('GET', '/api/v1/jobs/:id', async () => Response.json({ ok: true }));
      const response = await handler(new Request('https://host.example/api/v1/jobs/private-id?token=secret', {
        headers: { traceparent: incoming },
      }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
      assert.equal(response.headers.get('traceparent'), null);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(posts.length, 1);
      assert.equal(posts[0]?.url, 'https://radar.example.test/collect');
      const event = (posts[0]?.body.events as Array<{ data: Record<string, unknown> }>)[0];
      assert.equal(event.data.parent_span_id, incoming.split('-')[2]);
      assert.equal(event.data.trace_id, incoming.split('-')[1]);
      assert.equal(event.data['http.route'], '/api/v1/jobs/:id');
      assert.equal(event.data['http.status_code'], 200);
      assert.equal(typeof event.data.duration_ms, 'number');
      assert.equal(JSON.stringify(posts).includes('private-id'), false);
      assert.equal(JSON.stringify(posts).includes('secret'), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('Host payload maps NODE_ENV to environment and preserves explicit ENVIRONMENT', async () => {
  const keys = ['W_RADAR_CODE', 'W_RADAR_ENDPOINT', 'SERVICE_NAME', 'APP_ENV', 'ENVIRONMENT', 'NODE_ENV'] as const;
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const events: Array<Record<string, unknown>> = [];
  process.env.W_RADAR_CODE = 'W-WAVEWORLD-76B94EFF';
  process.env.W_RADAR_ENDPOINT = 'https://radar.example.test';
  process.env.SERVICE_NAME = 'waveworld-host';
  Reflect.set(process.env, 'NODE_ENV', 'production');
  delete process.env.APP_ENV;
  delete process.env.ENVIRONMENT;
  globalThis.fetch = (async (_input, init) => {
    const payload = JSON.parse(String(init?.body)) as { events?: Array<{ data: Record<string, unknown> }> };
    events.push(...(payload.events ?? []).map((event) => event.data));
    return new Response('{}', { status: 202 });
  }) as typeof fetch;
  try {
    await withRadarRoute('GET', '/api/health', async () => Response.json({ ok: true }))(
      new Request('https://host.example/api/health'),
    );
    process.env.ENVIRONMENT = 'staging';
    await withRadarRoute('GET', '/api/health', async () => Response.json({ ok: true }))(
      new Request('https://host.example/api/health'),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(events.length, 2);
    assert.equal(events[0]?.environment, 'production');
    assert.equal(events[0]?.['deployment.environment'], 'production');
    assert.equal(events[1]?.environment, 'staging');
    assert.equal(events[1]?.['deployment.environment'], 'staging');
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      const value = old[key];
      if (value === undefined) Reflect.deleteProperty(process.env, key); else Reflect.set(process.env, key, value);
    }
  }
});

test('exception capture strips message and stack while retaining request correlation', async () => {
  await withRadarEnv(async () => {
    const originalFetch = globalThis.fetch;
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input, init) => {
      posts.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response('{}', { status: 202 });
    }) as typeof fetch;
    try {
      const handler = withRadarRoute('POST', '/api/v1/jobs', async () => {
        captureRadarException(new TypeError('prompt Bearer private-token at /home/private/path'));
        return new Response('Internal error', { status: 500 });
      });
      await handler(new Request('https://host.example/api/v1/jobs?session=cookie'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const error = posts.find((post) => post.url.endsWith('/errors/capture'))?.body;
      assert.ok(error);
      assert.equal(error.exception_type, 'TypeError');
      assert.equal(error.message, 'TypeError');
      assert.equal(error.stack, '');
      assert.equal((error.context as Record<string, unknown>)['http.route'], '/api/v1/jobs');
      assert.equal((error.context as Record<string, unknown>)['http.status_code'], 500);
      assert.equal(JSON.stringify(error).includes('private-token'), false);
      assert.equal(JSON.stringify(error).includes('/home/private/path'), false);
      assert.equal(JSON.stringify(error).includes('session=cookie'), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('Host operation spans measure the awaited boundary and inherit a request parent', async () => {
  await withRadarEnv(async () => {
    const originalFetch = globalThis.fetch;
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    globalThis.fetch = (async (_input, init) => {
      const payload = JSON.parse(String(init?.body)) as { events?: Array<{ name: string; data: Record<string, unknown> }> };
      events.push(...(payload.events ?? []));
      return new Response('{}', { status: 202 });
    }) as typeof fetch;
    try {
      const handler = withRadarRoute('POST', '/api/v1/jobs', async () => {
        await withRadarOperation('wcompute.quote', async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'quoted';
        });
        return Response.json({ ok: true });
      });
      await handler(new Request('https://host.example/api/v1/jobs?private=secret'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const request = events.find((event) => event.name === 'http.server POST /api/v1/jobs');
      const quote = events.find((event) => event.name === 'wcompute.quote');
      assert.ok(request && quote);
      assert.equal(quote.data.parent_span_id, request.data.span_id);
      assert.equal(quote.data.operation, 'wcompute.quote');
      assert.ok(Number(quote.data.duration_ms) >= 8);
      assert.equal(JSON.stringify(events).includes('private=secret'), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('background Host operation failures capture sanitized exception classes', async () => {
  await withRadarEnv(async () => {
    const originalFetch = globalThis.fetch;
    const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = (async (input, init) => {
      posts.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response('{}', { status: 202 });
    }) as typeof fetch;
    try {
      try {
        await withRadarOperation('wcompute.create', async () => { throw new TypeError('private allocation at /home/tenant'); });
      } catch (error) {
        captureRadarException(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      const error = posts.find((post) => post.url.endsWith('/errors/capture'))?.body;
      assert.ok(error);
      assert.equal(error.exception_type, 'TypeError');
      assert.equal(error.message, 'TypeError');
      assert.equal(error.stack, '');
      assert.equal(JSON.stringify(error).includes('/home/tenant'), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('bounded telemetry queue drops overflow without waiting on a stuck export', async () => {
  const queue = new BoundedTelemetryQueue(1, 1);
  let release!: () => void;
  const stuck = new Promise<void>((resolve) => { release = resolve; });
  assert.equal(queue.enqueue(() => stuck), true);
  await Promise.resolve();
  assert.equal(queue.enqueue(async () => {}), false);
  assert.equal(queue.droppedCount, 1);
  release();
});

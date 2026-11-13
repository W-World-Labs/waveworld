import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BoundedTelemetryQueue,
  fetchWithAgentTelemetry,
  finishAgentPhase,
  finishAgentTrace,
  startAgentPhase,
  withAgentTrace,
} from './radar-telemetry.ts';

test('agent payload maps NODE_ENV to environment and preserves explicit ENVIRONMENT', async () => {
  const keys = ['W_RADAR_CODE', 'W_RADAR_ENDPOINT', 'SERVICE_NAME', 'APP_ENV', 'ENVIRONMENT', 'NODE_ENV'] as const;
  const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const events: Array<Record<string, unknown>> = [];
  process.env.W_RADAR_CODE = 'W-WAVEWORLD-76B94EFF';
  process.env.W_RADAR_ENDPOINT = 'https://radar.example.test';
  process.env.SERVICE_NAME = 'tuanliu-agent';
  Reflect.set(process.env, 'NODE_ENV', 'production');
  delete process.env.APP_ENV;
  delete process.env.ENVIRONMENT;
  globalThis.fetch = (async (input, init) => {
    if (String(input).startsWith('https://radar.example.test/')) {
      const payload = JSON.parse(String(init?.body)) as { events?: Array<{ data: Record<string, unknown> }> };
      events.push(...(payload.events ?? []).map((event) => event.data));
    }
    return new Response('{}', { status: 202 });
  }) as typeof fetch;
  try {
    await withAgentTrace('lbm-d3q19', 'private-job', () => finishAgentTrace('completed', {}));
    process.env.ENVIRONMENT = 'staging';
    await withAgentTrace('lbm-d3q19', 'private-job', () => finishAgentTrace('completed', {}));
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

test('agent execution and API calls share trace parents without recording URL or query data', async () => {
  const old = {
    code: process.env.W_RADAR_CODE,
    endpoint: process.env.W_RADAR_ENDPOINT,
    service: process.env.SERVICE_NAME,
  };
  const originalFetch = globalThis.fetch;
  const payloads: Array<{ url: string; body: Record<string, unknown> }> = [];
  const apiRequests: Array<{ url: string; traceparent: string | null }> = [];
  process.env.W_RADAR_CODE = 'W-WAVEWORLD-76B94EFF';
  process.env.W_RADAR_ENDPOINT = 'https://radar.example.test';
  process.env.SERVICE_NAME = 'tuanliu-agent';
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://radar.example.test/')) {
      payloads.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response('{}', { status: 202 });
    }
    apiRequests.push({ url, traceparent: new Headers(init?.headers).get('traceparent') });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    await withAgentTrace('lbm-d3q19', 'private-job-id', async () => {
      const phase = startAgentPhase('model.execute');
      await fetchWithAgentTelemetry('https://host.example/prefix/api/v1/jobs/private-job-id/heartbeat?cookie=secret', {
        method: 'POST',
        headers: { Authorization: 'Bearer auth-secret' },
      });
      finishAgentPhase(phase);
      finishAgentTrace('completed', { backend: 'cpu', gitSha: 'revision-test' });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(apiRequests.length, 1);
    assert.match(apiRequests[0]?.traceparent ?? '', /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    assert.equal(apiRequests[0]?.url.includes('cookie=secret'), true);
    const events = payloads.flatMap((payload) => payload.body.events as Array<{ name: string; data: Record<string, unknown> }>);
    const apiSpan = events.find((event) => event.name === 'http.client POST /api/v1/jobs/:id/heartbeat');
    const runSpan = events.find((event) => event.name === 'agent.run');
    const executeSpan = events.find((event) => event.name === 'agent.model.execute');
    assert.ok(apiSpan && runSpan && executeSpan);
    assert.equal(apiSpan.data.parent_span_id, executeSpan.data.span_id);
    assert.equal(apiSpan.data.trace_id, executeSpan.data.trace_id);
    assert.equal(runSpan.data['waveworld.job_kind'], 'lbm-d3q19');
    assert.equal(runSpan.data['waveworld.job_id'], 'private-job-id');
    assert.equal(JSON.stringify(payloads).includes('cookie=secret'), false);
    assert.equal(JSON.stringify(payloads).includes('auth-secret'), false);
    assert.equal(events.some((event) => event.name.includes('private-job-id')), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (old.code === undefined) delete process.env.W_RADAR_CODE; else process.env.W_RADAR_CODE = old.code;
    if (old.endpoint === undefined) delete process.env.W_RADAR_ENDPOINT; else process.env.W_RADAR_ENDPOINT = old.endpoint;
    if (old.service === undefined) delete process.env.SERVICE_NAME; else process.env.SERVICE_NAME = old.service;
  }
});

test('agent exception capture emits only safe exception type and no stack', async () => {
  const old = { code: process.env.W_RADAR_CODE, endpoint: process.env.W_RADAR_ENDPOINT };
  const originalFetch = globalThis.fetch;
  const errors: Array<Record<string, unknown>> = [];
  process.env.W_RADAR_CODE = 'W-WAVEWORLD-76B94EFF';
  process.env.W_RADAR_ENDPOINT = 'https://radar.example.test';
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (url.endsWith('/errors/capture')) errors.push(payload);
    return new Response('{}', { status: 202 });
  }) as typeof fetch;
  try {
    await withAgentTrace('waveworld-module', 'job-2', () =>
      finishAgentTrace('failed', { error: new TypeError('private model output at /home/agent/secret'), backend: 'cpu' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.exception_type, 'TypeError');
    assert.equal(errors[0]?.message, 'TypeError');
    assert.equal(errors[0]?.stack, '');
    assert.equal(JSON.stringify(errors).includes('private model output'), false);
    assert.equal(JSON.stringify(errors).includes('/home/agent/secret'), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (old.code === undefined) delete process.env.W_RADAR_CODE; else process.env.W_RADAR_CODE = old.code;
    if (old.endpoint === undefined) delete process.env.W_RADAR_ENDPOINT; else process.env.W_RADAR_ENDPOINT = old.endpoint;
  }
});

test('parallel agent runs keep API spans in their own async trace contexts', async () => {
  const old = { code: process.env.W_RADAR_CODE, endpoint: process.env.W_RADAR_ENDPOINT };
  const originalFetch = globalThis.fetch;
  const events: Array<{ name: string; data: Record<string, unknown> }> = [];
  process.env.W_RADAR_CODE = 'W-WAVEWORLD-76B94EFF';
  process.env.W_RADAR_ENDPOINT = 'https://radar.example.test';
  globalThis.fetch = (async (input, init) => {
    if (String(input).startsWith('https://radar.example.test/')) {
      const payload = JSON.parse(String(init?.body)) as { events?: Array<{ name: string; data: Record<string, unknown> }> };
      events.push(...(payload.events ?? []));
      return new Response('{}', { status: 202 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    await Promise.all(['job-a', 'job-b'].map((jobId) => withAgentTrace('lbm-d3q19', jobId, async () => {
      const phase = startAgentPhase('model.execute');
      await fetchWithAgentTelemetry(`https://host.example/api/v1/jobs/${jobId}/heartbeat`, { method: 'POST' });
      finishAgentPhase(phase);
      finishAgentTrace('completed', { backend: 'cpu' });
    })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const jobId of ['job-a', 'job-b']) {
      const trace = events.find((event) => event.name === 'agent.run' && event.data['waveworld.job_id'] === jobId);
      const phase = events.find((event) => event.name === 'agent.model.execute' && event.data.trace_id === trace?.data.trace_id);
      const api = events.find((event) => event.name === 'http.client POST /api/v1/jobs/:id/heartbeat' && event.data.trace_id === trace?.data.trace_id);
      assert.ok(trace && phase && api);
      assert.equal(api.data.parent_span_id, phase.data.span_id);
      assert.equal(api.data.trace_id, trace.data.trace_id);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (old.code === undefined) delete process.env.W_RADAR_CODE; else process.env.W_RADAR_CODE = old.code;
    if (old.endpoint === undefined) delete process.env.W_RADAR_ENDPOINT; else process.env.W_RADAR_ENDPOINT = old.endpoint;
  }
});

test('bounded telemetry queue drops overflow without waiting for the stuck export', async () => {
  const queue = new BoundedTelemetryQueue(1, 1);
  let release!: () => void;
  const stuck = new Promise<void>((resolve) => { release = resolve; });
  assert.equal(queue.enqueue(() => stuck), true);
  await Promise.resolve();
  assert.equal(queue.enqueue(async () => {}), false);
  assert.equal(queue.droppedCount, 1);
  release();
});

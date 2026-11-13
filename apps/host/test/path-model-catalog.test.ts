import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const testDb = path.resolve(here, '../../../data/tasks-test-path-model-catalog.db');

before(() => {
  process.env.TASK_DB_PATH = testDb;
  Object.assign(process.env, { NODE_ENV: 'production' });
  for (const suffix of ['', '-wal', '-shm']) try { fs.unlinkSync(testDb + suffix); } catch { /* absent */ }
});

describe('authenticated dynamic path-model catalog', { concurrency: false }, () => {
  it('aggregates matching Agent manifests and reports online execution capability', async () => {
    const { registerAgent, listPathModelCatalog } = await import('@/lib/tasks/auth-agent.ts');
    const manifest = {
      id: 'ir-dynamic', version: '2.1.0', backends: ['cpu' as const],
      parameters: { oxygen: { type: 'number' as const, required: true, unit: 'mM' } },
      outputs: { ros: { type: 'number' as const, unit: 'relative' } },
    };
    await registerAgent({ name: 'model-agent-a', capabilities: { backends: ['cpu'], kinds: ['path-experiment'], pathModels: [manifest] } });
    await registerAgent({ name: 'model-agent-b', capabilities: { backends: ['cpu', 'cuda'], kinds: ['path-experiment'], pathModels: [{ ...manifest, backends: ['cuda'] }] } });

    const catalog = listPathModelCatalog();
    assert.equal(catalog.length, 1);
    assert.deepEqual(catalog[0].backends, ['cpu', 'cuda']);
    assert.deepEqual(catalog[0].availableBackends, ['cpu', 'cuda']);
    assert.equal(catalog[0].available, true);
    assert.equal(catalog[0].availableAgentCount, 2);
    assert.equal(catalog[0].registeredAgentCount, 2);
    assert.equal(catalog[0].parameters?.oxygen.unit, 'mM');
    assert.equal(catalog[0].outputs?.ros.type, 'number');

    const stale = listPathModelCatalog(new Date(Date.now() + 10 * 60_000));
    assert.equal(stale[0].available, false);
    assert.equal(stale[0].availableAgentCount, 0);
    assert.deepEqual(stale[0].availableBackends, []);
    assert.equal(stale[0].registeredAgentCount, 2);
  });

  it('requires a user session and returns the aggregated catalog', async () => {
    const route = await import('../src/app/api/v1/path-models/route.ts');
    const anonymous = await route.GET(new Request('http://localhost/api/v1/path-models'));
    assert.equal(anonymous.status, 401);

    const { devLogin } = await import('../src/lib/user-auth.ts');
    const login = await devLogin({ name: 'catalog-reader', workspaceId: 'catalog-workspace' });
    const response = await route.GET(new Request('http://localhost/api/v1/path-models', { headers: { Authorization: `Bearer ${login.token}` } }));
    assert.equal(response.status, 200);
    const body = await response.json() as { models: Array<{ id: string; available: boolean }> };
    assert.equal(body.models[0].id, 'ir-dynamic');
    assert.equal(body.models[0].available, true);
  });

  it('fails closed when online Agents advertise different implementations for one version', async () => {
    const { registerAgent, listPathModelCatalog } = await import('@/lib/tasks/auth-agent.ts');
    const base = { id: 'conflicted-model', version: '1.0.0', backends: ['cpu' as const] };
    await registerAgent({ name: 'conflict-a', capabilities: { backends: ['cpu'], kinds: ['path-experiment'], pathModels: [{ ...base, implementationSha256: 'a'.repeat(64) }] } });
    await registerAgent({ name: 'conflict-b', capabilities: { backends: ['cpu'], kinds: ['path-experiment'], pathModels: [{ ...base, implementationSha256: 'b'.repeat(64) }] } });
    const model = listPathModelCatalog().find((item) => item.id === base.id)!;
    assert.equal(model.implementationConflict, true);
    assert.equal(model.available, false);
    assert.equal(model.availableAgentCount, 0);
    assert.deepEqual(model.availableBackends, []);
  });
});

/**
 * POST /api/v1/knowledge/conflicts/seed-demo (K21 write residual).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { POST } from '../src/app/api/v1/knowledge/conflicts/seed-demo/route.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const waveRoot = path.resolve(here, '../../..');
const testDb = path.join(os.tmpdir(), `k21-seed-demo-${Date.now()}.db`);

before(() => {
  process.env.KNOWLEDGE_DB_PATH = testDb;
  // Prefer dedicated write key for this route test.
  process.env.AGENT_REGISTRATION_KEY = 'test-reg-key-k21';
  for (const p of [testDb, testDb + '-wal', testDb + '-shm']) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ok */
    }
  }
  // Ensure schema exists for seed path.
  return import('../../../src/lib/knowledge-db/migrate.ts').then(({ migrateKnowledgeDb }) => {
    migrateKnowledgeDb({ root: waveRoot, dbPath: testDb });
  });
});

after(() => {
  for (const p of [testDb, testDb + '-wal', testDb + '-shm']) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ok */
    }
  }
});

describe('POST knowledge conflicts seed-demo (K21)', () => {
  it('401 without registration key', async () => {
    const res = await POST(
      new Request('http://localhost/api/v1/knowledge/conflicts/seed-demo', {
        method: 'POST',
      }),
    );
    assert.equal(res.status, 401);
  });

  it('401 with mismatched registration key', async () => {
    const res = await POST(
      new Request('http://localhost/api/v1/knowledge/conflicts/seed-demo', {
        method: 'POST',
        headers: { 'x-agent-registration-key': 'not-the-k21-key' },
      }),
    );
    assert.equal(res.status, 401);
  });

  it('seeds demo conflicts with valid key (idempotent)', async () => {
    const req = (key: string) =>
      new Request('http://localhost/api/v1/knowledge/conflicts/seed-demo', {
        method: 'POST',
        headers: { 'x-agent-registration-key': key },
      });
    const r1 = await POST(req('test-reg-key-k21'));
    assert.equal(r1.status, 200);
    const b1 = (await r1.json()) as {
      ok: boolean;
      created: boolean;
      conflictIds: string[];
    };
    assert.equal(b1.ok, true);
    assert.ok(b1.conflictIds.length >= 2);

    const r2 = await POST(req('test-reg-key-k21'));
    assert.equal(r2.status, 200);
    const b2 = (await r2.json()) as { created: boolean };
    assert.equal(b2.created, false);
  });
});

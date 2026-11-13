/**
 * POST /api/v1/knowledge/materials (K22 write residual).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { GET, POST } from '../src/app/api/v1/knowledge/materials/route.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const waveRoot = path.resolve(here, '../../..');
const testDb = path.join(os.tmpdir(), `k22-materials-write-${Date.now()}.db`);
const REG_KEY = 'test-reg-key-k22';

before(() => {
  process.env.KNOWLEDGE_DB_PATH = testDb;
  process.env.AGENT_REGISTRATION_KEY = REG_KEY;
  for (const p of [testDb, testDb + '-wal', testDb + '-shm']) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ok */
    }
  }
  return import('../../../src/lib/knowledge-db/migrate.ts').then(
    ({ migrateKnowledgeDb }) => {
      migrateKnowledgeDb({ root: waveRoot, dbPath: testDb });
    },
  );
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

describe('POST knowledge materials write (K22)', () => {
  it('401 without registration key', async () => {
    const res = await POST(
      new Request('http://localhost/api/v1/knowledge/materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'mat:noauth', name: 'No Auth' }),
      }),
    );
    assert.equal(res.status, 401);
  });

  it('creates material claim with valid key; GET lists it', async () => {
    const body = {
      id: 'mat:k22-route-demo',
      name: 'K22 Route Demo',
      categoryId: 'k22-route',
      kind: 'other',
      properties: [
        { key: 'density_kg_m3', unit: 'kg/m^3', valueNum: 42 }, // gitleaks:allow -- numeric material property identifier, not a credential.
      ],
    };
    const postRes = await POST(
      new Request('http://localhost/api/v1/knowledge/materials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-agent-registration-key': REG_KEY,
        },
        body: JSON.stringify(body),
      }),
    );
    assert.equal(postRes.status, 201);
    const postJson = (await postRes.json()) as {
      ok: boolean;
      created: boolean;
      claimId: string;
      item: { id: string; name: string };
    };
    assert.equal(postJson.ok, true);
    assert.equal(postJson.created, true);
    assert.equal(postJson.item.id, 'mat:k22-route-demo');
    assert.ok(postJson.claimId.includes('sim.material'));

    const getRes = await GET(
      new Request(
        'http://localhost/api/v1/knowledge/materials?q=k22-route-demo',
      ),
    );
    assert.equal(getRes.status, 200);
    const getJson = (await getRes.json()) as {
      items: Array<{ id: string }>;
      total: number;
    };
    assert.ok(getJson.items.some((m) => m.id === 'mat:k22-route-demo'));

    const claimsRoute = await import('../src/app/api/v1/knowledge/claims/route.ts');
    const claimRoute = await import('../src/app/api/v1/knowledge/claims/[id]/route.ts');
    const claimsUrl = 'http://localhost/api/v1/knowledge/claims?state=all&subjectId=mat:k22-route-demo';
    assert.equal((await claimsRoute.GET(new Request(claimsUrl))).status, 401);
    const headers = { 'x-agent-registration-key': REG_KEY };
    const claimsRes = await claimsRoute.GET(new Request(claimsUrl, { headers }));
    assert.equal(claimsRes.status, 200);
    const claims = await claimsRes.json() as { items: Array<{ id: string }> };
    assert.ok(claims.items.some((claim) => claim.id === postJson.claimId));
    const claimRes = await claimRoute.GET(
      new Request(`http://localhost/api/v1/knowledge/claims/${postJson.claimId}`, { headers }),
      { params: Promise.resolve({ id: postJson.claimId }) },
    );
    assert.equal(claimRes.status, 200);
    assert.equal((await claimRes.json()).item.id, postJson.claimId);
  });
});

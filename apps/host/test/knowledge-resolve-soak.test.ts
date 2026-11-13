/**
 * POST /knowledge/resolve-job parses up to 4MB then runs knowledge.db
 * assembly + acceptJobSpec validation, and the K18 write key is optional
 * (open when unset). GET /publications/[id]/download re-reads the bundle
 * and re-verifies its digest per request — unauthenticated for public
 * bundles. Both were reachable with no rate budget at all. Each now has a
 * 60/min per-IP bucket checked before any body/disk work.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let dir = '';
const previousEnv = new Map(
  ['TASK_DB_PATH', 'KNOWLEDGE_DB_PATH', 'NODE_ENV', 'TASK_API_KEY', 'KNOWLEDGE_WRITE_API_KEY', 'KNOWLEDGE_WRITE_KEY', 'AGENT_REGISTRATION_KEY']
    .map((key) => [key, process.env[key]]),
);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-resolve-soak-'));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
  const knowledgeDb = path.join(dir, 'knowledge.db');
  process.env.KNOWLEDGE_DB_PATH = knowledgeDb;
  Object.assign(process.env, { NODE_ENV: 'test' });
  // Exercise the open path: no write key configured → resolve-job is open.
  delete process.env.TASK_API_KEY;
  delete process.env.KNOWLEDGE_WRITE_API_KEY;
  delete process.env.KNOWLEDGE_WRITE_KEY;
  delete process.env.AGENT_REGISTRATION_KEY;

  // Allowed calls still enter knowledge.db before they return the expected
  // no-pack 4xx. Pin it to an initialized temp DB so the cap test never relies
  // on an ambient path or a checked-out data/ directory; otherwise SQLITE_CANTOPEN
  // becomes a 500 and looks like a rate-limit failure.
  const { migrateKnowledgeDb } = await import('../../../src/lib/knowledge-db/migrate.ts');
  migrateKnowledgeDb({ dbPath: knowledgeDb, root: repoRoot });
});

after(() => {
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

const fromIp = (ip: string) => ({ 'cf-connecting-ip': ip });

describe('resolve-job assembly cap', { concurrency: false }, () => {
  it('70 resolves from one IP shed after 60; a second IP keeps its bucket', async () => {
    const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    const { POST } = await import('../src/app/api/v1/knowledge/resolve-job/route.ts');
    const resolve = (ip: string) => POST(new Request('http://localhost/api/v1/knowledge/resolve-job', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...fromIp(ip) },
      // A valid JSON body with an invalid kind reaches route validation but
      // stops before opening the knowledge DB. This soak tests the pre-work
      // rate-limit boundary, so its result must not depend on DB fixtures.
      body: JSON.stringify({ kind: '' }),
    }));

    let allowed = 0;
    let shed = 0;
    for (let i = 0; i < 70; i++) {
      const res = await resolve('203.0.113.10');
      if (res.status === 429) {
        shed++;
        assert.ok(Number(res.headers.get('retry-after')) >= 1);
      } else {
        // Allowed calls reach request validation (400); only calls beyond
        // the 60/min budget are shed before body work.
        assert.equal(res.status, 400);
        allowed++;
      }
    }
    assert.equal(allowed, 60);
    assert.equal(shed, 10);

    const other = await resolve('203.0.113.11');
    assert.notEqual(other.status, 429);
  });
});

describe('publication download cap', { concurrency: false }, () => {
  it('70 downloads from one IP shed after 60, before the id check', async () => {
    const { resetRateLimitsForTests } = await import('../src/lib/rate-limit.ts');
    resetRateLimitsForTests();
    const { GET } = await import('../src/app/api/v1/publications/[publicId]/download/route.ts');
    const dl = (ip: string) => GET(
      new Request('http://localhost/api/v1/publications/not-a-real-id/download', { headers: fromIp(ip) }),
      { params: Promise.resolve({ publicId: 'not-a-real-id' }) },
    );

    let allowed = 0;
    let shed = 0;
    for (let i = 0; i < 70; i++) {
      const res = await dl('198.51.100.7');
      if (res.status === 429) {
        shed++;
        assert.ok(Number(res.headers.get('retry-after')) >= 1);
      } else {
        // Saturated cap sheds before isPlausiblePublicId — allowed calls
        // reach the id check and fail honestly with 400.
        assert.equal(res.status, 400);
        allowed++;
      }
    }
    assert.equal(allowed, 60);
    assert.equal(shed, 10);

    const other = await dl('198.51.100.8');
    assert.equal(other.status, 400);
  });
});

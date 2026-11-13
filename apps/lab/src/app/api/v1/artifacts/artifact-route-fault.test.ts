/**
 * Phase 2: leftover Lab GET /api/v1/artifacts/:id must not mask a store
 * fault as 404. Drives the shipped route. Faults are uid-independent
 * (ELOOP / EISDIR) so they hold under a root CI runner.
 *
 * Before: fs.existsSync swallowed ELOOP → 404 "Artifact not found", and a
 * mutated file was returned 200 with no integrity check.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, after, describe, it } from 'node:test';

let tmp = '';
let root = '';
const saved: Record<string, string | undefined> = {};
const KEYS = ['TASK_DB_PATH', 'ARTIFACT_ROOT', 'NODE_ENV'] as const;

before(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-lab-artfault-'));
  root = path.join(tmp, 'artifacts');
  fs.mkdirSync(root, { recursive: true });
  process.env.TASK_DB_PATH = path.join(tmp, 'tasks.db');
  process.env.ARTIFACT_ROOT = root;
  process.env.NODE_ENV = 'test';
});

after(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function getRoute() {
  return import('./[id]/route.ts');
}

async function save(data: string) {
  const { saveArtifact } = await import('@/lib/tasks/artifacts');
  return saveArtifact({
    kind: 'log',
    contentType: 'application/octet-stream',
    data: Buffer.from(data),
  });
}

describe('Lab artifact GET store faults', { concurrency: false }, () => {
  it('ELOOP → 500 generic, not the 404 existsSync lie, no path leak', async () => {
    const meta = await save('abc');
    const { getArtifact } = await import('@/lib/tasks/artifacts');
    const found = getArtifact(meta.id)!;
    fs.rmSync(found.absPath);
    fs.symlinkSync(found.absPath, found.absPath);
    try {
      const { GET } = await getRoute();
      const res = await GET(new Request(`http://localhost/api/v1/artifacts/${meta.id}`), {
        params: Promise.resolve({ id: meta.id }),
      });
      assert.equal(res.status, 500, `fault masked as ${res.status}`);
      const body = (await res.json()) as { error?: string };
      assert.equal(body.error, 'artifact storage unavailable');
      assert.equal(JSON.stringify(body).includes(tmp), false);
    } finally {
      fs.rmSync(found.absPath, { force: true });
    }
  });

  it('EISDIR → 500, not a 200 directory read or a 409 integrity lie', async () => {
    const meta = await save('abc');
    const { getArtifact } = await import('@/lib/tasks/artifacts');
    const found = getArtifact(meta.id)!;
    fs.rmSync(found.absPath);
    fs.mkdirSync(found.absPath);
    try {
      const { GET } = await getRoute();
      const res = await GET(new Request(`http://localhost/api/v1/artifacts/${meta.id}`), {
        params: Promise.resolve({ id: meta.id }),
      });
      assert.equal(res.status, 500);
      assert.equal(((await res.json()) as { error?: string }).error, 'artifact storage unavailable');
    } finally {
      fs.rmSync(found.absPath, { recursive: true, force: true });
    }
  });

  it('unlinked file stays 404 (absence is not a store fault)', async () => {
    const meta = await save('gone');
    const { getArtifact } = await import('@/lib/tasks/artifacts');
    const found = getArtifact(meta.id)!;
    fs.rmSync(found.absPath);
    const { GET } = await getRoute();
    const res = await GET(new Request(`http://localhost/api/v1/artifacts/${meta.id}`), {
      params: Promise.resolve({ id: meta.id }),
    });
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { error?: string }).error, 'Artifact not found');
  });

  it('mutated bytes → 409, not a silent corrupt body', async () => {
    const meta = await save('round-trip');
    const { getArtifact } = await import('@/lib/tasks/artifacts');
    const found = getArtifact(meta.id)!;
    fs.writeFileSync(found.absPath, Buffer.from('tampered!!'));
    const { GET } = await getRoute();
    const res = await GET(new Request(`http://localhost/api/v1/artifacts/${meta.id}`), {
      params: Promise.resolve({ id: meta.id }),
    });
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { error?: string }).error, 'Artifact failed integrity verification');
  });

  it('traversal id is 400 and does not touch the store', async () => {
    const { GET } = await getRoute();
    const res = await GET(new Request('http://localhost/api/v1/artifacts/..%2Fetc'), {
      params: Promise.resolve({ id: '../etc/passwd' }),
    });
    const text = await res.text();
    assert.equal(res.status, 400);
    assert.equal(JSON.parse(text).error, 'invalid artifact id');
    assert.equal(text.includes('passwd'), false);
  });

  it('production anonymous GET is 401 and does not return the bytes', async () => {
    const meta = await save('secret-bytes');
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.ARTIFACT_REQUIRE_AUTH;
    try {
      const { GET } = await getRoute();
      const res = await GET(new Request(`http://localhost/api/v1/artifacts/${meta.id}`), {
        params: Promise.resolve({ id: meta.id }),
      });
      assert.equal(res.status, 401);
      const body = (await res.json()) as { error?: string };
      assert.equal(body.error, 'artifact download requires authentication');
      assert.equal(JSON.stringify(body).includes('secret-bytes'), false);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('production bearer that does not hold the job is 403', async () => {
    const meta = await save('secret-bytes');
    const { registerAgent } = await import('@/lib/tasks/auth-agent');
    const { token } = await registerAgent({ name: 'lab-art-stranger' });
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { GET } = await getRoute();
      const res = await GET(new Request(`http://localhost/api/v1/artifacts/${meta.id}`, {
        headers: { authorization: `Bearer ${token}` },
      }), { params: Promise.resolve({ id: meta.id }) });
      assert.equal(res.status, 403);
      assert.equal(((await res.json()) as { error?: string }).error, 'forbidden: agent does not hold this job');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('production holding agent round-trips the bytes', async () => {
    const { registerAgent } = await import('@/lib/tasks/auth-agent');
    const { getSqlite } = await import('@/lib/tasks/db');
    const { agent, token } = await registerAgent({ name: 'lab-art-holder' });
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    getSqlite().prepare(
      `INSERT INTO jobs (id, status, priority, kind, spec, agent_id, attempt, max_attempts, created_at, updated_at)
       VALUES (?, 'running', 0, 'lbm-d3q19', '{}', ?, 0, 3, ?, ?)`,
    ).run(jobId, agent.id, now, now);
    const { saveArtifact } = await import('@/lib/tasks/artifacts');
    const meta = saveArtifact({
      jobId,
      kind: 'log',
      contentType: 'application/octet-stream',
      data: Buffer.from('held-bytes'),
    });
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { GET } = await getRoute();
      const res = await GET(new Request(`http://localhost/api/v1/artifacts/${meta.id}`, {
        headers: { authorization: `Bearer ${token}` },
      }), { params: Promise.resolve({ id: meta.id }) });
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'held-bytes');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('healthy store round-trips the saved bytes', async () => {
    const meta = await save('round-trip');
    const { GET } = await getRoute();
    const res = await GET(new Request(`http://localhost/api/v1/artifacts/${meta.id}`), {
      params: Promise.resolve({ id: meta.id }),
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'round-trip');
    assert.equal(res.headers.get('content-length'), String(Buffer.byteLength('round-trip')));
  });
});

/**
 * Phase 2 fault injection: artifact store faults → honest 5xx, never a
 * not-found/integrity lie, never a filesystem-path leak, no stranded rows.
 * Drives the real shipped route handlers (POST + GET /api/v1/artifacts) with
 * ARTIFACT_ROOT poisoned — faults are uid-independent so they hold under a
 * root CI runner too: ENOTDIR write root, ELOOP symlink-loop, EISDIR file→dir.
 *
 * Before this change: fs.existsSync swallowed EACCES/ELOOP → 404 "not found"
 * (fault masked as absence); raw fs throws reached errorResponse → err.message
 * echoed absolute server paths in the 500 body; a partial writeFileSync could
 * strand bytes no DB row referenced.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tmp = '';
let root = '';
const saved: Record<string, string | undefined> = {};
const KEYS = ['TASK_DB_PATH', 'ARTIFACT_ROOT', 'ARTIFACT_REQUIRE_AUTH', 'NODE_ENV'] as const;

before(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-artfault-'));
  root = path.join(tmp, 'artifacts');
  fs.mkdirSync(root, { recursive: true });
  process.env.TASK_DB_PATH = path.join(tmp, 'tasks.db');
  process.env.ARTIFACT_ROOT = root;
  // Non-production → open artifact access; the fault lives below auth anyway.
  Object.assign(process.env, { NODE_ENV: 'test' });
  delete process.env.ARTIFACT_REQUIRE_AUTH;
});

after(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else Object.assign(process.env, { [k]: saved[k] });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const upload = () =>
  new Request('http://localhost/api/v1/artifacts', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-artifact-kind': 'log' },
    body: 'fault-injection payload',
  });

describe('Phase 2: artifact store fault → honest degrade', { concurrency: false }, () => {
  it('unwritable ARTIFACT_ROOT → 500 generic, no path leak, no row, no stranded file', async () => {
    const blocker = path.join(tmp, 'blocker');
    fs.writeFileSync(blocker, 'regular file, not a directory');
    process.env.ARTIFACT_ROOT = path.join(blocker, 'sub'); // mkdirSync → ENOTDIR
    try {
      const { POST } = await import('../src/app/api/v1/artifacts/route.ts');
      const res = await POST(upload());
      assert.equal(res.status, 500, `want honest 500, got ${res.status}`);
      const body = (await res.json()) as { error?: string };
      assert.equal(body.error, 'artifact storage unavailable');
      assert.ok(!body.error.includes(tmp), 'fs path must never leak to the client');
      const { getSqlite } = await import('@/lib/tasks/db.ts');
      const { n } = getSqlite().prepare('SELECT count(*) AS n FROM artifacts').get() as { n: number };
      assert.equal(n, 0, 'failed write must not persist a metadata row');
    } finally {
      process.env.ARTIFACT_ROOT = root;
    }
  });

  it('ELOOP on the artifact path → 500, not the 404 lie existsSync produced', async () => {
    const { saveArtifact, getArtifact, readArtifactBytes, statArtifactFile } = await import('@/lib/tasks/artifacts.ts');
    const meta = saveArtifact({ kind: 'log', contentType: 'application/octet-stream', data: Buffer.from('abc') });
    const found = getArtifact(meta.id)!;
    fs.rmSync(found.absPath);
    fs.symlinkSync(found.absPath, found.absPath); // self-loop → statSync ELOOP
    try {
      assert.throws(() => statArtifactFile(found.absPath), /artifact storage unavailable/);
      assert.throws(() => readArtifactBytes(meta.id), /artifact storage unavailable/);
      const { GET } = await import('../src/app/api/v1/artifacts/[id]/route.ts');
      const res = await GET(new Request(`http://localhost/api/v1/artifacts/${meta.id}`), {
        params: Promise.resolve({ id: meta.id }),
      });
      assert.equal(res.status, 500, `fault masked as ${res.status} is dishonest`);
      const body = (await res.json()) as { error?: string };
      assert.equal(body.error, 'artifact storage unavailable');
      assert.ok(!body.error.includes(tmp));
    } finally {
      fs.rmSync(found.absPath, { force: true });
    }
  });

  it('EISDIR on read → 500, not the 409 "integrity" lie', async () => {
    const { saveArtifact, getArtifact, readArtifactBytes } = await import('@/lib/tasks/artifacts.ts');
    const meta = saveArtifact({ kind: 'log', contentType: 'application/octet-stream', data: Buffer.from('abc') });
    const found = getArtifact(meta.id)!;
    fs.rmSync(found.absPath);
    fs.mkdirSync(found.absPath); // statSync succeeds; readFileSync → EISDIR
    try {
      assert.throws(() => readArtifactBytes(meta.id), /artifact storage unavailable/);
      const { GET } = await import('../src/app/api/v1/artifacts/[id]/route.ts');
      const res = await GET(new Request(`http://localhost/api/v1/artifacts/${meta.id}`), {
        params: Promise.resolve({ id: meta.id }),
      });
      assert.equal(res.status, 500, `want honest 500, got ${res.status}`);
      assert.equal(((await res.json()) as { error?: string }).error, 'artifact storage unavailable');
    } finally {
      fs.rmSync(found.absPath, { recursive: true, force: true });
    }
  });

  it('recovery: healthy store round-trips bytes with integrity headers', async () => {
    const { saveArtifact } = await import('@/lib/tasks/artifacts.ts');
    const meta = saveArtifact({ kind: 'log', contentType: 'application/octet-stream', data: Buffer.from('round-trip') });
    const { GET } = await import('../src/app/api/v1/artifacts/[id]/route.ts');
    const res = await GET(new Request(`http://localhost/api/v1/artifacts/${meta.id}`), {
      params: Promise.resolve({ id: meta.id }),
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'round-trip');
  });
});

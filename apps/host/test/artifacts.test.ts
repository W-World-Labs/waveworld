/**
 * Artifact storage: project_id/owner, size limit 413, path safety, list/auth helpers,
 * project model source=artifact binding (cross-project reject).
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const waveRoot = path.resolve(here, '../../..');
const testDb = path.join(waveRoot, 'data', 'tasks-test-artifacts.db');
const testRoot = path.join(waveRoot, 'data', 'artifacts-test');

before(() => {
  process.env.TASK_DB_PATH = testDb;
  process.env.ARTIFACT_ROOT = testRoot;
  process.env.ARTIFACT_MAX_BYTES = String(1024);
  Object.assign(process.env, { NODE_ENV: 'test' });
  delete process.env.ARTIFACT_REQUIRE_AUTH;
  delete process.env.MAX_ARTIFACT_BYTES;
  for (const p of [testDb, testDb + '-wal', testDb + '-shm']) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ok */
    }
  }
  fs.rmSync(testRoot, { recursive: true, force: true });
  fs.mkdirSync(testRoot, { recursive: true });
});

describe('artifacts storage + project scope', { concurrency: false }, () => {
  it('saveArtifact stores projectId/owner; list by project; disk under ARTIFACT_ROOT', async () => {
    const {
      saveArtifact,
      listArtifacts,
      getArtifact,
      readArtifactBytes,
      getArtifactMaxBytes,
    } = await import('@/lib/tasks/artifacts.ts');

    assert.equal(getArtifactMaxBytes(), 1024);

    const meta = saveArtifact({
      kind: 'mesh',
      contentType: 'model/stl',
      projectId: 'proj-a',
      ownerUserId: 'user-alice',
      jobId: 'job-1',
      data: Buffer.from('solid test'),
    });
    assert.ok(meta.id);
    assert.equal(meta.projectId, 'proj-a');
    assert.equal(meta.ownerUserId, 'user-alice');
    assert.equal(meta.jobId, 'job-1');
    assert.ok(meta.bytes > 0);
    assert.equal(meta.sha256, createHash('sha256').update('solid test').digest('hex'));

    const found = getArtifact(meta.id);
    assert.ok(found);
    assert.ok(found!.absPath.startsWith(path.resolve(testRoot)));
    assert.ok(fs.existsSync(found!.absPath));
    // no path traversal in key
    assert.ok(!found!.meta.storageKey.includes('..'));

    const byProject = listArtifacts({ projectId: 'proj-a' });
    assert.ok(byProject.some((a) => a.id === meta.id));
    const byOther = listArtifacts({ projectId: 'proj-other' });
    assert.ok(!byOther.some((a) => a.id === meta.id));

    const bytes = readArtifactBytes(meta.id);
    assert.ok(bytes);
    assert.equal(bytes!.data.toString(), 'solid test');

    fs.writeFileSync(found!.absPath, 'tampered!');
    assert.equal(readArtifactBytes(meta.id), null, 'digest verification rejects modified disk bytes');
  });

  it('rejects oversized upload with 413', async () => {
    const { saveArtifact } = await import('@/lib/tasks/artifacts.ts');
    const { HttpError } = await import('@/lib/tasks/http.ts');
    const big = Buffer.alloc(2048, 1);
    try {
      saveArtifact({
        kind: 'log',
        contentType: 'application/octet-stream',
        data: big,
      });
      assert.fail('expected size error');
    } catch (err) {
      assert.ok(err instanceof HttpError);
      assert.equal((err as InstanceType<typeof HttpError>).status, 413);
      assert.match((err as Error).message, /ARTIFACT_MAX_BYTES|too large/i);
    }
  });

  it('safePathSegment blocks traversal; getArtifact rejects bad ids', async () => {
    const { safePathSegment, getArtifact, saveArtifact } = await import(
      '@/lib/tasks/artifacts.ts'
    );
    assert.equal(safePathSegment('../etc/passwd', 'orphan'), 'orphan');
    assert.equal(safePathSegment('a/b', 'orphan'), 'orphan');
    assert.equal(safePathSegment('good-id_1', 'orphan'), 'good-id_1');

    assert.equal(getArtifact('../x'), null);
    assert.equal(getArtifact('a/b'), null);

    const meta = saveArtifact({
      kind: 'log',
      contentType: 'text/plain',
      projectId: '../../../evil',
      data: Buffer.from('x'),
    });
    // unsafe project id must not escape ARTIFACT_ROOT
    const found = getArtifact(meta.id);
    assert.ok(found);
    assert.ok(found!.absPath.startsWith(path.resolve(testRoot)));
    assert.ok(!found!.absPath.includes('evil') || found!.absPath.startsWith(path.resolve(testRoot)));
  });

  it('userMayAccessArtifact: project / owner / legacy rules', async () => {
    const mod = await import('@/lib/tasks/artifacts.ts');
    const base = {
      id: 'a1',
      jobId: null as string | null,
      kind: 'log',
      storageKey: 'orphan/a1.bin',
      contentType: 'text/plain',
      bytes: 1,
      sha256: null,
      createdAt: new Date().toISOString(),
    };

    // project-scoped
    assert.equal(
      mod.userMayAccessArtifact(
        { ...base, projectId: 'p1', ownerUserId: 'u1' },
        { id: 'u2' },
        'viewer'
      ),
      true
    );
    assert.equal(
      mod.userMayAccessArtifact(
        { ...base, projectId: 'p1', ownerUserId: 'u1' },
        { id: 'u2' },
        null
      ),
      false
    );

    // owner-scoped no project
    assert.equal(
      mod.userMayAccessArtifact(
        { ...base, projectId: null, ownerUserId: 'u1' },
        { id: 'u1' },
        null
      ),
      true
    );
    assert.equal(
      mod.userMayAccessArtifact(
        { ...base, projectId: null, ownerUserId: 'u1' },
        { id: 'u2' },
        null
      ),
      false
    );

    // orphan / unscoped: not world-readable (#67)
    assert.equal(
      mod.userMayAccessArtifact(
        { ...base, projectId: null, ownerUserId: null },
        { id: 'anyone' },
        null
      ),
      false
    );
  });

  it('allowOpenArtifactAccess false when ARTIFACT_REQUIRE_AUTH or production', async () => {
    const mod = await import('@/lib/tasks/artifacts.ts');
    const prev = process.env.NODE_ENV;
    const prevReq = process.env.ARTIFACT_REQUIRE_AUTH;

    Object.assign(process.env, { NODE_ENV: 'test' });
    delete process.env.ARTIFACT_REQUIRE_AUTH;
    assert.equal(mod.allowOpenArtifactAccess(), true);

    process.env.ARTIFACT_REQUIRE_AUTH = '1';
    assert.equal(mod.allowOpenArtifactAccess(), false);

    delete process.env.ARTIFACT_REQUIRE_AUTH;
    Object.assign(process.env, { NODE_ENV: 'production' });
    assert.equal(mod.allowOpenArtifactAccess(), false);

    Object.assign(process.env, { NODE_ENV: prev });
    if (prevReq === undefined) delete process.env.ARTIFACT_REQUIRE_AUTH;
    else process.env.ARTIFACT_REQUIRE_AUTH = prevReq;
  });

  it('project model source=artifact binds same project; rejects cross-project', async () => {
    const { createProject, addProjectModel } = await import('../src/lib/project-service.ts');
    const { saveArtifact } = await import('@/lib/tasks/artifacts.ts');

    const owner = { id: 'user-alice', workspaceId: 'ws-1', name: 'Alice' };
    const bob = { id: 'user-bob', workspaceId: 'ws-1', name: 'Bob' };

    const p1 = await createProject(owner, { name: 'P1' });
    const p2 = await createProject(bob, { name: 'P2' });

    const artP1 = saveArtifact({
      kind: 'mesh',
      contentType: 'model/stl',
      projectId: p1.id,
      ownerUserId: owner.id,
      data: Buffer.from('mesh-p1'),
    });
    const artP2 = saveArtifact({
      kind: 'mesh',
      contentType: 'model/stl',
      projectId: p2.id,
      ownerUserId: bob.id,
      data: Buffer.from('mesh-p2'),
    });

    const ok = await addProjectModel(p1.id, owner.id, {
      name: 'from-artifact',
      source: 'artifact',
      artifactId: artP1.id,
      isActive: true,
    });
    assert.equal(ok.artifactId, artP1.id);
    assert.equal(ok.source, 'artifact');

    await assert.rejects(
      () =>
        addProjectModel(p1.id, owner.id, {
          name: 'cross',
          source: 'artifact',
          artifactId: artP2.id,
        }),
      (err: Error & { status?: number }) => {
        assert.equal(err.status, 403);
        assert.match(err.message, /different project/i);
        return true;
      }
    );

    await assert.rejects(
      () =>
        addProjectModel(p1.id, owner.id, {
          name: 'missing',
          source: 'artifact',
        }),
      (err: Error & { status?: number }) => {
        assert.equal(err.status, 400);
        return true;
      }
    );

    // unscoped artifact gets stamped with project on bind
    const orphan = saveArtifact({
      kind: 'mesh',
      contentType: 'model/stl',
      data: Buffer.from('orphan-mesh'),
    });
    assert.equal(orphan.projectId, null);
    await addProjectModel(p1.id, owner.id, {
      name: 'orphan-bind',
      source: 'artifact',
      artifactId: orphan.id,
    });
    const { listArtifacts } = await import('@/lib/tasks/artifacts.ts');
    const stamped = listArtifacts({ projectId: p1.id }).find((a) => a.id === orphan.id);
    assert.ok(stamped);
    assert.equal(stamped!.projectId, p1.id);
  });
});

describe('terminal-job artifact GC', { concurrency: false }, () => {
  it('sweeps failed/cancelled-job artifacts past retention; honours disable + batch bound', async () => {
    const { getSqlite } = await import('@/lib/tasks/db.ts');
    const { saveArtifact, sweepTerminalJobArtifacts, listArtifacts } = await import(
      '@/lib/tasks/artifacts.ts'
    );
    const db = getSqlite();
    const insertJob = db.prepare(
      `INSERT INTO jobs (id,name,status,priority,kind,spec,result,error,created_by,agent_id,project_id,lease_expires_at,attempt,max_attempts,progress,created_at,updated_at,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    const spec = JSON.stringify({ schemaVersion: 1, kind: 'lbm-d3q19', parameters: {}, run: { maxSteps: 1 }, outputs: { forces: false, history: false } });
    const iso = new Date().toISOString();
    insertJob.run('gc-fail', 'f', 'failed', 0, 'lbm-d3q19', spec, null, 'x', null, null, null, null, 1, 3, null, iso, iso, iso, iso);
    insertJob.run('gc-ok', 'o', 'succeeded', 0, 'lbm-d3q19', spec, '{}', null, null, null, null, null, 0, 3, null, iso, iso, iso, iso);

    const dead1 = saveArtifact({ jobId: 'gc-fail', kind: 'flow', contentType: 'application/octet-stream', data: Buffer.from('dead-1') });
    const dead2 = saveArtifact({ jobId: 'gc-fail', kind: 'flow', contentType: 'application/octet-stream', data: Buffer.from('dead-2') });
    const live = saveArtifact({ jobId: 'gc-ok', kind: 'flow', contentType: 'application/octet-stream', data: Buffer.from('live') });
    const orphan = saveArtifact({ kind: 'mesh', contentType: 'model/stl', data: Buffer.from('orph') });
    const abs = (key: string) => path.join(testRoot, key);
    assert.ok(fs.existsSync(abs(dead1.storageKey)));

    // Retention disabled → no-op.
    process.env.ARTIFACT_RETENTION_SECONDS = '0';
    assert.equal(sweepTerminalJobArtifacts().deletedRows, 0);
    // Fresh rows are inside the window.
    process.env.ARTIFACT_RETENTION_SECONDS = '3600';
    assert.equal(sweepTerminalJobArtifacts().deletedRows, 0);
    // Backdate everything past the window; only dead-job rows may go.
    db.prepare(`UPDATE artifacts SET created_at = ?`).run(new Date(Date.now() - 2 * 3600_000).toISOString());
    // Batch bound: one row per sweep.
    process.env.ARTIFACT_GC_MAX_DELETE = '1';
    let r = sweepTerminalJobArtifacts();
    assert.equal(r.deletedRows, 1);
    process.env.ARTIFACT_GC_MAX_DELETE = '256';
    r = sweepTerminalJobArtifacts();
    assert.equal(r.deletedRows, 1, 'second dead artifact reclaimed');
    assert.ok(!fs.existsSync(abs(dead1.storageKey)));
    assert.ok(!fs.existsSync(abs(dead2.storageKey)));
    assert.ok(fs.existsSync(abs(live.storageKey)), 'succeeded-job artifact retained');
    assert.ok(fs.existsSync(abs(orphan.storageKey)), 'orphan artifact retained');
    assert.equal(listArtifacts({ jobId: 'gc-fail' }).length, 0);
    assert.equal(r.bytesFreed, Buffer.from('dead-2').byteLength);
    delete process.env.ARTIFACT_RETENTION_SECONDS;
    delete process.env.ARTIFACT_GC_MAX_DELETE;
  });
});

describe('orphan artifact file GC', { concurrency: false }, () => {
  it('reclaims row-less files past retention; keeps referenced + in-flight files; throttles', async () => {
    const { saveArtifact, sweepOrphanedArtifactFiles, listArtifacts } = await import(
      '@/lib/tasks/artifacts.ts'
    );
    process.env.ARTIFACT_RETENTION_SECONDS = '3600';
    process.env.ARTIFACT_GC_INTERVAL_SECONDS = '3600';
    // A far-future sweep clock makes the throttle deterministic and ages all
    // pre-existing test files past the window — they all have rows, so the
    // only deletable files are the row-less ones this test creates.
    const sweepNow = Date.now() + 30 * 86400_000;
    const setMtime = (abs: string, msAgo: number) => {
      const t = new Date(sweepNow - msAgo);
      fs.utimesSync(abs, t, t);
    };

    const ghostDir = path.join(testRoot, 'ghost-job');
    fs.mkdirSync(ghostDir, { recursive: true });
    const orphanOld = path.join(ghostDir, 'orphan-old.bin');
    fs.writeFileSync(orphanOld, 'orphan-payload');
    setMtime(orphanOld, 7200_000);
    const orphanFresh = path.join(ghostDir, 'orphan-fresh.bin');
    fs.writeFileSync(orphanFresh, 'in-flight');
    setMtime(orphanFresh, 1800_000); // inside the window: write→insert gap safety

    const kept = saveArtifact({ jobId: 'gc-ok', kind: 'flow', contentType: 'application/octet-stream', data: Buffer.from('kept') });
    const keptAbs = path.join(testRoot, kept.storageKey);
    setMtime(keptAbs, 7200_000); // old but row-referenced → retained

    const r1 = sweepOrphanedArtifactFiles(sweepNow);
    assert.ok(r1);
    assert.ok(r1!.scanned > 0);
    assert.ok(!fs.existsSync(orphanOld), 'old row-less file reclaimed');
    assert.ok(fs.existsSync(orphanFresh), 'in-window orphan survives (in-flight gap)');
    assert.ok(fs.existsSync(keptAbs), 'row-referenced file survives past window');
    assert.ok(r1!.deleted >= 1);
    assert.ok(!fs.existsSync(ghostDir) || fs.readdirSync(ghostDir).length === 1, 'dir pruned except fresh orphan');

    // Throttle: a second call inside the interval is skipped (null), one past it sweeps.
    assert.equal(sweepOrphanedArtifactFiles(sweepNow + 60_000), null);
    const r2 = sweepOrphanedArtifactFiles(sweepNow + 3601_000);
    assert.ok(r2);
    delete process.env.ARTIFACT_RETENTION_SECONDS;
    delete process.env.ARTIFACT_GC_INTERVAL_SECONDS;
  });
});

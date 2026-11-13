import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

const savedEnv = { ...process.env };
let dir: string;
before(() => {
  const root = path.resolve(__dirname, '../../../.runtime');
  fs.mkdirSync(root, { recursive: true });
  dir = fs.mkdtempSync(path.join(root, 'artifact-model-retention-'));
  Object.assign(process.env, {
    TASK_DB_PATH: path.join(dir, 'tasks.db'), ARTIFACT_ROOT: path.join(dir, 'artifacts'),
    ARTIFACT_RETENTION_SECONDS: '3600', ARTIFACT_GC_MAX_DELETE: '1',
  });
});
after(() => {
  for (const key of ['TASK_DB_PATH', 'ARTIFACT_ROOT', 'ARTIFACT_RETENTION_SECONDS', 'ARTIFACT_GC_MAX_DELETE']) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('GC retains model inputs reused by jobs and project models, then reclaims them after reference removal', async () => {
  const { getSqlite } = await import('../src/lib/tasks/db');
  const { saveArtifact, readArtifactBytes, sweepTerminalJobArtifacts } = await import('../src/lib/tasks/artifacts');
  const db = getSqlite();
  const owner = { id: 'retention-owner', workspaceId: 'retention' };
  const old = new Date(Date.now() - 7200_000).toISOString();
  const insertJob = db.prepare(`INSERT INTO jobs (id, status, kind, spec, created_at, updated_at)
    VALUES (?, ?, 'lbm-d3q19', ?, ?, ?)`);
  insertJob.run('failed-source', 'failed', '{}', old, old);
  const make = (text: string) => {
    const artifact = saveArtifact({ jobId: 'failed-source', ownerUserId: owner.id, kind: 'mesh', contentType: 'model/stl', data: Buffer.from(text) });
    db.prepare('UPDATE artifacts SET created_at = ? WHERE id = ?').run(old, artifact.id);
    return artifact;
  };
  const jobInput = make('reused job model');
  insertJob.run('queued-consumer', 'queued', JSON.stringify({ model: { source: 'artifact', artifactId: jobInput.id } }), old, old);

  // A fresh task DB need not have the lazily-created project model table yet.
  assert.equal(sweepTerminalJobArtifacts().deletedRows, 0);
  assert.equal(readArtifactBytes(jobInput.id)?.data.toString(), 'reused job model');

  const { createProject, addProjectModel } = await import('../src/lib/project-service');
  const project = await createProject(owner, { name: 'Retained model' });
  const projectInput = make('saved project model');
  const model = await addProjectModel(project.id, owner.id, { name: 'mesh', source: 'artifact', artifactId: projectInput.id });
  const disposable = make('unreferenced output');
  assert.equal(sweepTerminalJobArtifacts().deletedRows, 1, 'protected inputs must not starve the bounded garbage batch');
  assert.equal(readArtifactBytes(disposable.id), null);
  assert.equal(readArtifactBytes(jobInput.id)?.data.toString(), 'reused job model');
  assert.equal(readArtifactBytes(projectInput.id)?.data.toString(), 'saved project model');

  // Completed jobs retain their reproducibility inputs too.
  db.prepare("UPDATE jobs SET status = 'succeeded' WHERE id = 'queued-consumer'").run();
  assert.equal(sweepTerminalJobArtifacts().deletedRows, 0);
  db.prepare("DELETE FROM jobs WHERE id = 'queued-consumer'").run();
  db.prepare('DELETE FROM project_models WHERE id = ?').run(model.id);
  assert.equal(sweepTerminalJobArtifacts().deletedRows, 1);
  assert.equal(sweepTerminalJobArtifacts().deletedRows, 1);
  assert.equal(readArtifactBytes(jobInput.id), null);
  assert.equal(readArtifactBytes(projectInput.id), null);
});

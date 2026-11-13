import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

const savedEnv = { ...process.env };
let dir: string;
before(() => {
  const root = path.resolve(__dirname, '../../../.runtime');
  fs.mkdirSync(root, { recursive: true });
  dir = fs.mkdtempSync(path.join(root, 'project-model-ownership-'));
  Object.assign(process.env, {
    NODE_ENV: 'production', TASK_DB_PATH: path.join(dir, 'tasks.db'), ARTIFACT_ROOT: path.join(dir, 'artifacts'),
  });
});
after(() => {
  for (const key of ['NODE_ENV', 'TASK_DB_PATH', 'ARTIFACT_ROOT', 'ARTIFACT_REQUIRE_AUTH']) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else Object.assign(process.env, { [key]: savedEnv[key] });
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('project model binding cannot take another user\'s personal artifact', async () => {
  const { devLogin } = await import('../src/lib/user-auth');
  const { createProject } = await import('../src/lib/project-service');
  const { saveArtifact, getArtifact } = await import('../src/lib/tasks/artifacts');
  const { POST } = await import('../src/app/api/v1/projects/[id]/models/route');
  const { GET } = await import('../src/app/api/v1/artifacts/[id]/route');
  const alice = await devLogin({ name: 'model-alice', workspaceId: 'models' });
  const bob = await devLogin({ name: 'model-bob', workspaceId: 'models' });
  const project = await createProject(bob.user, { name: 'Bob project' });
  const artifact = saveArtifact({ ownerUserId: alice.user.id, kind: 'mesh', contentType: 'model/stl', data: Buffer.from('private mesh') });
  const download = (token: string) => GET(new Request(`http://host.test/api/v1/artifacts/${artifact.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  }), { params: Promise.resolve({ id: artifact.id }) });
  assert.equal((await download(bob.token)).status, 403);

  const response = await POST(new Request(`http://host.test/api/v1/projects/${project.id}/models`, {
    method: 'POST', headers: { Authorization: `Bearer ${bob.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'stolen mesh', source: 'artifact', artifactId: artifact.id }),
  }), { params: Promise.resolve({ id: project.id }) });
  assert.equal(response.status, 403);
  assert.equal(getArtifact(artifact.id)!.meta.projectId, null, 'rejection must not rescope the artifact');
  assert.equal((await download(bob.token)).status, 403);
  assert.equal((await download(alice.token)).status, 200);
});

test('only the owner may move a personal artifact; ownerless binding fails closed when auth is required', async () => {
  const { createProject, addProjectModel } = await import('../src/lib/project-service');
  const { saveArtifact, getArtifact } = await import('../src/lib/tasks/artifacts');
  const owner = { id: 'model-owner', workspaceId: 'models' };
  const project = await createProject(owner, { name: 'Owned models' });
  const personal = saveArtifact({ ownerUserId: owner.id, kind: 'mesh', contentType: 'model/stl', data: Buffer.from('owned') });
  assert.equal((await addProjectModel(project.id, owner.id, { name: 'owned', source: 'artifact', artifactId: personal.id })).artifactId, personal.id);
  assert.equal(getArtifact(personal.id)!.meta.projectId, project.id);

  const orphan = saveArtifact({ kind: 'mesh', contentType: 'model/stl', data: Buffer.from('unowned') });
  for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'test', ARTIFACT_REQUIRE_AUTH: '1' }]) {
    Object.assign(process.env, env);
    await assert.rejects(addProjectModel(project.id, owner.id, {
      name: 'unowned', source: 'artifact', artifactId: orphan.id,
    }), (err) => (err as { status?: number }).status === 403);
    assert.equal(getArtifact(orphan.id)!.meta.projectId, null);
  }
});

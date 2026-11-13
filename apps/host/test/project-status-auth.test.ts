import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

const savedEnv = { ...process.env };
let dir: string;
before(() => {
  const root = path.resolve(__dirname, '../../../.runtime');
  fs.mkdirSync(root, { recursive: true });
  dir = fs.mkdtempSync(path.join(root, 'project-status-auth-'));
  Object.assign(process.env, { NODE_ENV: 'production', TASK_DB_PATH: path.join(dir, 'tasks.db') });
});
after(() => {
  for (const key of ['NODE_ENV', 'TASK_DB_PATH']) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else Object.assign(process.env, { [key]: savedEnv[key] });
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

async function fixture(name: string) {
  const { devLogin } = await import('../src/lib/user-auth');
  const { createProject, upsertProjectMember } = await import('../src/lib/project-service');
  const owner = await devLogin({ name: `${name}-owner`, workspaceId: 'projects' });
  const editor = await devLogin({ name: `${name}-editor`, workspaceId: 'projects' });
  const project = await createProject(owner.user, { name });
  await upsertProjectMember(project.id, owner.user.id, { userId: editor.user.id, role: 'editor' });
  const ctx = { params: Promise.resolve({ id: project.id }) };
  const request = (token: string, method: string, body?: unknown) => new Request(`http://host.test/api/v1/projects/${project.id}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { owner, editor, project, ctx, request };
}

test('an editor cannot bypass owner-only deletion through project PATCH', async () => {
  const { PATCH, DELETE } = await import('../src/app/api/v1/projects/[id]/route');
  const { getProject } = await import('../src/lib/project-service');
  const { owner, editor, project, ctx, request } = await fixture('delete-policy');
  assert.equal((await DELETE(request(editor.token, 'DELETE'), ctx)).status, 403);
  const response = await PATCH(request(editor.token, 'PATCH', { status: 'deleted' }), ctx);
  assert.notEqual(await getProject(project.id), null, 'PATCH must not delete a project for an editor');
  assert.equal(response.status, 400);
  assert.equal((await PATCH(request(owner.token, 'PATCH', { status: 'deleted' }), ctx)).status, 400);
  assert.equal((await DELETE(request(owner.token, 'DELETE'), ctx)).status, 200);
  assert.equal(await getProject(project.id), null);
});

test('PATCH accepts archive/reactivate and rejects invalid lifecycle values without partial edits', async () => {
  const { PATCH } = await import('../src/app/api/v1/projects/[id]/route');
  const { getProject } = await import('../src/lib/project-service');
  const { editor, project, ctx, request } = await fixture('lifecycle-values');
  for (const status of ['archived', 'active']) {
    assert.equal((await PATCH(request(editor.token, 'PATCH', { status }), ctx)).status, 200);
    assert.equal((await getProject(project.id))!.status, status);
  }
  for (const status of ['deleted', 'unknown', '', null, 42, {}, ['deleted']]) {
    assert.equal((await PATCH(request(editor.token, 'PATCH', { status, name: 'must not be saved' }), ctx)).status, 400);
    const stored = await getProject(project.id);
    assert.equal(stored?.status, 'active');
    assert.equal(stored?.name, project.name);
  }
});

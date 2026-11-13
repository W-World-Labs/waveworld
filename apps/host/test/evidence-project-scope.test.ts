import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const testDb = path.resolve(here, '../../../data/tasks-test-evidence-project.db');

before(() => {
  process.env.TASK_DB_PATH = testDb;
  for (const suffix of ['', '-wal', '-shm']) try { fs.unlinkSync(testDb + suffix); } catch { /* absent */ }
});

function request(url: string, token: string, body?: unknown): Request {
  return new Request(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function pathSpec(source: { kind: 'measured'; evidenceId: string; sha256: string }) {
  return {
    schemaVersion: 1 as const, kind: 'path-experiment' as const,
    parameters: {}, run: { maxSteps: 1 }, outputs: { forces: false, history: false },
    experiment: {
      experimentId: 'project-evidence-path', title: 'Project evidence path',
      materials: [{ id: 'm', name: 'Ir', role: 'sensitizer', source }],
      steps: [{ id: 's', label: 'excitation', mechanism: 'photoexcitation', inputs: [], outputs: [], hypothesis: { status: 'candidate' as const, description: 'candidate', sources: [{ kind: 'assumption' as const, note: 'candidate' }] } }],
      parameters: {}, model: { id: 'photosensitization-rk4', version: '1.0.0' },
      provenance: { createdAt: '2026-01-01T00:00:00.000Z', software: { name: 'WaveWorld', version: 'test' } },
    },
  };
}

describe('project-scoped evidence API authorization', { concurrency: false }, () => {
  it('requires an editor to import/use, lets readers restore, and blocks cross-project references', async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      const { devLogin } = await import('../src/lib/user-auth.ts');
      const { createProject } = await import('../src/lib/project-service.ts');
      const { getSqlite } = await import('@/lib/tasks/db.ts');
      const owner = await devLogin({ name: 'evidence-owner', workspaceId: 'evidence-ws' });
      const editor = await devLogin({ name: 'evidence-editor', workspaceId: 'evidence-ws' });
      const viewer = await devLogin({ name: 'evidence-viewer', workspaceId: 'evidence-ws' });
      const outsider = await devLogin({ name: 'evidence-outsider', workspaceId: 'other-ws' });
      const project = await createProject(owner.user, { name: 'Evidence project' });
      const otherProject = await createProject(editor.user, { name: 'Other project' });
      const now = new Date().toISOString();
      getSqlite().prepare(`INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?)`).run(project.id, editor.user.id, 'editor', now, project.id, viewer.user.id, 'viewer', now);

      const importRoute = await import('../src/app/api/v1/evidence/import/route.ts');
      const body = { kind: 'measured', title: 'Shared trace', format: 'csv', contentBase64: Buffer.from('time,T1\n0,0\n').toString('base64'), projectId: project.id };
      assert.equal((await importRoute.POST(request('http://localhost/api/v1/evidence/import', viewer.token, body))).status, 403);
      const importedResponse = await importRoute.POST(request('http://localhost/api/v1/evidence/import', editor.token, body));
      assert.equal(importedResponse.status, 201);
      const imported = (await importedResponse.json()).evidence as { id: string; sha256: string; projectId: string };
      assert.equal(imported.projectId, project.id);

      const listRoute = await import('../src/app/api/v1/evidence/route.ts');
      const visible = await (await listRoute.GET(request('http://localhost/api/v1/evidence', viewer.token))).json() as { evidence: Array<{ id: string }> };
      assert.ok(visible.evidence.some((item) => item.id === imported.id));
      const hidden = await (await listRoute.GET(request('http://localhost/api/v1/evidence', outsider.token))).json() as { evidence: Array<{ id: string }> };
      assert.ok(!hidden.evidence.some((item) => item.id === imported.id));

      const evidenceRoute = await import('../src/app/api/v1/evidence/[id]/route.ts');
      assert.equal((await evidenceRoute.GET(request(`http://localhost/api/v1/evidence/${imported.id}`, viewer.token), { params: Promise.resolve({ id: imported.id }) })).status, 200);
      assert.equal((await evidenceRoute.GET(request(`http://localhost/api/v1/evidence/${imported.id}`, outsider.token), { params: Promise.resolve({ id: imported.id }) })).status, 403);

      const jobsRoute = await import('../src/app/api/v1/jobs/route.ts');
      const spec = pathSpec({ kind: 'measured', evidenceId: imported.id, sha256: imported.sha256 });
      assert.equal((await jobsRoute.POST(request('http://localhost/api/v1/jobs', viewer.token, { spec, projectId: project.id }))).status, 403);
      assert.equal((await jobsRoute.POST(request('http://localhost/api/v1/jobs', editor.token, { spec, projectId: otherProject.id }))).status, 403);
      const accepted = await jobsRoute.POST(request('http://localhost/api/v1/jobs', editor.token, { spec, projectId: project.id }));
      assert.equal(accepted.status, 201);
      assert.equal(((await accepted.json()).job as { projectId: string }).projectId, project.id);
    } finally {
      Object.assign(process.env, { NODE_ENV: priorNodeEnv });
    }
  });
});

import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const db = path.join(root, 'data/tasks-test-evidence-agent-acl.db');
const artifactRoot = path.join(root, 'data/artifacts-test-evidence-agent-acl');

before(() => {
  process.env.TASK_DB_PATH = db;
  process.env.ARTIFACT_ROOT = artifactRoot;
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(db + suffix); } catch { /* absent */ }
  }
  fs.rmSync(artifactRoot, { recursive: true, force: true });
});

describe('evidence Agent authorization', { concurrency: false }, () => {
  it('does not let a registered agent read personal or project evidence', async () => {
    const previousEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      const { devLogin } = await import('../src/lib/user-auth.ts');
      const { createProject } = await import('../src/lib/project-service.ts');
      const { registerAgent } = await import('../src/lib/tasks/auth-agent.ts');
      const { importEvidence } = await import('../src/lib/tasks/evidence.ts');
      const { GET } = await import('../src/app/api/v1/evidence/[id]/route.ts');
      const owner = await devLogin({ name: 'evidence-acl-owner', workspaceId: 'private-evidence' });
      const outsider = await devLogin({ name: 'evidence-acl-outsider', workspaceId: 'foreign-evidence' });
      const project = await createProject(owner.user, { name: 'Private research' });
      const agent = await registerAgent({ name: 'foreign-evidence-agent' });
      const input = {
        kind: 'literature' as const,
        title: 'Unpublished investigation',
        citation: 'Private laboratory notebook',
        metadata: { confidential: 'Unreleased findings' },
      };
      const personal = importEvidence(input, owner.user.id);
      const shared = importEvidence({ ...input, projectId: project.id }, owner.user.id);
      const get = (id: string, token: string) => GET(new Request(`http://localhost/api/v1/evidence/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      }), { params: Promise.resolve({ id }) });

      for (const evidence of [personal, shared]) {
        const response = await get(evidence.id, agent.token);
        assert.equal(response.status, 403, 'Agent registration must not grant access to private evidence');
        assert.deepEqual(await response.json(), { error: 'forbidden: no access to evidence' });
        assert.equal((await get(evidence.id, outsider.token)).status, 403);
        const authorized = await get(evidence.id, owner.token);
        assert.equal(authorized.status, 200);
        assert.equal((await authorized.json()).evidence.metadata.confidential, input.metadata.confidential);
      }

      // Agent imports have no user/project owner; keep this legacy surface usable.
      const unscoped = importEvidence(input);
      assert.equal((await get(unscoped.id, agent.token)).status, 200);
    } finally {
      if (previousEnv === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
      else Object.assign(process.env, { NODE_ENV: previousEnv });
    }
  });
});

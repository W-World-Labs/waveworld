/**
 * User project CRUD against real project-service + SQLite.
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const waveRoot = path.resolve(here, '../../..');
const testDb = path.join(waveRoot, 'data', 'tasks-test-projects.db');

before(() => {
  process.env.TASK_DB_PATH = testDb;
  for (const p of [testDb, testDb + '-wal', testDb + '-shm']) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ok */
    }
  }
});

describe('project-service (user-owned projects)', () => {
  it('create → list → update → model → attach job → soft delete', async () => {
    const {
      createProject,
      listProjectsForUser,
      listAccessibleProjectIds,
      updateProject,
      addProjectModel,
      getProjectDetail,
      deleteProject,
      attachJobToProject,
      upsertProjectMember,
      removeProjectMember,
      canAccessProject,
    } = await import('../src/lib/project-service.ts');
    const { createJob } = await import('@/lib/tasks/service.ts');
    const { defaultJobSpec } = await import('@/types/task.ts');

    const owner = { id: 'user-alice', workspaceId: 'ws-1', name: 'Alice' };

    const created = await createProject(owner, {
      name: 'Ahmed CFD',
      description: '25° validation',
      settings: { gridPreset: 'fast', inletVelocity: 10 },
    });
    assert.equal(created.name, 'Ahmed CFD');
    assert.equal(created.ownerUserId, owner.id);
    assert.equal(created.status, 'active');
    assert.equal(created.settings.gridPreset, 'fast');

    const editor = await upsertProjectMember(created.id, owner.id, {
      userId: 'user-bob', role: 'editor', userName: 'Bob',
    });
    assert.equal(editor.role, 'editor');
    assert.equal(await canAccessProject(created.id, 'user-bob', 'ws-other'), 'editor');
    await assert.rejects(
      () => upsertProjectMember(created.id, 'user-bob', { userId: 'user-eve', role: 'viewer' }),
      /only owner/
    );
    await assert.rejects(
      () => removeProjectMember(created.id, owner.id, owner.id),
      /owner cannot be removed/
    );

    const listed = await listProjectsForUser({
      userId: owner.id,
      workspaceId: owner.workspaceId,
    });
    assert.ok(listed.some((p) => p.id === created.id));
    assert.ok((await listAccessibleProjectIds(owner.id, owner.workspaceId)).includes(created.id));
    assert.ok((await listAccessibleProjectIds('user-bob', 'ws-other')).includes(created.id));

    const updated = await updateProject(created.id, owner.id, {
      description: 'updated desc',
      settings: { gridPreset: 'standard', tags: ['cfd'] },
    });
    assert.ok(updated);
    assert.equal(updated!.description, 'updated desc');
    assert.equal(updated!.settings.gridPreset, 'standard');

    const model = await addProjectModel(created.id, owner.id, {
      name: 'cylinder',
      source: 'preset',
      presetId: 'cylinder',
      isActive: true,
    });
    assert.equal(model.presetId, 'cylinder');
    assert.equal(model.isActive, true);

    const job = createJob({
      spec: defaultJobSpec({ name: 'proj-job', run: { maxSteps: 5 } }),
      createdBy: owner.id,
    });
    await attachJobToProject(created.id, job.id, owner.id);

    const detail = await getProjectDetail(created.id);
    assert.ok(detail);
    assert.equal(detail!.models.length, 1);
    assert.ok(detail!.recentJobIds.includes(job.id));
    assert.equal(detail!.jobCount, 1);
    assert.equal(detail!.modelCount, 1);

    assert.equal(await removeProjectMember(created.id, owner.id, 'user-bob'), true);
    assert.equal(await canAccessProject(created.id, 'user-bob', 'ws-other'), null);

    // removed user cannot see private project
    const other = await listProjectsForUser({
      userId: 'user-bob',
      workspaceId: 'ws-other',
    });
    assert.ok(!other.some((p) => p.id === created.id));

    const ok = await deleteProject(created.id, owner.id);
    assert.equal(ok, true);
    const after = await listProjectsForUser({
      userId: owner.id,
      workspaceId: owner.workspaceId,
    });
    assert.ok(!after.some((p) => p.id === created.id));
    assert.ok(!(await listAccessibleProjectIds(owner.id, owner.workspaceId)).includes(created.id));
  });
});

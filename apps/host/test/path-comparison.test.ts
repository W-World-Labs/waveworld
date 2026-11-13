import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const testDb = path.join(root, 'data', 'tasks-test-path-comparison.db');
const artifactRoot = path.join(root, 'data', 'artifacts-test-path-comparison');

before(() => {
  process.env.TASK_DB_PATH = testDb;
  process.env.ARTIFACT_ROOT = artifactRoot;
  for (const suffix of ['', '-wal', '-shm']) try { fs.unlinkSync(testDb + suffix); } catch { /* absent */ }
  fs.rmSync(artifactRoot, { recursive: true, force: true });
});

function spec(name: string): import('@/types/task').JobSpecV1 {
  const candidate = name === 'b';
  return {
    schemaVersion: 1,
    kind: 'path-experiment',
    name,
    parameters: {},
    run: { maxSteps: 10 },
    outputs: { forces: false, history: false },
    experiment: {
      experimentId: name,
      title: name,
      materials: [
        { id: 'ir', name: 'Ir', role: 'sensitizer', ...(candidate ? {} : { formula: 'IrL3' }), source: { kind: 'literature', citation: 'source' } },
        ...(candidate ? [{ id: 'oxygen', name: 'Oxygen', role: 'quencher', source: { kind: 'measured' as const, note: 'assay' } }] : []),
      ],
      steps: [{ id: 'ros', label: 'ROS', mechanism: candidate ? 'Type-II transfer' : 'transfer', inputs: ['T1'], outputs: ['ROS'], hypothesis: { status: candidate ? 'accepted' : 'candidate', description: 'route', sources: [{ kind: 'assumption', note: 'test' }] } }],
      parameters: { k_q: { value: candidate ? 1.8 : 0.8, unit: 's^-1', source: { kind: 'literature', citation: candidate ? 'candidate source' : 'baseline source' } } },
      model: { id: 'test-model', version: candidate ? '2' : '1' },
      provenance: { createdAt: '2026-08-02T00:00:00.000Z', software: { name: 'WaveWorld', version: 'test' } },
    },
  };
}

function result(experimentId: string, ros: number, interval: [number, number, number]): import('@/types/task').JobResultV1 {
  return {
    schemaVersion: 1,
    summary: { steps: 10, wallTimeMs: 2 },
    backend: { id: 'cpu', agentId: 'test-agent' },
    experiment: {
      experimentId,
      modelVersion: '1',
      outputs: {
        rosYield: { value: ros, unit: 'relative' },
        ignoredDifferentUnit: { value: ros, unit: experimentId === 'a' ? 'M' : 'mM' },
        'uq.rosYield.p10': { value: interval[0], unit: 'relative' },
        'uq.rosYield.p50': { value: interval[1], unit: 'relative' },
        'uq.rosYield.p90': { value: interval[2], unit: 'relative' },
      },
      provenance: { computedAt: '2026-08-02T00:01:00.000Z', engineVersion: 'test-engine' },
    },
  };
}

describe('auditable path comparison', { concurrency: false }, () => {
  it('aligns scalar metrics, computes deltas/UQ overlap, verifies hashes, and reuses idempotently', async () => {
    const { createJob, getJob } = await import('@/lib/tasks/service.ts');
    const { getSqlite } = await import('@/lib/tasks/db.ts');
    const { createPathComparison, getPathComparison, verifyPathComparisonArtifact, PATH_COMPARISON_COMPUTE_VERSION_V1 } = await import('@/lib/tasks/path-comparison.ts');
    const user = { id: 'alice', name: 'Alice', workspaceId: 'ws', createdAt: new Date().toISOString() };
    const a = createJob({ spec: spec('a'), createdBy: user.id });
    const b = createJob({ spec: spec('b'), createdBy: user.id });
    const db = getSqlite();
    db.prepare(`UPDATE jobs SET status='succeeded', result=?, finished_at=? WHERE id=?`).run(JSON.stringify(result('a', 0.5, [0.4, 0.5, 0.6])), new Date().toISOString(), a.id);
    db.prepare(`UPDATE jobs SET status='succeeded', result=?, finished_at=? WHERE id=?`).run(JSON.stringify(result('b', 0.8, [0.55, 0.7, 0.9])), new Date().toISOString(), b.id);
    assert.equal(getJob(a.id)?.status, 'succeeded');

    const first = await createPathComparison({ user, jobIds: [a.id, b.id] });
    assert.equal(first.reused, false);
    assert.equal(first.comparison.envelope.manifest.inputs.length, 2);
    const comparisonResult = first.comparison.envelope.manifest.result;
    assert.ok('snapshots' in comparisonResult && 'differences' in comparisonResult);
    assert.equal(comparisonResult.snapshots.length, 2);
    assert.deepEqual(comparisonResult.snapshots[0].model, { id: 'test-model', version: '1' });
    assert.equal(comparisonResult.snapshots[1].materials.some((item) => item.id === 'oxygen'), true);
    assert.ok(comparisonResult.snapshots[1].evidenceAnchors.some((item) => item.path === '/parameters/k_q/source'));
    const pathDiff = comparisonResult.differences[1];
    assert.ok(pathDiff.added.some((item) => item.path === '/materials/oxygen/name' && item.value === 'Oxygen'));
    assert.ok(pathDiff.removed.some((item) => item.path === '/materials/ir/formula' && item.value === 'IrL3'));
    assert.ok(pathDiff.changed.some((item) => item.path === '/model/version' && item.baselineValue === '1' && item.value === '2'));
    assert.ok(pathDiff.changed.some((item) => item.path === '/steps/ros/mechanism' && item.value === 'Type-II transfer'));
    assert.ok(pathDiff.changed.some((item) => item.path === '/parameters/k_q/value' && item.baselineValue === 0.8 && item.value === 1.8));
    assert.deepEqual(comparisonResult.differences[0], { baselineJobId: a.id, jobId: a.id, added: [], removed: [], changed: [] });
    const metric = first.comparison.envelope.manifest.result.metrics.find((item) => item.key === 'rosYield');
    assert.ok(metric);
    assert.ok(Math.abs(metric.values[1].absoluteDelta - 0.3) < 1e-12);
    assert.ok(metric.values[1].relativeDelta !== null && Math.abs(metric.values[1].relativeDelta - 0.6) < 1e-12);
    assert.equal(first.comparison.envelope.manifest.result.metrics.some((item) => item.key === 'ignoredDifferentUnit'), false);
    const uq = first.comparison.envelope.manifest.result.uncertainty[0];
    assert.equal(uq.key, 'rosYield');
    assert.equal(uq.intervals[1].overlapsBaseline, true);
    assert.ok(Math.abs(uq.intervals[1].overlapWidth - 0.05) < 1e-12);
    assert.equal(verifyPathComparisonArtifact(first.comparison.artifact.id).manifest.fingerprint, first.comparison.fingerprint);

    // Re-signing the outer manifest is insufficient: verification rebuilds the
    // scientific snapshot/diff from the independently verified job audits.
    const forged = structuredClone(first.comparison.envelope);
    assert.ok('snapshots' in forged.manifest.result);
    forged.manifest.result.snapshots[1]!.model.version = 'forged';
    const { canonicalJson } = await import('@/lib/tasks/audit-manifest.ts');
    forged.manifestSha256 = createHash('sha256').update(canonicalJson(forged.manifest)).digest('hex');
    const { saveArtifact } = await import('@/lib/tasks/artifacts.ts');
    const forgedArtifact = saveArtifact({
      ownerUserId: user.id,
      kind: 'path-experiment-comparison',
      contentType: 'application/vnd.waveworld.path-comparison+json',
      data: Buffer.from(canonicalJson(forged)),
    });
    assert.throws(() => verifyPathComparisonArtifact(forgedArtifact.id), /scientific path snapshot mismatch/);

    // Production already contains engine/1 artifacts. Exercise their exact old
    // shape (no snapshots/differences) and original input-only fingerprint.
    const { snapshots: _snapshots, differences: _differences, ...legacyResult } = comparisonResult;
    const legacyInputs = first.comparison.envelope.manifest.inputs.map(({ auditArtifactId: _location, ...identity }) => identity);
    const legacyFingerprint = createHash('sha256').update(canonicalJson({
      schema: 'waveworld.path-comparison/v1',
      computeVersion: PATH_COMPARISON_COMPUTE_VERSION_V1,
      inputs: legacyInputs,
    })).digest('hex');
    const legacyManifest = {
      ...first.comparison.envelope.manifest,
      computeVersion: PATH_COMPARISON_COMPUTE_VERSION_V1,
      fingerprint: legacyFingerprint,
      result: legacyResult,
    };
    const legacyEnvelope = {
      manifestSha256: createHash('sha256').update(canonicalJson(legacyManifest)).digest('hex'),
      manifest: legacyManifest,
    };
    const legacyArtifact = saveArtifact({
      ownerUserId: user.id,
      kind: 'path-experiment-comparison',
      contentType: 'application/vnd.waveworld.path-comparison+json',
      data: Buffer.from(canonicalJson(legacyEnvelope)),
    });
    assert.equal(verifyPathComparisonArtifact(legacyArtifact.id).manifest.computeVersion, PATH_COMPARISON_COMPUTE_VERSION_V1);
    const legacyId = 'legacy-engine-1-comparison';
    db.prepare(`INSERT INTO path_comparisons (id,fingerprint,created_by,job_ids,artifact_id,created_at) VALUES (?,?,?,?,?,?)`)
      .run(legacyId, legacyFingerprint, user.id, JSON.stringify([a.id, b.id]), legacyArtifact.id, new Date().toISOString());
    assert.equal((await getPathComparison({ user, id: legacyId }))?.envelope.manifest.computeVersion, PATH_COMPARISON_COMPUTE_VERSION_V1);

    const again = await createPathComparison({ user, jobIds: [a.id, b.id] });
    assert.equal(again.reused, true);
    assert.equal(again.comparison.id, first.comparison.id);
    assert.equal((await getPathComparison({ user, id: first.comparison.id }))?.artifact.id, first.comparison.artifact.id);
    assert.equal(await getPathComparison({ user: { ...user, id: 'mallory' }, id: first.comparison.id }), null);
  });

  it('allows project viewers to compare succeeded project jobs and enforces API authentication', async () => {
    const { createJob } = await import('@/lib/tasks/service.ts');
    const { getSqlite } = await import('@/lib/tasks/db.ts');
    const { createProject, upsertProjectMember, attachJobToProject } = await import('../src/lib/project-service.ts');
    const { devLogin } = await import('../src/lib/user-auth.ts');
    const owner = await devLogin({ name: 'comparison-owner', workspaceId: 'ws-project' });
    const viewer = await devLogin({ name: 'comparison-viewer', workspaceId: 'ws-project' });
    const project = await createProject(owner.user, { name: 'Shared evidence project' });
    await upsertProjectMember(project.id, owner.user.id, { userId: viewer.user.id, role: 'viewer' });
    const a = createJob({ spec: spec('project-a'), createdBy: owner.user.id });
    const b = createJob({ spec: spec('project-b'), createdBy: owner.user.id });
    await attachJobToProject(project.id, a.id, owner.user.id);
    await attachJobToProject(project.id, b.id, owner.user.id);
    const db = getSqlite();
    db.prepare(`UPDATE jobs SET status='succeeded', result=?, finished_at=? WHERE id=?`).run(JSON.stringify(result('a', 1, [0.8, 1, 1.2])), new Date().toISOString(), a.id);
    db.prepare(`UPDATE jobs SET status='succeeded', result=?, finished_at=? WHERE id=?`).run(JSON.stringify(result('b', 2, [1.5, 2, 2.5])), new Date().toISOString(), b.id);

    const route = await import('../src/app/api/v1/comparisons/route.ts');
    const body = JSON.stringify({ jobIds: [a.id, b.id] });
    const anonymous = await route.POST(new Request('http://localhost/api/v1/comparisons', { method: 'POST', headers: { 'content-type': 'application/json' }, body }));
    assert.equal(anonymous.status, 401);
    const createdResponse = await route.POST(new Request('http://localhost/api/v1/comparisons', { method: 'POST', headers: { authorization: `Bearer ${viewer.token}`, 'content-type': 'application/json' }, body }));
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as { comparison: { id: string; artifact: { projectId: string } } };
    assert.equal(created.comparison.artifact.projectId, project.id);
    const readRoute = await import('../src/app/api/v1/comparisons/[id]/route.ts');
    const loaded = await readRoute.GET(new Request(`http://localhost/api/v1/comparisons/${created.comparison.id}`, { headers: { authorization: `Bearer ${viewer.token}` } }), { params: Promise.resolve({ id: created.comparison.id }) });
    assert.equal(loaded.status, 200);
  });
});

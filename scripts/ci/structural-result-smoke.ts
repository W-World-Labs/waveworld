import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaultJobSpec } from '@w-sim/contracts';
import { readStructuralFields } from '../../src/lib/structuralResult.ts';

// One linear solve, isolated SQLite and real route handlers; no listening port,
// cloud instance, external login provider or engineering convergence sweep.
test('structural fields survive Agent, authenticated settlement, storage and result reads', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'waveworld-structural-result-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  process.env.TASK_DB_PATH = path.join(dir, 'tasks.db');
  process.env.ARTIFACT_DIR = path.join(dir, 'artifacts');
  process.env.JOB_REQUIRE_AUTH = '1';
  delete process.env.TASK_API_KEY;
  delete process.env.AGENT_WORKSPACE;
  const { issueSession } = await import('../../apps/host/src/lib/user-auth.ts');
  const { registerAgent } = await import('../../apps/host/src/lib/tasks/auth-agent.ts');
  const { createAgentSolverRegistry } = await import('../../apps/lab/agent/src/runners.ts');
  const { POST: submit } = await import('../../apps/host/src/app/api/v1/jobs/route.ts');
  const { POST: claim } = await import('../../apps/host/src/app/api/v1/jobs/claim/route.ts');
  const { POST: complete } = await import('../../apps/host/src/app/api/v1/jobs/[id]/complete/route.ts');
  const { GET: detail } = await import('../../apps/host/src/app/api/v1/jobs/[id]/route.ts');
  const { GET: savedResult } = await import('../../apps/host/src/app/api/v1/jobs/[id]/result/route.ts');
  const { fingerprintJobResult } = await import('../../apps/host/src/lib/tasks/job-fingerprint.ts');
  const owner = await issueSession({ userId: 'structural-owner', name: 'Owner', workspaceId: 'structural-test' });
  const stranger = await issueSession({ userId: 'structural-stranger', name: 'Stranger', workspaceId: 'structural-test' });
  const { agent, token } = await registerAgent({ name: 'structural-agent', capabilities: {
    kinds: ['structural-static'], backends: ['cpu'], precision: ['float64'], outputs: ['fields', 'forces', 'kpis'],
  } });
  const nodes = Array.from({ length: 17 }, (_, i) => ({ id: 100 + i * 7, x: i / 16, y: 0 }));
  const elements = nodes.slice(1).map((node, i) => ({ id: 500 + i * 11, n1: nodes[i].id, n2: node.id, area: 0.01, I: 1e-6 }));
  const spec = defaultJobSpec({
    kind: 'structural-static', name: 'Saved 51-DOF cantilever',
    parameters: {
      elementType: 'beam2d', youngsModulusPa: 2.1e11, poissonRatio: 0.3, sectionModulusM3: 2e-5,
      nodes, elements,
      constraints: [{ node: nodes[0].id, dof: 'ux', value: 0 }, { node: nodes[0].id, dof: 'uy', value: 0 }, { node: nodes[0].id, dof: 'rz', value: 0 }],
      loads: [{ node: nodes[16].id, dof: 'uy', value: -100 }],
      units: { length: 'm', force: 'N', stress: 'Pa', youngsModulus: 'Pa', area: 'm^2', secondMoment: 'm^4', displacement: 'm' },
    },
    run: { maxSteps: 1 }, outputs: { fields: ['displacement', 'stress'], forces: true, kpis: ['maxDisplacementM', 'maxStressPa'] },
    requirements: { backends: ['cpu'], precision: 'float64', requiredOutputs: ['fields', 'kpis'] },
  });
  const request = (url: string, bearer?: string, body?: unknown) => new Request(`http://localhost${url}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal((await submit(request('/api/v1/jobs', undefined, { spec }))).status, 401);
  const created = await submit(request('/api/v1/jobs', owner.token, { spec }));
  assert.equal(created.status, 201, await created.clone().text());
  const { job } = await created.json();
  const ctx = { params: Promise.resolve({ id: job.id }) }, base = `/api/v1/jobs/${job.id}`;
  const claimed = await claim(request('/api/v1/jobs/claim', token, { kinds: ['structural-static'] }));
  assert.equal(claimed.status, 200);
  assert.equal((await claimed.json()).job.id, job.id);
  const resolved = createAgentSolverRegistry({ agentId: agent.id }).resolve(job.spec);
  assert.ok(resolved.ok);
  const result = JSON.parse(JSON.stringify(await resolved.runner.run(job.spec)));
  assert.equal(result.summary.dofCount, 51);
  assert.equal(result.derived.fieldInline, 1);
  assert.equal(result.derived.nodeIdsCsv, nodes.map(node => node.id).join(','));
  assert.equal(result.derived.elementConnectivityCsv, elements.flatMap(e => [e.n1, e.n2]).join(','));
  assert.equal(result.derived.dofNamesCsv, 'ux,uy,rz');
  assert.equal(result.derived.displacementUnitsCsv, 'm,m,rad');
  assert.equal(result.derived.reactionUnitsCsv, 'N,N,N*m');
  assert.equal(result.derived.displacementCsv.split(',').length, 51);
  assert.equal(result.derived.reactionCsv.split(',').length, 51);
  assert.ok(Math.abs(Number(result.derived.displacementCsv.split(',')[49]) + 100 / (3 * 2.1e11 * 1e-6)) < 1e-12);
  assert.equal(result.derived.elementBendingStressPaCsv.split(',').length, 16);
  assert.equal(result.derived.elementMaxBendingMomentNmCsv.split(',').length, 16);
  assert.equal(result.artifacts?.length ?? 0, 0);
  const completed = await complete(request(`${base}/complete`, token, { result }), ctx);
  assert.equal(completed.status, 200, await completed.clone().text());
  assert.equal((await completed.json()).job.status, 'succeeded');
  for (const route of [detail, savedResult]) {
    assert.equal((await route(request(base), ctx)).status, 404);
    assert.equal((await route(request(base, stranger.token), ctx)).status, 404);
    const response = await route(request(base, owner.token), ctx);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.job ? body.job.result : body.result, result);
    const fields = readStructuralFields((body.job ? body.job.result : body.result).derived);
    assert.ok(!('unavailable' in fields));
    assert.equal(fields.nodes.rows.length, 17);
    assert.equal(fields.elements.rows.length, 16);
    assert.equal(fields.nodes.rows[16][0], nodes[16].id);
    assert.equal(fields.nodes.rows[16][5], Number(result.derived.displacementCsv.split(',')[49]));
    if (!body.job) assert.deepEqual(body.artifacts, []);
  }
  const changed = { ...result, derived: { ...result.derived, displacementCsv: result.derived.displacementCsv + ',1' } };
  assert.notEqual(fingerprintJobResult(changed), fingerprintJobResult(result));
});

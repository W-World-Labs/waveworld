import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const waveRoot = path.resolve(here, '../../..');
const testDb = path.join(waveRoot, 'data', 'tasks-test-publications.db');
const testArtifacts = path.join(waveRoot, 'data', 'artifacts-test-publications');
let publicPublication: { publicId: string; version: number };
let privatePublication: { publicId: string; version: number };
let succeededJobId = '';

before(() => {
  process.env.TASK_DB_PATH = testDb;
  process.env.ARTIFACT_ROOT = testArtifacts;
  process.env.ARTIFACT_MAX_BYTES = String(8 * 1024 * 1024);
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(testDb + suffix); } catch { /* absent */ } }
  fs.rmSync(testArtifacts, { recursive: true, force: true });
});

function spec(evidence: { id: string; sha256: string }) {
  return {
    schemaVersion: 1 as const, kind: 'path-experiment' as const, name: 'publishable Ir ROS path', parameters: {},
    run: { maxSteps: 4 }, outputs: { forces: false, history: true, fields: [] }, requirements: { backends: ['cpu' as const] },
    experiment: {
      experimentId: 'publication-test', title: 'Ir ultrasound ROS',
      materials: [{ id: 'ir', name: 'Ir complex', role: 'sensitizer', source: { kind: 'measured' as const, evidenceId: evidence.id, sha256: evidence.sha256, locator: 'lab notebook 42' } }],
      steps: [{ id: 'triplet', label: 'Triplet generation', mechanism: 'ISC', inputs: ['ir'], outputs: ['t1'], hypothesis: { status: 'accepted' as const, description: 'triplet route', sources: [{ kind: 'assumption' as const, note: 'test' }] } }],
      parameters: { oxygen: { value: 180, unit: 'uM', source: { kind: 'measured' as const, evidenceId: evidence.id, sha256: evidence.sha256, locator: 'oxygen column' } } },
      model: { id: 'ir-sonodynamic-kinetics', version: '1.0.0', implementation: 'ode' },
      provenance: { createdAt: '2026-08-02T00:00:00.000Z', createdBy: 'owner-1', software: { name: 'WaveWorld', version: 'test' } },
    },
  };
}

describe('immutable, offline-verifiable research publications', { concurrency: false }, () => {
  it('embeds licensed evidence, complete audit and job artifacts; detects any tampering', async () => {
    const { importEvidence } = await import('@/lib/tasks/evidence.ts');
    const evidence = importEvidence({ kind: 'measured', title: 'oxygen trace', format: 'csv', contentBase64: Buffer.from('time,O2\n0,180\n').toString('base64'), metadata: { redistributionAllowed: true, license: 'CC-BY-4.0' } }, 'owner-1');
    const { createJob, claimJob, completeJob, getJob } = await import('@/lib/tasks/service.ts');
    const job = createJob({ spec: spec(evidence), createdBy: 'owner-1' });
    const { saveArtifact } = await import('@/lib/tasks/artifacts.ts');
    const output = saveArtifact({ jobId: job.id, ownerUserId: 'owner-1', kind: 'solver-output', contentType: 'application/json', data: Buffer.from('{"ros":0.61}') });
    const claimed = claimJob({ jobId: job.id, agentId: 'agent-publication', capabilities: { backends: ['cpu'], kinds: ['path-experiment'], pathModels: [{ id: 'ir-sonodynamic-kinetics', version: '1.0.0', backends: ['cpu'] }] } });
    assert.equal(claimed?.id, job.id);
    completeJob({ jobId: job.id, agentId: 'agent-publication', result: { schemaVersion: 1, summary: { steps: 4, wallTimeMs: 2 }, backend: { id: 'cpu', agentId: 'agent-publication' }, experiment: { experimentId: 'publication-test', modelVersion: '1.0.0', outputs: { rosYield: { value: 0.61, unit: 'relative' } }, provenance: { computedAt: '2026-08-02T00:01:00.000Z', engineVersion: 'test' } } } });
    assert.equal(getJob(job.id)?.status, 'succeeded');

    const { createPublication, readPublicationBundle, verifyPublicationBundle, getPublication } = await import('@/lib/tasks/publications.ts');
    const publication = createPublication({ jobIds: [job.id], title: 'Ir ROS conclusion', public: true, ownerUserId: 'owner-1', evidencePolicies: { [evidence.id]: { mode: 'embed' } } });
    publicPublication = publication;
    succeededJobId = job.id;
    assert.match(publication.publicId, /^pub_/);
    assert.equal(publication.version, 1);
    assert.equal(publication.public, true);
    assert.deepEqual(getPublication(publication.publicId), publication);
    const loaded = readPublicationBundle(publication);
    assert.equal(loaded.bundle.manifest.publication.publicId, publication.publicId);
    assert.ok(loaded.bundle.entries.some((entry) => entry.path === `evidence/${evidence.id}/content`));
    assert.ok(loaded.bundle.entries.some((entry) => entry.path === `jobs/${job.id}/artifacts/${output.id}`));
    assert.equal(loaded.bundle.manifest.evidence[0].disposition, 'embedded');
    assert.doesNotThrow(() => verifyPublicationBundle(loaded.data));

    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wwpub-'));
    const file = path.join(temporary, 'publication.wwpub.json');
    fs.writeFileSync(file, loaded.data);
    const cli = JSON.parse(execFileSync(process.execPath, [path.join(waveRoot, 'scripts/verify-publication-bundle.mjs'), file], { encoding: 'utf8' }));
    assert.equal(cli.ok, true);
    assert.equal(cli.publicId, publication.publicId);

    const tampered = structuredClone(loaded.bundle);
    const target = tampered.entries.find((entry) => entry.path.endsWith('/result.json'))!;
    target.contentBase64 = Buffer.from('tampered').toString('base64');
    assert.throws(() => verifyPublicationBundle(JSON.stringify(tampered)), /digest mismatch/);
  });

  it('requires audit readiness, enforces evidence licensing, and makes DB rows immutable', async () => {
    const { importEvidence } = await import('@/lib/tasks/evidence.ts');
    const restricted = importEvidence({ kind: 'measured', title: 'restricted trace', format: 'json', contentBase64: Buffer.from('{"x":1}').toString('base64') }, 'owner-1');
    const { createJob, claimJob, completeJob } = await import('@/lib/tasks/service.ts');
    const pending = createJob({ spec: spec(restricted), createdBy: 'owner-1' });
    const { createPublication } = await import('@/lib/tasks/publications.ts');
    assert.throws(() => createPublication({ jobIds: [pending.id], title: 'too early', ownerUserId: 'owner-1' }), /not a succeeded/);
    claimJob({ jobId: pending.id, agentId: 'agent-restricted', capabilities: { backends: ['cpu'], kinds: ['path-experiment'], pathModels: [{ id: 'ir-sonodynamic-kinetics', version: '1.0.0', backends: ['cpu'] }] } });
    completeJob({ jobId: pending.id, agentId: 'agent-restricted', result: { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'cpu', agentId: 'agent-restricted' }, experiment: { experimentId: 'publication-test', modelVersion: '1.0.0', outputs: { ros: { value: 0.2 } }, provenance: { computedAt: '2026-08-02T00:00:00Z', engineVersion: 'test' } } } });
    assert.throws(() => createPublication({ jobIds: [pending.id], title: 'illegal redistribution', ownerUserId: 'owner-1', evidencePolicies: { [restricted.id]: { mode: 'embed' } } }), /redistributionAllowed/);
    const publication = createPublication({ jobIds: [pending.id], title: 'licensed boundary', ownerUserId: 'owner-1', evidencePolicies: { [restricted.id]: { mode: 'exclude', reason: 'Consent does not permit redistribution.' } } });
    privatePublication = publication;
    const { getSqlite } = await import('@/lib/tasks/db.ts');
    assert.throws(() => getSqlite().prepare(`UPDATE publications SET title='changed' WHERE public_id=?`).run(publication.publicId), /immutable/);
    assert.throws(() => getSqlite().prepare(`DELETE FROM publications WHERE public_id=?`).run(publication.publicId), /immutable/);
  });

  it('enforces authenticated publishing/private reads while public bundles are stable anonymous downloads', async () => {
    const priorNodeEnv = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: 'production' });
    try {
      const { issueSession } = await import('../src/lib/user-auth.ts');
      const owner = await issueSession({ userId: 'owner-1', name: 'Owner', workspaceId: 'publication-ws', authProvider: 'dev' });
      const outsider = await issueSession({ userId: 'outsider-1', name: 'Outsider', workspaceId: 'publication-ws', authProvider: 'dev' });
      const detailRoute = await import('../src/app/api/v1/publications/[publicId]/route.ts');
      const downloadRoute = await import('../src/app/api/v1/publications/[publicId]/download/route.ts');
      const publicDetail = await detailRoute.GET(new Request(`http://localhost/api/v1/publications/${publicPublication.publicId}`), { params: Promise.resolve({ publicId: publicPublication.publicId }) });
      assert.equal(publicDetail.status, 200);
      assert.equal((await publicDetail.json()).verified, true);
      const publicDownload = await downloadRoute.GET(new Request(`http://localhost/api/v1/publications/${publicPublication.publicId}/download`), { params: Promise.resolve({ publicId: publicPublication.publicId }) });
      assert.equal(publicDownload.status, 200);
      assert.match(publicDownload.headers.get('cache-control') ?? '', /immutable/);
      assert.ok(publicDownload.headers.get('digest'));
      assert.equal((await detailRoute.GET(new Request(`http://localhost/api/v1/publications/${privatePublication.publicId}`), { params: Promise.resolve({ publicId: privatePublication.publicId }) })).status, 404);
      assert.equal((await detailRoute.GET(new Request(`http://localhost/api/v1/publications/${privatePublication.publicId}`, { headers: { Authorization: `Bearer ${outsider.token}` } }), { params: Promise.resolve({ publicId: privatePublication.publicId }) })).status, 404);
      assert.equal((await detailRoute.GET(new Request(`http://localhost/api/v1/publications/${privatePublication.publicId}`, { headers: { Authorization: `Bearer ${owner.token}` } }), { params: Promise.resolve({ publicId: privatePublication.publicId }) })).status, 200);

      const collection = await import('../src/app/api/v1/publications/route.ts');
      const denied = await collection.POST(new Request('http://localhost/api/v1/publications', { method: 'POST', headers: { Authorization: `Bearer ${outsider.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jobIds: [succeededJobId], title: 'stolen publication' }) }));
      assert.equal(denied.status, 404);

      // Residual after wave34: garbage / non-array jobIds → 400 (not dishonest 404)
      const { normalizeShareJobIds, isPlausibleJobId } = await import('../src/lib/job-sharing.ts');
      assert.equal(isPlausibleJobId(succeededJobId), true);
      assert.throws(
        () => normalizeShareJobIds('not-array'),
        (err: Error & { status?: number }) =>
          err.message === 'jobIds must be an array' && err.status === 400,
      );
      assert.throws(
        () => normalizeShareJobIds(['123']),
        (err: Error & { status?: number }) =>
          err.message === 'invalid job id' && err.status === 400,
      );
      const postPub = async (jobIds: unknown) =>
        collection.POST(
          new Request('http://localhost/api/v1/publications', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${owner.token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ jobIds, title: 'wave34 residual pub' }),
          }),
        );
      for (const bad of ['abc', 123, true, { 0: succeededJobId }]) {
        const res = await postPub(bad);
        assert.equal(res.status, 400, `expected 400 for non-array ${JSON.stringify(bad)}`);
        const body = (await res.json()) as { error?: string };
        assert.equal(body.error, 'jobIds must be an array');
      }
      for (const badId of ['123', 'not-a-uuid', '', 'shr_fake', '../etc/passwd']) {
        const res = await postPub([badId]);
        assert.equal(res.status, 400, `expected 400 for jobId=${badId}`);
        const body = (await res.json()) as { error?: string };
        assert.equal(body.error, 'invalid job id');
      }
      // Well-formed UUID missing row stays 404 (distinct from invalid format)
      const missingUuid = '00000000-0000-4000-8000-000000000034';
      assert.equal(isPlausibleJobId(missingUuid), true);
      const missing = await postPub([missingUuid]);
      assert.equal(missing.status, 404);
      const missingBody = (await missing.json()) as { error?: string };
      assert.match(missingBody.error ?? '', /not found or not publishable/);

      // Source pin: publications POST must use normalizeShareJobIds (wave34)
      const pubRouteSrc = fs.readFileSync(
        path.resolve(here, '../src/app/api/v1/publications/route.ts'),
        'utf8',
      );
      assert.match(pubRouteSrc, /normalizeShareJobIds/);
      assert.match(pubRouteSrc, /wave34/);

      // Residual after wave35: garbage publicId / invalid version → 400 (not dishonest 404)
      const {
        isPlausiblePublicId,
        normalizePublicationVersion,
      } = await import('../src/lib/job-sharing.ts');
      assert.equal(isPlausiblePublicId(publicPublication.publicId), true);
      assert.equal(isPlausiblePublicId('123'), false);
      assert.equal(isPlausiblePublicId('pub_short'), false); // body < 10
      assert.equal(isPlausiblePublicId('not-a-pub-id'), false);
      assert.equal(isPlausiblePublicId('../etc/passwd'), false);
      assert.equal(isPlausiblePublicId(succeededJobId), false); // UUID ≠ pub_
      assert.equal(normalizePublicationVersion(null), 1);
      assert.equal(normalizePublicationVersion(''), 1);
      assert.equal(normalizePublicationVersion('2'), 2);
      assert.equal(normalizePublicationVersion(3), 3);
      assert.throws(
        () => normalizePublicationVersion('abc'),
        (err: Error & { status?: number }) =>
          err.message === 'invalid publication version' && err.status === 400,
      );
      assert.throws(
        () => normalizePublicationVersion(0),
        (err: Error & { status?: number }) =>
          err.message === 'invalid publication version' && err.status === 400,
      );
      assert.throws(
        () => normalizePublicationVersion(1.5),
        (err: Error & { status?: number }) =>
          err.message === 'invalid publication version' && err.status === 400,
      );
      assert.throws(
        () => normalizePublicationVersion(-1),
        (err: Error & { status?: number }) =>
          err.message === 'invalid publication version' && err.status === 400,
      );

      for (const badId of ['123', 'pub_short', 'not-a-pub', '../etc/passwd', 'shr_fake', succeededJobId]) {
        const res = await detailRoute.GET(
          new Request(`http://localhost/api/v1/publications/${encodeURIComponent(badId)}`),
          { params: Promise.resolve({ publicId: badId }) },
        );
        assert.equal(res.status, 400, `expected 400 for publicId=${badId}`);
        const body = (await res.json()) as { error?: string };
        assert.equal(body.error, 'invalid publication id');

        const dl = await downloadRoute.GET(
          new Request(`http://localhost/api/v1/publications/${encodeURIComponent(badId)}/download`),
          { params: Promise.resolve({ publicId: badId }) },
        );
        assert.equal(dl.status, 400, `expected 400 download for publicId=${badId}`);
        const dlBody = (await dl.json()) as { error?: string };
        assert.equal(dlBody.error, 'invalid publication id');
      }

      // Plausible publicId form but missing row stays 404 (distinct from invalid format)
      const missingPubId = 'pub_zzzzzzzzzzzzzzzzzzzzzz';
      assert.equal(isPlausiblePublicId(missingPubId), true);
      const missingPub = await detailRoute.GET(
        new Request(`http://localhost/api/v1/publications/${missingPubId}`),
        { params: Promise.resolve({ publicId: missingPubId }) },
      );
      assert.equal(missingPub.status, 404);
      const missingPubBody = (await missingPub.json()) as { error?: string };
      assert.match(missingPubBody.error ?? '', /publication not found/);

      // Invalid ?version → 400 (not dishonest 404)
      for (const badVer of ['abc', '0', '-1', '1.5']) {
        const res = await detailRoute.GET(
          new Request(
            `http://localhost/api/v1/publications/${publicPublication.publicId}?version=${badVer}`,
          ),
          { params: Promise.resolve({ publicId: publicPublication.publicId }) },
        );
        assert.equal(res.status, 400, `expected 400 for version=${badVer}`);
        const body = (await res.json()) as { error?: string };
        assert.equal(body.error, 'invalid publication version');
      }
      // Well-formed version that does not exist stays 404
      const missingVer = await detailRoute.GET(
        new Request(
          `http://localhost/api/v1/publications/${publicPublication.publicId}?version=99`,
        ),
        { params: Promise.resolve({ publicId: publicPublication.publicId }) },
      );
      assert.equal(missingVer.status, 404);

      // Source pin: detail/download/reviews must gate publicId (wave35)
      const detailSrc = fs.readFileSync(
        path.resolve(here, '../src/app/api/v1/publications/[publicId]/route.ts'),
        'utf8',
      );
      const downloadSrc = fs.readFileSync(
        path.resolve(here, '../src/app/api/v1/publications/[publicId]/download/route.ts'),
        'utf8',
      );
      const reviewsSrc = fs.readFileSync(
        path.resolve(here, '../src/app/api/v1/publications/[publicId]/reviews/route.ts'),
        'utf8',
      );
      for (const src of [detailSrc, downloadSrc, reviewsSrc]) {
        assert.match(src, /isPlausiblePublicId/);
        assert.match(src, /normalizePublicationVersion/);
        assert.match(src, /wave35/);
      }
    } finally { Object.assign(process.env, { NODE_ENV: priorNodeEnv }); }
  });
});

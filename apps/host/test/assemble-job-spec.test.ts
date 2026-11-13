/**
 * #69: job submit can assemble via resolveJob.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFluidJobSpec } from '@w-sim/contracts';

const here = path.dirname(fileURLToPath(import.meta.url));
const waveRoot = path.resolve(here, '../../..');
const testDb = path.join(os.tmpdir(), `ww-assemble-69-${Date.now()}.db`);

before(async () => {
  process.env.KNOWLEDGE_DB_PATH = testDb;
  for (const p of [testDb, testDb + '-wal', testDb + '-shm']) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ok */
    }
  }
  const { migrateKnowledgeDb } = await import('../../../src/lib/knowledge-db/migrate.ts');
  migrateKnowledgeDb({ root: waveRoot, dbPath: testDb });
  const { seedSimParamPackReleaseSync } = await import(
    '../../../src/lib/knowledge-db/seed-sim-param-pack.ts'
  );
  await seedSimParamPackReleaseSync({ dbPath: testDb, root: waveRoot, skipMigrate: true });
});

after(() => {
  for (const p of [testDb, testDb + '-wal', testDb + '-shm']) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ok */
    }
  }
});

describe('assembleJobSpecFromKnowledge (#69)', () => {
  it('fixed seed release stamps knowledgeDbReleaseId; unreleased pack is rejected', async () => {
    const { assembleJobSpecFromKnowledge } = await import('../src/lib/assemble-job-spec.ts');
    const { SEED_SIM_PARAM_PACK_RELEASE_ID, SEED_LBM_JOB_KIND } = await import(
      '../../../src/lib/knowledge-db/seed-sim-param-pack.ts'
    );
    const spec = {
      schemaVersion: 1 as const,
      kind: SEED_LBM_JOB_KIND,
      name: 'assemble-test',
      parameters: { inletVelocity: 0.2 },
      run: { maxSteps: 10 },
      outputs: { forces: true, history: false },
    };
    const a = assembleJobSpecFromKnowledge({
      spec,
      knowledge: { kind: SEED_LBM_JOB_KIND },
    });
    const b = assembleJobSpecFromKnowledge({
      spec,
      knowledge: { kind: SEED_LBM_JOB_KIND },
    });
    assert.equal(a.provenance.knowledgeDbReleaseId, SEED_SIM_PARAM_PACK_RELEASE_ID);
    assert.equal(a.provenance.knowledgeDbReleaseId, b.provenance.knowledgeDbReleaseId);
    assert.ok(isFluidJobSpec(a.spec));
    assert.equal(a.spec.parameters.inletVelocity, 0.2);
    assert.ok(a.provenance.paramOverrideKeys.includes('inletVelocity'));
    assert.equal(
      (a.spec.experiment as { knowledgeDbReleaseId?: string })?.knowledgeDbReleaseId,
      SEED_SIM_PARAM_PACK_RELEASE_ID,
    );

    assert.throws(
      () =>
        assembleJobSpecFromKnowledge({
          spec,
          knowledge: { kind: SEED_LBM_JOB_KIND, packClaimId: 'claim:does-not-exist' },
        }),
      /pack|missing|not found/i,
    );
  });
});

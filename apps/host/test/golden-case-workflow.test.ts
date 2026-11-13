import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifyGoldenCase } from '../../../scripts/research/golden-case.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const waveRoot = path.resolve(here, '../../..');
const testDb = path.join(waveRoot, 'data', 'tasks-test-golden-case.db');
const artifactRoot = path.join(waveRoot, 'data', 'artifacts-test-golden-case');

before(() => {
  process.env.TASK_DB_PATH = testDb;
  process.env.ARTIFACT_ROOT = artifactRoot;
  process.env.ARTIFACT_MAX_BYTES = String(16 * 1024 * 1024);
  for (const suffix of ['', '-wal', '-shm']) { try { fs.unlinkSync(testDb + suffix); } catch { /* absent */ } }
  fs.rmSync(artifactRoot, { recursive: true, force: true });
});

describe('golden case through evidence, jobs, comparison and publication', { concurrency: false }, () => {
  it('persists the preregistered negative result and verifies it offline', async (context) => {
    const user = { id: 'golden-reviewer', name: 'Golden Reviewer', workspaceId: 'golden', createdAt: new Date().toISOString() };
    const caseRoot = path.join(waveRoot, 'research/golden-case');
    const verified = verifyGoldenCase(caseRoot) as { datasets: Array<{ path: string; condition: string; sha256: string; sourceSha256: string; transformed: Array<{ time: number; singletO2: number }> }> };
    const local = JSON.parse(execFileSync(path.join(waveRoot, 'node_modules/.bin/tsx'), [path.join(waveRoot, 'scripts/research/run-golden-case.ts')], {
      cwd: waveRoot,
      encoding: 'utf8',
    })) as {
      decision: { status: string; normalizedRmseMax: number };
      runs: Array<{
        condition: string;
        model: { id: string; version: string };
        spec: import('../../../apps/host/src/types/task.ts').JobSpecV1;
        result: import('../../../apps/host/src/types/task.ts').JobResultV1;
      }>;
    };
    assert.equal(local.decision.status, 'fail');

    const { importEvidence, validateJobEvidenceReferences } = await import('../../../apps/host/src/lib/tasks/evidence.ts');
    const { validateJobSpec } = await import('../../../apps/host/src/lib/tasks/validate-spec.ts');
    const evidenceByPath = new Map<string, { id: string; sha256: string }>();
    for (const dataset of verified.datasets) {
      const evidence = importEvidence({
        kind: 'measured',
        title: `Golden calibration observations — ${dataset.condition}`,
        format: 'csv',
        contentBase64: Buffer.from(`time,singletO2\n${dataset.transformed.map((row) => `${row.time},${row.singletO2}`).join('\n')}\n`, 'utf8').toString('base64'),
        metadata: {
          redistributionAllowed: true,
          license: 'CC-BY-4.0',
          doi: '10.5281/zenodo.7469900',
          sourceSnapshotSha256: dataset.sha256,
          upstreamEntrySha256: dataset.sourceSha256,
          transform: 'waveworld.mb-transient-normalization/v1',
        },
      }, user.id);
      evidenceByPath.set(dataset.path, evidence);
    }

    const { createJob, claimJob, completeJob, getJob } = await import('../../../apps/host/src/lib/tasks/service.ts');
    const { saveArtifact } = await import('../../../apps/host/src/lib/tasks/artifacts.ts');
    const jobIds: string[] = [];
    let researchContractAttached = false;
    for (const localRun of local.runs) {
      const dataset = verified.datasets.find((item) => item.condition === localRun.condition)!;
      const spec = structuredClone(localRun.spec);
      if (localRun.model.id === 'photosensitization-rk4') {
        const evidence = evidenceByPath.get(dataset.path)!;
        spec.experiment!.analysis!.calibration!.evidence = {
          kind: 'measured', evidenceId: evidence.id, sha256: evidence.sha256,
          citation: 'Sandberg et al.; doi:10.5281/zenodo.7469900; Figure 1C',
          uri: 'https://doi.org/10.5281/zenodo.7469900',
          locator: 'columns=time,T1|singletO2', transform: 'CSV numeric parse v1',
        };
      }
      validateJobSpec(spec);
      validateJobEvidenceReferences(spec, user.id);
      const job = createJob({ spec, createdBy: user.id });
      if (!researchContractAttached) {
        const preregistrationBytes = fs.readFileSync(path.join(caseRoot, 'preregistration.json'));
        saveArtifact({
          jobId: job.id, ownerUserId: user.id, kind: 'golden-case-preregistration',
          contentType: 'application/json', data: preregistrationBytes,
        });
        saveArtifact({
          jobId: job.id, ownerUserId: user.id, kind: 'golden-case-decision',
          contentType: 'application/json', data: Buffer.from(JSON.stringify({
            schema: 'waveworld.golden-case-decision/v1',
            caseId: 'mb-pbs-oxygen-transient-2026',
            preregistrationSha256: createHash('sha256').update(preregistrationBytes).digest('hex'),
            decision: local.decision,
          })),
        });
        researchContractAttached = true;
      }
      const claimed = claimJob({
        jobId: job.id,
        agentId: 'golden-case-cpu',
        capabilities: {
          backends: ['cpu'], kinds: ['path-experiment'],
          pathModels: [{ id: localRun.model.id, version: localRun.model.version, backends: ['cpu'] }],
        },
      });
      assert.equal(claimed?.id, job.id);
      const completed = completeJob({ jobId: job.id, agentId: 'golden-case-cpu', result: localRun.result });
      assert.equal(completed?.status, 'succeeded');
      assert.equal(getJob(job.id)?.spec.experiment?.analysis?.calibration?.evidenceDerivation?.extractor, localRun.model.id === 'photosensitization-rk4' ? 'waveworld.calibration-csv' : undefined);
      jobIds.push(job.id);
    }

    const { createPathComparison, verifyPathComparisonArtifact } = await import('../../../apps/host/src/lib/tasks/path-comparison.ts');
    const comparison = await createPathComparison({ user, jobIds });
    const comparisonResult = comparison.comparison.envelope.manifest.result;
    assert.ok('snapshots' in comparisonResult);
    assert.equal(comparisonResult.snapshots.length, 4);
    assert.ok(comparison.comparison.envelope.manifest.result.metrics.some((metric) => metric.key === 'steadyT1'));
    assert.equal(verifyPathComparisonArtifact(comparison.comparison.artifact.id).manifest.fingerprint, comparison.comparison.fingerprint);

    const { createPublication, readPublicationBundle, verifyPublicationBundle } = await import('../../../apps/host/src/lib/tasks/publications.ts');
    const evidencePolicies = Object.fromEntries([...evidenceByPath.values()].map((evidence) => [evidence.id, { mode: 'embed' as const }]));
    const publication = createPublication({
      jobIds,
      title: 'WaveWorld R1 golden case — preregistered negative result',
      public: true,
      ownerUserId: user.id,
      evidencePolicies,
    });
    const loaded = readPublicationBundle(publication);
    assert.doesNotThrow(() => verifyPublicationBundle(loaded.data));
    for (const evidence of evidenceByPath.values()) {
      assert.ok(loaded.bundle.entries.some((entry) => entry.path === `evidence/${evidence.id}/content`));
    }

    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'waveworld-golden-publication-'));
    context.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const bundlePath = path.join(temporary, 'golden.wwpub.json');
    fs.writeFileSync(bundlePath, loaded.data);
    const genericVerifier = path.join(temporary, 'verify-publication-bundle.mjs');
    const goldenVerifier = path.join(temporary, 'verify-golden-publication.mjs');
    fs.copyFileSync(path.join(waveRoot, 'scripts/verify-publication-bundle.mjs'), genericVerifier);
    fs.copyFileSync(path.join(waveRoot, 'scripts/research/verify-golden-publication.mjs'), goldenVerifier);
    const offline = JSON.parse(execFileSync(process.execPath, [genericVerifier, bundlePath], { cwd: temporary, encoding: 'utf8' }));
    assert.equal(offline.ok, true);
    assert.equal(offline.publicId, publication.publicId);
    const goldenOffline = JSON.parse(execFileSync(process.execPath, [goldenVerifier, bundlePath], { cwd: temporary, encoding: 'utf8' }));
    assert.equal(goldenOffline.ok, true);
    assert.equal(goldenOffline.recalculated.status, 'fail');
    assert.ok(Math.abs(goldenOffline.recalculated.normalizedRmseMax - local.decision.normalizedRmseMax) < 1e-12);

    const { canonicalJson } = await import('../../../apps/host/src/lib/tasks/audit-manifest.ts');
    const rewriteEntry = (bundle: typeof loaded.bundle, entryPath: string, mutate: (value: unknown) => unknown): void => {
      const entry = bundle.entries.find((candidate) => candidate.path === entryPath)!;
      const value = JSON.parse(Buffer.from(entry.contentBase64, 'base64').toString('utf8'));
      const rewritten = Buffer.from(canonicalJson(mutate(value)));
      entry.contentBase64 = rewritten.toString('base64'); entry.bytes = rewritten.byteLength;
      entry.sha256 = createHash('sha256').update(rewritten).digest('hex');
      const metadata = bundle.manifest.entries.find((candidate) => candidate.path === entry.path)!;
      metadata.bytes = entry.bytes; metadata.sha256 = entry.sha256;
      bundle.manifestSha256 = createHash('sha256').update(canonicalJson(bundle.manifest)).digest('hex');
    };
    const verifyResignedForgery = (name: string, forged: typeof loaded.bundle, message: RegExp): void => {
      const forgedPath = path.join(temporary, `${name}.wwpub.json`);
      fs.writeFileSync(forgedPath, canonicalJson(forged));
      assert.doesNotThrow(() => execFileSync(process.execPath, [genericVerifier, forgedPath], { cwd: temporary }));
      assert.throws(() => execFileSync(process.execPath, [goldenVerifier, forgedPath], { cwd: temporary, stdio: 'pipe' }), message);
    };

    // Re-sign modified scientific content so generic integrity remains green;
    // the golden verifier must detect semantic binding failures independently.
    const predictionForgery = structuredClone(loaded.bundle);
    const rk4Job = predictionForgery.manifest.jobs.find((job) => {
      const entry = predictionForgery.entries.find((candidate) => candidate.path === job.specPath)!;
      return JSON.parse(Buffer.from(entry.contentBase64, 'base64').toString('utf8')).experiment.model.id === 'photosensitization-rk4';
    })!;
    rewriteEntry(predictionForgery, rk4Job.resultPath, (value) => {
      const result = value as { experiment: { outputs: Record<string, { value: number[] }> } };
      result.experiment.outputs['calibration.predictedSingletO2'].value[1] += 0.25;
      return result;
    });
    verifyResignedForgery('prediction-forged', predictionForgery, /calibration RMSE mismatch/);

    const modelForgery = structuredClone(loaded.bundle);
    rewriteEntry(modelForgery, rk4Job.specPath, (value) => {
      const spec = value as { experiment: { model: { id: string } } };
      spec.experiment.model.id = 'forged-model'; return spec;
    });
    verifyResignedForgery('model-forged', modelForgery, /exactly two RK4/);

    const evidenceForgery = structuredClone(loaded.bundle);
    const evidencePath = evidenceForgery.manifest.evidence.find((item) => item.disposition === 'embedded')!.entryPath!;
    const evidenceEntry = evidenceForgery.entries.find((entry) => entry.path === evidencePath)!;
    const evidenceBytes = Buffer.from(evidenceEntry.contentBase64, 'base64');
    const alteredEvidence = Buffer.from(evidenceBytes.toString('utf8').replace(/\n([^,]+),([^\n]+)/, (_row, time, value) => `\n${time},${Number(value) + 0.1}`));
    evidenceEntry.contentBase64 = alteredEvidence.toString('base64'); evidenceEntry.bytes = alteredEvidence.byteLength;
    evidenceEntry.sha256 = createHash('sha256').update(alteredEvidence).digest('hex');
    const evidenceMeta = evidenceForgery.manifest.entries.find((entry) => entry.path === evidencePath)!;
    evidenceMeta.bytes = evidenceEntry.bytes; evidenceMeta.sha256 = evidenceEntry.sha256;
    evidenceForgery.manifestSha256 = createHash('sha256').update(canonicalJson(evidenceForgery.manifest)).digest('hex');
    verifyResignedForgery('evidence-forged', evidenceForgery, /evidence digest mismatch/);

    process.env.WAVEWORLD_BUILD_ID = 'golden-test-build';
    const reviewIssueUrl = 'https://reviews.example.invalid/waveworld/evidence/issues/46';
    const priorReviewIssueUrl = process.env.WAVEWORLD_REVIEW_ISSUE_URL;
    context.after(() => {
      if (priorReviewIssueUrl === undefined) delete process.env.WAVEWORLD_REVIEW_ISSUE_URL;
      else process.env.WAVEWORLD_REVIEW_ISSUE_URL = priorReviewIssueUrl;
    });
    const reviewPayload = {
      schema: 'waveworld.golden-case-independent-review/v1', status: 'completed',
      reviewer: { productionAccountId: 'oidc_external_reviewer', giteaAccount: 'external-reviewer',
        nonImplementerAttestation: 'I did not implement or prepare this golden case or its publication bundle.' },
      execution: { startedAt: new Date(Date.now() - 60_000).toISOString(), finishedAt: new Date().toISOString(),
        productionBuildId: 'golden-test-build', isolatedWorkingDirectoryDescription: 'new empty temporary directory outside repository',
        publicationId: publication.publicId, bundleSha256: publication.bundleSha256,
        genericVerifierSha256: createHash('sha256').update(fs.readFileSync(path.join(waveRoot, 'scripts/verify-publication-bundle.mjs'))).digest('hex'),
        goldenVerifierSha256: createHash('sha256').update(fs.readFileSync(path.join(waveRoot, 'scripts/research/verify-golden-publication.mjs'))).digest('hex') },
      positiveVerification: { genericVerifierExitCode: 0, goldenVerifierExitCode: 0, completeLogArtifactOrIssueUrl: reviewIssueUrl },
      tamperExercise: { changedField: 'calibration.predictedSingletO2[1]', resignedTamperedBundleSha256: 'a'.repeat(64), genericVerifierExitCode: 0, goldenVerifierExitCode: 1, goldenVerifierError: 'calibration RMSE mismatch' },
      answers: { datasetAndConditions: 'Sandberg Figure 1C, air and nitrogen PBS pH 3.5', hypothesisDecision: 'fail', workflowVersusModelFailure: 'models failed the fit gate; workflow passed', claimBoundary: 'no absolute singlet-oxygen, clinical, or causal claim', cpuGpuInterpretation: 'v1 state tolerance failed without changing the scientific decision' },
      usability: { manualSteps: ['downloaded bundle', 'ran both verifiers', 'performed re-signed mutation'], failuresOrConfusion: ['NONE: protocol was self-contained'], elapsedMinutes: 12, recommendation: 'accept-with-limitations' },
      giteaIssue46CommentUrl: reviewIssueUrl,
    };
    const { submitIndependentReview, listIndependentReviews } = await import('../src/lib/independent-review-service.ts');
    const ownerOidc = { ...user, authProvider: 'oidc' as const };
    await assert.rejects(() => submitIndependentReview({ publicId: publication.publicId, payload: { ...reviewPayload, reviewer: { ...reviewPayload.reviewer, productionAccountId: ownerOidc.id } } }, ownerOidc), /owner cannot independently review/);
    await assert.rejects(() => submitIndependentReview({ publicId: publication.publicId, payload: reviewPayload }, { ...ownerOidc, id: 'dev-reviewer', authProvider: 'dev' }), /requires a W-ID/);
    const reviewer = { id: 'oidc_external_reviewer', name: 'External Reviewer', workspaceId: 'external', createdAt: new Date().toISOString(), authProvider: 'oidc' as const };
    delete process.env.WAVEWORLD_REVIEW_ISSUE_URL;
    await assert.rejects(() => submitIndependentReview({ publicId: publication.publicId, payload: reviewPayload }, reviewer), { status: 503 });
    for (const configured of [
      reviewIssueUrl.replace('https:', 'http:'),
      reviewIssueUrl.replace('https://', 'https://operator@'),
      reviewIssueUrl + '?scope=unexpected',
      reviewIssueUrl + '#issuecomment-1',
      reviewIssueUrl.replace('/46', '/not-an-issue'),
    ]) {
      process.env.WAVEWORLD_REVIEW_ISSUE_URL = configured;
      await assert.rejects(() => submitIndependentReview({ publicId: publication.publicId, payload: reviewPayload }, reviewer), { status: 503 });
    }
    process.env.WAVEWORLD_REVIEW_ISSUE_URL = reviewIssueUrl;
    for (const supplied of [
      reviewIssueUrl.replace('reviews.example.invalid', 'untrusted.example.invalid'),
      reviewIssueUrl.replace('/evidence/', '/another-repository/'),
      reviewIssueUrl.replace('/46', '/47'),
      reviewIssueUrl.replace('https://', 'https://reviewer@'),
      reviewIssueUrl + '?scope=unexpected',
      reviewIssueUrl + '#unexpected',
      reviewIssueUrl + '#issuecomment-not-a-number',
      reviewIssueUrl + '#',
      reviewIssueUrl.replace('/waveworld/', '/other/../waveworld/'),
    ]) {
      await assert.rejects(() => submitIndependentReview({ publicId: publication.publicId, payload: { ...reviewPayload, giteaIssue46CommentUrl: supplied } }, reviewer), { status: 400 });
    }
    const review = await submitIndependentReview({ publicId: publication.publicId, payload: reviewPayload }, reviewer);
    assert.equal(review.semanticDecision, 'fail');
    assert.equal(review.status, 'verified');
    assert.match(review.recordSha256, /^[a-f0-9]{64}$/);
    assert.equal(listIndependentReviews(publication.publicId, 1, reviewer).length, 1);
    assert.equal(listIndependentReviews(publication.publicId, 1, ownerOidc).length, 1);
    assert.equal(listIndependentReviews(publication.publicId, 1, { ...reviewer, id: 'oidc_bystander' }).length, 0);
    await assert.rejects(() => submitIndependentReview({ publicId: publication.publicId, payload: reviewPayload }, reviewer), /already submitted/);
    const { getSqlite } = await import('../../../apps/host/src/lib/tasks/db.ts');
    assert.throws(() => getSqlite().prepare('UPDATE independent_reviews SET status=? WHERE id=?').run('forged', review.id), /immutable/);
    assert.throws(() => getSqlite().prepare('DELETE FROM independent_reviews WHERE id=?').run(review.id), /immutable/);
    delete process.env.WAVEWORLD_BUILD_ID;
  });
});

/**
 * Residual after A-host lab-usability-honesty: deploy config gate must
 * reject loopback Lab bake, Host/Atlas base mismatch, and secret values
 * embedded in tracked example files — without printing secret values.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const waveRoot = path.resolve(here, '../../..');
const script = path.join(waveRoot, 'scripts/check-deploy-config.sh');

function runCheck(args: string[], env: Record<string, string | undefined> = {}): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const r = spawnSync('bash', [script, ...args], {
    cwd: waveRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

// Public source retains runtime/synthetic environment rejection checks. The
// separately registered private deployment metadata cases retain their assertions
// but are explicitly reported as skipped because their inputs are not distributed.
describe('check-deploy-config.sh (A-host residual)', () => {
  it('lists secret keys and never requires them for plain check', () => {
    const r = runCheck(['--list']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /TASK_API_KEY/);
    assert.match(r.stdout, /W_ID_CLIENT_SECRET/);
    assert.match(r.stdout, /AGENT_TOKEN/);
    assert.match(r.stdout, /KNOWLEDGE_WRITE_KEY/);
    assert.match(r.stdout, /KNOWLEDGE_WRITE_API_KEY/);
    assert.match(r.stdout, /# secrets \(never in git examples\)/);
  });

  it('accepts production host.env.example (no secret values)', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const example = path.join(waveRoot, 'deploy/production/host.env.example');
    const r = runCheck(['--file', example]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /examples: ok/);
    assert.match(r.stdout, /#53|preview/i);
    // Never echo secret material
    assert.doesNotMatch(r.stdout + r.stderr, /sk_|password|BEGIN /i);
  });

  it('--assert-examples passes tracked deploy examples', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const r = runCheck(['--assert-examples']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /examples: ok/);
  });

  it('fails closed on loopback NEXT_PUBLIC_LAB_URL bake', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-deploy-check-'));
    const file = path.join(dir, 'host.env');
    fs.writeFileSync(
      file,
      [
        'TASK_DB_PATH=/var/lib/waveworld/tasks.db',
        'NODE_ENV=production',
        'ARTIFACT_ROOT=/var/lib/waveworld/artifacts',
        'NEXT_PUBLIC_LAB_URL=http://127.0.0.1:3000',
        '',
      ].join('\n'),
    );
    try {
      const r = runCheck(['--file', file]);
      assert.equal(r.status, 1);
      assert.match(r.stdout, /loopback/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when Host/Atlas Lab bases differ', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-deploy-check-'));
    const file = path.join(dir, 'host.env');
    fs.writeFileSync(
      file,
      [
        'TASK_DB_PATH=/tmp/t.db',
        'NEXT_PUBLIC_LAB_URL=https://waveworld.example/app/lab',
        'VITE_LAB_URL=https://other.example/app/lab',
        '',
      ].join('\n'),
    );
    try {
      const r = runCheck(['--file', file]);
      assert.equal(r.status, 1);
      assert.match(r.stdout, /differ|identical/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when an example file embeds a non-empty secret (value not printed)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-deploy-check-'));
    const file = path.join(dir, 'host.env.example');
    const secretValue = 'super-secret-must-not-appear-in-output-xyz';
    fs.writeFileSync(
      file,
      [
        'TASK_DB_PATH=/var/lib/waveworld/tasks.db',
        `TASK_API_KEY=${secretValue}`,
        '',
      ].join('\n'),
    );
    try {
      const r = runCheck(['--file', file]);
      assert.equal(r.status, 1);
      assert.match(r.stderr + r.stdout, /TASK_API_KEY/);
      assert.match(r.stderr + r.stdout, /embeds secret|examples: FAIL/);
      assert.doesNotMatch(r.stdout + r.stderr, new RegExp(secretValue));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when example embeds KNOWLEDGE_WRITE_API_KEY (value not printed)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-deploy-check-'));
    const file = path.join(dir, 'host.env.example');
    const secretValue = 'knowledge-write-secret-must-not-print-abc';
    fs.writeFileSync(
      file,
      [
        'TASK_DB_PATH=/var/lib/waveworld/tasks.db',
        `KNOWLEDGE_WRITE_API_KEY=${secretValue}`,
        '',
      ].join('\n'),
    );
    try {
      const r = runCheck(['--file', file]);
      assert.equal(r.status, 1);
      assert.match(r.stderr + r.stdout, /KNOWLEDGE_WRITE_API_KEY/);
      assert.doesNotMatch(r.stdout + r.stderr, new RegExp(secretValue));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails when example embeds KNOWLEDGE_WRITE_KEY (value not printed)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-deploy-check-'));
    const file = path.join(dir, 'host.env.example');
    const secretValue = 'knowledge-write-key-alias-must-not-print-xyz';
    fs.writeFileSync(
      file,
      [
        'TASK_DB_PATH=/var/lib/waveworld/tasks.db',
        `KNOWLEDGE_WRITE_KEY=${secretValue}`,
        '',
      ].join('\n'),
    );
    try {
      const r = runCheck(['--file', file]);
      assert.equal(r.status, 1);
      assert.match(r.stderr + r.stdout, /KNOWLEDGE_WRITE_KEY/);
      assert.doesNotMatch(r.stdout + r.stderr, new RegExp(secretValue));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('compose healthcheck is process-ok only (not welded to a closed issue)', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const compose = fs.readFileSync(
      path.join(waveRoot, 'deploy/docker-compose.yml'),
      'utf8',
    );
    assert.match(compose, /j.ok!==true/);
    assert.doesNotMatch(compose, /blockerIssue!==49/);
    assert.doesNotMatch(compose, /TASK_API_KEY:\s*['\"][^$\{]/);
  });

  it('check-deploy-config notes pathLive gauge and no-store metrics', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const r = runCheck(['--list']);
    assert.equal(r.status, 0);
    // --list path may not print notes; assert production example + script text
    const example = fs.readFileSync(
      path.join(waveRoot, 'deploy/production/host.env.example'),
      'utf8',
    );
    assert.match(example, /waveworld_lab_path_live_not_fully_usable=1/);
    assert.match(example, /safeOperationalErrorMessage/);
    assert.match(example, /labClaimFullyUsable=false/);
    assert.doesNotMatch(example, /TASK_API_KEY=\S+/);
    const script = fs.readFileSync(
      path.join(waveRoot, 'scripts/check-deploy-config.sh'),
      'utf8',
    );
    assert.match(script, /lab_path_live_not_fully_usable=1/);
    assert.match(script, /no-store/);
    assert.match(script, /safeOperationalErrorMessage/);
    assert.match(script, /labClaimFullyUsable=false/);
  });

  it('host.env.example documents readiness/auth residual after a0c47ec (no secrets)', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const example = fs.readFileSync(
      path.join(waveRoot, 'deploy/production/host.env.example'),
      'utf8',
    );
    const unit = fs.readFileSync(
      path.join(waveRoot, 'deploy/systemd/waveworld-host.service'),
      'utf8',
    );
    assert.match(example, /auth\/config/);
    assert.match(unit, /safeOperationalErrorMessage/);
    assert.match(unit, /labClaimFullyUsable=false/);
    assert.doesNotMatch(example + unit, /TASK_API_KEY=\S+/);
    assert.doesNotMatch(example + unit, /sk_[a-zA-Z0-9]/);
  });

  it('host.env.example documents residual after 59a3fa3 (ready + auth blocker pins, no secrets)', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const example = fs.readFileSync(
      path.join(waveRoot, 'deploy/production/host.env.example'),
      'utf8',
    );
    const unit = fs.readFileSync(
      path.join(waveRoot, 'deploy/systemd/waveworld-host.service'),
      'utf8',
    );
    const script = fs.readFileSync(
      path.join(waveRoot, 'scripts/check-deploy-config.sh'),
      'utf8',
    );
    assert.match(example, /labBlockerOpen/);
    assert.match(example, /PROBE_NO_STORE_HEADERS/);
    assert.match(example, /ready=true\|false/);
    assert.match(unit, /labBlockerIssue=49/);
    assert.match(unit, /PROBE_NO_STORE_HEADERS/);
    assert.match(script, /PROBE_NO_STORE_HEADERS/);
    assert.doesNotMatch(example + unit, /TASK_API_KEY=\S+/);
  });

  it('host.env.example documents residual after 6d08a42 (readyScope + redactor + tight no-store)', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const example = fs.readFileSync(
      path.join(waveRoot, 'deploy/production/host.env.example'),
      'utf8',
    );
    const unit = fs.readFileSync(
      path.join(waveRoot, 'deploy/systemd/waveworld-host.service'),
      'utf8',
    );
    const script = fs.readFileSync(
      path.join(waveRoot, 'scripts/check-deploy-config.sh'),
      'utf8',
    );
    assert.match(example, /readyScope/);
    assert.match(example, /redactOperationalSecrets/);
    assert.match(example, /must-revalidate|private/);
    assert.match(unit, /readyScope=task-db/);
    assert.match(unit, /redactOperationalSecrets/);
    assert.match(script, /readyScope/);
    assert.match(script, /redactOperationalSecrets/);
    assert.doesNotMatch(example + unit, /TASK_API_KEY=\S+/);
  });

  it('host.env.example documents residual after 1b367e7 (okScope + jobs/stats + Expires:0)', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const example = fs.readFileSync(
      path.join(waveRoot, 'deploy/production/host.env.example'),
      'utf8',
    );
    const unit = fs.readFileSync(
      path.join(waveRoot, 'deploy/systemd/waveworld-host.service'),
      'utf8',
    );
    const script = fs.readFileSync(
      path.join(waveRoot, 'scripts/check-deploy-config.sh'),
      'utf8',
    );
    assert.match(example, /okScope=process/);
    assert.match(example, /jobs\/stats/);
    assert.match(example, /Expires:0|Expires: 0/);
    assert.match(unit, /okScope=process/);
    assert.match(unit, /jobs\/stats/);
    assert.match(script, /okScope=process/);
    assert.match(script, /jobs\/stats/);
    assert.doesNotMatch(example + unit, /TASK_API_KEY=\S+/);
  });

  it('host.env.example documents residual after aabd0bf (sameSecret + Surrogate-Control)', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const example = fs.readFileSync(
      path.join(waveRoot, 'deploy/production/host.env.example'),
      'utf8',
    );
    const unit = fs.readFileSync(
      path.join(waveRoot, 'deploy/systemd/waveworld-host.service'),
      'utf8',
    );
    const script = fs.readFileSync(
      path.join(waveRoot, 'scripts/check-deploy-config.sh'),
      'utf8',
    );
    assert.match(example, /sameSecret/);
    assert.match(example, /Surrogate-Control/);
    assert.match(unit, /sameSecret/);
    assert.match(unit, /Surrogate-Control/);
    assert.match(script, /sameSecret/);
    assert.match(script, /Surrogate-Control/);
    assert.doesNotMatch(example + unit, /TASK_API_KEY=\S+/);
  });

  it('host.env.example documents residual after 7290c1c (agents/register sameSecret + JOB_REQUIRE_AUTH list)', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const example = fs.readFileSync(
      path.join(waveRoot, 'deploy/production/host.env.example'),
      'utf8',
    );
    const unit = fs.readFileSync(
      path.join(waveRoot, 'deploy/systemd/waveworld-host.service'),
      'utf8',
    );
    const script = fs.readFileSync(
      path.join(waveRoot, 'scripts/check-deploy-config.sh'),
      'utf8',
    );
    assert.match(example, /agents\/register/);
    assert.match(example, /JOB_REQUIRE_AUTH/);
    assert.match(unit, /agents\/register/);
    assert.match(script, /agents\/register sameSecret/);
    assert.match(script, /JOB_REQUIRE_AUTH/);
    // --list must surface JOB_REQUIRE_AUTH after residual
    const list = runCheck(['--list']);
    assert.equal(list.status, 0);
    assert.match(list.stdout, /JOB_REQUIRE_AUTH/);
    assert.doesNotMatch(example + unit, /TASK_API_KEY=\S+/);
    assert.doesNotMatch(example + unit, /sk_[a-zA-Z0-9]/);
  });

  it('host.env.example documents residual after 6d2ecaa (register no-store + bind list)', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const example = fs.readFileSync(
      path.join(waveRoot, 'deploy/production/host.env.example'),
      'utf8',
    );
    const unit = fs.readFileSync(
      path.join(waveRoot, 'deploy/systemd/waveworld-host.service'),
      'utf8',
    );
    const script = fs.readFileSync(
      path.join(waveRoot, 'scripts/check-deploy-config.sh'),
      'utf8',
    );
    assert.match(example, /PROBE_NO_STORE|no-store/);
    assert.match(example, /agents\/register/);
    assert.match(example, /6d2ecaa|register.*no-store|token/);
    assert.match(unit, /agents\/register/);
    assert.match(unit, /PROBE_NO_STORE|no-store/);
    assert.match(script, /6d2ecaa|register.*PROBE_NO_STORE|agents\/register no-store/);
    // --list surfaces loopback bind knobs (WAVEWORLD_BIND_HOST / PORT)
    const list = runCheck(['--list']);
    assert.equal(list.status, 0);
    assert.match(list.stdout, /WAVEWORLD_BIND_HOST/);
    assert.match(list.stdout, /PORT/);
    assert.doesNotMatch(example + unit, /TASK_API_KEY=\S+/);
    assert.doesNotMatch(example + unit, /sk_[a-zA-Z0-9]/);
  });

  it('host.env.example documents residual after f8da984 (register key-always + jobs/stats JOB_REQUIRE_AUTH)', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const example = fs.readFileSync(
      path.join(waveRoot, 'deploy/production/host.env.example'),
      'utf8',
    );
    const unit = fs.readFileSync(
      path.join(waveRoot, 'deploy/systemd/waveworld-host.service'),
      'utf8',
    );
    const script = fs.readFileSync(
      path.join(waveRoot, 'scripts/check-deploy-config.sh'),
      'utf8',
    );
    assert.match(example, /f8da984|configured key always|jobs\/stats honors JOB_REQUIRE_AUTH|share tokens min-length/);
    assert.match(example, /JOB_REQUIRE_AUTH/);
    assert.match(unit, /f8da984|configured-key-always|jobs\/stats JOB_REQUIRE_AUTH|share token min-length/);
    assert.match(script, /f8da984|configured-key-always|jobs\/stats JOB_REQUIRE_AUTH|share token min-length/);
    // --list still surfaces JOB_REQUIRE_AUTH (prod-like gates)
    const list = runCheck(['--list']);
    assert.equal(list.status, 0);
    assert.match(list.stdout, /JOB_REQUIRE_AUTH/);
    assert.doesNotMatch(example + unit, /TASK_API_KEY=\S+/);
    assert.doesNotMatch(example + unit, /sk_[a-zA-Z0-9]/);
    // never claim Lab fully usable in residual notes
    assert.match(example, /Do not claim Lab fully usable/);
  });

  it('host.env.example documents residual after c72cf29 (share base64url+max + no-store + CORS)', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const example = fs.readFileSync(
      path.join(waveRoot, 'deploy/production/host.env.example'),
      'utf8',
    );
    const unit = fs.readFileSync(
      path.join(waveRoot, 'deploy/systemd/waveworld-host.service'),
      'utf8',
    );
    const script = fs.readFileSync(
      path.join(waveRoot, 'scripts/check-deploy-config.sh'),
      'utf8',
    );
    assert.match(example, /c72cf29|share tokens base64url|shares POST no-store|x-waveworld-share/);
    assert.match(unit, /c72cf29|share base64url|shares POST no-store|x-waveworld-share/);
    assert.match(script, /c72cf29|share base64url|shares POST no-store|x-waveworld-share/);
    assert.doesNotMatch(example + unit, /TASK_API_KEY=\S+/);
    assert.doesNotMatch(example + unit, /sk_[a-zA-Z0-9]/);
    assert.match(example, /Do not claim Lab fully usable/);
  });

  it('host.env.example documents residual after wave30 (share TTL clamp + applied expiresInSeconds + revoke no-store)', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const example = fs.readFileSync(
      path.join(waveRoot, 'deploy/production/host.env.example'),
      'utf8',
    );
    const unit = fs.readFileSync(
      path.join(waveRoot, 'deploy/systemd/waveworld-host.service'),
      'utf8',
    );
    const script = fs.readFileSync(
      path.join(waveRoot, 'scripts/check-deploy-config.sh'),
      'utf8',
    );
    assert.match(example, /wave30|share TTL clamp|expiresInSeconds|shares DELETE no-store/);
    assert.match(unit, /wave30|share TTL clamp|expiresInSeconds|revoke DELETE no-store/);
    assert.match(script, /wave30|share TTL clamp|expiresInSeconds|revoke DELETE no-store/);
    assert.doesNotMatch(example + unit, /TASK_API_KEY=\S+/);
    assert.doesNotMatch(example + unit, /sk_[a-zA-Z0-9]/);
    assert.match(example, /Do not claim Lab fully usable/);
  });

  it('host.env.example documents residual after wave31 (share all-path no-store + normalize TTL + title clamp)', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const example = fs.readFileSync(
      path.join(waveRoot, 'deploy/production/host.env.example'),
      'utf8',
    );
    const unit = fs.readFileSync(
      path.join(waveRoot, 'deploy/systemd/waveworld-host.service'),
      'utf8',
    );
    const script = fs.readFileSync(
      path.join(waveRoot, 'scripts/check-deploy-config.sh'),
      'utf8',
    );
    assert.match(
      example,
      /wave31|normalizeShareExpiresInSeconds|shares POST\/DELETE all-path|title clamp|SHARE_JOBS_MAX/,
    );
    assert.match(
      unit,
      /wave31|normalizeShareExpiresInSeconds|shares POST\/DELETE all-path|title clamp|SHARE_JOBS_MAX/,
    );
    assert.match(
      script,
      /wave31|normalizeShareExpiresInSeconds|shares POST\/DELETE all-path|title clamp|SHARE_JOBS_MAX/,
    );
    // Residual after wave32: share id UUID gate documented in deploy residual notes
    assert.match(
      example,
      /wave32|isPlausibleShareId|invalid share id|UUID/,
    );
    assert.match(
      unit,
      /wave32|isPlausibleShareId|UUID gate/,
    );
    assert.match(
      script,
      /wave32|isPlausibleShareId|invalid share id/,
    );
    // Residual after wave33: shares POST jobIds normalize documented
    assert.match(
      example,
      /wave33|normalizeShareJobIds|invalid job id/,
    );
    assert.match(
      unit,
      /wave33|normalizeShareJobIds/,
    );
    assert.match(
      script,
      /wave33|normalizeShareJobIds|invalid job id/,
    );
    // Residual after wave34: publications POST reuses normalizeShareJobIds
    assert.match(
      example,
      /wave34|publications POST.*normalizeShareJobIds|normalizeShareJobIds.*publications/,
    );
    assert.match(
      unit,
      /wave34|publications POST.*normalizeShareJobIds|normalizeShareJobIds.*publications/,
    );
    assert.match(
      script,
      /wave34|publications POST.*normalizeShareJobIds|normalizeShareJobIds.*publications/,
    );
    // Residual after wave35: publications publicId / version format gate documented
    assert.match(
      example,
      /wave35|isPlausiblePublicId|normalizePublicationVersion|invalid publication id/,
    );
    assert.match(
      unit,
      /wave35|isPlausiblePublicId|normalizePublicationVersion/,
    );
    assert.match(
      script,
      /wave35|isPlausiblePublicId|normalizePublicationVersion|invalid publication/,
    );
    // Residual after wave36: jobs/[id] path isPlausibleJobId gate documented
    assert.match(
      example,
      /wave36|isPlausibleJobId.*jobs\/\[id\]|jobs\/\[id\].*isPlausibleJobId|isPlausibleJobId on jobs/,
    );
    assert.match(
      unit,
      /wave36|isPlausibleJobId on jobs/,
    );
    assert.match(
      script,
      /wave36|isPlausibleJobId on jobs|invalid job id \(not dishonest 404/,
    );
    // Residual after wave37: normalizeJobId across jobs/[id]/* + shareAllowsJob
    assert.match(
      example,
      /wave37|normalizeJobId on jobs|shareAllowsJob jobId/,
    );
    assert.match(
      unit,
      /wave37|normalizeJobId on jobs|shareAllowsJob jobId/,
    );
    assert.match(
      script,
      /wave37|normalizeJobId on jobs|shareAllowsJob jobId/,
    );
    // Residual after wave38: normalizeShareId + normalizeProjectId + attach jobId
    assert.match(
      example,
      /wave38|normalizeShareId|normalizeProjectId|attach body\.jobId/,
    );
    assert.match(
      unit,
      /wave38|normalizeShareId|normalizeProjectId|attach body\.jobId/,
    );
    assert.match(
      script,
      /wave38|normalizeShareId|normalizeProjectId|attach body\.jobId/,
    );
    // Residual after wave39: project members/models path gates + normalizeModelId
    assert.match(
      example,
      /wave39|normalizeModelId|projects\/\[id\]\/members|projects\/\[id\]\/models/,
    );
    assert.match(
      unit,
      /wave39|normalizeModelId|projects\/\[id\]\/members|projects\/\[id\]\/models/,
    );
    assert.match(
      script,
      /wave39|normalizeModelId|projects\/\[id\]\/members|projects\/\[id\]\/models/,
    );
    // Residual after wave40: artifacts/evidence/comparisons path id gates + artifact jobId
    assert.match(
      example,
      /wave40|normalizeArtifactId|normalizeEvidenceId|normalizeComparisonId|artifacts POST body\.jobId/,
    );
    assert.match(
      unit,
      /wave40|normalizeArtifactId|normalizeEvidenceId|normalizeComparisonId|artifacts POST body\.jobId/,
    );
    assert.match(
      script,
      /wave40|normalizeArtifactId|normalizeEvidenceId|normalizeComparisonId|artifacts POST body\.jobId/,
    );
    // Residual after wave41: comparisons POST jobIds + artifacts projectId/GET filters + evidence import
    assert.match(
      example,
      /wave41|comparisons POST normalizeShareJobIds|artifacts POST\/GET projectId|evidence import projectId/,
    );
    assert.match(
      unit,
      /wave41|comparisons POST normalizeShareJobIds|artifacts POST\/GET projectId|evidence import projectId/,
    );
    assert.match(
      script,
      /wave41|comparisons POST normalizeShareJobIds|artifacts POST\/GET projectId|evidence import projectId/,
    );
    assert.doesNotMatch(example + unit, /TASK_API_KEY=\S+/);
    assert.doesNotMatch(example + unit, /sk_[a-zA-Z0-9]/);
    assert.match(example, /Do not claim Lab fully usable/);
  });
});

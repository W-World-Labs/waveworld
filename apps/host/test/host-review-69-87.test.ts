/**
 * Structural + helper tests for review issues #69–#87.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const waveRoot = path.resolve(here, '../../..');

describe('review #69–#87 structural gates', () => {
  it('#70/#81/#91 sample catalog is labeled and not served as latest', async () => {
    const index = JSON.parse(
      fs.readFileSync(path.join(waveRoot, 'public/knowledge-releases/index.json'), 'utf8'),
    );
    assert.equal(index.sample, true);
    const {
      browserCatalogIsSample,
      catalogDivergesFromDbWithoutSample,
      fetchLatestReleased,
      fetchReleaseIndex,
    } = await import('../../../src/lib/knowledge/atlas/browserCatalog.ts');
    assert.equal(browserCatalogIsSample(index), true);
    assert.equal(browserCatalogIsSample({ ids: ['kr-real'] }), false);
    assert.equal(catalogDivergesFromDbWithoutSample(index, 'kr-other'), false);
    assert.equal(catalogDivergesFromDbWithoutSample({ ids: ['kr-file'] }, 'kr-db'), true);
    const parsed = await fetchReleaseIndex(
      '/knowledge-releases',
      async () => new Response(JSON.stringify(index), { status: 200 }),
    );
    assert.equal(parsed.sample, true);
    assert.equal(
      await fetchLatestReleased('/knowledge-releases', async () =>
        new Response(JSON.stringify(index), { status: 200 }),
      ),
      null,
    );
  });

  it('#89 tuanliu jobs POST assembles via shared resolveJob', () => {
    const route = fs.readFileSync(
      path.join(waveRoot, 'apps/lab/src/app/api/v1/jobs/route.ts'),
      'utf8',
    );
    assert.match(route, /body\.knowledge/);
    assert.match(route, /resolveCanonicalHostJobsUrl/);
    assert.match(route, /X-WaveWorld-Canonical-Jobs|successor-version/);
    assert.ok(fs.existsSync(path.join(waveRoot, 'src/lib/knowledge-db/assemble-job-spec.ts')));
  });

  it('#90 Host lab URL is a thin wrapper over Atlas resolveLabUiBase', () => {
    const host = fs.readFileSync(path.join(waveRoot, 'apps/host/src/lib/lab-entry.ts'), 'utf8');
    assert.match(host, /sharedResolveLabUiBase/);
    assert.doesNotMatch(host, /Public host: never expose loopback lab to visitors/);
  });

  it('#71 next configs no longer ignore TS build errors', () => {
    const host = fs.readFileSync(path.join(waveRoot, 'apps/host/next.config.mjs'), 'utf8');
    const lab = fs.readFileSync(path.join(waveRoot, 'apps/lab/next.config.ts'), 'utf8');
    assert.doesNotMatch(host, /ignoreBuildErrors:\s*true/);
    assert.doesNotMatch(lab, /ignoreBuildErrors:\s*true/);
  });

  it('#72 VERSION_REPORT records a time-boxed preview exception', () => {
    const src = fs.readFileSync(path.join(waveRoot, 'apps/lab/VERSION_REPORT.md'), 'utf8');
    assert.match(src, /time-boxed exception/i);
    assert.match(src, /2026-10-01/);
  });

  it('#73 Host and tuanliu default to repo data/tasks.db', async () => {
    const { resolveDefaultTaskDbPath } = await import('@/lib/tasks/db.ts');
    const host = resolveDefaultTaskDbPath('/opt/ww/apps/host', {});
    const lab = resolveDefaultTaskDbPath('/opt/ww/apps/lab', {});
    assert.match(host, /data\/tasks\.db$/);
    assert.equal(path.normalize(host), path.normalize(lab));
    const pinned = resolveDefaultTaskDbPath('/tmp', { TASK_DB_PATH: '/var/lib/waveworld/tasks.db' });
    assert.equal(pinned, '/var/lib/waveworld/tasks.db');
  });

  it('CI consumes the pinned W-Sim vendor bundle, agent tests, and budget', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const ci = fs.readFileSync(path.join(waveRoot, '.gitea/workflows/ci.yml'), 'utf8');
    const deploy = fs.readFileSync(path.join(waveRoot, '.gitea/workflows/deploy.yml'), 'utf8');
    const setupNode = fs.readFileSync(
      path.join(waveRoot, 'scripts/ci/setup-node-runtime.sh'),
      'utf8',
    );
    for (const src of [ci]) {
      assert.match(src, /test:smoke --prefix apps\/lab/);
      assert.doesNotMatch(src, /npm run test:models/);
      assert.doesNotMatch(src, /20-15-w-sim|WSIM_REF|build-wsim-sibling/);
      assert.doesNotMatch(src, /token:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
      assert.match(src, /uses:\s*actions\/upload-artifact@81f940d004763f986ba3582c007fd842dd5cb0d7/);
      assert.match(src, /setup-node-runtime\.sh/);
      assert.match(src, /for attempt in 1 2 3/);
      assert.match(src, /npx playwright install --with-deps chromium/);
      assert.match(src, /if \[ "\$attempt" -eq 3 \]; then\s+exit 1/);
      assert.match(src, /verify-wsim-vendor\.mjs|--check-wsim-vendor/);
      assert.match(src, /tsconfig.app.tests.json/);
      assert.match(src, /npm run budget/);
      // The agent suite runs via the src/*.test.ts glob — the full surface,
      // not a nameable file list that would orphan newly added tests.
      assert.match(src, /agent\/src\/\*\.test\.ts/);
    }
    assert.match(ci, /Package and smoke the single WaveWorld release/);
    assert.match(deploy, /gitea-download-artifact/);
    assert.doesNotMatch(deploy, /npm-ci-retry|\bnpm ci\b|\bnpm install\b/);
    assert.match(setupNode, /hostedtoolcache\/node\/22/);
    assert.match(setupNode, /Node 22 ABI 127/);
    assert.ok(fs.existsSync(path.join(waveRoot, 'tsconfig.app.tests.json')));
    const budget = fs.readFileSync(path.join(waveRoot, 'scripts/check-bundle-budget.mjs'), 'utf8');
    assert.match(budget, /totalKb:\s*7500/);
  });

  it('CI derives job-scoped preview and Lab ports for browser tests', () => {
    const ci = fs.readFileSync(path.join(waveRoot, '.github/workflows/source.yml'), 'utf8');
    const playwright = fs.readFileSync(path.join(waveRoot, 'playwright.config.ts'), 'utf8');
    const labNext = fs.readFileSync(path.join(waveRoot, 'apps/lab/next.config.ts'), 'utf8');
    const configurePorts = fs.readFileSync(
      path.join(waveRoot, 'scripts/ci/configure-e2e-ports.sh'),
      'utf8',
    );

    assert.match(ci, /bash scripts\/ci\/configure-e2e-ports\.sh/);
    assert.doesNotMatch(ci, /E2E_LAB_PORT:\s*4180/);
    assert.match(configurePorts, /GITHUB_RUN_ID % 10000/);
    assert.match(configurePorts, /E2E_PORT=\$preview_port/);
    assert.match(configurePorts, /E2E_LAB_PORT=\$lab_port/);
    assert.match(configurePorts, /VITE_LAB_URL=http:\/\/127\.0\.0\.1:\$lab_port/);
    assert.match(configurePorts, />> "\$GITHUB_ENV"/);
    assert.match(playwright, /npm run dev --prefix apps\/lab -- --webpack/);
    assert.match(playwright, /WAVEWORLD_LAB_FRAME_ANCESTOR=http:\/\/127\.0\.0\.1:\$\{port\}/);
    assert.doesNotMatch(playwright, /bypassCSP:\s*true/);
    assert.match(playwright, /url:\s*`\$\{labURL\}\/lab`/);
    assert.match(labNext, /requireFromLab\.resolve\(`@w-sim\/solvers-lbm\/\$\{name\}`\)/);
    assert.match(labNext, /"@w-sim\/solvers-lbm\/d3q19":\s*resolveLbmEntry\("d3q19"\)/);
    const labProxy = fs.readFileSync(path.join(waveRoot, 'apps/lab/src/proxy.ts'), 'utf8');
    assert.match(labProxy, /process\.env\.WAVEWORLD_LAB_FRAME_ANCESTOR/);
  });

  it('Host lockfile resolves W-Sim packages from the pinned vendor artifacts', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(waveRoot, 'apps/host/package.json'), 'utf8'),
    );
    const packageLock = JSON.parse(
      fs.readFileSync(path.join(waveRoot, 'apps/host/package-lock.json'), 'utf8'),
    );
    for (const packageName of ['contracts', 'kit', 'runtime']) {
      const dependency = `@w-sim/${packageName}`;
      const filename = `w-sim-${packageName}-0.3.0.tgz`;
      const relativePath = `../../vendor/w-sim/${filename}`;
      assert.equal(packageJson.dependencies[dependency], `file:${relativePath}`);
      assert.equal(packageLock.packages[`node_modules/${dependency}`].resolved, `file:${relativePath}`);
      assert.ok(packageLock.packages[`node_modules/${dependency}`].integrity);
    }
  });

  it('#88 honesty defaults to open #53, not closed #49/#79', async () => {
    const { hostLabUsabilityHonesty } = await import('../src/lib/lab-entry.ts');
    const def = hostLabUsabilityHonesty({});
    assert.equal(def.blockerIssue, 53);
    assert.equal(def.claimFullyUsable, false);
    assert.doesNotMatch(def.noteEn, /#49|#79/);
    const overridden = hostLabUsabilityHonesty({ WAVEWORLD_LAB_BLOCKER_ISSUE: '88' });
    assert.equal(overridden.blockerIssue, 88);
    const live = hostLabUsabilityHonesty({ WAVEWORLD_LAB_CLAIM_FULLY_USABLE: '1' });
    assert.equal(live.claimFullyUsable, true);
  });

  it('private compose preserves open Lab usability blockers', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const compose = fs.readFileSync(path.join(waveRoot, 'deploy/docker-compose.yml'), 'utf8');
    assert.doesNotMatch(compose, /blockerIssue!==49/);
    assert.doesNotMatch(compose, /blockerIssue!==79/);
  });

  it('#80 inventory floors are not all 1', async () => {
    const { KNOWLEDGE_INVENTORY_FLOORS } = await import(
      '../../../src/lib/knowledge-db/check-inventory-floors.ts'
    );
    assert.ok(KNOWLEDGE_INVENTORY_FLOORS.nodes >= 50);
    assert.ok(KNOWLEDGE_INVENTORY_FLOORS.edges >= 100);
    assert.ok(KNOWLEDGE_INVENTORY_FLOORS.claims >= 50);
  });

  it('#82/#83/#84/#85/#87 docs state shipping honesty', () => {
    const golden = fs.readFileSync(path.join(waveRoot, 'research/golden-case/README.md'), 'utf8');
    assert.match(golden, /not\*\* complete|not a peer-reviewed|independently reviewed/i);
    const readme = fs.readFileSync(path.join(waveRoot, 'README.md'), 'utf8');
    assert.match(readme, /Vite Atlas/);
    assert.match(readme, /not complete engineering engines/);
    const layers = fs.readFileSync(path.join(waveRoot, 'docs/platform-layers.md'), 'utf8');
    assert.match(layers, /knowledgeDbReleaseId/);
    assert.doesNotMatch(layers, /必有\*\* `knowledgeReleaseId`/);
    const backend = fs.readFileSync(path.join(waveRoot, 'docs/platform-upgrade-backend.md'), 'utf8');
    assert.match(backend, /Vite Atlas/);
    assert.doesNotMatch(backend, /v3 默认入口切到 Next/);
  });

  it('private runtime release documentation and CLI retain their contract', { skip: "Private forge/deployment fixtures are outside the public source distribution; no private deployment acceptance is claimed." }, () => {
    const deploy = fs.readFileSync(path.join(waveRoot, 'docs/deploy.md'), 'utf8');
    assert.match(deploy, /single CI-built release package/i);
    const prod = fs.readFileSync(path.join(waveRoot, 'scripts/deploy-waveworld-release.sh'), 'utf8');
    assert.match(prod, /--archive TAR/);
  });

  it('capability CLI reports a source inventory without inventing overall completion', () => {
    const reportFiles = ['json', 'md'].map(extension => path.join(waveRoot, `runtime/capability-coverage.${extension}`));
    const previous = reportFiles.map(file => fs.existsSync(file) ? fs.readFileSync(file) : null);
    const run = spawnSync(process.execPath, ['scripts/loops/capability-coverage.mjs', '--json', '--no-write'], {
      cwd: waveRoot, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
      env: { ...process.env, CAPABILITY_COVERAGE_STRICT: '0' },
    });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.schemaVersion, 2);
    assert.equal(report.scope, 'source-inventory');
    assert.doesNotMatch(run.stdout, /"(?:overall_pct|scores|score_pct|auto_derives_from_compose)"\s*:/);
    assert.equal(report.assessment.product_completion, 'not-assessed');
    assert.equal(report.assessment.numerical_validation, 'not-run');
    assert.equal(report.assessment.production_health, 'not-checked');
    assert.equal(report.layers.solver_packages.tests_executed, false);
    assert.equal(report.layers.principle_bridge.verification, 'not-run');
    assert.match(report.layers.kind_registry.note, /no solver execution or live service probe/i);
    assert.ok(Number.isSafeInteger(report.layers.source.sim_leaf_ts_files) && report.layers.source.sim_leaf_ts_files > 0);
    reportFiles.forEach((file, index) => {
      assert.deepEqual(fs.existsSync(file) ? fs.readFileSync(file) : null, previous[index], '--no-write must preserve existing or absent reports');
    });
  });

  it('strict source inventory fails when W-Sim registration evidence is missing', () => {
    const temporary = fs.mkdtempSync(path.join(tmpdir(), 'waveworld-missing-capability-'));
    try {
      const wsimRoot = path.join(temporary, 'w-sim');
      for (const hasOwnerTable of [false, true]) {
        if (hasOwnerTable) {
          fs.mkdirSync(path.join(wsimRoot, 'scripts'), { recursive: true });
          fs.writeFileSync(path.join(wsimRoot, 'scripts/check-kind-matrix.mjs'), `
            export const PRODUCTION_KIND_OWNERS = { 'declared-only': ['solvers-fixture'] };
            export const runKindMatrixCheck = ({ builtinKinds }) => ({ ok: true, coveredLive: builtinKinds, uncovered: [] });
          `);
        }
        const run = spawnSync(process.execPath, ['scripts/loops/capability-coverage.mjs', '--json', '--no-write', '--strict'], {
          cwd: waveRoot, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
          env: { ...process.env, WSIM_ROOT: wsimRoot, CAPABILITY_COVERAGE_STRICT: '0' },
        });
        assert.equal(run.status, 1, run.stdout + run.stderr);
        const report = JSON.parse(run.stdout);
        assert.equal(report.schemaVersion, 2);
        assert.equal(report.scope, 'source-inventory');
        assert.doesNotMatch(run.stdout, /"(?:overall_pct|scores|score_pct|auto_derives_from_compose)"\s*:/);
        assert.equal(report.assessment.product_completion, 'not-assessed');
        assert.equal(report.assessment.numerical_validation, 'not-run');
        assert.equal(report.layers.kind_registry.kind_matrix_ok, false);
        for (const key of ['builtin_count', 'declared_count', 'builtin_kinds', 'declared_kinds_with_packages', 'uncovered']) {
          assert.equal(report.layers.kind_registry[key], null, `${key} must remain unknown when evidence is absent`);
        }
        assert.match(report.layers.kind_registry.errors.join('\n'), hasOwnerTable ? /contracts\/dist\/job-spec\.js/ : /check-kind-matrix\.mjs missing/);
        assert.equal(report.layers.solver_packages.package_count, 0);
        assert.equal(report.layers.solver_packages.tests_executed, false);
        assert.equal(report.layers.principle_bridge.available, false);
        assert.equal(report.layers.principle_bridge.verification, 'not-run');
        assert.match(report.layers.principle_bridge.reason, /unavailable/i);
      }
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });

  it('#86 / #96 source parts exist and budget script passes', () => {
    const script = path.join(waveRoot, 'scripts/check-source-budgets.mjs');
    assert.ok(fs.existsSync(script));
    assert.ok(fs.existsSync(path.join(waveRoot, 'src/data/methods/parts/wave.ts')));
    assert.ok(fs.existsSync(path.join(waveRoot, 'src/data/applications/parts/app-solar-cell.ts')));
    assert.ok(fs.existsSync(path.join(waveRoot, 'src/lib/principle-depth/parts/kind-lbm-d3q19.ts')));
    assert.ok(fs.existsSync(path.join(waveRoot, 'CODEOWNERS')));
    const { spawnSync } = require('node:child_process');
    const r = spawnSync(process.execPath, [script], { encoding: 'utf8', cwd: waveRoot });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});

#!/usr/bin/env node
/**
 * 构建 tuanliu-agent 独立二进制（Node SEA）+ 旁路 Dawn 原生库
 *
 * 产出：
 *   bin/tuanliu-agent           # 真二进制（基于当前 node 注入 SEA blob）
 *   bin/native/*.dawn.node      # WebGPU 原生绑定（运行时 dlopen）
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'bin');
const NATIVE_DIR = path.join(OUT_DIR, 'native');
const BUNDLE = path.join(OUT_DIR, 'tuanliu-agent.cjs');
const BLOB = path.join(OUT_DIR, 'sea-prep.blob');
const BINARY = path.join(OUT_DIR, 'tuanliu-agent');
const SEA_CONFIG = path.join(OUT_DIR, 'sea-config.json');
const PROVENANCE_FILE = path.join(OUT_DIR, 'agent-build-provenance.json');

function log(msg) {
  console.log(`→ ${msg}`);
}

function digestFiles(files) {
  const hash = createHash('sha256');
  for (const file of files.sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(`${file.name}\0`, 'utf8');
    hash.update(fs.readFileSync(file.path));
    hash.update('\0', 'utf8');
  }
  return hash.digest('hex');
}

function writeBuildProvenance() {
  const modelImplementationSha256 = digestFiles([
    { name: 'agent/src/path-experiment-runner.ts', path: path.join(ROOT, 'agent/src/path-experiment-runner.ts') },
    { name: 'src/lib/sim/photosensitization.ts', path: path.resolve(ROOT, '../../src/lib/sim/photosensitization.ts') },
  ]);
  const dependencyLockSha256 = digestFiles([
    { name: 'agent/package-lock.json', path: path.join(ROOT, 'agent/package-lock.json') },
  ]);
  const agentBuildId = process.env.WAVEWORLD_BUILD_ID || process.env.BUILD_ID || process.env.GIT_SHA || `dev-${modelImplementationSha256.slice(0, 16)}`;
  fs.writeFileSync(PROVENANCE_FILE, JSON.stringify({ agentBuildId, modelImplementationSha256, dependencyLockSha256 }, null, 2));
  log(`build provenance → ${PROVENANCE_FILE}`);
}

function copyDawnNatives() {
  const srcDist = path.join(ROOT, 'agent/node_modules/webgpu/dist');
  if (!fs.existsSync(srcDist)) {
    console.error('agent/node_modules/webgpu missing — run: npm install --prefix agent --legacy-peer-deps');
    process.exit(1);
  }
  fs.mkdirSync(NATIVE_DIR, { recursive: true });
  for (const f of fs.readdirSync(srcDist)) {
    if (!f.endsWith('.dawn.node') && !f.endsWith('.dll')) continue;
    fs.copyFileSync(path.join(srcDist, f), path.join(NATIVE_DIR, f));
  }
  // 当前平台也放一份到 bin/ 旁，方便默认查找
  const plat =
    process.platform === 'darwin'
      ? 'darwin-universal.dawn.node'
      : process.platform === 'linux'
        ? `linux-${process.arch}.dawn.node`
        : 'win32-x64.dawn.node';
  const src = path.join(NATIVE_DIR, plat);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(OUT_DIR, plat));
  }
  log(`copied Dawn natives → ${NATIVE_DIR}`);
}

async function bundleJs() {
  log('esbuild bundle (node cjs)');
  await build({
    entryPoints: [path.join(ROOT, 'agent/src/cli.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: BUNDLE,
    sourcemap: false,
    minify: false,
    // 原生模块运行时加载，不打进 bundle
    external: [],
    // 解析 @/* 与 .ts 扩展
    alias: {
      '@': path.join(ROOT, 'src'),
    },
    // 允许 import .ts
    loader: { '.ts': 'ts', '.tsx': 'ts' },
    banner: {
      // SEA / cjs: 提供 import.meta.url 兼容
      js: `
const __sea_import_meta_url = require('url').pathToFileURL(__filename).href;
`.trim(),
    },
    define: {
      'import.meta.url': '__sea_import_meta_url',
    },
    logLevel: 'info',
  });
  log(`bundle → ${BUNDLE} (${(fs.statSync(BUNDLE).size / 1024).toFixed(1)} KB)`);
}

function buildSea() {
  log('Node SEA config');
  fs.writeFileSync(
    SEA_CONFIG,
    JSON.stringify(
      {
        main: BUNDLE,
        output: BLOB,
        disableExperimentalSEAWarning: true,
        useSnapshot: false,
        useCodeCache: true,
      },
      null,
      2
    )
  );

  execFileSync(process.execPath, ['--experimental-sea-config', SEA_CONFIG], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  // 复制 node 可执行文件
  fs.copyFileSync(process.execPath, BINARY);
  fs.chmodSync(BINARY, 0o755);

  // 注入 blob
  log('inject SEA blob (postject)');
  let postjectBin;
  try {
    postjectBin = require.resolve('postject/dist/cli.js');
  } catch {
    execSync('npm install postject --no-save --legacy-peer-deps', {
      cwd: ROOT,
      stdio: 'inherit',
    });
    postjectBin = require.resolve('postject/dist/cli.js');
  }

  const args = [
    postjectBin,
    BINARY,
    'NODE_SEA_BLOB',
    BLOB,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ];
  if (process.platform === 'darwin') {
    args.push('--macho-segment-name', 'NODE_SEA');
  }
  execFileSync(process.execPath, args, { stdio: 'inherit' });

  // macOS 签名（ad-hoc，否则 dyld 可能拒载）
  if (process.platform === 'darwin') {
    try {
      execFileSync('codesign', ['--sign', '-', '--force', BINARY], { stdio: 'inherit' });
      log('ad-hoc codesign ok');
    } catch {
      console.warn('warn: codesign failed (optional)');
    }
  }

  const size = (fs.statSync(BINARY).size / 1024 / 1024).toFixed(1);
  log(`binary → ${BINARY} (${size} MB)`);
}

function writeReadme() {
  fs.writeFileSync(
    path.join(OUT_DIR, 'README.md'),
    `# tuanliu-agent binary

\`\`\`bash
./bin/tuanliu-agent register --name my-gpu
./bin/tuanliu-agent run
./bin/tuanliu-agent submit --preset cylinder --steps 1000
./bin/tuanliu-agent probe
\`\`\`

Dawn 原生库在 \`bin/native/\`（也可放在二进制同目录）。

环境变量：
- \`TASK_API_URL\` API 地址
- \`AGENT_TOKEN\` / \`data/agent-token.json\`
- \`TUANLIU_ROOT\` 项目根（含 public/models）
- \`DAWN_NODE_PATH\` 强制指定 .node 路径
`
  );
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeBuildProvenance();
  if (!fs.existsSync(path.join(ROOT, 'agent/node_modules/webgpu'))) {
    execSync('npm install --prefix agent --legacy-peer-deps', { cwd: ROOT, stdio: 'inherit' });
  }
  copyDawnNatives();
  await bundleJs();
  if (process.argv.includes('--bundle-only')) {
    log('bundle-only mode: skipped Node SEA executable packaging');
    console.log('\n✓ done');
    console.log(`  ${BUNDLE}`);
    console.log(`  ${NATIVE_DIR}/`);
    return;
  }
  buildSea();
  writeReadme();
  console.log('\n✓ done');
  console.log(`  ${BINARY}`);
  console.log(`  ${NATIVE_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

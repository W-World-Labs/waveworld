import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { inspectTarGz } from './safe-tar.mjs';

const root = resolve(process.env.WSIM_VERIFY_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const vendor = resolve(root, 'vendor/w-sim');
const manifest = JSON.parse(readFileSync(resolve(vendor, 'manifest.json'), 'utf8'));
if (manifest.schemaVersion !== 1 || manifest.source?.workingTreeClean !== true) {
  throw new Error('W-Sim vendor manifest must identify a clean, versioned source tree');
}
if (!/^[0-9a-f]{40}$/.test(manifest.source?.revision ?? '')) {
  throw new Error('W-Sim vendor manifest has no immutable source revision');
}
if (!Array.isArray(manifest.npmPackages) || !Array.isArray(manifest.rustCrates)) {
  throw new Error('W-Sim vendor manifest is missing artifact lists');
}
for (const artifact of [...manifest.npmPackages, ...manifest.rustCrates]) {
  if (typeof artifact.filename !== 'string' || artifact.filename !== artifact.filename.split('/').at(-1) ||
      !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0 ||
      !/^[0-9a-f]{64}$/.test(artifact.sha256 ?? '')) {
    throw new Error('W-Sim vendor manifest contains an invalid artifact entry');
  }
  const bytes = readFileSync(resolve(vendor, artifact.filename));
  if (bytes.byteLength !== artifact.sizeBytes) {
    throw new Error(`W-Sim vendor size mismatch: ${artifact.filename}`);
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== artifact.sha256) {
    throw new Error(`W-Sim vendor checksum mismatch: ${artifact.filename}`);
  }
  if (artifact.sourceRevision !== undefined && !/^[0-9a-f]{40}$/.test(artifact.sourceRevision)) {
    throw new Error(`W-Sim artifact has invalid source provenance: ${artifact.filename}`);
  }
}
for (const artifact of manifest.rustCrates) {
  if (!/^[0-9a-f]{40}$/.test(artifact.sourceRevision ?? '')) {
    throw new Error(`W-Sim Rust artifact has no independent source revision: ${artifact.filename}`);
  }
}
for (const crate of manifest.rustCrates) {
  const extracted = resolve(root, 'vendor/w-sim-kernels');
  const scratch = mkdtempSync(resolve(tmpdir(), 'waveworld-wsim-crate-'));
  try {
    inspectTarGz(readFileSync(resolve(vendor, crate.filename)));
    execFileSync('tar', ['-xzf', resolve(vendor, crate.filename), '-C', scratch], { stdio: 'ignore' });
    const archiveRoot = resolve(scratch, `w-sim-kernels-${crate.version}`);
    const entries = (base, ignoreBuildTarget = false) => {
      const result = [];
      const walk = (dir, prefix = '') => {
        for (const name of readdirSync(dir).sort()) {
          if (ignoreBuildTarget && prefix === '' && name === 'target') continue;
          const rel = prefix ? `${prefix}/${name}` : name;
          const path = resolve(dir, name);
          const stat = lstatSync(path);
          if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
            throw new Error(`unsupported W-Sim crate entry: ${rel}`);
          }
          if (stat.isDirectory()) walk(path, rel);
          else result.push([rel, createHash('sha256').update(readFileSync(path)).digest('hex')]);
        }
      };
      walk(base);
      return result;
    };
    const packed = entries(archiveRoot);
    const consumed = entries(extracted, true);
    if (JSON.stringify(packed) !== JSON.stringify(consumed)) {
      throw new Error(`expanded W-Sim Rust source differs from ${crate.filename}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
console.log(`Verified ${manifest.npmPackages.length} W-Sim npm packages and ${manifest.rustCrates.length} Rust crate(s) from ${manifest.source.revision}`);

#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { copyFile, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'usage: restore-waveworld.mjs --backup ABS --target ABS';

function fail(message) { throw new Error(message); }
function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || !argv[i + 1]) fail(USAGE);
    out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}
function absolute(input, label) {
  if (!input || !path.isAbsolute(input)) fail(`${label} must be an explicit absolute path`);
  const resolved = path.resolve(input);
  if (resolved === path.parse(resolved).root) fail(`${label} must not be a filesystem root`);
  return resolved;
}
function safeRelative(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\\') || path.posix.isAbsolute(value) || value.split('/').includes('..')) fail(`${label} contains an unsafe path`);
  return value;
}
function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function databaseCtor() {
  for (const pkg of [path.resolve(import.meta.dirname, '../../apps/host/package.json'), path.resolve(import.meta.dirname, '../../apps/lab/package.json')]) {
    try { return createRequire(pkg)('better-sqlite3'); } catch { /* try next */ }
  }
  fail('better-sqlite3 is required (install apps/host dependencies)');
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function json(file) { return JSON.parse(readFileSync(file, 'utf8')); }
async function verify(file, expected, label) {
  if (!existsSync(file) || !lstatSync(file).isFile()) fail(`${label} missing: ${file}`);
  const stat = lstatSync(file);
  if (stat.size !== expected.bytes) fail(`${label} size mismatch: ${file}`);
  if (await sha256(file) !== expected.sha256) fail(`${label} SHA-256 mismatch: ${file}`);
}
async function verifyInventoryTree(backup, meta, labelPrefix) {
  const rootRel = safeRelative(meta?.root, `${labelPrefix}.root`);
  const invRel = safeRelative(meta?.inventory, `${labelPrefix}.inventory`);
  const inventory = json(path.join(backup, ...invRel.split('/')));
  if (inventory.format !== 'waveworld-backup-v1' || !Array.isArray(inventory.files)) fail(`invalid ${labelPrefix} inventory`);
  if (inventory.files.length !== meta.count) fail(`${labelPrefix} inventory count mismatch`);
  for (const entry of inventory.files) {
    const rel = safeRelative(entry.path, `${labelPrefix} path`);
    await verify(path.join(backup, ...rootRel.split('/'), ...rel.split('/')), entry, labelPrefix);
  }
  return { rootRel, inventory };
}
async function restoreInventoryTree(backup, target, rootRel, inventory, labelPrefix) {
  const destRoot = path.join(target, path.basename(rootRel));
  mkdirSync(destRoot, { mode: 0o700 });
  for (const entry of inventory.files) {
    const segments = entry.path.split('/');
    const destination = path.join(destRoot, ...segments);
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(path.join(backup, ...rootRel.split('/'), ...segments), destination);
    await verify(destination, entry, `restored ${labelPrefix}`);
  }
  return inventory.files.length;
}
function integrityCheck(Database, dbPath, label) {
  const restoredDb = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = restoredDb.pragma('integrity_check');
    if (!Array.isArray(integrity) || integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
      fail(`${label} failed PRAGMA integrity_check`);
    }
  } finally { restoredDb.close(); }
}

export async function restoreWaveWorld(options) {
  const backup = absolute(options.backup, '--backup');
  const target = absolute(options.target, '--target');
  if (!existsSync(backup) || !lstatSync(backup).isDirectory()) fail(`backup directory not found: ${backup}`);
  if (existsSync(target)) fail(`restore target already exists; refusing overwrite: ${target}`);
  if (inside(target, backup)) fail('--target must not be inside the backup source');
  if (!existsSync(path.dirname(target))) fail(`restore parent directory does not exist: ${path.dirname(target)}`);
  const manifest = json(path.join(backup, 'manifest.json'));
  if (manifest.format !== 'waveworld-backup-v1') fail('unsupported backup format');

  const dbRel = safeRelative(manifest.database?.path, 'database.path');
  const dbSource = path.join(backup, ...dbRel.split('/'));
  await verify(dbSource, manifest.database, 'database');

  const artifacts = await verifyInventoryTree(backup, manifest.artifacts, 'artifact');

  let knowledgeDbRel = null;
  if (manifest.knowledgeDatabase) {
    knowledgeDbRel = safeRelative(manifest.knowledgeDatabase.path, 'knowledgeDatabase.path');
    await verify(path.join(backup, ...knowledgeDbRel.split('/')), manifest.knowledgeDatabase, 'knowledge database');
  }

  let knowledgeBlobs = null;
  if (manifest.knowledgeBlobs) {
    knowledgeBlobs = await verifyInventoryTree(backup, manifest.knowledgeBlobs, 'knowledge-blob');
  }

  mkdirSync(target, { recursive: false, mode: 0o700 });
  await copyFile(dbSource, path.join(target, 'tasks.db'));
  const artCount = await restoreInventoryTree(backup, target, artifacts.rootRel, artifacts.inventory, 'artifact');
  await verify(path.join(target, 'tasks.db'), manifest.database, 'restored database');

  const Database = databaseCtor();
  integrityCheck(Database, path.join(target, 'tasks.db'), 'restored database');

  let knowledgeDatabaseSha256 = null;
  if (knowledgeDbRel) {
    const knowledgeDest = path.join(target, 'knowledge.db');
    await copyFile(path.join(backup, ...knowledgeDbRel.split('/')), knowledgeDest);
    await verify(knowledgeDest, manifest.knowledgeDatabase, 'restored knowledge database');
    integrityCheck(Database, knowledgeDest, 'restored knowledge database');
    knowledgeDatabaseSha256 = manifest.knowledgeDatabase.sha256;
  }

  let knowledgeBlobCount = 0;
  if (knowledgeBlobs) {
    knowledgeBlobCount = await restoreInventoryTree(
      backup,
      target,
      knowledgeBlobs.rootRel,
      knowledgeBlobs.inventory,
      'knowledge-blob',
    );
  }

  const marker = await open(path.join(target, 'RESTORE_VERIFIED.json'), 'wx', 0o600);
  try {
    await marker.writeFile(`${JSON.stringify({
      format: manifest.format,
      sourceCreatedAt: manifest.createdAt,
      verifiedAt: new Date().toISOString(),
      knowledgeDatabase: Boolean(knowledgeDbRel),
      knowledgeBlobs: knowledgeBlobCount,
    }, null, 2)}\n`);
  } finally { await marker.close(); }

  return {
    target,
    artifacts: artCount,
    databaseSha256: manifest.database.sha256,
    knowledgeDatabaseSha256,
    knowledgeBlobs: knowledgeBlobCount,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(path.resolve(process.argv[1]))) {
  restoreWaveWorld(args(process.argv.slice(2)))
    .then((r) => process.stdout.write(`${JSON.stringify(r)}\n`))
    .catch((error) => { process.stderr.write(`restore failed: ${error.message}\n`); process.exitCode = 1; });
}

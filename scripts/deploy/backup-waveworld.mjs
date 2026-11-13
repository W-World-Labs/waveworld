#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createReadStream, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { copyFile, open } from 'node:fs/promises';
import path from 'node:path';

const FORMAT = 'waveworld-backup-v1';
const USAGE = 'usage: backup-waveworld.mjs --db ABS --artifacts ABS --out ABS [--knowledge-db ABS] [--knowledge-blobs ABS]';

function fail(message) { throw new Error(message); }
function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]; const value = argv[i + 1];
    if (!key?.startsWith('--') || !value) fail(USAGE);
    out[key.slice(2)] = value;
  }
  return out;
}
function absolute(input, label) {
  if (!input || !path.isAbsolute(input)) fail(`${label} must be an explicit absolute path`);
  const resolved = path.resolve(input);
  if (resolved === path.parse(resolved).root) fail(`${label} must not be a filesystem root`);
  return resolved;
}
function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function databaseCtor() {
  const roots = [
    path.resolve(import.meta.dirname, '../../apps/host/package.json'),
    path.resolve(import.meta.dirname, '../../apps/lab/package.json'),
  ];
  for (const pkg of roots) {
    try { return createRequire(pkg)('better-sqlite3'); } catch { /* try next */ }
  }
  fail('better-sqlite3 is required (install apps/host dependencies)');
}
async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function treeFiles(root, current = root) {
  const result = [];
  for (const name of readdirSync(current).sort()) {
    const full = path.join(current, name); const stat = lstatSync(full);
    if (stat.isSymbolicLink()) fail(`symlink is not allowed: ${full}`);
    if (stat.isDirectory()) result.push(...treeFiles(root, full));
    else if (stat.isFile()) result.push({ full, relative: path.relative(root, full).split(path.sep).join('/') });
    else fail(`unsupported tree entry: ${full}`);
  }
  return result;
}
async function backupSqliteFile(Database, sourcePath, destPath) {
  const db = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try { await db.backup(destPath); } finally { db.close(); }
  return {
    path: path.basename(destPath),
    bytes: lstatSync(destPath).size,
    sha256: await sha256(destPath),
  };
}
async function copyTreeWithInventory(sourceRoot, destRoot, inventoryName, outputRoot) {
  mkdirSync(destRoot, { mode: 0o700 });
  const inventory = [];
  for (const item of treeFiles(sourceRoot)) {
    const destination = path.join(destRoot, ...item.relative.split('/'));
    mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(item.full, destination);
    const stat = lstatSync(destination);
    inventory.push({ path: item.relative, bytes: stat.size, sha256: await sha256(destination) });
  }
  const inventoryRel = inventoryName;
  await writeJsonExclusive(path.join(outputRoot, inventoryRel), { format: FORMAT, files: inventory });
  return {
    root: path.basename(destRoot),
    inventory: inventoryRel,
    count: inventory.length,
    bytes: inventory.reduce((n, x) => n + x.bytes, 0),
  };
}
async function writeJsonExclusive(destination, value) {
  const handle = await open(destination, 'wx', 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); } finally { await handle.close(); }
}

export async function backupWaveWorld(options) {
  const dbPath = absolute(options.db, '--db');
  const artifactRoot = absolute(options.artifacts, '--artifacts');
  const output = absolute(options.out, '--out');
  const knowledgeDbPath = options['knowledge-db'] != null ? absolute(options['knowledge-db'], '--knowledge-db') : null;
  const knowledgeBlobsRoot = options['knowledge-blobs'] != null ? absolute(options['knowledge-blobs'], '--knowledge-blobs') : null;

  if (!existsSync(dbPath) || !lstatSync(dbPath).isFile()) fail(`database file not found: ${dbPath}`);
  if (!existsSync(artifactRoot) || !lstatSync(artifactRoot).isDirectory()) fail(`artifact directory not found: ${artifactRoot}`);
  if (knowledgeDbPath && (!existsSync(knowledgeDbPath) || !lstatSync(knowledgeDbPath).isFile())) {
    fail(`knowledge database file not found: ${knowledgeDbPath}`);
  }
  if (knowledgeBlobsRoot && (!existsSync(knowledgeBlobsRoot) || !lstatSync(knowledgeBlobsRoot).isDirectory())) {
    fail(`knowledge-blobs directory not found: ${knowledgeBlobsRoot}`);
  }
  if (existsSync(output)) fail(`backup destination already exists; refusing overwrite: ${output}`);
  if (inside(output, artifactRoot)) fail('--out must not be inside the artifact source');
  if (knowledgeBlobsRoot && inside(output, knowledgeBlobsRoot)) fail('--out must not be inside the knowledge-blobs source');
  if (!existsSync(path.dirname(output))) fail(`backup parent directory does not exist: ${path.dirname(output)}`);

  // Exclusive creation is the overwrite guard. An incomplete directory is retained
  // on failure for diagnosis and is never silently deleted.
  mkdirSync(output, { recursive: false, mode: 0o700 });
  const Database = databaseCtor();

  const dbDest = path.join(output, 'tasks.db');
  const databaseMeta = await backupSqliteFile(Database, dbPath, dbDest);

  const artifactsMeta = await copyTreeWithInventory(
    artifactRoot,
    path.join(output, 'artifacts'),
    'artifacts.inventory.json',
    output,
  );

  const manifest = {
    format: FORMAT,
    createdAt: new Date().toISOString(),
    database: databaseMeta,
    artifacts: artifactsMeta,
  };

  if (knowledgeDbPath) {
    const knowledgeDest = path.join(output, 'knowledge.db');
    manifest.knowledgeDatabase = await backupSqliteFile(Database, knowledgeDbPath, knowledgeDest);
  }
  if (knowledgeBlobsRoot) {
    manifest.knowledgeBlobs = await copyTreeWithInventory(
      knowledgeBlobsRoot,
      path.join(output, 'knowledge-blobs'),
      'knowledge-blobs.inventory.json',
      output,
    );
  }

  await writeJsonExclusive(path.join(output, 'manifest.json'), manifest);
  return manifest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(path.resolve(process.argv[1]))) {
  backupWaveWorld(args(process.argv.slice(2)))
    .then((m) => process.stdout.write(`${JSON.stringify(m)}\n`))
    .catch((error) => { process.stderr.write(`backup failed: ${error.message}\n`); process.exitCode = 1; });
}

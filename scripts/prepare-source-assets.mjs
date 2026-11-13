#!/usr/bin/env node
// Explicit build/CI preparation; never called by the browser or a runtime loader.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const models = resolve(root, 'apps/lab/public/models');
const source = resolve(root, 'source-assets');
const manifest = JSON.parse(readFileSync(resolve(source, 'models.json'), 'utf8'));
if (manifest.schema !== 1 || !Array.isArray(manifest.entries)) throw new Error('Invalid source asset manifest');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
for (const item of manifest.entries) {
  if (item.file !== basename(item.file) || item.archive !== basename(item.archive) ||
      !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > 40 * 1024 * 1024) {
    throw new Error('Invalid source asset boundary');
  }
  const target = resolve(models, item.file);
  if (existsSync(target)) {
    const bytes = readFileSync(target);
    if (bytes.length !== item.bytes || digest(bytes) !== item.sha256) throw new Error(`Existing asset differs: ${item.file}`);
    continue;
  }
  const archive = readFileSync(resolve(source, item.archive));
  if (archive.length !== item.archiveBytes || digest(archive) !== item.archiveSha256) throw new Error(`Source asset archive differs: ${item.file}`);
  const bytes = gunzipSync(archive, { maxOutputLength: item.bytes });
  if (bytes.length !== item.bytes || digest(bytes) !== item.sha256) throw new Error(`Decoded source asset differs: ${item.file}`);
  writeFileSync(target, bytes, { flag: 'wx' });
}

// The downloaded Ahmed mesh has no verified redistribution license. Reuse the
// existing authored procedural fallback instead; do not download or substitute
// an unrelated third-party mesh. This teaching geometry is not a reference oracle.
if (!existsSync(resolve(models, 'ahmed.stl'))) {
  execFileSync(process.execPath, [resolve(root, 'apps/lab/scripts/generate-preset-stls.mjs'), 'ahmed.stl'], { stdio: 'inherit' });
}
execFileSync(process.execPath, [resolve(root, 'apps/lab/scripts/write-models-manifest.mjs')], { stdio: 'inherit' });
console.log('Prepared reviewed source assets and existing authored Ahmed fallback; no network access');

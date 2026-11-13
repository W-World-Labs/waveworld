#!/usr/bin/env node
import fs from 'node:fs';
import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
const hash = (data) => createHash('sha256').update(data).digest('hex');
const fail = (message) => { throw new Error(message); };

const file = process.argv[2];
if (!file) fail('usage: node scripts/verify-publication-bundle.mjs <bundle.wwpub.json>');
const bytes = fs.readFileSync(file);
let bundle;
try { bundle = JSON.parse(bytes.toString('utf8')); } catch { fail('bundle is not valid JSON'); }
if (bundle?.manifest?.schema !== 'waveworld.publication-bundle/v1' || !Array.isArray(bundle.entries)) fail('unsupported publication bundle schema');
if (hash(JSON.stringify(canonical(bundle.manifest))) !== bundle.manifestSha256) fail('manifest digest mismatch');
const expected = new Map(bundle.manifest.entries.map((entry) => [entry.path, entry]));
if (expected.size !== bundle.manifest.entries.length || expected.size !== bundle.entries.length) fail('entry set is not one-to-one');
const seen = new Set();
for (const entry of bundle.entries) {
  if (seen.has(entry.path)) fail(`duplicate entry: ${entry.path}`);
  seen.add(entry.path);
  const meta = expected.get(entry.path);
  if (!meta || meta.sha256 !== entry.sha256 || meta.bytes !== entry.bytes || meta.contentType !== entry.contentType) fail(`entry metadata mismatch: ${entry.path}`);
  if (typeof entry.contentBase64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(entry.contentBase64) || entry.contentBase64.length % 4) fail(`invalid base64: ${entry.path}`);
  const content = Buffer.from(entry.contentBase64, 'base64');
  if (content.byteLength !== entry.bytes || hash(content) !== entry.sha256) fail(`entry digest mismatch: ${entry.path}`);
}
for (const evidence of bundle.manifest.evidence) {
  if (evidence.disposition === 'embedded' && (!evidence.entryPath || !seen.has(evidence.entryPath))) fail(`embedded evidence missing: ${evidence.evidenceId}`);
  if (evidence.disposition === 'external' && !evidence.locator) fail(`external evidence locator missing: ${evidence.evidenceId}`);
  if (evidence.disposition === 'excluded' && !evidence.reason) fail(`evidence exclusion reason missing: ${evidence.evidenceId}`);
}
process.stdout.write(JSON.stringify({ ok: true, publicId: bundle.manifest.publication.publicId, version: bundle.manifest.publication.version, bundleSha256: hash(bytes), manifestSha256: bundle.manifestSha256, entries: bundle.entries.length }) + '\n');

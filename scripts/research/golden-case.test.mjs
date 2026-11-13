import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseMeasuredCsv, transformMeasurements, verifyGoldenCase } from './golden-case.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const caseRoot = path.join(repoRoot, 'research/golden-case');

test('verifies the frozen case and deterministically reconstructs paired observations', () => {
  const result = verifyGoldenCase(caseRoot);
  assert.equal(result.ok, true);
  assert.equal(result.datasets.length, 2);
  for (const dataset of result.datasets) {
    assert.equal(dataset.rows, 30);
    assert.match(dataset.transformedSha256, /^[a-f0-9]{64}$/);
    assert.equal(dataset.transformed[0].time, 0);
    assert.equal(dataset.transformed[0].singletO2, 0);
    assert.equal(dataset.transformed.at(-1).singletO2, 1);
  }
});

test('rejects digest tampering before parsing measurements', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'waveworld-golden-case-'));
  fs.cpSync(caseRoot, temporary, { recursive: true });
  fs.appendFileSync(path.join(temporary, 'data/air-pbs-431w.csv'), '1001,0\n');
  assert.throws(() => verifyGoldenCase(temporary), /snapshot digest mismatch/);
});

test('rejects unit, row and numeric-contract drift', () => {
  assert.throws(() => parseMeasuredCsv(Buffer.from('time,intensity_au\n1,2\n'), 1), /header/);
  assert.throws(() => parseMeasuredCsv(Buffer.from('pulse_width_us,intensity_au\n1,NaN\n'), 1), /invalid numeric/);
  assert.throws(() => parseMeasuredCsv(Buffer.from('pulse_width_us,intensity_au\n2,3\n1,2\n'), 2), /strictly increasing/);
  assert.throws(() => transformMeasurements([{ pulseWidthUs: 1, intensityAu: 2 }, { pulseWidthUs: 2, intensityAu: 2 }]), /./);
});

test('rejects symlink substitution', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'waveworld-golden-symlink-'));
  fs.cpSync(caseRoot, temporary, { recursive: true });
  const target = path.join(temporary, 'data/air-pbs-431w.csv');
  const replacement = path.join(temporary, 'replacement.csv');
  fs.copyFileSync(target, replacement);
  fs.unlinkSync(target);
  fs.symlinkSync(replacement, target);
  assert.throws(() => verifyGoldenCase(temporary), /not a regular file/);
});

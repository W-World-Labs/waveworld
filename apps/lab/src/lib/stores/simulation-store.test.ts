import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateSimulationStore } from './simulation-store';

test('v3→v4 migration preserves the legacy recording-off intent', () => {
  const off = migrateSimulationStore({ parameters: { fieldFrames: 1 } }, 3);
  assert.equal(off.parameters.fieldFps, 0);
  const zero = migrateSimulationStore({ parameters: { fieldFrames: 0 } }, 3);
  assert.equal(zero.parameters.fieldFps, 0);
});

test('v3→v4 migration maps legacy recording-on to 30 fps', () => {
  const on = migrateSimulationStore({ parameters: { fieldFrames: 16 } }, 3);
  assert.equal(on.parameters.fieldFps, 30);
});

test('v3→v4 migration leaves an explicit fieldFps untouched', () => {
  const explicit = migrateSimulationStore({ parameters: { fieldFrames: 16, fieldFps: 60 } }, 3);
  assert.equal(explicit.parameters.fieldFps, 60);
});

test('v1→v2 and v2→v3 defaults still apply on the way to v4', () => {
  const migrated = migrateSimulationStore({ parameters: { fieldFrames: 16 } }, 1);
  assert.equal(migrated.parameters.wallCondition, 'slip');
  assert.equal(migrated.parameters.durationSeconds, 10);
  assert.equal(migrated.parameters.fieldFps, 30);
});

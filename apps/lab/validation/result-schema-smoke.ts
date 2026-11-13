/**
 * Lightweight smoke: complete payload schema (Cd/Cl finite) without WebGPU.
 * Uses agent-local validator (no Next path aliases).
 *
 * Run from apps/lab:
 *   npx tsx validation/result-schema-smoke.ts
 */
import assert from 'node:assert/strict';
import {
  AgentResultValidationError,
  assertCompleteResult,
} from '../agent/src/validate-result.ts';

function ok(label: string) {
  console.log('  ok', label);
}

assertCompleteResult({
  schemaVersion: 1,
  summary: { steps: 200, cd: 1.18, cl: 0.03, wallTimeMs: 1200 },
  history: { step: [20, 40], cd: [1.2, 1.18], cl: [0.01, 0.03] },
  backend: { id: 'webgpu-dawn', agentId: 'agent-smoke' },
});
ok('finite Cd/Cl accepted');

assertCompleteResult({
  schemaVersion: 1,
  summary: { steps: 1, wallTimeMs: 1 },
  backend: { id: 'cpu', agentId: 'a' },
});
ok('optional Cd/Cl omitted');

assert.throws(
  () =>
    assertCompleteResult({
      schemaVersion: 1,
      summary: { steps: 1, cd: Number.NaN, cl: 0, wallTimeMs: 1 },
      backend: { id: 't', agentId: 'a' },
    }),
  AgentResultValidationError
);
ok('NaN Cd rejected');

assert.throws(
  () =>
    assertCompleteResult({
      schemaVersion: 1,
      summary: { steps: 1, cd: 1, cl: Number.POSITIVE_INFINITY, wallTimeMs: 1 },
      backend: { id: 't', agentId: 'a' },
    }),
  /cl/
);
ok('Infinity Cl rejected');

assert.throws(
  () =>
    assertCompleteResult({
      schemaVersion: 1,
      summary: { steps: 2, cd: 1, cl: 0, wallTimeMs: 1 },
      history: { step: [1, 2], cd: [1], cl: [0, 0] },
      backend: { id: 't', agentId: 'a' },
    }),
  /length/
);
ok('history length mismatch rejected');

console.log('RESULT SCHEMA SMOKE PASS');

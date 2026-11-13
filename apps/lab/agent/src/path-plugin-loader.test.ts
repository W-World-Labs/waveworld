import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PATH_MODEL_PLUGIN_MANIFEST,
  PATH_MODEL_PLUGIN_PROTOCOL,
  calculatePluginImplementationSha256,
  createAgentPathModelRegistry,
  pathModelCapabilities,
} from './path-plugin-loader.ts';
import { type PathExperimentJobSpecLike } from './path-experiment-runner.ts';
import type { AgentBuildProvenance } from './build-provenance.ts';
import { processJob } from './claim-loop.ts';
import type { TaskApiClient } from './client.ts';
import type { JobRecord, JobResultV1 } from '../../src/types/task.ts';

const BUILD: AgentBuildProvenance = {
  agentBuildId: 'test-build',
  modelImplementationSha256: 'a'.repeat(64),
  dependencyLockSha256: 'b'.repeat(64),
};

function pluginSource(id = 'third-party-score', version = '2.0.0'): string {
  return `export default {
    manifest: {
      id: ${JSON.stringify(id)}, version: ${JSON.stringify(version)}, backends: ['cpu'],
      parameters: { alpha: { type: 'number', required: true, min: 0 } },
      outputs: { score: { type: 'number' } }
    },
    run({ parameters, maxSteps }) {
      return { steps: maxSteps, metrics: { score: Number(parameters.alpha) * 3 } };
    }
  };\n`;
}

function installPlugin(root: string, name: string, source: string): { dir: string; digest: string } {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.mjs'), source);
  const digest = calculatePluginImplementationSha256(dir, ['plugin.mjs']);
  fs.writeFileSync(path.join(dir, PATH_MODEL_PLUGIN_MANIFEST), JSON.stringify({
    protocol: PATH_MODEL_PLUGIN_PROTOCOL,
    entry: 'plugin.mjs',
    files: ['plugin.mjs'],
    implementationSha256: digest,
  }));
  return { dir, digest };
}

function spec(): PathExperimentJobSpecLike {
  return {
    schemaVersion: 1,
    kind: 'path-experiment',
    parameters: { alpha: 4 },
    run: { maxSteps: 3 },
    experiment: {
      experimentId: 'external-1', title: 'External plugin', materials: [{}], steps: [],
      parameters: { alpha: { value: 4, source: { kind: 'assumption' } } },
      model: { id: 'third-party-score', version: '2.0.0' },
      provenance: { createdAt: '2026-08-02T00:00:00.000Z', software: { name: 'test', version: '1' } },
    },
  };
}

test('loads an external ESM model without rebuilding and advertises exactly what executes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'waveworld-plugin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { digest } = installPlugin(root, 'score', pluginSource());

  const registry = await createAgentPathModelRegistry(BUILD, root);
  const advertised = pathModelCapabilities(registry).find((item) => item.id === 'third-party-score');
  assert.equal(advertised?.implementationSha256, digest);
  assert.deepEqual(advertised?.outputs, { score: { type: 'number' } });
  assert.throws(() => registry.register({
    manifest: { id: 'late', version: '1', backends: ['cpu'], parameters: {}, outputs: {} },
    run: () => ({ steps: 1, metrics: {} }),
  }), /registry is frozen/);

  let result: JobResultV1 | undefined;
  const client = {
    heartbeat: async () => undefined,
    complete: async (_jobId: string, value: JobResultV1) => {
      result = value;
      return { jobId: 'plugin-job', status: 'succeeded', result: value };
    },
  } as unknown as TaskApiClient;
  const job = {
    id: 'plugin-job', attempt: 0, status: 'leased', name: 'external', spec: spec(),
  } as unknown as JobRecord;
  await processJob(client, job, 'agent-plugin', BUILD, registry);
  assert.ok(result?.experiment);
  assert.equal(result.experiment.outputs.score.value, 12);
  assert.equal(result.backend.provenance?.modelImplementationSha256, digest);
  assert.equal(result.experiment.provenance.modelImplementationSha256, digest);
});

test('rejects a plugin whose declared implementation bytes were tampered with', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'waveworld-plugin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { dir } = installPlugin(root, 'score', pluginSource());
  fs.appendFileSync(path.join(dir, 'plugin.mjs'), '\n// tampered');
  await assert.rejects(createAgentPathModelRegistry(BUILD, root), /integrity mismatch/);
});

test('refuses to execute a JobSpec pinned to different plugin bytes', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'waveworld-plugin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  installPlugin(root, 'score', pluginSource());
  const registry = await createAgentPathModelRegistry(BUILD, root);
  const pinned = spec();
  pinned.experiment!.model.checksum = 'f'.repeat(64);
  const client = {
    heartbeat: async () => undefined,
    // processJob terminal-fail honesty on runner error; mock must accept fail.
    fail: async () => undefined,
  } as unknown as TaskApiClient;
  const job = { id: 'wrong-pin', status: 'leased', name: 'wrong-pin', spec: pinned } as unknown as JobRecord;
  await assert.rejects(processJob(client, job, 'agent-plugin', BUILD, registry), /implementation mismatch/);
});

test('rejects duplicate model identity across built-in and external plugins', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'waveworld-plugin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  installPlugin(root, 'duplicate', pluginSource('photosensitization-rk4', '1.0.0'));
  await assert.rejects(createAgentPathModelRegistry(BUILD, root), /already registered/);
});

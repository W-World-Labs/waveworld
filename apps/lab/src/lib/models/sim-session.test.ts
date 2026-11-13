/**
 * #49-C: load → prepare(start) → stop → swap smoke for NACA STL + MilkTruck/Duck GLB.
 *
 * Run: npm run test:models
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { parseModelFile } from './parser';
import {
  injectPrepareFailureThenRecover,
  loadPresetForSession,
  prepareSimulation,
  runLoadStartStopSwap,
  stopSimulationSession,
} from './sim-session';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, '../../../public/models');

/** GLTFLoader needs Image/self stubs under Node (same as geometry-contract tests). */
function installNodeGltfPolyfills(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  if (!g.self) g.self = globalThis;
  if (!g.Image) {
    g.Image = class Image {
      width = 0;
      height = 0;
      onload: (() => void) | null = null;
      onerror: ((err?: unknown) => void) | null = null;
      private _src = '';
      set src(v: string) {
        this._src = v;
        queueMicrotask(() => {
          this.width = 1;
          this.height = 1;
          this.onload?.();
        });
      }
      get src() {
        return this._src;
      }
    };
  }
  if (!g.document) {
    g.document = {
      createElementNS: () => new g.Image(),
      createElement: () => new g.Image(),
    };
  }
}

function loadFile(name: string): File {
  const p = path.join(MODELS_DIR, name);
  assert.ok(fs.existsSync(p), `missing model fixture: ${p}`);
  return new File([fs.readFileSync(p)], name);
}

// ---------------------------------------------------------------------------
// Happy path: real files load → prepare → stop → swap
// ---------------------------------------------------------------------------

test('NACA STL load → prepare → stop → open Milk Truck GLB is rejected for computation', async () => {
  installNodeGltfPolyfills();

  // Prefer file parse path (no fetch in node); then session prepare/stop/swap.
  const naca = await parseModelFile(loadFile('naca0012.stl'));
  naca.metadata.id = 'naca0012';
  naca.metadata.name = 'NACA 0012 翼型';

  const prep1 = prepareSimulation(
    naca.metadata.id,
    naca.metadata.name,
    naca.geometry,
    naca.metadata,
    { gridPresetId: 'fast', modelResolutionId: 'coarse', fromFile: true, angleOfAttackDeg: 5 }
  );
  assert.equal(prep1.ok, true);
  if (!prep1.ok) return;
  assert.equal(prep1.phase, 'prepared');
  assert.ok(prep1.prepared.voxel.flags.length > 0);
  assert.ok(prep1.prepared.voxel.solidCells > 0, 'NACA should voxelize to solid cells');

  const stopped = stopSimulationSession(prep1.prepared);
  assert.equal(stopped.phase, 'stopped');
  assert.equal(stopped.ok, true);

  const truck = await parseModelFile(loadFile('milk-truck.glb'));
  truck.metadata.id = 'milk-truck';
  truck.metadata.name = '牛奶车（glTF）';

  const prep2 = prepareSimulation(
    truck.metadata.id,
    truck.metadata.name,
    truck.geometry,
    truck.metadata,
    { gridPresetId: 'fast', modelResolutionId: 'coarse', fromFile: true }
  );
  // The visual asset has open edges; parsing it does not make it a closed solid.
  assert.equal(prep2.ok, false);
  if (prep2.ok) return;
  assert.equal(prep2.phase, 'error');
  assert.match(prep2.failure.message, /solid boundary.*code 11/);
});

test('Duck GLB load → prepare → stop → NACA STL prepare (swap reverse)', async () => {
  installNodeGltfPolyfills();

  const duck = await parseModelFile(loadFile('duck.glb'));
  duck.metadata.id = 'duck';
  duck.metadata.name = '橡皮鸭（glTF）';

  const prep1 = prepareSimulation(
    duck.metadata.id,
    duck.metadata.name,
    duck.geometry,
    duck.metadata,
    { gridPresetId: 'fast', modelResolutionId: 'coarse', fromFile: true }
  );
  assert.equal(prep1.ok, true);
  if (!prep1.ok) return;
  assert.ok(prep1.prepared.voxel.solidCells > 0);

  stopSimulationSession(prep1.prepared);

  const naca = await parseModelFile(loadFile('naca0012.stl'));
  naca.metadata.id = 'naca0012';
  const prep2 = prepareSimulation(
    naca.metadata.id,
    naca.metadata.name,
    naca.geometry,
    naca.metadata,
    { gridPresetId: 'fast', modelResolutionId: 'coarse', fromFile: true, angleOfAttackDeg: 5 }
  );
  assert.equal(prep2.ok, true);
  if (!prep2.ok) return;
  assert.equal(prep2.prepared.modelId, 'naca0012');
});

test('runLoadStartStopSwap happy path with procedural NACA ↔ cylinder (no fetch)', async () => {
  // Presets without network: injectLoadError forces procedural recovery path for both.
  const load1 = await loadPresetForSession('naca0012', {
    injectLoadError: 'injected: file unavailable',
  });
  assert.equal(load1.ok, true);
  if (!load1.ok) return;
  assert.equal(load1.fromFile, false);
  assert.match(load1.warning ?? '', /injected/);

  const prep1 = prepareSimulation(
    load1.metadata.id,
    load1.metadata.name,
    load1.geometry,
    load1.metadata,
    { fromFile: false, warning: load1.warning, gridPresetId: 'fast', modelResolutionId: 'coarse' }
  );
  assert.equal(prep1.ok, true);
  if (!prep1.ok) return;
  stopSimulationSession(prep1.prepared);

  const load2 = await loadPresetForSession('cylinder', {
    injectLoadError: 'injected: swap',
  });
  assert.equal(load2.ok, true);
  if (!load2.ok) return;
  const prep2 = prepareSimulation(
    load2.metadata.id,
    load2.metadata.name,
    load2.geometry,
    load2.metadata,
    { gridPresetId: 'fast', modelResolutionId: 'coarse' }
  );
  assert.equal(prep2.ok, true);
});

// ---------------------------------------------------------------------------
// Injected failure + local recovery (must not throw)
// ---------------------------------------------------------------------------

test('a file-only preset load failure returns a local error without substituting another model', async () => {
  const result = await loadPresetForSession('milk-truck', {
    injectLoadError: 'HTTP 404 (injected)',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.recoverable, true);
  assert.match(result.failure.message, /仅支持原始文件/);
});

test('injected prepare (sim) failure returns local recoverable error and recovers', () => {
  const result = injectPrepareFailureThenRecover('naca0012', {
    gridPresetId: 'fast',
    modelResolutionId: 'coarse',
  });
  // Failure is reported locally (ok:false) but recovered geometry is attached
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.failure.recoverable, true);
  assert.equal(result.failure.kind, 'contract');
  assert.ok(result.recovered, 'procedural recovery should attach prepared session');
  assert.equal(result.recovered!.modelId, 'naca0012');
  assert.ok(result.recovered!.voxel.solidCells > 0);
});

test('prepareSimulation does not throw on empty-ish mesh; returns local error', () => {
  const empty = {
    vertices: new Float32Array(0),
    normals: new Float32Array(0),
    indices: new Uint32Array(0),
  };
  const meta = {
    id: 'bad',
    name: 'bad',
    format: 'stl' as const,
    fileSize: 0,
    uploadDate: new Date(),
    vertexCount: 0,
    faceCount: 0,
    boundingBox: {
      min: [0, 0, 0] as [number, number, number],
      max: [0, 0, 0] as [number, number, number],
      center: [0, 0, 0] as [number, number, number],
      size: [0, 0, 0] as [number, number, number],
    },
    isWatertight: false,
    hasNormals: false,
    hasUVs: false,
    manifoldEdges: 0,
    nonManifoldEdges: 0,
  };
  assert.doesNotThrow(() => {
    const r = prepareSimulation('bad', 'bad', empty, meta);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.failure.recoverable, true);
      assert.equal(r.failure.kind, 'contract');
    }
  });
});

test('runLoadStartStopSwap returns structured error for unknown preset (no throw)', async () => {
  const r = await runLoadStartStopSwap('__no_such_preset__', 'cylinder');
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.step, 'load1');
  assert.equal(r.failure.recoverable, true);
});

test('#49-D writes CI evidence artifact for load-start-stop-swap (NACA→duck)', async () => {
  const { buildLabEvidenceArtifact, classifyGpuFailure } = await import(
    '../lab-diagnostics.ts'
  );

  // Pure recovery classifiers (no WebGPU needed in node).
  assert.equal(classifyGpuFailure('当前浏览器不支持 WebGPU').kind, 'webgpu_unavailable');
  assert.equal(classifyGpuFailure('GPU 设备丢失: test').kind, 'context_lost');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => new Response(fs.readFileSync(path.join(MODELS_DIR, String(input).split('/').at(-1)!)));
  let swap: Awaited<ReturnType<typeof runLoadStartStopSwap>>;
  try {
    swap = await runLoadStartStopSwap('naca0012', 'duck', {
      gridPresetId: 'fast',
      modelResolutionId: 'coarse',
    });
  } finally { globalThis.fetch = originalFetch; }

  const outDir = path.resolve(__dirname, '../../../test-results');
  fs.mkdirSync(outDir, { recursive: true });
  const artifactPath = path.join(outDir, 'lab-models-49d-evidence.json');

  const art = buildLabEvidenceArtifact({
    suite: 'lab-models-49d',
    ok: swap.ok,
    steps: swap.ok
      ? ['load_naca', 'prepare_naca', 'stop', 'load_duck', 'prepare_duck']
      : ['failed'],
    failures: swap.ok ? [] : [swap.ok === false ? swap.failure.code : 'unknown'],
    events: [
      {
        type: 'info',
        message: swap.ok
          ? `first=${swap.first.modelId} second=${swap.second.modelId}`
          : 'swap failed',
        ts: new Date().toISOString(),
      },
    ],
    extra: {
      pageerror: 0,
      consoleError: 0,
      note: 'node CPU-side smoke; browser Playwright deferred',
    },
  });

  fs.writeFileSync(artifactPath, JSON.stringify(art, null, 2));
  assert.ok(fs.existsSync(artifactPath));
  assert.equal(art.pageerror.length, 0);
  assert.match(art.diagnosticCode, /^lab-/);
  assert.equal(swap.ok, true, swap.ok ? '' : JSON.stringify(swap));
});

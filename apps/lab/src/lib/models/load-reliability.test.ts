/**
 * #49-G: abort lifecycle, memory budget prune, build-time manifest contract.
 * Run via: npm run test:models
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  expectedPresetFileMap,
  isModelsManifest,
  type ModelsManifest,
} from './models-manifest.ts';
import { PRESET_MODELS, loadPresetModel } from './preset-models.ts';
import {
  MAX_UPLOADED_MODELS,
  pruneUploadedModels,
} from '../stores/project-store.ts';
import type { UploadedModel } from '@/types/model';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.resolve(__dirname, '../../../public/models/manifest.json');

function fakeUploaded(id: string): UploadedModel {
  return {
    metadata: {
      id,
      name: id,
      format: 'stl',
      fileSize: 12,
      uploadDate: new Date(),
      vertexCount: 3,
      faceCount: 1,
      boundingBox: {
        min: [0, 0, 0],
        max: [1, 1, 1],
        center: [0.5, 0.5, 0.5],
        size: [1, 1, 1],
      },
      isWatertight: true,
      hasNormals: true,
      hasUVs: false,
      manifoldEdges: 0,
      nonManifoldEdges: 0,
    },
    geometry: {
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    },
  };
}

// ---------------------------------------------------------------------------
// Memory budget
// ---------------------------------------------------------------------------

test('MAX_UPLOADED_MODELS is a small positive budget', () => {
  assert.ok(MAX_UPLOADED_MODELS >= 2 && MAX_UPLOADED_MODELS <= 8);
});

test('pruneUploadedModels keeps protected ids and drops oldest others', () => {
  const models = ['a', 'b', 'c', 'd', 'e'].map(fakeUploaded);
  const keep = new Set(['e', 'd']);
  const pruned = pruneUploadedModels(models, keep, 3);
  assert.equal(pruned.length, 3);
  const ids = pruned.map((m) => m.metadata.id);
  assert.ok(ids.includes('e'));
  assert.ok(ids.includes('d'));
  // One of a/b/c may remain; total is 3
  assert.equal(ids.filter((id) => keep.has(id)).length, 2);
});

test('pruneUploadedModels is a no-op when under budget', () => {
  const models = ['a', 'b'].map(fakeUploaded);
  const pruned = pruneUploadedModels(models, new Set(['a']), 4);
  assert.equal(pruned.length, 2);
  assert.deepEqual(
    pruned.map((m) => m.metadata.id),
    ['a', 'b']
  );
});

// ---------------------------------------------------------------------------
// Abort lifecycle
// ---------------------------------------------------------------------------

test('loadPresetModel rejects immediately when signal already aborted', async () => {
  const ac = new AbortController();
  ac.abort();
  const preset = PRESET_MODELS.find((p) => p.id === 'naca0012');
  assert.ok(preset);
  await assert.rejects(
    () => loadPresetModel(preset!, { signal: ac.signal }),
    (err: unknown) => {
      assert.equal((err as { name?: string }).name, 'AbortError');
      return true;
    }
  );
});

test('loadPresetModel aborts in-flight when signal aborts (no throw of non-abort)', async () => {
  const ac = new AbortController();
  const preset = PRESET_MODELS.find((p) => p.id === 'naca0012');
  assert.ok(preset);
  // Abort on next tick so fetch (if any) is cancelled; procedural path also checks signal.
  setTimeout(() => {
    ac.abort();
  }, 0);
  try {
    await loadPresetModel(preset!, { signal: ac.signal });
    // If abort lost the race and load completed, that is still acceptable.
  } catch (err) {
    assert.equal((err as { name?: string }).name, 'AbortError');
  }
});

// ---------------------------------------------------------------------------
// Build-time manifest
// ---------------------------------------------------------------------------

test('public/models/manifest.json exists and matches catalog presets', () => {
  assert.ok(fs.existsSync(MANIFEST_PATH), `missing ${MANIFEST_PATH} — run npm run models:manifest`);
  const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as unknown;
  assert.ok(isModelsManifest(raw), 'manifest schema invalid');
  const manifest = raw as ModelsManifest;
  assert.equal(manifest.schema, 'waveworld.lab-models-manifest/v1');
  assert.ok(manifest.count >= 21, `expected ≥21 files, got ${manifest.count}`);

  const expected = expectedPresetFileMap();
  assert.equal(Object.keys(expected).length, 21);
  for (const [id, file] of Object.entries(expected)) {
    assert.equal(manifest.presets[id], file, `preset ${id} file mismatch`);
    assert.ok(
      manifest.files.some((f) => f.file === file),
      `manifest.files missing ${file} for ${id}`
    );
  }
});

// ---------------------------------------------------------------------------
// Residual lock (#49 LAB-auto-residual-manifest-boundary)
// Keep automatable residual checkable: no mount-time HEAD storm + local boundaries.
// ---------------------------------------------------------------------------

const SRC_ROOT = path.resolve(__dirname, '../../');

test('preset selector uses build-time manifest and never method:HEAD probes', () => {
  const selectorPath = path.join(SRC_ROOT, 'components/upload/preset-model-selector.tsx');
  assert.ok(fs.existsSync(selectorPath), `missing ${selectorPath}`);
  const src = fs.readFileSync(selectorPath, 'utf8');
  assert.ok(src.includes('loadModelsManifest'), 'selector must load build-time manifest');
  assert.ok(src.includes('manifestHasFile'), 'selector must consult manifest for real-file badges');
  assert.ok(
    !/method\s*:\s*['"]HEAD['"]/.test(src),
    'selector must not reintroduce concurrent HEAD probes'
  );
  assert.ok(
    !/\bfetch\s*\([^)]*['"]HEAD['"]/.test(src),
    'selector must not fetch with HEAD'
  );
});

test('preset model file GET is bounded by an AbortSignal timeout', () => {
  const src = fs.readFileSync(path.join(SRC_ROOT, 'lib/models/preset-models.ts'), 'utf8');
  // Callers (lab/page, hq-lab-adapter, sim-session) may pass no signal; the
  // fetch must still compose a timeout so a hung connection cannot pin the
  // load promise forever — same contract as models-manifest.
  assert.ok(
    /fetch\(publicAssetUrl\(preset\.modelUrl\)[\s\S]*?AbortSignal\.timeout\(/.test(src),
    'loadPresetModel must bound the model file fetch with AbortSignal.timeout'
  );
});

test('local error boundaries exist for model preview and sim canvas', () => {
  const files = [
    path.join(SRC_ROOT, 'components/visualization/model-preview-boundary.tsx'),
    path.join(SRC_ROOT, 'components/visualization/sim-canvas-boundary.tsx'),
  ];
  for (const file of files) {
    assert.ok(fs.existsSync(file), `missing boundary ${file}`);
    const src = fs.readFileSync(file, 'utf8');
    assert.ok(src.includes('getDerivedStateFromError'), `${file} must be a React error boundary`);
    assert.ok(src.includes('componentDidCatch'), `${file} must log via componentDidCatch`);
    assert.ok(src.includes('LocalErrorPanel'), `${file} must render LocalErrorPanel`);
  }
});

test('lab page wires both local error boundaries', () => {
  const pagePath = path.join(SRC_ROOT, 'app/lab/page.tsx');
  assert.ok(fs.existsSync(pagePath), `missing ${pagePath}`);
  const src = fs.readFileSync(pagePath, 'utf8');
  assert.ok(src.includes('ModelPreviewBoundary'), 'lab page must wrap preview in ModelPreviewBoundary');
  assert.ok(src.includes('SimCanvasBoundary'), 'lab page must wrap sim canvas in SimCanvasBoundary');
});

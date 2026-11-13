#!/usr/bin/env node
/**
 * Write public/models/manifest.json from on-disk model files + preset catalog ids.
 *
 * This is the build-time replacement for concurrent HEAD probes of every preset.
 * Run: node scripts/write-models-manifest.mjs
 * (also invoked by models:manifest / prebuild hooks when wired)
 */

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { GENERATED_PRESETS, encodeBinaryStl } from './generate-preset-stls.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(__dirname, '..', 'public', 'models');
const OUT = path.join(MODELS_DIR, 'manifest.json');

// Keep in sync with PRESET_MODELS modelUrl basenames in preset-models.ts
const PRESET_FILES = {
  naca0012: 'naca0012.stl',
  cylinder: 'cylinder.stl',
  sphere: 'sphere.stl',
  car: 'car.stl',
  airplane: 'airplane.stl',
  'ahmed-body': 'ahmed.stl',
  'onera-m6': 'onera-m6.stl',
  'server-chassis': 'server-chassis.stl',
  heatsink: 'heatsink.stl',
  cube: 'cube.stl',
  cone: 'cone.stl',
  building: 'building.stl',
  'drivaer-lite': 'drivaer-lite.stl',
  'milk-truck': 'milk-truck-solid.stl',
  duck: 'duck.glb',
  'toy-car': 'toy-car-solid.stl',
  bicycle: 'bicycle-solid.stl',
  rocket: 'rocket-solid.stl',
  'ares-rocket': 'ares-rocket-solid.stl',
  'space-shuttle': 'space-shuttle-solid.stl',
  'airplane-x57': 'airplane-x57-solid.stl',
};

const files = fs
  .readdirSync(MODELS_DIR)
  .filter((f) => /\.(stl|glb|gltf)$/i.test(f))
  .sort()
  .map((file) => {
    const st = fs.statSync(path.join(MODELS_DIR, file));
    const source = fs.readFileSync(path.join(MODELS_DIR, file));
    const generate = GENERATED_PRESETS.find(([name]) => name === file)?.[1];
    const mesh = generate?.();
    // Only declare construction groups when the actual shipped file is exactly reproduced.
    // Downloaded meshes and edited files retain the single boundary-set semantics.
    const solidTriangleCounts = mesh?.solidTriangleCounts.length > 1 && encodeBinaryStl(mesh, file).equals(source)
      ? mesh.solidTriangleCounts : undefined;
    return {
      ...(solidTriangleCounts ? { solidTriangleCounts, sha256: createHash('sha256').update(source).digest('hex') } : {}),
      file,
      bytes: st.size,
      ext: path.extname(file).slice(1).toLowerCase(),
    };
  });

const onDisk = new Set(files.map((f) => f.file));
const missing = Object.entries(PRESET_FILES)
  .filter(([, file]) => !onDisk.has(file))
  .map(([id, file]) => `${id}→${file}`);

if (missing.length) {
  console.warn('[write-models-manifest] missing preset files:', missing.join(', '));
}

const manifest = {
  schema: 'waveworld.lab-models-manifest/v1',
  solidGroupsVersion: 1,
  generatedAt: new Date().toISOString(),
  count: files.length,
  files,
  presets: PRESET_FILES,
};

fs.writeFileSync(OUT, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`[write-models-manifest] wrote ${OUT} (${files.length} files, ${Object.keys(PRESET_FILES).length} presets)`);

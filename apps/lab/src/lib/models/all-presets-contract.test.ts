/**
 * #49-E: every shipped preset file must exist and meet the source-file size cap.
 * Node parses STL presets and checks their geometry contract. Real GLB decoding
 * is covered by scripts/ci/lab-execution-smoke.cjs (all presets) and
 * scripts/ci/next-csp-smoke.mjs (compressed rocket and embedded textures).
 * Run via: npm run test:models
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertGeometryContract } from './geometry-contract.ts';
import { parseModelFile } from './parser.ts';
import { PRESET_MODELS } from './preset-models.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.resolve(__dirname, '../../../public/models');

const withFile = PRESET_MODELS.filter((p) => !!p.modelUrl);

test('catalog lists expected preset count with modelUrl', () => {
  assert.equal(withFile.length, 21, `expected 21 file presets, got ${withFile.length}`);
});

for (const preset of withFile) {
  const fileName = preset.modelUrl!.split('/').pop()!;
  const filePath = path.join(MODELS_DIR, fileName);
  const isGlb = fileName.endsWith('.glb') || fileName.endsWith('.gltf');

  test(`preset ${preset.id}: file exists (${fileName})`, () => {
    assert.ok(fs.existsSync(filePath), `missing ${filePath}`);
    const st = fs.statSync(filePath);
    assert.ok(st.size > 0, `empty file ${fileName}`);
    // X-57 is large but must still be under hard cap (50MB parse path)
    assert.ok(st.size < 50 * 1024 * 1024, `${fileName} exceeds 50MB contract cap`);
  });

  if (!isGlb) {
    test(`preset ${preset.id}: parse + geometry contract`, async () => {
      const buf = fs.readFileSync(filePath);
      const file = new File([buf], fileName);
      const { geometry, metadata } = await parseModelFile(file);
      assert.doesNotThrow(() => assertGeometryContract(geometry));
      assert.ok(metadata.vertexCount > 0);
      assert.ok(metadata.faceCount > 0);
    });
  }
}

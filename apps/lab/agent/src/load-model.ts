import fs from 'node:fs';
import path from 'node:path';
import type { ModelGeometry } from '../../src/types/model.ts';
import type { JobModelRef } from '../../src/types/task.ts';
import { resolveModelsDir, resolveProjectRoot } from './paths.ts';
import { generatePresetModel, PRESET_MODELS } from '../../src/lib/models/preset-models.ts';
import { applyPresetSolidGroups, isModelsManifest } from '../../src/lib/models/models-manifest.ts';
import { decodeModelGeometry } from '../../src/lib/models/geometry-contract.ts';
import { parseStlGeometry, MAX_MODEL_FILE_BYTES } from '../../src/lib/models/parser.ts';
import { downloadModelUrl } from './download-model-url.ts';

export async function loadModelGeometry(model: JobModelRef, options?: {
  loadArtifact?: (id: string, signal?: AbortSignal) => Promise<ArrayBuffer>;
  downloadUrl?: typeof downloadModelUrl;
  signal?: AbortSignal;
}): Promise<ModelGeometry | null> {
  options?.signal?.throwIfAborted();
  if (!model?.source) {
    throw new Error(
      'model load failed: job.spec.model.source is missing (expected preset|url|artifact)'
    );
  }

  const modelsDir = resolveModelsDir();

  if (model.source === 'preset') {
    const id = model.presetId ?? 'cylinder';
    const preset = PRESET_MODELS.find(item => item.id === id);
    const fileName = preset?.modelUrl.endsWith('.stl') ? path.basename(preset.modelUrl) : undefined;
    if (fileName) {
      const p = path.join(modelsDir, fileName);
      if (fs.existsSync(p)) {
        try {
          console.log(`[model] load file ${p}`);
          if (fs.statSync(p).size > MAX_MODEL_FILE_BYTES) throw new Error('model exceeds 50 MiB');
          const bytes = new Uint8Array(fs.readFileSync(p)).buffer;
          const manifestPath = path.join(modelsDir, 'manifest.json');
          const manifest: unknown = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;
          if (!isModelsManifest(manifest)) throw new Error('preset manifest missing or outdated; solid groups cannot be confirmed');
          return await applyPresetSolidGroups(parseStlGeometry(bytes), bytes, manifest.files.find(entry => entry.file === fileName));
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          throw new Error(
            `model load failed: cannot parse preset STL "${id}" at ${p}: ${detail}`
          );
        }
      }
      console.warn(`[model] preset file missing: ${p} — trying procedural fallback`);
    }
    if (preset && !preset.modelUrl.match(/\.(glb|gltf)$/i)) {
      console.log(`[model] shared procedural preset ${id}`);
      return generatePresetModel(id).geometry;
    }
    throw new Error(`model load failed: preset "${id}" unavailable; submit the exact model artifact from the browser`);
  }

  if (model.source === 'url') {
    if (!model.url) {
      throw new Error('model load failed: source=url but model.url is empty');
    }
    try {
      return parseStlGeometry(await (options?.downloadUrl ?? downloadModelUrl)(model.url, options?.signal));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`model load failed: URL download or STL parsing failed: ${detail}`);
    }
  }

  if (model.source === 'artifact') {
    if (!model.artifactId || !options?.loadArtifact) throw new Error('model artifact requires an authenticated job download');
    const bytes = await options.loadArtifact(model.artifactId, options.signal);
    options.signal?.throwIfAborted();
    return decodeModelGeometry(bytes);
  }

  throw new Error(
    `model load failed: unsupported model.source "${String((model as { source?: string }).source)}"`
  );
}

// re-export for tests
export { resolveProjectRoot };

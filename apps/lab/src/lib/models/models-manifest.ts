/**
 * Build-time models manifest helpers.
 *
 * Replaces mount-time HEAD probes: Lab knows which files ship with the build
 * from public/models/manifest.json (written by scripts/write-models-manifest.mjs).
 * Runtime still does a single GET on user click to load the chosen model.
 */

import { PRESET_MODELS, publicAssetUrl } from './preset-models';
import { assertGeometryContract } from './geometry-contract';
import type { ModelGeometry } from '../../types/model';

export type ModelsManifestEntry = {
  file: string;
  bytes: number;
  ext: string;
  /** Explicit construction groups, valid only for these exact file bytes. */
  solidTriangleCounts?: number[];
  sha256?: string;
};

export type ModelsManifest = {
  schema: 'waveworld.lab-models-manifest/v1';
  solidGroupsVersion: 1;
  generatedAt: string;
  count: number;
  files: ModelsManifestEntry[];
  /** preset id → file basename for catalog entries that have modelUrl */
  presets: Record<string, string>;
};

export const MODELS_MANIFEST_PATH = '/models/manifest.json';

/** In-memory cache after first successful fetch (module-scoped, per tab). */
let cachedManifest: ModelsManifest | null = null;
let inflight: Promise<ModelsManifest | null> | null = null;

export function resetModelsManifestCacheForTests(): void {
  cachedManifest = null;
  inflight = null;
}

export function isModelsManifest(value: unknown): value is ModelsManifest {
  if (!value || typeof value !== 'object') return false;
  const v = value as ModelsManifest;
  return (
    v.schema === 'waveworld.lab-models-manifest/v1' && v.solidGroupsVersion === 1 &&
    Array.isArray(v.files) &&
    typeof v.presets === 'object' &&
    v.presets !== null
  );
}

/**
 * Expected preset → basename map from the TypeScript catalog (no network).
 * Used by CI and by the write-manifest script contract.
 */
export function expectedPresetFileMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of PRESET_MODELS) {
    if (!p.modelUrl) continue;
    const base = p.modelUrl.split('/').pop();
    if (base) out[p.id] = base;
  }
  return out;
}

/**
 * Fetch the build-time manifest once. Never HEAD-probes individual models.
 * Returns null on network/parse failure so callers can fall back to catalog-only UI.
 */
export async function loadModelsManifest(
  signal?: AbortSignal
): Promise<ModelsManifest | null> {
  if (cachedManifest) return cachedManifest;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch(publicAssetUrl(MODELS_MANIFEST_PATH), {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
        // Manifest is tiny and static; prefer cache when available.
        cache: 'force-cache',
      });
      if (!res.ok) return null;
      const data: unknown = await res.json();
      if (!isModelsManifest(data)) return null;
      cachedManifest = data;
      return data;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

export function manifestHasFile(
  manifest: ModelsManifest | null | undefined,
  modelUrl: string | undefined
): boolean {
  if (!manifest || !modelUrl) return false;
  const base = modelUrl.split('/').pop();
  if (!base) return false;
  return manifest.files.some((f) => f.file === base);
}

/** Applies author-declared solids only; material names and surface connectivity do not imply solids. */
export async function applyPresetSolidGroups(
  geometry: ModelGeometry, file: ArrayBuffer, entry: ModelsManifestEntry | undefined,
): Promise<ModelGeometry> {
  if (!entry) throw new Error('模型文件不在当前清单中，无法确认实体分组');
  if (!entry.solidTriangleCounts) return geometry;
  if (!Array.isArray(entry.solidTriangleCounts) || !entry.solidTriangleCounts.length ||
      entry.solidTriangleCounts.some(count => !Number.isSafeInteger(count) || count <= 0 || count > geometry.indices.length / 3) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) throw new Error('预设实体分组元数据无效');
  const digest = await crypto.subtle.digest('SHA-256', file);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== entry.sha256 || file.byteLength !== entry.bytes) throw new Error('预设模型与实体分组版本不一致');
  const grouped = { ...geometry, solidTriangleCounts: new Uint32Array(entry.solidTriangleCounts) };
  assertGeometryContract(grouped);
  return grouped;
}

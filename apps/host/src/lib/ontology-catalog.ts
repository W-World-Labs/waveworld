/**
 * Ontology / methods catalog for Phase 3 API.
 * Loads WaveWorld methods via dynamic import (source of truth under src/data/methods).
 *
 * Hardening:
 * - in-memory cache of the full methods list
 * - stable sort by id before filter/page
 * - clamped pagination (default limit 50, max 200)
 * - optional field projection for list endpoints
 */

export type MethodSummary = {
  id: string;
  name: string;
  nameEn?: string;
  /** Domain kind — used as list "category" for projection. */
  kind: string;
  role?: string;
  yearIntroduced?: number;
  simPaths?: string[];
  parentId?: string;
  summary: string;
};

/** Compact list row for `fields=minimal` / projection. */
export type MethodListItem = {
  id: string;
  name: string;
  nameEn?: string;
  /** Alias of `kind` for clients that expect "category". */
  category: string;
  kind: string;
};

export type MethodsQuery = {
  q?: string;
  kind?: string;
  limit?: number;
  offset?: number;
  /**
   * Field projection:
   * - undefined | "full" → MethodSummary (default)
   * - "minimal" | "id,name,category" → MethodListItem only
   */
  fields?: string;
};

type MethodLike = {
  id: string;
  name: string;
  nameEn?: string;
  kind: string;
  role?: string;
  yearIntroduced?: number;
  simPaths?: string[];
  parentId?: string;
  summary: string;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

let cache: MethodLike[] | null = null;
let cacheLoadedAt: number | null = null;

function clampLimit(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(raw)));
}

function clampOffset(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.trunc(raw));
}

function wantsMinimal(fields?: string): boolean {
  if (!fields) return false;
  const f = fields.trim().toLowerCase();
  if (f === 'minimal' || f === 'compact') return true;
  if (f === 'full') return false;
  // allow explicit id,name,category style lists
  const parts = f.split(/[,\s]+/).filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.includes('full')) return false;
  const minimalKeys = new Set(['id', 'name', 'category', 'kind', 'nameen']);
  return parts.every((p) => minimalKeys.has(p));
}

async function loadMethods(): Promise<MethodLike[]> {
  if (cache) return cache;
  // Import from WaveWorld atlas source (externalDir / webpack @ww)
  const mod = await import('../../../../src/data/methods/methods');
  const raw = mod.METHODS as MethodLike[];
  // Stable sort by id once at load — list/pagination order is deterministic
  cache = [...raw].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  cacheLoadedAt = Date.now();
  return cache;
}

/** Test helper: drop in-memory catalog (not used in production). */
export function clearOntologyCache(): void {
  cache = null;
  cacheLoadedAt = null;
}

export function ontologyCacheInfo(): { loaded: boolean; loadedAt: number | null; count: number } {
  return {
    loaded: cache != null,
    loadedAt: cacheLoadedAt,
    count: cache?.length ?? 0,
  };
}

function toSummary(m: MethodLike): MethodSummary {
  return {
    id: m.id,
    name: m.name,
    nameEn: m.nameEn,
    kind: m.kind,
    role: m.role,
    yearIntroduced: m.yearIntroduced,
    simPaths: m.simPaths,
    parentId: m.parentId,
    summary: m.summary,
  };
}

function toListItem(m: MethodLike): MethodListItem {
  return {
    id: m.id,
    name: m.name,
    nameEn: m.nameEn,
    category: m.kind,
    kind: m.kind,
  };
}

export async function listMethods(query: MethodsQuery = {}): Promise<{
  total: number;
  offset: number;
  limit: number;
  fields: 'full' | 'minimal';
  items: Array<MethodSummary | MethodListItem>;
}> {
  const all = await loadMethods();
  const q = query.q?.trim().toLowerCase();
  const kind = query.kind?.trim();
  let filtered = all;
  if (kind) filtered = filtered.filter((m) => m.kind === kind);
  if (q) {
    filtered = filtered.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        (m.nameEn?.toLowerCase().includes(q) ?? false) ||
        m.summary.toLowerCase().includes(q)
    );
  }
  // filtered inherits stable id order from cache
  const total = filtered.length;
  const offset = clampOffset(query.offset);
  const limit = clampLimit(query.limit);
  const slice = filtered.slice(offset, offset + limit);
  const minimal = wantsMinimal(query.fields);
  return {
    total,
    offset,
    limit,
    fields: minimal ? 'minimal' : 'full',
    items: minimal ? slice.map(toListItem) : slice.map(toSummary),
  };
}

export async function getMethod(id: string): Promise<MethodSummary | null> {
  if (!id || !id.trim()) return null;
  const all = await loadMethods();
  const m = all.find((x) => x.id === id);
  if (!m) return null;
  return toSummary(m);
}

export async function ontologyMeta(): Promise<{
  methodCount: number;
  kinds: Record<string, number>;
  jobKinds: string[];
  defaults: { limit: number; maxLimit: number; sort: string };
}> {
  const all = await loadMethods();
  const kinds: Record<string, number> = {};
  for (const m of all) {
    kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
  }
  // stable key order for kinds
  const sortedKinds: Record<string, number> = {};
  for (const k of Object.keys(kinds).sort()) {
    sortedKinds[k] = kinds[k];
  }
  return {
    methodCount: all.length,
    kinds: sortedKinds,
    jobKinds: ['lbm-d3q19', 'fdtd-batch', 'export-report'],
    defaults: {
      limit: DEFAULT_LIMIT,
      maxLimit: MAX_LIMIT,
      sort: 'id',
    },
  };
}

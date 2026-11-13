/**
 * Atlas/Host knowledge source adapter (EPIC #52 K3/K4).
 *
 * Honors KNOWLEDGE_SOURCE=static|db so product code can switch without
 * rewriting matrix/edge card pages. Default is **db** (K4). Static path
 * uses packaged ontology (seed / explicit fallback); db path uses Knowledge
 * DB read models (released claims only).
 *
 * @see docs/knowledge-db.md §5–§6 K3/K4
 */
import type { ConversionEdge, EnergyNode } from '../../data/ontology/types.ts'
import {
  getKnowledgeEdge,
  getKnowledgeMaterial,
  getKnowledgeNode,
  listKnowledgeEdges,
  listKnowledgeMaterials,
  listKnowledgeNodes,
  listKnowledgeReleases,
  type KnowledgeEdgeDto,
  type KnowledgeMaterialDto,
  type KnowledgeNodeDto,
  type KnowledgeReleaseSummaryDto,
  type ListEdgesQuery,
  type PageQuery,
  type PageResult,
  type ReadDbOptions,
  type ReleasedClaimDto,
} from './read.ts'
import {
  DEFAULT_KNOWLEDGE_SOURCE,
  resolveKnowledgeSource,
  type KnowledgeSource,
} from './source.ts'

export type KnowledgeAdapterOptions = ReadDbOptions & {
  /** Override env resolution (tests / explicit host config). */
  source?: KnowledgeSource
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  /**
   * Static loaders (injectable). Defaults lazy-import ontology packages
   * only when source=static so db-only hosts avoid loading large JSON.
   */
  loadStaticNodes?: () => EnergyNode[] | Promise<EnergyNode[]>
  loadStaticEdges?: () => ConversionEdge[] | Promise<ConversionEdge[]>
  loadStaticMaterials?: () =>
    | StaticMaterialLike[]
    | Promise<StaticMaterialLike[]>
}

export type StaticMaterialLike = {
  id: string
  categoryId?: string
  category_id?: string
  name: string
  nameEn?: string | null
  name_en?: string | null
  formula?: string | null
  kind?: string
  fidelity?: string | null
  forcefield?: string | null
  notes?: string | null
  sourceText?: string | null
  source_text?: string | null
  meta?: unknown
}

export type KnowledgeAdapter = {
  source: KnowledgeSource
  listNodes: (query?: PageQuery) => Promise<PageResult<KnowledgeNodeDto>>
  getNode: (id: string) => Promise<KnowledgeNodeDto | null>
  listEdges: (query?: ListEdgesQuery) => Promise<PageResult<KnowledgeEdgeDto>>
  getEdge: (
    id: string,
    opts?: { embedReleasedClaims?: boolean },
  ) => Promise<KnowledgeEdgeDto | null>
  listMaterials: (
    query?: PageQuery & { categoryId?: string },
  ) => Promise<PageResult<KnowledgeMaterialDto>>
  getMaterial: (id: string) => Promise<KnowledgeMaterialDto | null>
  listReleases: (
    query?: PageQuery,
  ) => Promise<PageResult<KnowledgeReleaseSummaryDto>>
}

function clampLimit(raw: number | undefined, def = 50, max = 200): number {
  if (raw == null || !Number.isFinite(raw)) return def
  return Math.min(max, Math.max(1, Math.trunc(raw)))
}

function clampOffset(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return 0
  return Math.max(0, Math.trunc(raw))
}

function pageOf<T>(items: T[], query: PageQuery = {}): PageResult<T> {
  const limit = clampLimit(query.limit)
  const offset = clampOffset(query.offset)
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  }
}

function matchQ(
  q: string | undefined,
  fields: Array<string | null | undefined>,
): boolean {
  if (!q?.trim()) return true
  const needle = q.trim().toLowerCase()
  return fields.some((f) => (f ?? '').toLowerCase().includes(needle))
}

function nodeFromStatic(n: EnergyNode): KnowledgeNodeDto {
  return {
    id: n.id,
    parentId: n.parent ?? null,
    name: n.name,
    nameEn: n.nameEn ?? null,
    symbol: n.symbol ?? null,
    icon: n.icon ?? null,
    color: n.color ?? null,
    desc: n.desc ?? '',
    descEn: n.descEn ?? null,
    quantities: n.quantities ?? [],
    consensus: n.consensus ?? {},
    refs: n.refs ?? null,
  }
}

/**
 * Static edges expose legacy efficiency only; releasedClaims stays empty
 * unless a caller seeds synthetic claims (K3: DB is the claim authority).
 */
function edgeFromStatic(
  e: ConversionEdge,
  releasedClaims?: ReleasedClaimDto[],
): KnowledgeEdgeDto {
  return {
    id: e.id,
    fromNodeId: e.from,
    toNodeId: e.to,
    name: e.name,
    nameEn: e.nameEn ?? null,
    principle: e.principle ?? '',
    principleEn: e.principleEn ?? null,
    efficiencyKind: e.kind === 'transport' ? 'transport' : 'conversion',
    efficiency: e.efficiency ?? null,
    formula: e.formula ?? null,
    lossMechanisms: e.lossMechanisms ?? null,
    maturity: e.maturity ?? null,
    apps: e.apps ?? null,
    consensus: e.consensus ?? {},
    refs: e.refs ?? null,
    status: 'active',
    devices: e.device ? [...e.device] : [],
    products: (e.products ?? []).map((p) => ({
      vendor: p.vendor ?? null,
      vendorEn: p.vendorEn ?? null,
      model: p.model,
      modelEn: p.modelEn ?? null,
      spec: p.spec ?? null,
      specEn: p.specEn ?? null,
    })),
    ...(releasedClaims ? { releasedClaims } : {}),
  }
}

function materialFromStatic(m: StaticMaterialLike): KnowledgeMaterialDto {
  return {
    id: m.id,
    categoryId: m.categoryId ?? m.category_id ?? 'unknown',
    name: m.name,
    nameEn: m.nameEn ?? m.name_en ?? null,
    formula: m.formula ?? null,
    kind: m.kind ?? 'other',
    fidelity: m.fidelity ?? null,
    forcefield: m.forcefield ?? null,
    notes: m.notes ?? null,
    sourceText: m.sourceText ?? m.source_text ?? null,
    meta: m.meta ?? null,
  }
}

async function defaultStaticNodes(): Promise<EnergyNode[]> {
  const mod = await import('../../data/ontology/nodes.ts')
  return mod.NODES as EnergyNode[]
}

async function defaultStaticEdges(): Promise<ConversionEdge[]> {
  const mod = await import('../../data/ontology/edges.ts')
  return mod.EDGES as ConversionEdge[]
}

/**
 * Build materials list from materials.data.json + MATERIAL_ID_BY_NAME
 * (same id space as seed). Soft-fails to [] if import unavailable.
 */
async function defaultStaticMaterials(): Promise<StaticMaterialLike[]> {
  try {
    const materialsFile = (
      await import('../../data/materials/materials.data.json')
    ).default as {
      categories: Array<{
        key: string
        materials: Array<Record<string, unknown> & { name: string }>
      }>
    }
    const { resolveMaterialId } = await import('./seed-from-static.ts')
    const out: StaticMaterialLike[] = []
    for (const cat of materialsFile.categories) {
      for (const mat of cat.materials) {
        let id: string
        try {
          id = resolveMaterialId(mat.name)
        } catch {
          id = `mat:unknown:${mat.name}`
        }
        out.push({
          id,
          categoryId: cat.key,
          name: mat.name,
          formula: typeof mat.formula === 'string' ? mat.formula : null,
          kind: 'forcefield_lj',
          forcefield:
            typeof mat.forcefield === 'string' ? mat.forcefield : null,
          notes: typeof mat.notes === 'string' ? mat.notes : null,
          sourceText:
            typeof mat.source === 'string' ? mat.source : null,
          meta: mat,
        })
      }
    }
    return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  } catch {
    return []
  }
}

export function createKnowledgeAdapter(
  options: KnowledgeAdapterOptions = {},
): KnowledgeAdapter {
  const source =
    options.source ??
    resolveKnowledgeSource(options.env ?? process.env) ??
    DEFAULT_KNOWLEDGE_SOURCE

  const dbOpts: ReadDbOptions = {
    dbPath: options.dbPath,
    root: options.root,
    readonly: options.readonly,
  }

  if (source === 'db') {
    return {
      source: 'db',
      listNodes: async (query) => listKnowledgeNodes(query, dbOpts),
      getNode: async (id) => getKnowledgeNode(id, dbOpts),
      listEdges: async (query) => listKnowledgeEdges(query, dbOpts),
      getEdge: async (id, opts) =>
        getKnowledgeEdge(id, {
          ...dbOpts,
          embedReleasedClaims: opts?.embedReleasedClaims,
        }),
      listMaterials: async (query) => listKnowledgeMaterials(query, dbOpts),
      getMaterial: async (id) =>
        getKnowledgeMaterial(id, { ...dbOpts, includeProperties: true }),
      listReleases: async (query) => listKnowledgeReleases(query, dbOpts),
    }
  }

  // ── static ──────────────────────────────────────────────────────
  let nodesCache: EnergyNode[] | null = null
  let edgesCache: ConversionEdge[] | null = null
  let materialsCache: StaticMaterialLike[] | null = null

  async function nodes(): Promise<EnergyNode[]> {
    if (!nodesCache) {
      nodesCache = await (options.loadStaticNodes ?? defaultStaticNodes)()
    }
    return nodesCache
  }
  async function edges(): Promise<ConversionEdge[]> {
    if (!edgesCache) {
      edgesCache = await (options.loadStaticEdges ?? defaultStaticEdges)()
    }
    return edgesCache
  }
  async function materials(): Promise<StaticMaterialLike[]> {
    if (!materialsCache) {
      materialsCache = await (
        options.loadStaticMaterials ?? defaultStaticMaterials
      )()
    }
    return materialsCache
  }

  return {
    source: 'static',
    listNodes: async (query = {}) => {
      const all = (await nodes())
        .map(nodeFromStatic)
        .filter((n) => matchQ(query.q, [n.id, n.name, n.nameEn]))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      return pageOf(all, query)
    },
    getNode: async (id) => {
      const n = (await nodes()).find((x) => x.id === id)
      return n ? nodeFromStatic(n) : null
    },
    listEdges: async (query = {}) => {
      let all = (await edges()).map((e) =>
        edgeFromStatic(
          e,
          query.embedReleasedClaims ? [] : undefined,
        ),
      )
      if (query.fromNodeId) {
        all = all.filter((e) => e.fromNodeId === query.fromNodeId)
      }
      if (query.toNodeId) {
        all = all.filter((e) => e.toNodeId === query.toNodeId)
      }
      if (query.status && query.status !== 'all' && query.status !== 'active') {
        all = all.filter((e) => e.status === query.status)
      }
      all = all
        .filter((e) => matchQ(query.q, [e.id, e.name, e.nameEn]))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      return pageOf(all, query)
    },
    getEdge: async (id, opts) => {
      const e = (await edges()).find((x) => x.id === id)
      if (!e) return null
      const embed = opts?.embedReleasedClaims !== false
      // Static mode: no released claim authority; empty array when embedded.
      return edgeFromStatic(e, embed ? [] : undefined)
    },
    listMaterials: async (query = {}) => {
      let all = (await materials()).map(materialFromStatic)
      if (query.categoryId) {
        all = all.filter((m) => m.categoryId === query.categoryId)
      }
      all = all
        .filter((m) => matchQ(query.q, [m.id, m.name, m.nameEn]))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      return pageOf(all, query)
    },
    getMaterial: async (id) => {
      const m = (await materials()).find((x) => x.id === id)
      return m ? materialFromStatic(m) : null
    },
    listReleases: async (query = {}) => {
      // Static packaged releases are file-store (track C); adapter returns empty
      // until Host API is used with source=db. Callers should prefer API.
      return pageOf([] as KnowledgeReleaseSummaryDto[], query)
    },
  }
}

/** Singleton helper for process env (Host routes may recreate per request). */
let defaultAdapter: KnowledgeAdapter | null = null
let defaultAdapterSource: KnowledgeSource | null = null

export function getKnowledgeAdapter(
  options?: KnowledgeAdapterOptions,
): KnowledgeAdapter {
  if (options?.source || options?.env || options?.dbPath || options?.root) {
    return createKnowledgeAdapter(options)
  }
  const source = resolveKnowledgeSource()
  if (!defaultAdapter || defaultAdapterSource !== source) {
    defaultAdapter = createKnowledgeAdapter({ source })
    defaultAdapterSource = source
  }
  return defaultAdapter
}

/** Test helper. */
export function resetKnowledgeAdapterCache(): void {
  defaultAdapter = null
  defaultAdapterSource = null
}

/**
 * Atlas Matrix / Graph / Paths ontology load seam (EPIC #52 K11).
 *
 * Preferred path: createKnowledgeAdapter() with DEFAULT_KNOWLEDGE_SOURCE=db
 * (or Host HTTP API that uses the same read model). Explicit static ontology
 * fallback when DB/API is empty or unavailable — static is seed/emergency only.
 *
 * Browser-safe: does not statically import better-sqlite3 / adapter IO.
 * Node/tests may inject an adapter or lazy-load createKnowledgeAdapter.
 *
 * @see docs/knowledge-db.md §5.2
 */
import type {
  Consensus,
  ConversionEdge,
  EfficiencyKind,
  EnergyNode,
  Formula,
  LossMechanism,
  Product,
  Quantity,
} from '../../data/ontology/types.ts'
import type { KnowledgeAdapter } from './adapter.ts'
import type {
  KnowledgeEdgeDto,
  KnowledgeNodeDto,
  PageResult,
} from './read.ts'
import {
  DEFAULT_KNOWLEDGE_SOURCE,
  type KnowledgeSource,
} from './source.ts'

export const DEFAULT_KNOWLEDGE_API_BASE = '/api/v1/knowledge'

export type AtlasOntologySource = KnowledgeSource | 'api'

export type AtlasOntologyBundle = {
  nodes: EnergyNode[]
  edges: ConversionEdge[]
  /** Runtime authority used for this load. */
  source: AtlasOntologySource
  /** True when preferred db/api path failed or was empty and static was used. */
  usedFallback: boolean
  /** Non-fatal preferred-path error message (if any). */
  error?: string
}

export type LoadAtlasOntologyOptions = {
  /** Injected adapter (tests / Host). When set, skips env create + API. */
  adapter?: KnowledgeAdapter
  /**
   * Host public knowledge API base (browser).
   * Default `/api/v1/knowledge`. Set empty string to skip API.
   */
  apiBase?: string
  fetchImpl?: typeof fetch
  /** Force packaged static ontology only. */
  preferStatic?: boolean
  /** Skip lazy createKnowledgeAdapter() attempt (browser / pure API tests). */
  skipLocalAdapter?: boolean
  /** Page size for adapter/API list (clamped server-side to ≤200). */
  pageSize?: number
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function asConsensus(raw: unknown): Consensus {
  if (raw && typeof raw === 'object' && typeof (raw as Consensus).status === 'string') {
    return raw as Consensus
  }
  return { status: 'open' }
}

function asQuantity(raw: unknown): Quantity | null {
  if (!raw || typeof raw !== 'object') return null
  const q = raw as Quantity
  if (typeof q.symbol !== 'string' || typeof q.unit !== 'string') return null
  return q
}

function asFormula(raw: unknown): Formula | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const f = raw as Formula
  if (typeof f.expr !== 'string' || !f.vars || typeof f.vars !== 'object') {
    return undefined
  }
  return f
}

function asLossMechanisms(raw: unknown): LossMechanism[] {
  if (!Array.isArray(raw)) return []
  const out: LossMechanism[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const l = item as LossMechanism
    if (typeof l.name !== 'string' || typeof l.desc !== 'string') continue
    out.push({
      name: l.name,
      desc: l.desc,
      formula: asFormula(l.formula),
    })
  }
  return out
}

function asProducts(raw: unknown): Product[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: Product[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const p = item as Product & Record<string, unknown>
    if (typeof p.model !== 'string') continue
    const product: Product = { model: p.model }
    if (typeof p.vendor === 'string') product.vendor = p.vendor
    if (typeof p.vendorEn === 'string') product.vendorEn = p.vendorEn
    if (typeof p.modelEn === 'string') product.modelEn = p.modelEn
    if (typeof p.spec === 'string') product.spec = p.spec
    if (typeof p.specEn === 'string') product.specEn = p.specEn
    out.push(product)
  }
  return out.length ? out : undefined
}

function asStringList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out = raw.filter((x): x is string => typeof x === 'string')
  return out.length ? out : undefined
}

/** Map Knowledge DB node DTO → Atlas EnergyNode. */
export function knowledgeNodeDtoToEnergyNode(dto: KnowledgeNodeDto): EnergyNode {
  const quantities = Array.isArray(dto.quantities)
    ? (dto.quantities as unknown[])
        .map(asQuantity)
        .filter((q): q is Quantity => q != null)
    : []
  return {
    id: dto.id,
    parent: dto.parentId ?? undefined,
    name: dto.name,
    nameEn: dto.nameEn ?? undefined,
    symbol: dto.symbol ?? undefined,
    icon: dto.icon ?? undefined,
    color: dto.color ?? undefined,
    desc: dto.desc ?? '',
    descEn: dto.descEn ?? undefined,
    quantities,
    consensus: asConsensus(dto.consensus),
    refs: asStringList(dto.refs),
  }
}

/**
 * Map Knowledge DB edge DTO → Atlas ConversionEdge.
 * Returns null when efficiency skeleton is unusable (skip bad rows).
 */
export function knowledgeEdgeDtoToConversionEdge(
  dto: KnowledgeEdgeDto,
): ConversionEdge | null {
  const efficiency = asQuantity(dto.efficiency)
  if (!efficiency) return null
  const kind: EfficiencyKind | undefined =
    dto.efficiencyKind === 'transport'
      ? 'transport'
      : dto.efficiencyKind === 'conversion'
        ? 'conversion'
        : undefined
  return {
    id: dto.id,
    from: dto.fromNodeId,
    to: dto.toNodeId,
    name: dto.name,
    nameEn: dto.nameEn ?? undefined,
    principle: dto.principle ?? '',
    principleEn: dto.principleEn ?? undefined,
    kind,
    efficiency,
    lossMechanisms: asLossMechanisms(dto.lossMechanisms),
    formula: asFormula(dto.formula),
    maturity: dto.maturity ?? undefined,
    apps: asStringList(dto.apps),
    consensus: asConsensus(dto.consensus),
    refs: asStringList(dto.refs),
    // K12: edge_devices / edge_products joined on public KnowledgeEdgeDto.
    device: asStringList(dto.devices),
    products: asProducts(dto.products),
  }
}

async function listAllPages<T>(
  fetchPage: (limit: number, offset: number) => Promise<PageResult<T>>,
  pageSize: number,
): Promise<T[]> {
  const limit = Math.min(200, Math.max(1, pageSize))
  const out: T[] = []
  let offset = 0
  let total = Infinity
  while (offset < total) {
    const page = await fetchPage(limit, offset)
    total = page.total
    out.push(...page.items)
    if (page.items.length === 0) break
    offset += page.items.length
    if (offset > 50_000) break // hard safety
  }
  return out
}

/** Load full ontology graph via KnowledgeAdapter (db or static source). */
export async function loadAtlasOntologyFromAdapter(
  adapter: KnowledgeAdapter,
  pageSize = 200,
): Promise<AtlasOntologyBundle> {
  const nodeDtos = await listAllPages(
    (limit, offset) => adapter.listNodes({ limit, offset }),
    pageSize,
  )
  const edgeDtos = await listAllPages(
    (limit, offset) => adapter.listEdges({ limit, offset }),
    pageSize,
  )
  const nodes = nodeDtos.map(knowledgeNodeDtoToEnergyNode)
  const edges = edgeDtos
    .map(knowledgeEdgeDtoToConversionEdge)
    .filter((e): e is ConversionEdge => e != null)
  return {
    nodes,
    edges,
    source: adapter.source,
    usedFallback: adapter.source === 'static',
  }
}

type ApiListResponse<T> = {
  items?: T[]
  total?: number
  limit?: number
  offset?: number
  source?: string
}

async function fetchApiPage<T>(
  url: string,
  fetchImpl: typeof fetch,
): Promise<PageResult<T>> {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(`knowledge API HTTP ${res.status} for ${url}`)
  }
  const body = (await res.json()) as ApiListResponse<T>
  const items = Array.isArray(body.items) ? body.items : []
  const total =
    typeof body.total === 'number' && Number.isFinite(body.total)
      ? body.total
      : items.length
  const limit =
    typeof body.limit === 'number' && Number.isFinite(body.limit)
      ? body.limit
      : items.length
  const offset =
    typeof body.offset === 'number' && Number.isFinite(body.offset)
      ? body.offset
      : 0
  return { items, total, limit, offset }
}

function joinApi(base: string, path: string, query: string): string {
  const b = base.replace(/\/+$/, '')
  const p = path.replace(/^\/+/, '')
  return `${b}/${p}?${query}`
}

/** Load via Host GET /api/v1/knowledge/nodes|edges (same read model as adapter db). */
export async function loadAtlasOntologyFromApi(
  apiBase: string = DEFAULT_KNOWLEDGE_API_BASE,
  fetchImpl: typeof fetch = fetch,
  pageSize = 200,
): Promise<AtlasOntologyBundle> {
  const base = apiBase.trim() || DEFAULT_KNOWLEDGE_API_BASE
  const nodeDtos = await listAllPages(
    (limit, offset) =>
      fetchApiPage<KnowledgeNodeDto>(
        joinApi(base, 'nodes', `limit=${limit}&offset=${offset}`),
        fetchImpl,
      ),
    pageSize,
  )
  const edgeDtos = await listAllPages(
    (limit, offset) =>
      fetchApiPage<KnowledgeEdgeDto>(
        joinApi(base, 'edges', `limit=${limit}&offset=${offset}`),
        fetchImpl,
      ),
    pageSize,
  )
  const nodes = nodeDtos.map(knowledgeNodeDtoToEnergyNode)
  const edges = edgeDtos
    .map(knowledgeEdgeDtoToConversionEdge)
    .filter((e): e is ConversionEdge => e != null)
  if (nodes.length === 0 && edges.length === 0) {
    throw new Error('knowledge API returned empty nodes and edges')
  }
  return {
    nodes,
    edges,
    source: 'api',
    usedFallback: false,
  }
}

/** Explicit static fallback (seed / emergency). Lazy-imports ontology packages. */
export async function loadAtlasOntologyStatic(): Promise<AtlasOntologyBundle> {
  const [{ NODES }, { EDGES }] = await Promise.all([
    import('../../data/ontology/nodes.ts'),
    import('../../data/ontology/edges.ts'),
  ])
  return {
    nodes: NODES as EnergyNode[],
    edges: EDGES as ConversionEdge[],
    source: 'static',
    usedFallback: true,
  }
}

/**
 * Preferred: createKnowledgeAdapter() default db → (browser) Host API → static.
 */
export async function loadAtlasOntology(
  options: LoadAtlasOntologyOptions = {},
): Promise<AtlasOntologyBundle> {
  const pageSize = options.pageSize ?? 200

  if (options.preferStatic) {
    return loadAtlasOntologyStatic()
  }

  // 1) Explicit injected adapter (tests / Node callers).
  if (options.adapter) {
    try {
      const bundle = await loadAtlasOntologyFromAdapter(
        options.adapter,
        pageSize,
      )
      if (bundle.nodes.length > 0 || bundle.edges.length > 0) {
        return bundle
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const fallback = await loadAtlasOntologyStatic()
      return { ...fallback, error: msg, usedFallback: true }
    }
  }

  let preferredError: string | undefined

  // 2) Node: lazy createKnowledgeAdapter() with DEFAULT_KNOWLEDGE_SOURCE=db.
  // import.meta.env.SSR is false in Vite client builds so this branch (and the
  // node-only adapter graph) is tree-shaken out of the SPA bundle.
  if (
    import.meta.env?.SSR !== false &&
    !options.skipLocalAdapter &&
    !isBrowser()
  ) {
    try {
      const { createKnowledgeAdapter } = await import('./adapter.ts')
      const adapter = createKnowledgeAdapter({
        source: DEFAULT_KNOWLEDGE_SOURCE,
      })
      const bundle = await loadAtlasOntologyFromAdapter(adapter, pageSize)
      if (bundle.nodes.length > 0 || bundle.edges.length > 0) {
        return bundle
      }
      preferredError = 'local knowledge adapter returned empty graph'
    } catch (err) {
      preferredError = err instanceof Error ? err.message : String(err)
    }
  }

  // 3) Browser / remote: Host knowledge API (server uses Knowledge DB read).
  const apiBase =
    options.apiBase !== undefined
      ? options.apiBase
      : DEFAULT_KNOWLEDGE_API_BASE
  if (apiBase) {
    try {
      const fetchImpl = options.fetchImpl ?? fetch
      const bundle = await loadAtlasOntologyFromApi(
        apiBase,
        fetchImpl,
        pageSize,
      )
      if (bundle.nodes.length > 0 || bundle.edges.length > 0) {
        return bundle
      }
      preferredError =
        preferredError ?? 'knowledge API returned empty nodes and edges'
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      preferredError = preferredError ? `${preferredError}; ${msg}` : msg
    }
  }

  // 4) Explicit static fallback.
  const fallback = await loadAtlasOntologyStatic()
  return {
    ...fallback,
    usedFallback: true,
    error: preferredError,
  }
}

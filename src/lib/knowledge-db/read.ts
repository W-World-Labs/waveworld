/**
 * Knowledge DB read models for Host public API (EPIC #52 K3).
 *
 * Public defaults:
 * - skeleton lists (nodes/edges/materials) are status-filtered where applicable
 * - claims exposed only when `state='released'` AND present in a release
 *   (`v_released_claims`) — never candidates/quarantine on public paths
 *
 * @see docs/knowledge-db.md §5.2
 */
import type { Claim } from '../knowledge/types.ts'
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'

export const DEFAULT_PAGE_LIMIT = 50
export const MAX_PAGE_LIMIT = 200

export type PageQuery = {
  limit?: number
  offset?: number
  q?: string
}

export type PageResult<T> = {
  items: T[]
  total: number
  limit: number
  offset: number
}

export type KnowledgeNodeDto = {
  id: string
  parentId: string | null
  name: string
  nameEn: string | null
  symbol: string | null
  icon: string | null
  color: string | null
  desc: string
  descEn: string | null
  quantities: unknown
  consensus: unknown
  refs: unknown
}

export type ReleasedClaimDto = {
  id: string
  kind: string
  subjectId: string
  statement: Record<string, unknown>
  state: 'released'
  confidence: number | null
  createdAt: string
  updatedAt: string | null
  contractVersion: number
}

/** Commercial product row from edge_products (Atlas chips). */
export type KnowledgeEdgeProductDto = {
  vendor: string | null
  vendorEn: string | null
  model: string
  modelEn: string | null
  spec: string | null
  specEn: string | null
}

export type KnowledgeEdgeDto = {
  id: string
  fromNodeId: string
  toNodeId: string
  name: string
  nameEn: string | null
  principle: string
  principleEn: string | null
  efficiencyKind: string
  /** Legacy mirror from conversion_edges.efficiency_json (migration window). */
  efficiency: unknown
  formula: unknown
  lossMechanisms: unknown
  maturity: string | null
  apps: unknown
  consensus: unknown
  refs: unknown
  status: string
  /**
   * Typical transducers/devices from edge_devices (sort_order).
   * Always present on list/detail so Atlas chips work for source=db/api.
   */
  devices: string[]
  /** Commercial products from edge_products (sort_order). */
  products: KnowledgeEdgeProductDto[]
  /** Released efficiency claims when requested / on detail. */
  releasedClaims?: ReleasedClaimDto[]
}

export type KnowledgeMaterialDto = {
  id: string
  categoryId: string
  name: string
  nameEn: string | null
  formula: string | null
  kind: string
  fidelity: string | null
  forcefield: string | null
  notes: string | null
  sourceText: string | null
  meta: unknown
  properties?: KnowledgeMaterialPropertyDto[]
}

export type KnowledgeMaterialPropertyDto = {
  id: string
  materialId: string
  key: string
  valueNum: number | null
  valueText: string | null
  unit: string | null
  condition: unknown
  fidelity: string | null
  claimId: string | null
  sortOrder: number
}

export type KnowledgeReleaseSummaryDto = {
  id: string
  releasedAt: string
  state: string
  sha256: string
  claimCount: number
  snapshotCount: number
  bindingCount: number
  exportRelpath: string | null
  meta: unknown
}

export type KnowledgeReleaseDetailDto = KnowledgeReleaseSummaryDto & {
  claims?: ReleasedClaimDto[]
  claimIds?: string[]
}

export type ReadDbOptions = {
  dbPath?: string
  root?: string
  /** Prefer readonly open (default true for API). */
  readonly?: boolean
}

function clampLimit(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return DEFAULT_PAGE_LIMIT
  return Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.trunc(raw)))
}

function clampOffset(raw: number | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return 0
  return Math.max(0, Math.trunc(raw))
}

function parseJson(text: string | null | undefined, fallback: unknown): unknown {
  if (text == null || text === '') return fallback
  try {
    return JSON.parse(text) as unknown
  } catch {
    return fallback
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {}
}

type ClaimRow = {
  id: string
  contract_version: number
  kind: string
  subject_id: string
  statement_json: string
  state: string
  confidence: number | null
  created_at: string
  updated_at: string | null
}

export function claimRowToReleasedDto(row: ClaimRow): ReleasedClaimDto {
  return {
    id: row.id,
    kind: row.kind,
    subjectId: row.subject_id,
    statement: asRecord(parseJson(row.statement_json, {})),
    state: 'released',
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    contractVersion: row.contract_version,
  }
}

/** Map released claim DTO → pipeline Claim (for adapters/tests). */
export function releasedClaimDtoToClaim(dto: ReleasedClaimDto): Claim {
  return {
    contractVersion: dto.contractVersion as 1,
    id: dto.id,
    kind: dto.kind,
    subjectId: dto.subjectId,
    statement: dto.statement,
    state: 'released',
    confidence: dto.confidence ?? undefined,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt ?? undefined,
  }
}

export function withKnowledgeDb<T>(
  options: ReadDbOptions | undefined,
  fn: (db: SqliteDatabase) => T,
): T {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const readonly = options?.readonly !== false
  const db = openKnowledgeDb({ dbPath, root, readonly })
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

// ─── Nodes ────────────────────────────────────────────────────────

type NodeRow = {
  id: string
  parent_id: string | null
  name: string
  name_en: string | null
  symbol: string | null
  icon: string | null
  color: string | null
  desc_zh: string
  desc_en: string | null
  quantities_json: string
  consensus_json: string
  refs_json: string | null
}

function mapNode(row: NodeRow): KnowledgeNodeDto {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    nameEn: row.name_en,
    symbol: row.symbol,
    icon: row.icon,
    color: row.color,
    desc: row.desc_zh,
    descEn: row.desc_en,
    quantities: parseJson(row.quantities_json, []),
    consensus: parseJson(row.consensus_json, {}),
    refs: parseJson(row.refs_json, null),
  }
}

export function listKnowledgeNodes(
  query: PageQuery & { parentId?: string | null } = {},
  options?: ReadDbOptions,
): PageResult<KnowledgeNodeDto> {
  const limit = clampLimit(query.limit)
  const offset = clampOffset(query.offset)
  const q = query.q?.trim()
  /** K36: filter by parent_id; special value `__root__` / empty means parent_id IS NULL */
  const parentIdRaw = query.parentId
  const parentFilter =
    parentIdRaw === undefined
      ? null
      : parentIdRaw === null ||
          parentIdRaw === '' ||
          parentIdRaw === '__root__' ||
          parentIdRaw === 'null'
        ? { mode: 'null' as const }
        : { mode: 'id' as const, id: parentIdRaw.trim() }

  return withKnowledgeDb(options, (db) => {
    const clauses: string[] = []
    const params: Record<string, unknown> = {}
    if (parentFilter?.mode === 'null') {
      clauses.push('parent_id IS NULL')
    } else if (parentFilter?.mode === 'id') {
      clauses.push('parent_id = @parentId')
      params.parentId = parentFilter.id
    }
    if (q) {
      clauses.push(
        `(id LIKE @like OR name LIKE @like OR IFNULL(name_en,'') LIKE @like)`,
      )
      params.like = `%${q}%`
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const total = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM energy_nodes ${where}`)
        .get(params) as { c: number }
    ).c
    const rows = db
      .prepare(
        `SELECT * FROM energy_nodes ${where} ORDER BY id LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as NodeRow[]
    return { items: rows.map(mapNode), total, limit, offset }
  })
}

export function getKnowledgeNode(
  id: string,
  options?: ReadDbOptions,
): KnowledgeNodeDto | null {
  return withKnowledgeDb(options, (db) => {
    const row = db
      .prepare(`SELECT * FROM energy_nodes WHERE id = ?`)
      .get(id) as NodeRow | undefined
    return row ? mapNode(row) : null
  })
}

// ─── Edges ────────────────────────────────────────────────────────

type EdgeRow = {
  id: string
  from_node_id: string
  to_node_id: string
  name: string
  name_en: string | null
  principle: string
  principle_en: string | null
  efficiency_kind: string
  efficiency_json: string | null
  formula_json: string | null
  loss_mechanisms_json: string | null
  maturity: string | null
  apps_json: string | null
  consensus_json: string
  refs_json: string | null
  status: string
}

type DeviceRow = {
  edge_id: string
  label: string
  sort_order: number
}

type ProductRow = {
  edge_id: string
  vendor: string | null
  vendor_en: string | null
  model: string
  model_en: string | null
  spec: string | null
  spec_en: string | null
  sort_order: number
}

function listDevicesForEdges(
  db: SqliteDatabase,
  edgeIds: readonly string[],
): Map<string, string[]> {
  const out = new Map<string, string[]>()
  if (edgeIds.length === 0) return out
  const placeholders = edgeIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT edge_id, label, sort_order FROM edge_devices
       WHERE edge_id IN (${placeholders})
       ORDER BY edge_id, sort_order, id`,
    )
    .all(...edgeIds) as DeviceRow[]
  for (const row of rows) {
    const list = out.get(row.edge_id) ?? []
    list.push(row.label)
    out.set(row.edge_id, list)
  }
  return out
}

function listProductsForEdges(
  db: SqliteDatabase,
  edgeIds: readonly string[],
): Map<string, KnowledgeEdgeProductDto[]> {
  const out = new Map<string, KnowledgeEdgeProductDto[]>()
  if (edgeIds.length === 0) return out
  const placeholders = edgeIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT edge_id, vendor, vendor_en, model, model_en, spec, spec_en, sort_order
       FROM edge_products
       WHERE edge_id IN (${placeholders})
       ORDER BY edge_id, sort_order, id`,
    )
    .all(...edgeIds) as ProductRow[]
  for (const row of rows) {
    const list = out.get(row.edge_id) ?? []
    list.push({
      vendor: row.vendor,
      vendorEn: row.vendor_en,
      model: row.model,
      modelEn: row.model_en,
      spec: row.spec,
      specEn: row.spec_en,
    })
    out.set(row.edge_id, list)
  }
  return out
}

function mapEdge(
  row: EdgeRow,
  opts?: {
    claims?: ReleasedClaimDto[]
    devices?: string[]
    products?: KnowledgeEdgeProductDto[]
  },
): KnowledgeEdgeDto {
  const dto: KnowledgeEdgeDto = {
    id: row.id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    name: row.name,
    nameEn: row.name_en,
    principle: row.principle,
    principleEn: row.principle_en,
    efficiencyKind: row.efficiency_kind,
    efficiency: parseJson(row.efficiency_json, null),
    formula: parseJson(row.formula_json, null),
    lossMechanisms: parseJson(row.loss_mechanisms_json, null),
    maturity: row.maturity,
    apps: parseJson(row.apps_json, null),
    consensus: parseJson(row.consensus_json, {}),
    refs: parseJson(row.refs_json, null),
    status: row.status,
    devices: opts?.devices ?? [],
    products: opts?.products ?? [],
  }
  if (opts?.claims) dto.releasedClaims = opts.claims
  return dto
}

export type ListEdgesQuery = PageQuery & {
  fromNodeId?: string
  toNodeId?: string
  status?: string
  /** K37: filter conversion_edges.efficiency_kind (conversion|transport). */
  efficiencyKind?: string
  /** When true, attach released conversion.efficiency claims per edge. */
  embedReleasedClaims?: boolean
}

export function listReleasedClaimsForSubjects(
  db: SqliteDatabase,
  subjectIds: readonly string[],
  kind?: string,
): Map<string, ReleasedClaimDto[]> {
  const out = new Map<string, ReleasedClaimDto[]>()
  if (subjectIds.length === 0) return out

  const placeholders = subjectIds.map(() => '?').join(',')
  const params: unknown[] = [...subjectIds]
  let kindSql = ''
  if (kind) {
    kindSql = ' AND kind = ?'
    params.push(kind)
  }
  const rows = db
    .prepare(
      `SELECT * FROM v_released_claims
       WHERE subject_id IN (${placeholders})${kindSql}
       ORDER BY subject_id, id`,
    )
    .all(...params) as ClaimRow[]

  for (const row of rows) {
    const dto = claimRowToReleasedDto(row)
    const list = out.get(dto.subjectId) ?? []
    list.push(dto)
    out.set(dto.subjectId, list)
  }
  return out
}

export function listReleasedClaimsForSubject(
  subjectId: string,
  options?: ReadDbOptions & { kind?: string },
): ReleasedClaimDto[] {
  return withKnowledgeDb(options, (db) => {
    const map = listReleasedClaimsForSubjects(
      db,
      [subjectId],
      options?.kind,
    )
    return map.get(subjectId) ?? []
  })
}

export function listKnowledgeEdges(
  query: ListEdgesQuery = {},
  options?: ReadDbOptions,
): PageResult<KnowledgeEdgeDto> {
  const limit = clampLimit(query.limit)
  const offset = clampOffset(query.offset)
  const q = query.q?.trim()
  const fromNodeId = query.fromNodeId?.trim()
  const toNodeId = query.toNodeId?.trim()
  const status = query.status?.trim() || 'active'
  const efficiencyKind = query.efficiencyKind?.trim()

  return withKnowledgeDb(options, (db) => {
    const clauses: string[] = []
    const params: Record<string, unknown> = {}
    if (status && status !== 'all') {
      clauses.push('status = @status')
      params.status = status
    }
    if (fromNodeId) {
      clauses.push('from_node_id = @fromNodeId')
      params.fromNodeId = fromNodeId
    }
    if (toNodeId) {
      clauses.push('to_node_id = @toNodeId')
      params.toNodeId = toNodeId
    }
    if (efficiencyKind) {
      clauses.push('efficiency_kind = @efficiencyKind')
      params.efficiencyKind = efficiencyKind
    }
    if (q) {
      clauses.push(
        `(id LIKE @like OR name LIKE @like OR IFNULL(name_en,'') LIKE @like)`,
      )
      params.like = `%${q}%`
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const total = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM conversion_edges ${where}`)
        .get(params) as { c: number }
    ).c
    const rows = db
      .prepare(
        `SELECT * FROM conversion_edges ${where}
         ORDER BY id LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as EdgeRow[]

    const edgeIds = rows.map((r) => r.id)
    let claimsBySubject: Map<string, ReleasedClaimDto[]> | null = null
    if (query.embedReleasedClaims && edgeIds.length > 0) {
      claimsBySubject = listReleasedClaimsForSubjects(
        db,
        edgeIds,
        'conversion.efficiency',
      )
    }
    const devicesByEdge = listDevicesForEdges(db, edgeIds)
    const productsByEdge = listProductsForEdges(db, edgeIds)

    const items = rows.map((row) =>
      mapEdge(row, {
        claims: claimsBySubject
          ? (claimsBySubject.get(row.id) ?? [])
          : undefined,
        devices: devicesByEdge.get(row.id) ?? [],
        products: productsByEdge.get(row.id) ?? [],
      }),
    )
    return { items, total, limit, offset }
  })
}

export function getKnowledgeEdge(
  id: string,
  options?: ReadDbOptions & { embedReleasedClaims?: boolean },
): KnowledgeEdgeDto | null {
  const embed = options?.embedReleasedClaims !== false
  return withKnowledgeDb(options, (db) => {
    const row = db
      .prepare(`SELECT * FROM conversion_edges WHERE id = ?`)
      .get(id) as EdgeRow | undefined
    if (!row) return null
    let claims: ReleasedClaimDto[] | undefined
    if (embed) {
      const map = listReleasedClaimsForSubjects(
        db,
        [id],
        'conversion.efficiency',
      )
      claims = map.get(id) ?? []
    }
    const devices = listDevicesForEdges(db, [id]).get(id) ?? []
    const products = listProductsForEdges(db, [id]).get(id) ?? []
    return mapEdge(row, { claims, devices, products })
  })
}

// ─── Materials ────────────────────────────────────────────────────

type MaterialRow = {
  id: string
  category_id: string
  name: string
  name_en: string | null
  formula: string | null
  kind: string
  fidelity: string | null
  forcefield: string | null
  notes: string | null
  source_text: string | null
  meta_json: string | null
}

type PropRow = {
  id: string
  material_id: string
  key: string
  value_num: number | null
  value_text: string | null
  unit: string | null
  condition_json: string | null
  fidelity: string | null
  claim_id: string | null
  sort_order: number
}

function mapProp(row: PropRow): KnowledgeMaterialPropertyDto {
  return {
    id: row.id,
    materialId: row.material_id,
    key: row.key,
    valueNum: row.value_num,
    valueText: row.value_text,
    unit: row.unit,
    condition: parseJson(row.condition_json, null),
    fidelity: row.fidelity,
    claimId: row.claim_id,
    sortOrder: row.sort_order,
  }
}

function mapMaterial(
  row: MaterialRow,
  properties?: KnowledgeMaterialPropertyDto[],
): KnowledgeMaterialDto {
  const dto: KnowledgeMaterialDto = {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    nameEn: row.name_en,
    formula: row.formula,
    kind: row.kind,
    fidelity: row.fidelity,
    forcefield: row.forcefield,
    notes: row.notes,
    sourceText: row.source_text,
    meta: parseJson(row.meta_json, null),
  }
  if (properties) dto.properties = properties
  return dto
}

export function listKnowledgeMaterials(
  query: PageQuery & { categoryId?: string; kind?: string } = {},
  options?: ReadDbOptions,
): PageResult<KnowledgeMaterialDto> {
  const limit = clampLimit(query.limit)
  const offset = clampOffset(query.offset)
  const q = query.q?.trim()
  const categoryId = query.categoryId?.trim()
  const kind = query.kind?.trim()

  return withKnowledgeDb(options, (db) => {
    const clauses: string[] = []
    const params: Record<string, unknown> = {}
    if (categoryId) {
      clauses.push('category_id = @categoryId')
      params.categoryId = categoryId
    }
    if (kind) {
      clauses.push('kind = @kind')
      params.kind = kind
    }
    if (q) {
      clauses.push(
        `(id LIKE @like OR name LIKE @like OR IFNULL(name_en,'') LIKE @like)`,
      )
      params.like = `%${q}%`
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const total = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM materials ${where}`)
        .get(params) as { c: number }
    ).c
    const rows = db
      .prepare(
        `SELECT * FROM materials ${where} ORDER BY id LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as MaterialRow[]
    return {
      items: rows.map((r) => mapMaterial(r)),
      total,
      limit,
      offset,
    }
  })
}

export function getKnowledgeMaterial(
  id: string,
  options?: ReadDbOptions & { includeProperties?: boolean },
): KnowledgeMaterialDto | null {
  const includeProps = options?.includeProperties !== false
  return withKnowledgeDb(options, (db) => {
    const row = db
      .prepare(`SELECT * FROM materials WHERE id = ?`)
      .get(id) as MaterialRow | undefined
    if (!row) return null
    let props: KnowledgeMaterialPropertyDto[] | undefined
    if (includeProps) {
      const propRows = db
        .prepare(
          `SELECT * FROM material_properties WHERE material_id = ? ORDER BY sort_order, key`,
        )
        .all(id) as PropRow[]
      props = propRows.map(mapProp)
    }
    return mapMaterial(row, props)
  })
}

// ─── Releases ─────────────────────────────────────────────────────

type ReleaseRow = {
  id: string
  contract_version: number
  released_at: string
  state: string
  sha256: string
  export_relpath: string | null
  meta_json: string | null
  created_at: string
}

function releaseCounts(
  db: SqliteDatabase,
  releaseId: string,
): { claimCount: number; snapshotCount: number; bindingCount: number } {
  const claimCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM release_claims WHERE release_id = ?`,
      )
      .get(releaseId) as { c: number }
  ).c
  const snapshotCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM release_snapshots WHERE release_id = ?`,
      )
      .get(releaseId) as { c: number }
  ).c
  const bindingCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS c FROM release_bindings WHERE release_id = ?`,
      )
      .get(releaseId) as { c: number }
  ).c
  return { claimCount, snapshotCount, bindingCount }
}

function mapReleaseSummary(
  db: SqliteDatabase,
  row: ReleaseRow,
): KnowledgeReleaseSummaryDto {
  const counts = releaseCounts(db, row.id)
  return {
    id: row.id,
    releasedAt: row.released_at,
    state: row.state,
    sha256: row.sha256,
    claimCount: counts.claimCount,
    snapshotCount: counts.snapshotCount,
    bindingCount: counts.bindingCount,
    exportRelpath: row.export_relpath,
    meta: parseJson(row.meta_json, null),
  }
}

export function listKnowledgeReleases(
  query: PageQuery = {},
  options?: ReadDbOptions,
): PageResult<KnowledgeReleaseSummaryDto> {
  const limit = clampLimit(query.limit)
  const offset = clampOffset(query.offset)
  const q = query.q?.trim()

  return withKnowledgeDb(options, (db) => {
    // Schema only allows state='released'; still filter for defense-in-depth.
    // K38: optional q on id / sha256 / export_relpath
    const clauses = [`state = 'released'`]
    const params: Record<string, unknown> = {}
    if (q) {
      clauses.push(
        `(id LIKE @like OR sha256 LIKE @like OR IFNULL(export_relpath,'') LIKE @like)`,
      )
      params.like = `%${q}%`
    }
    const where = `WHERE ${clauses.join(' AND ')}`
    const total = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM knowledge_releases ${where}`)
        .get(params) as { c: number }
    ).c
    const rows = db
      .prepare(
        `SELECT * FROM knowledge_releases ${where}
         ORDER BY released_at DESC, id DESC
         LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as ReleaseRow[]
    return {
      items: rows.map((r) => mapReleaseSummary(db, r)),
      total,
      limit,
      offset,
    }
  })
}

export function getKnowledgeRelease(
  id: string,
  options?: ReadDbOptions & { includeClaims?: boolean },
): KnowledgeReleaseDetailDto | null {
  const includeClaims = options?.includeClaims === true
  return withKnowledgeDb(options, (db) => {
    const row = db
      .prepare(
        `SELECT * FROM knowledge_releases WHERE id = ? AND state = 'released'`,
      )
      .get(id) as ReleaseRow | undefined
    if (!row) return null
    const summary = mapReleaseSummary(db, row)
    const detail: KnowledgeReleaseDetailDto = { ...summary }
    if (includeClaims) {
      const claimRows = db
        .prepare(
          `SELECT c.* FROM claims c
           INNER JOIN release_claims rc ON rc.claim_id = c.id
           WHERE rc.release_id = ? AND c.state = 'released'
           ORDER BY c.id`,
        )
        .all(id) as ClaimRow[]
      detail.claims = claimRows.map(claimRowToReleasedDto)
      detail.claimIds = detail.claims.map((c) => c.id)
    } else {
      const ids = db
        .prepare(
          `SELECT claim_id AS id FROM release_claims WHERE release_id = ? ORDER BY claim_id`,
        )
        .all(id) as Array<{ id: string }>
      detail.claimIds = ids.map((r) => r.id)
    }
    return detail
  })
}

export function getLatestKnowledgeRelease(
  options?: ReadDbOptions & { includeClaims?: boolean },
): KnowledgeReleaseDetailDto | null {
  return withKnowledgeDb(options, (db) => {
    const row = db
      .prepare(
        `SELECT * FROM knowledge_releases
         WHERE state = 'released'
         ORDER BY released_at DESC, id DESC
         LIMIT 1`,
      )
      .get() as ReleaseRow | undefined
    if (!row) return null
    // Re-use getKnowledgeRelease path by id without double-open: inline
    const summary = mapReleaseSummary(db, row)
    const detail: KnowledgeReleaseDetailDto = { ...summary }
    if (options?.includeClaims) {
      const claimRows = db
        .prepare(
          `SELECT c.* FROM claims c
           INNER JOIN release_claims rc ON rc.claim_id = c.id
           WHERE rc.release_id = ? AND c.state = 'released'
           ORDER BY c.id`,
        )
        .all(row.id) as ClaimRow[]
      detail.claims = claimRows.map(claimRowToReleasedDto)
      detail.claimIds = detail.claims.map((c) => c.id)
    } else {
      const ids = db
        .prepare(
          `SELECT claim_id AS id FROM release_claims WHERE release_id = ? ORDER BY claim_id`,
        )
        .all(row.id) as Array<{ id: string }>
      detail.claimIds = ids.map((r) => r.id)
    }
    return detail
  })
}

/**
 * Assert public claim lists never include non-released states.
 * Used by tests / health probes.
 */
export function countNonReleasedInPublicView(options?: ReadDbOptions): number {
  return withKnowledgeDb(options, (db) => {
    // v_released_claims must only yield released rows in a release.
    const bad = db
      .prepare(
        `SELECT COUNT(*) AS c FROM v_released_claims WHERE state != 'released'`,
      )
      .get() as { c: number }
    return bad.c
  })
}

// ─── Conflict sets (G4) — public read of open/resolved controversy sets ───

export type KnowledgeConflictSetDto = {
  id: string
  subjectId: string
  reason: string | null
  resolutionNote: string | null
  state: 'open' | 'resolved'
  claimIds: string[]
  createdAt: string
  updatedAt: string | null
  contractVersion: number
}

/** K31: conflict_sets list filter (analogous to K27 claims?state=). */
export const CONFLICT_LIST_STATES = ['open', 'resolved', 'all'] as const
export type ConflictListState = (typeof CONFLICT_LIST_STATES)[number]

export type ListConflictsQuery = PageQuery & {
  /**
   * Filter by conflict_sets.state: open | resolved | all.
   * Default / omit / invalid → all (both open and resolved).
   */
  state?: ConflictListState
  /** Filter by subject_id exact match. */
  subjectId?: string
}

export type ListConflictsResult = PageResult<KnowledgeConflictSetDto> & {
  /** Applied state filter (always one of CONFLICT_LIST_STATES). */
  state: ConflictListState
}

export function normalizeConflictListState(
  raw?: string | null,
): ConflictListState {
  const s = (raw ?? '').trim().toLowerCase()
  if (s === 'open' || s === 'resolved' || s === 'all') return s
  return 'all'
}

type ConflictRow = {
  id: string
  contract_version: number
  subject_id: string
  reason: string | null
  resolution_note: string | null
  state: string
  created_at: string
  updated_at: string | null
}

/**
 * List conflict_sets with member claim ids (K17 + K31 state filter).
 * Does not expose candidate/quarantine claim bodies — only set metadata + claim ids.
 * Query.state: open | resolved | all (default all).
 */
export function listKnowledgeConflictSets(
  query: ListConflictsQuery = {},
  options?: ReadDbOptions,
): ListConflictsResult {
  const limit = clampLimit(query.limit)
  const offset = clampOffset(query.offset)
  const state = normalizeConflictListState(query.state)
  const subjectId = query.subjectId?.trim() || null
  const q = query.q?.trim() || null

  return withKnowledgeDb(options, (db) => {
    const where: string[] = ['1=1']
    const params: unknown[] = []
    if (state !== 'all') {
      where.push('state = ?')
      params.push(state)
    }
    if (subjectId) {
      where.push('subject_id = ?')
      params.push(subjectId)
    }
    if (q) {
      where.push('(id LIKE ? OR subject_id LIKE ? OR IFNULL(reason, \'\') LIKE ?)')
      const like = `%${q}%`
      params.push(like, like, like)
    }
    const whereSql = where.join(' AND ')

    const total = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM conflict_sets WHERE ${whereSql}`)
        .get(...params) as { c: number }
    ).c

    const rows = db
      .prepare(
        `SELECT * FROM conflict_sets
         WHERE ${whereSql}
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as ConflictRow[]

    const memberStmt = db.prepare(
      `SELECT claim_id AS id FROM conflict_members WHERE conflict_id = ? ORDER BY claim_id`,
    )

    const items: KnowledgeConflictSetDto[] = rows.map((r) => {
      const members = memberStmt.all(r.id) as Array<{ id: string }>
      return {
        id: r.id,
        subjectId: r.subject_id,
        reason: r.reason,
        resolutionNote: r.resolution_note,
        state: r.state === 'resolved' ? 'resolved' : 'open',
        claimIds: members.map((m) => m.id),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        contractVersion: r.contract_version,
      }
    })

    return { items, total, limit, offset, state }
  })
}

export function getKnowledgeConflictSet(
  id: string,
  options?: ReadDbOptions,
): KnowledgeConflictSetDto | null {
  return withKnowledgeDb(options, (db) => {
    const row = db
      .prepare(`SELECT * FROM conflict_sets WHERE id = ?`)
      .get(id) as ConflictRow | undefined
    if (!row) return null
    const members = db
      .prepare(
        `SELECT claim_id AS id FROM conflict_members WHERE conflict_id = ? ORDER BY claim_id`,
      )
      .all(id) as Array<{ id: string }>
    return {
      id: row.id,
      subjectId: row.subject_id,
      reason: row.reason,
      resolutionNote: row.resolution_note,
      state: row.state === 'resolved' ? 'resolved' : 'open',
      claimIds: members.map((m) => m.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      contractVersion: row.contract_version,
    }
  })
}

// ─── C2 / K19: durable blob reverse index (content_sha256 → snapshots) ───

export type KnowledgeSourceSnapshotDto = {
  id: string
  locator: string
  locatorKind: string
  capturedAt: string
  contentSha256: string
  captureStatus: 'locator-only' | 'bytes-captured'
  contentType: string | null
  byteLength: number | null
  license: string | null
  title: string | null
  provider: string | null
  blobRelpath: string | null
  contractVersion: number
}

type SnapshotRow = {
  id: string
  contract_version: number
  locator: string
  locator_kind: string
  captured_at: string
  content_sha256: string
  capture_status: string
  content_type: string | null
  byte_length: number | null
  license: string | null
  title: string | null
  provider: string | null
  blob_relpath: string | null
}

function snapshotRowToDto(row: SnapshotRow): KnowledgeSourceSnapshotDto {
  return {
    id: row.id,
    locator: row.locator,
    locatorKind: row.locator_kind,
    capturedAt: row.captured_at,
    contentSha256: row.content_sha256,
    captureStatus:
      row.capture_status === 'bytes-captured' ? 'bytes-captured' : 'locator-only',
    contentType: row.content_type,
    byteLength: row.byte_length,
    license: row.license,
    title: row.title,
    provider: row.provider,
    blobRelpath: row.blob_relpath,
    contractVersion: row.contract_version,
  }
}

const SHA256_HEX = /^[a-f0-9]{64}$/i

/**
 * Durable reverse index: content_sha256 → source_snapshots (idx_snap_sha).
 * Complements in-memory edgeRefs blobStore reverse lookup (C2 residual).
 */
export function listSourceSnapshotsByContentSha(
  contentSha256: string,
  options?: ReadDbOptions,
): KnowledgeSourceSnapshotDto[] {
  const sha = contentSha256.trim().toLowerCase()
  if (!SHA256_HEX.test(sha)) return []
  return withKnowledgeDb(options, (db) => {
    const rows = db
      .prepare(
        `SELECT id, contract_version, locator, locator_kind, captured_at,
                content_sha256, capture_status, content_type, byte_length,
                license, title, provider, blob_relpath
         FROM source_snapshots
         WHERE content_sha256 = ?
         ORDER BY captured_at DESC, id DESC`,
      )
      .all(sha) as SnapshotRow[]
    return rows.map(snapshotRowToDto)
  })
}

/**
 * Lookup one snapshot by id (for reverse-index follow-up).
 */
export function getSourceSnapshot(
  id: string,
  options?: ReadDbOptions,
): KnowledgeSourceSnapshotDto | null {
  const key = id.trim()
  if (!key) return null
  return withKnowledgeDb(options, (db) => {
    const row = db
      .prepare(
        `SELECT id, contract_version, locator, locator_kind, captured_at,
                content_sha256, capture_status, content_type, byte_length,
                license, title, provider, blob_relpath
         FROM source_snapshots WHERE id = ?`,
      )
      .get(key) as SnapshotRow | undefined
    return row ? snapshotRowToDto(row) : null
  })
}

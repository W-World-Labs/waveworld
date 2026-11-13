/**
 * K22: create a materials row (+ optional properties) and a candidate
 * sim.material claim via the Knowledge DB write path.
 *
 * Host: POST /api/v1/knowledge/materials (registration key required).
 * Does not auto-release; claim starts as `candidate` unless overridden.
 *
 * @see docs/knowledge-db.md §5 write path
 * @see EPIC #52
 */
import { KNOWLEDGE_CONTRACT_VERSION } from '../knowledge/types.ts'
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'
import type {
  KnowledgeMaterialDto,
  KnowledgeMaterialPropertyDto,
} from './read.ts'

const MATERIAL_KINDS = [
  'forcefield_lj',
  'fluid_continuum',
  'device_product',
  'other',
] as const

export type MaterialKind = (typeof MATERIAL_KINDS)[number]

export type CreateMaterialPropertyInput = {
  key: string
  unit: string
  valueNum?: number | null
  valueText?: string | null
  condition?: unknown
  fidelity?: string | null
  sortOrder?: number
}

export type CreateMaterialInput = {
  /** Stable material id (e.g. mat:demo-write). Required. */
  id: string
  name: string
  categoryId?: string | null
  /** When categoryId is new, optional label (defaults to categoryId). */
  categoryLabel?: string | null
  nameEn?: string | null
  formula?: string | null
  kind?: MaterialKind
  fidelity?: 'quantitative' | 'qualitative' | null
  forcefield?: string | null
  notes?: string | null
  sourceText?: string | null
  meta?: unknown
  properties?: CreateMaterialPropertyInput[]
  /**
   * Also write a sim.material claim (default true).
   * Claim id: claim:sim.material:{materialId}
   */
  createClaim?: boolean
  /** Default `candidate` (write path; not public until released). */
  claimState?: 'candidate' | 'validated'
  confidence?: number | null
}

export type CreateMaterialResult = {
  dbPath: string
  /** True when the materials row was newly inserted. */
  created: boolean
  material: KnowledgeMaterialDto
  claimId: string | null
  /** True when the sim.material claim was newly inserted. */
  claimCreated: boolean
}

export function claimIdForSimMaterial(materialId: string): string {
  return `claim:sim.material:${materialId}`
}

export function propertyIdForMaterial(materialId: string, key: string): string {
  return `mprop:${materialId}:${key}`
}

function isMaterialKind(v: string): v is MaterialKind {
  return (MATERIAL_KINDS as readonly string[]).includes(v)
}

function j(v: unknown): string {
  return JSON.stringify(v)
}

/**
 * Validate and normalize POST body fields. Throws Error with message
 * suitable for 400 responses (prefix `invalid:`).
 */
export function normalizeCreateMaterialInput(
  raw: Record<string, unknown>,
): CreateMaterialInput {
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!id) throw new Error('invalid: id is required')
  if (!name) throw new Error('invalid: name is required')
  if (id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new Error('invalid: id must not contain path segments')
  }

  let kind: MaterialKind = 'other'
  if (typeof raw.kind === 'string' && raw.kind.trim()) {
    if (!isMaterialKind(raw.kind.trim())) {
      throw new Error(
        `invalid: kind must be one of ${MATERIAL_KINDS.join(', ')}`,
      )
    }
    kind = raw.kind.trim() as MaterialKind
  }

  let fidelity: CreateMaterialInput['fidelity'] = null
  if (raw.fidelity === 'quantitative' || raw.fidelity === 'qualitative') {
    fidelity = raw.fidelity
  } else if (raw.fidelity != null && raw.fidelity !== '') {
    throw new Error('invalid: fidelity must be quantitative|qualitative|null')
  }

  let claimState: 'candidate' | 'validated' = 'candidate'
  if (raw.claimState === 'validated' || raw.claimState === 'candidate') {
    claimState = raw.claimState
  } else if (raw.claimState != null && raw.claimState !== '') {
    throw new Error('invalid: claimState must be candidate|validated')
  }

  const properties: CreateMaterialPropertyInput[] = []
  if (raw.properties != null) {
    if (!Array.isArray(raw.properties)) {
      throw new Error('invalid: properties must be an array')
    }
    for (const p of raw.properties) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) {
        throw new Error('invalid: each property must be an object')
      }
      const pr = p as Record<string, unknown>
      const key = typeof pr.key === 'string' ? pr.key.trim() : ''
      const unit = typeof pr.unit === 'string' ? pr.unit.trim() : ''
      if (!key || !unit) {
        throw new Error('invalid: property key and unit are required')
      }
      properties.push({
        key,
        unit,
        valueNum:
          typeof pr.valueNum === 'number' && Number.isFinite(pr.valueNum)
            ? pr.valueNum
            : pr.valueNum === null
              ? null
              : undefined,
        valueText:
          typeof pr.valueText === 'string'
            ? pr.valueText
            : pr.valueText === null
              ? null
              : undefined,
        condition: pr.condition,
        fidelity: typeof pr.fidelity === 'string' ? pr.fidelity : null,
        sortOrder:
          typeof pr.sortOrder === 'number' && Number.isFinite(pr.sortOrder)
            ? pr.sortOrder
            : undefined,
      })
    }
  }

  return {
    id,
    name,
    categoryId:
      typeof raw.categoryId === 'string' && raw.categoryId.trim()
        ? raw.categoryId.trim()
        : null,
    categoryLabel:
      typeof raw.categoryLabel === 'string' ? raw.categoryLabel : null,
    nameEn: typeof raw.nameEn === 'string' ? raw.nameEn : null,
    formula: typeof raw.formula === 'string' ? raw.formula : null,
    kind,
    fidelity,
    forcefield: typeof raw.forcefield === 'string' ? raw.forcefield : null,
    notes: typeof raw.notes === 'string' ? raw.notes : null,
    sourceText:
      typeof raw.sourceText === 'string'
        ? raw.sourceText
        : typeof raw.source_text === 'string'
          ? raw.source_text
          : null,
    meta: raw.meta,
    properties,
    createClaim: raw.createClaim === false ? false : true,
    claimState,
    confidence:
      typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
        ? raw.confidence
        : null,
  }
}

export function createKnowledgeMaterialOnDb(
  db: SqliteDatabase,
  input: CreateMaterialInput,
  dbPath: string,
): CreateMaterialResult {
  const now = new Date().toISOString()
  const kind = input.kind ?? 'other'
  const createClaim = input.createClaim !== false
  const claimState = input.claimState ?? 'candidate'
  const claimId = createClaim ? claimIdForSimMaterial(input.id) : null

  const existing = db
    .prepare(`SELECT id FROM materials WHERE id = ?`)
    .get(input.id) as { id: string } | undefined
  const materialCreated = !existing

  const run = db.transaction(() => {
    if (input.categoryId) {
      const catExists = db
        .prepare(`SELECT id FROM material_categories WHERE id = ?`)
        .get(input.categoryId) as { id: string } | undefined
      if (!catExists) {
        db.prepare(
          `INSERT INTO material_categories (id, label, label_en, cross_check, sort_order)
           VALUES (@id, @label, NULL, NULL, 0)`,
        ).run({
          id: input.categoryId,
          label: input.categoryLabel?.trim() || input.categoryId,
        })
      }
    }

    if (materialCreated) {
      db.prepare(
        `INSERT INTO materials (
           id, category_id, name, name_en, formula, kind, fidelity,
           forcefield, notes, source_text, meta_json, created_at, updated_at
         ) VALUES (
           @id, @category_id, @name, @name_en, @formula, @kind, @fidelity,
           @forcefield, @notes, @source_text, @meta_json, @created_at, @updated_at
         )`,
      ).run({
        id: input.id,
        category_id: input.categoryId ?? null,
        name: input.name,
        name_en: input.nameEn ?? null,
        formula: input.formula ?? null,
        kind,
        fidelity: input.fidelity ?? null,
        forcefield: input.forcefield ?? null,
        notes: input.notes ?? null,
        source_text: input.sourceText ?? null,
        meta_json:
          input.meta !== undefined
            ? j(input.meta)
            : j({ source: 'write-api', k: 'K22' }),
        created_at: now,
        updated_at: now,
      })
    }

    const props = input.properties ?? []
    for (let i = 0; i < props.length; i++) {
      const p = props[i]!
      const pid = propertyIdForMaterial(input.id, p.key)
      db.prepare(
        `INSERT INTO material_properties (
           id, material_id, key, value_num, value_text, unit,
           condition_json, fidelity, claim_id, sort_order
         ) VALUES (
           @id, @material_id, @key, @value_num, @value_text, @unit,
           @condition_json, @fidelity, @claim_id, @sort_order
         )
         ON CONFLICT(id) DO UPDATE SET
           value_num = excluded.value_num,
           value_text = excluded.value_text,
           unit = excluded.unit,
           condition_json = excluded.condition_json,
           fidelity = excluded.fidelity,
           claim_id = excluded.claim_id,
           sort_order = excluded.sort_order`,
      ).run({
        id: pid,
        material_id: input.id,
        key: p.key,
        value_num: p.valueNum ?? null,
        value_text: p.valueText ?? null,
        unit: p.unit,
        condition_json:
          p.condition !== undefined ? j(p.condition) : '{}',
        fidelity: p.fidelity ?? null,
        claim_id: claimId,
        sort_order: p.sortOrder ?? i,
      })
    }

    let claimCreated = false
    if (claimId) {
      const claimExists = db
        .prepare(`SELECT id FROM claims WHERE id = ?`)
        .get(claimId) as { id: string } | undefined
      if (!claimExists) {
        const propRows = db
          .prepare(
            `SELECT key, value_num, value_text, unit, condition_json
             FROM material_properties WHERE material_id = ? ORDER BY sort_order, key`,
          )
          .all(input.id) as Array<{
          key: string
          value_num: number | null
          value_text: string | null
          unit: string
          condition_json: string | null
        }>
        const statement = {
          materialId: input.id,
          properties: propRows.map((r) => ({
            key: r.key,
            value: r.value_num ?? r.value_text,
            unit: r.unit,
            ...(r.condition_json && r.condition_json !== '{}'
              ? { condition: JSON.parse(r.condition_json) }
              : {}),
          })),
          source: 'write-api-k22',
        }
        db.prepare(
          `INSERT INTO claims (
             id, contract_version, kind, subject_id, statement_json, state,
             confidence, created_at, updated_at
           ) VALUES (
             @id, @contract_version, @kind, @subject_id, @statement_json, @state,
             @confidence, @created_at, @updated_at
           )`,
        ).run({
          id: claimId,
          contract_version: KNOWLEDGE_CONTRACT_VERSION,
          kind: 'sim.material',
          subject_id: input.id,
          statement_json: j(statement),
          state: claimState,
          confidence: input.confidence ?? null,
          created_at: now,
          updated_at: now,
        })
        claimCreated = true
      }
    }

    return claimCreated
  })

  const claimCreated = run() as boolean

  const material = readMaterialDtoFromDb(db, input.id)
  if (!material) {
    throw new Error(`create material failed to read back: ${input.id}`)
  }

  return {
    dbPath,
    created: materialCreated,
    material,
    claimId,
    claimCreated,
  }
}

function readMaterialDtoFromDb(
  db: SqliteDatabase,
  id: string,
): KnowledgeMaterialDto | null {
  const row = db.prepare(`SELECT * FROM materials WHERE id = ?`).get(id) as
    | {
        id: string
        category_id: string | null
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
    | undefined
  if (!row) return null
  const propRows = db
    .prepare(
      `SELECT * FROM material_properties WHERE material_id = ? ORDER BY sort_order, key`,
    )
    .all(id) as Array<{
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
  }>
  let meta: unknown = null
  if (row.meta_json) {
    try {
      meta = JSON.parse(row.meta_json)
    } catch {
      meta = row.meta_json
    }
  }
  const properties: KnowledgeMaterialPropertyDto[] = propRows.map((p) => {
    let condition: unknown = null
    if (p.condition_json) {
      try {
        condition = JSON.parse(p.condition_json)
      } catch {
        condition = p.condition_json
      }
    }
    return {
      id: p.id,
      materialId: p.material_id,
      key: p.key,
      valueNum: p.value_num,
      valueText: p.value_text,
      unit: p.unit,
      condition,
      fidelity: p.fidelity,
      claimId: p.claim_id,
      sortOrder: p.sort_order,
    }
  })
  return {
    id: row.id,
    categoryId: row.category_id ?? '',
    name: row.name,
    nameEn: row.name_en,
    formula: row.formula,
    kind: row.kind,
    fidelity: row.fidelity,
    forcefield: row.forcefield,
    notes: row.notes,
    sourceText: row.source_text,
    meta,
    properties,
  }
}

export function createKnowledgeMaterialSync(
  input: CreateMaterialInput,
  options?: { dbPath?: string; root?: string },
): CreateMaterialResult {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root })
  try {
    return createKnowledgeMaterialOnDb(db, input, dbPath)
  } finally {
    db.close()
  }
}

/** Re-export property DTO for callers that need the shape. */
export type { KnowledgeMaterialDto, KnowledgeMaterialPropertyDto }

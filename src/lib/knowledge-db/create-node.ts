/**
 * K24: create an energy_nodes row via the Knowledge DB write path.
 *
 * Host: POST /api/v1/knowledge/nodes (registration key required).
 *
 * @see docs/knowledge-db.md §5 write path
 * @see EPIC #52 residual
 */
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'
import { getKnowledgeNode, type KnowledgeNodeDto } from './read.ts'

export type CreateNodeInput = {
  /** Stable node id (e.g. node:k24-write-demo). Required. */
  id: string
  name: string
  nameEn?: string | null
  parentId?: string | null
  symbol?: string | null
  icon?: string | null
  color?: string | null
  desc?: string | null
  descEn?: string | null
  quantities?: unknown
  consensus?: unknown
  refs?: unknown
  /**
   * When parentId is set and missing, create a stub parent (default true).
   */
  ensureParent?: boolean
}

export type CreateNodeResult = {
  dbPath: string
  created: boolean
  node: KnowledgeNodeDto
  parentCreated: boolean
}

function j(v: unknown): string {
  return JSON.stringify(v ?? null)
}

/**
 * Validate and normalize POST body. Throws Error with `invalid:` prefix for 400.
 */
export function normalizeCreateNodeInput(
  raw: Record<string, unknown>,
): CreateNodeInput {
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!id) throw new Error('invalid: id is required')
  if (!name) throw new Error('invalid: name is required')
  if (id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new Error('invalid: id must not contain path segments')
  }
  const parentId =
    typeof raw.parentId === 'string'
      ? raw.parentId.trim() || null
      : typeof raw.parent === 'string'
        ? raw.parent.trim() || null
        : null
  if (parentId === id) {
    throw new Error('invalid: parentId must differ from id')
  }

  return {
    id,
    name,
    nameEn: typeof raw.nameEn === 'string' ? raw.nameEn.trim() : null,
    parentId,
    symbol: typeof raw.symbol === 'string' ? raw.symbol.trim() : null,
    icon: typeof raw.icon === 'string' ? raw.icon.trim() : null,
    color: typeof raw.color === 'string' ? raw.color.trim() : null,
    desc: typeof raw.desc === 'string' ? raw.desc : typeof raw.descZh === 'string' ? raw.descZh : null,
    descEn: typeof raw.descEn === 'string' ? raw.descEn : null,
    quantities: raw.quantities,
    consensus: raw.consensus,
    refs: raw.refs,
    ensureParent: raw.ensureParent === false ? false : true,
  }
}

export function createKnowledgeNodeOnDb(
  db: SqliteDatabase,
  input: CreateNodeInput,
  dbPath: string,
): CreateNodeResult {
  const now = new Date().toISOString()
  let parentCreated = false

  const existing = db
    .prepare(`SELECT id FROM energy_nodes WHERE id = ?`)
    .get(input.id) as { id: string } | undefined
  const created = !existing

  const run = db.transaction(() => {
    if (input.parentId) {
      const parentOk = db
        .prepare(`SELECT id FROM energy_nodes WHERE id = ?`)
        .get(input.parentId) as { id: string } | undefined
      if (!parentOk) {
        if (input.ensureParent === false) {
          throw new Error(
            `invalid: parent node ${input.parentId} does not exist (ensureParent=false)`,
          )
        }
        db.prepare(
          `INSERT INTO energy_nodes (
             id, parent_id, name, name_en, symbol, icon, color,
             desc_zh, desc_en, quantities_json, consensus_json, refs_json,
             created_at, updated_at
           ) VALUES (
             @id, NULL, @name, NULL, NULL, NULL, NULL,
             @desc, NULL, '[]', '{}', '[]',
             @created_at, @updated_at
           )`,
        ).run({
          id: input.parentId,
          name: input.parentId,
          desc: 'stub parent from write-api-k24',
          created_at: now,
          updated_at: now,
        })
        parentCreated = true
      }
    }

    if (created) {
      db.prepare(
        `INSERT INTO energy_nodes (
           id, parent_id, name, name_en, symbol, icon, color,
           desc_zh, desc_en, quantities_json, consensus_json, refs_json,
           created_at, updated_at
         ) VALUES (
           @id, @parent_id, @name, @name_en, @symbol, @icon, @color,
           @desc_zh, @desc_en, @quantities_json, @consensus_json, @refs_json,
           @created_at, @updated_at
         )`,
      ).run({
        id: input.id,
        parent_id: input.parentId ?? null,
        name: input.name,
        name_en: input.nameEn ?? null,
        symbol: input.symbol ?? null,
        icon: input.icon ?? null,
        color: input.color ?? null,
        desc_zh: input.desc ?? 'node from write-api-k24',
        desc_en: input.descEn ?? null,
        quantities_json:
          input.quantities !== undefined ? j(input.quantities) : '[]',
        consensus_json:
          input.consensus !== undefined ? j(input.consensus) : '{}',
        refs_json: input.refs !== undefined ? j(input.refs) : '[]',
        created_at: now,
        updated_at: now,
      })
    }
  })
  run()

  const node = getKnowledgeNode(input.id, { dbPath })
  if (!node) {
    throw new Error(`create node failed: ${input.id} not readable after write`)
  }
  return { dbPath, created, node, parentCreated }
}

export function createKnowledgeNodeSync(
  input: CreateNodeInput,
  options?: { root?: string; dbPath?: string },
): CreateNodeResult {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: false })
  try {
    return createKnowledgeNodeOnDb(db, input, dbPath)
  } finally {
    db.close()
  }
}

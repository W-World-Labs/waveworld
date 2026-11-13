/**
 * K23: create a conversion_edges row (+ optional conversion.efficiency claim)
 * via the Knowledge DB write path.
 *
 * Host: POST /api/v1/knowledge/edges (registration key required).
 * Does not auto-release; claim starts as `candidate` unless overridden.
 *
 * @see docs/knowledge-db.md §5 write path
 * @see EPIC #52 residual
 */
import { KNOWLEDGE_CONTRACT_VERSION } from '../knowledge/types.ts'
import type { SqliteDatabase } from './load-sqlite.ts'
import { openKnowledgeDb } from './migrate.ts'
import { repoRootFromHere, resolveKnowledgeDbPath } from './paths.ts'
import {
  getKnowledgeEdge,
  type KnowledgeEdgeDto,
} from './read.ts'

/** Schema CHECK: conversion_edges.efficiency_kind ∈ {conversion, transport}. */
const EFFICIENCY_KINDS = ['conversion', 'transport'] as const

export type EfficiencyKind = (typeof EFFICIENCY_KINDS)[number]

export type CreateEdgeInput = {
  /** Stable edge id (e.g. edge:k23-write-demo). Required. */
  id: string
  fromNodeId: string
  toNodeId: string
  name: string
  nameEn?: string | null
  principle?: string | null
  principleEn?: string | null
  efficiencyKind?: EfficiencyKind
  efficiency?: unknown
  formula?: unknown
  lossMechanisms?: unknown
  maturity?: string | null
  apps?: unknown
  consensus?: unknown
  refs?: unknown
  status?: 'active' | 'deprecated'
  /**
   * When true (default), ensure from/to energy_nodes exist as skeleton stubs
   * if missing (write-path convenience for demos).
   */
  ensureNodes?: boolean
  /** Optional labels when creating stub nodes. */
  fromNodeName?: string | null
  toNodeName?: string | null
  /**
   * Also write a conversion.efficiency claim (default true when efficiency set,
   * else false unless createClaim=true).
   */
  createClaim?: boolean
  claimState?: 'candidate' | 'validated'
  confidence?: number | null
}

export type CreateEdgeResult = {
  dbPath: string
  created: boolean
  edge: KnowledgeEdgeDto
  claimId: string | null
  claimCreated: boolean
  nodesCreated: string[]
}

export function claimIdForConversionEfficiency(edgeId: string): string {
  return `claim:conversion.efficiency:${edgeId}`
}

function isEfficiencyKind(v: string): v is EfficiencyKind {
  return (EFFICIENCY_KINDS as readonly string[]).includes(v)
}

function j(v: unknown): string {
  return JSON.stringify(v ?? null)
}

/**
 * Validate and normalize POST body fields. Throws Error with message
 * suitable for 400 responses (prefix `invalid:`).
 */
export function normalizeCreateEdgeInput(
  raw: Record<string, unknown>,
): CreateEdgeInput {
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const fromNodeId =
    typeof raw.fromNodeId === 'string'
      ? raw.fromNodeId.trim()
      : typeof raw.from === 'string'
        ? raw.from.trim()
        : ''
  const toNodeId =
    typeof raw.toNodeId === 'string'
      ? raw.toNodeId.trim()
      : typeof raw.to === 'string'
        ? raw.to.trim()
        : ''
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!id) throw new Error('invalid: id is required')
  if (!fromNodeId) throw new Error('invalid: fromNodeId is required')
  if (!toNodeId) throw new Error('invalid: toNodeId is required')
  if (!name) throw new Error('invalid: name is required')
  if (id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new Error('invalid: id must not contain path segments')
  }
  if (fromNodeId === toNodeId) {
    throw new Error('invalid: fromNodeId and toNodeId must differ')
  }

  let efficiencyKind: EfficiencyKind = 'conversion'
  if (typeof raw.efficiencyKind === 'string' && raw.efficiencyKind.trim()) {
    if (!isEfficiencyKind(raw.efficiencyKind.trim())) {
      throw new Error(
        `invalid: efficiencyKind must be one of ${EFFICIENCY_KINDS.join(', ')}`,
      )
    }
    efficiencyKind = raw.efficiencyKind.trim() as EfficiencyKind
  }

  let status: CreateEdgeInput['status'] = 'active'
  if (raw.status === 'deprecated' || raw.status === 'active') {
    status = raw.status
  } else if (raw.status != null && raw.status !== '') {
    throw new Error('invalid: status must be active|deprecated')
  }

  let claimState: CreateEdgeInput['claimState'] = 'candidate'
  if (raw.claimState === 'validated' || raw.claimState === 'candidate') {
    claimState = raw.claimState
  }

  const createClaim =
    raw.createClaim === true
      ? true
      : raw.createClaim === false
        ? false
        : raw.efficiency !== undefined

  return {
    id,
    fromNodeId,
    toNodeId,
    name,
    nameEn: typeof raw.nameEn === 'string' ? raw.nameEn.trim() : null,
    principle: typeof raw.principle === 'string' ? raw.principle.trim() : null,
    principleEn:
      typeof raw.principleEn === 'string' ? raw.principleEn.trim() : null,
    efficiencyKind,
    efficiency: raw.efficiency,
    formula: raw.formula,
    lossMechanisms: raw.lossMechanisms,
    maturity: typeof raw.maturity === 'string' ? raw.maturity.trim() : null,
    apps: raw.apps,
    consensus: raw.consensus,
    refs: raw.refs,
    status,
    ensureNodes: raw.ensureNodes === false ? false : true,
    fromNodeName:
      typeof raw.fromNodeName === 'string' ? raw.fromNodeName.trim() : null,
    toNodeName:
      typeof raw.toNodeName === 'string' ? raw.toNodeName.trim() : null,
    createClaim,
    claimState,
    confidence:
      typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
        ? raw.confidence
        : null,
  }
}

function ensureStubNode(
  db: SqliteDatabase,
  nodeId: string,
  name: string | null | undefined,
  now: string,
): boolean {
  const exists = db
    .prepare(`SELECT id FROM energy_nodes WHERE id = ?`)
    .get(nodeId) as { id: string } | undefined
  if (exists) return false
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
    id: nodeId,
    name: name?.trim() || nodeId,
    desc: 'stub node from write-api-k23',
    created_at: now,
    updated_at: now,
  })
  return true
}

export function createKnowledgeEdgeOnDb(
  db: SqliteDatabase,
  input: CreateEdgeInput,
  dbPath: string,
): CreateEdgeResult {
  const now = new Date().toISOString()
  const createClaim = input.createClaim === true
  const claimId = createClaim ? claimIdForConversionEfficiency(input.id) : null
  const nodesCreated: string[] = []

  const existing = db
    .prepare(`SELECT id FROM conversion_edges WHERE id = ?`)
    .get(input.id) as { id: string } | undefined
  const edgeCreated = !existing

  const run = db.transaction(() => {
    if (input.ensureNodes !== false) {
      if (ensureStubNode(db, input.fromNodeId, input.fromNodeName, now)) {
        nodesCreated.push(input.fromNodeId)
      }
      if (ensureStubNode(db, input.toNodeId, input.toNodeName, now)) {
        nodesCreated.push(input.toNodeId)
      }
    } else {
      for (const nid of [input.fromNodeId, input.toNodeId]) {
        const ok = db
          .prepare(`SELECT id FROM energy_nodes WHERE id = ?`)
          .get(nid) as { id: string } | undefined
        if (!ok) {
          throw new Error(`invalid: energy node ${nid} does not exist (ensureNodes=false)`)
        }
      }
    }

    if (edgeCreated) {
      db.prepare(
        `INSERT INTO conversion_edges (
           id, from_node_id, to_node_id, name, name_en,
           principle, principle_en, efficiency_kind,
           efficiency_json, formula_json, loss_mechanisms_json,
           maturity, apps_json, consensus_json, refs_json, status,
           created_at, updated_at
         ) VALUES (
           @id, @from_node_id, @to_node_id, @name, @name_en,
           @principle, @principle_en, @efficiency_kind,
           @efficiency_json, @formula_json, @loss_mechanisms_json,
           @maturity, @apps_json, @consensus_json, @refs_json, @status,
           @created_at, @updated_at
         )`,
      ).run({
        id: input.id,
        from_node_id: input.fromNodeId,
        to_node_id: input.toNodeId,
        name: input.name,
        name_en: input.nameEn ?? null,
        principle: input.principle ?? '',
        principle_en: input.principleEn ?? null,
        efficiency_kind: input.efficiencyKind ?? 'conversion',
        efficiency_json:
          input.efficiency !== undefined
            ? j(input.efficiency)
            : j({ source: 'write-api', k: 'K23' }),
        formula_json: input.formula !== undefined ? j(input.formula) : null,
        loss_mechanisms_json:
          input.lossMechanisms !== undefined ? j(input.lossMechanisms) : null,
        maturity: input.maturity ?? null,
        apps_json: input.apps !== undefined ? j(input.apps) : null,
        consensus_json:
          input.consensus !== undefined ? j(input.consensus) : '{}',
        refs_json: input.refs !== undefined ? j(input.refs) : null,
        status: input.status ?? 'active',
        created_at: now,
        updated_at: now,
      })
    }

    let claimCreated = false
    if (claimId) {
      const claimExists = db
        .prepare(`SELECT id FROM claims WHERE id = ?`)
        .get(claimId) as { id: string } | undefined
      if (!claimExists) {
        const statement = {
          edgeId: input.id,
          fromNodeId: input.fromNodeId,
          toNodeId: input.toNodeId,
          efficiency: input.efficiency ?? null,
          efficiencyKind: input.efficiencyKind ?? 'conversion',
          source: 'write-api-k23',
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
          kind: 'conversion.efficiency',
          subject_id: input.id,
          statement_json: j(statement),
          state: input.claimState ?? 'candidate',
          confidence: input.confidence ?? null,
          created_at: now,
          updated_at: now,
        })
        claimCreated = true
      }
    }

    return { claimCreated }
  })

  const { claimCreated } = run()
  const edge = getKnowledgeEdge(input.id, {
    dbPath,
    embedReleasedClaims: false,
  })
  if (!edge) {
    throw new Error(`create edge failed: ${input.id} not readable after write`)
  }
  return {
    dbPath,
    created: edgeCreated,
    edge,
    claimId,
    claimCreated,
    nodesCreated,
  }
}

export function createKnowledgeEdgeSync(
  input: CreateEdgeInput,
  options?: { root?: string; dbPath?: string },
): CreateEdgeResult {
  const root = options?.root ?? repoRootFromHere()
  const dbPath = options?.dbPath ?? resolveKnowledgeDbPath(root)
  const db = openKnowledgeDb({ dbPath, root, readonly: false })
  try {
    return createKnowledgeEdgeOnDb(db, input, dbPath)
  } finally {
    db.close()
  }
}

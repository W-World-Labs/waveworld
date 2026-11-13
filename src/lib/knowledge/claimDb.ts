/**
 * Claim ↔ Knowledge DB `claims` row codec (statement_json alignment).
 *
 * Does not open SQLite — pure map for K/C bridges. Lifecycle states match
 * CHECK (state IN ('candidate','quarantine','validated','released')).
 */

import {
  KNOWLEDGE_CONTRACT_VERSION,
  type Claim,
  type ClaimDbRow,
  type KnowledgeLifecycleState,
} from './types'
import { isKnowledgeLifecycleState, validateClaim } from './validate'
import {
  parseStatementJson,
  statementToJsonText,
  validateStatementForKind,
} from './statementSchema'

export type ClaimDbCodecError = {
  ok: false
  error: string
}

export type ClaimToDbOk = { ok: true; row: ClaimDbRow }
export type ClaimFromDbOk = { ok: true; claim: Claim }

/**
 * Encode an in-memory Claim to a claims-table row.
 * Validates lifecycle + statement shape for known kinds before serializing.
 */
export function claimToDbRow(
  claim: Claim,
  opts?: { validateStatement?: boolean },
): ClaimToDbOk | ClaimDbCodecError {
  const base = validateClaim(claim)
  if (base) return { ok: false, error: base }

  if (opts?.validateStatement !== false) {
    const stErr = validateStatementForKind(claim.kind, claim.statement)
    if (stErr) return { ok: false, error: stErr }
  }

  const row: ClaimDbRow = {
    id: claim.id,
    contract_version: claim.contractVersion,
    kind: String(claim.kind),
    subject_id: claim.subjectId,
    statement_json: statementToJsonText(claim.statement),
    state: claim.state,
    confidence: claim.confidence ?? null,
    created_at: claim.createdAt,
    updated_at: claim.updatedAt ?? null,
  }
  return { ok: true, row }
}

/**
 * Decode a claims-table row (or equivalent plain object) to Claim.
 * Parses statement_json and re-validates against the TS contract.
 */
export function claimFromDbRow(
  row: ClaimDbRow | Record<string, unknown>,
  opts?: { validateStatement?: boolean },
): ClaimFromDbOk | ClaimDbCodecError {
  if (!row || typeof row !== 'object') {
    return { ok: false, error: 'ClaimDbRow: not an object' }
  }
  const r = row as Partial<ClaimDbRow>

  if (typeof r.id !== 'string' || r.id.length === 0) {
    return { ok: false, error: 'ClaimDbRow: id required' }
  }
  const contractVersion =
    typeof r.contract_version === 'number'
      ? r.contract_version
      : KNOWLEDGE_CONTRACT_VERSION
  if (contractVersion !== KNOWLEDGE_CONTRACT_VERSION) {
    return {
      ok: false,
      error: `ClaimDbRow: unsupported contract_version ${String(r.contract_version)}`,
    }
  }
  if (typeof r.kind !== 'string' || r.kind.length === 0) {
    return { ok: false, error: 'ClaimDbRow: kind required' }
  }
  if (typeof r.subject_id !== 'string' || r.subject_id.length === 0) {
    return { ok: false, error: 'ClaimDbRow: subject_id required' }
  }
  if (typeof r.statement_json !== 'string') {
    return { ok: false, error: 'ClaimDbRow: statement_json required' }
  }
  if (!isKnowledgeLifecycleState(r.state)) {
    return { ok: false, error: `ClaimDbRow: invalid state ${String(r.state)}` }
  }
  if (typeof r.created_at !== 'string' || r.created_at.length === 0) {
    return { ok: false, error: 'ClaimDbRow: created_at required' }
  }
  if (
    r.confidence != null
    && (typeof r.confidence !== 'number'
      || r.confidence < 0
      || r.confidence > 1)
  ) {
    return { ok: false, error: 'ClaimDbRow: confidence must be null or [0,1]' }
  }

  const parsed = parseStatementJson(r.statement_json)
  if (typeof parsed === 'string') {
    return { ok: false, error: parsed }
  }

  if (opts?.validateStatement !== false) {
    const stErr = validateStatementForKind(r.kind, parsed)
    if (stErr) return { ok: false, error: stErr }
  }

  const claim: Claim = {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: r.id,
    kind: r.kind,
    subjectId: r.subject_id,
    statement: parsed,
    state: r.state as KnowledgeLifecycleState,
    createdAt: r.created_at,
  }
  if (r.confidence != null) claim.confidence = r.confidence
  if (typeof r.updated_at === 'string' && r.updated_at.length > 0) {
    claim.updatedAt = r.updated_at
  }

  const err = validateClaim(claim)
  if (err) return { ok: false, error: err }
  return { ok: true, claim }
}

/**
 * Round-trip Claim → row → Claim. Useful in tests and K ingest bridges.
 * Returns the decoded claim or an error string.
 */
export function claimDbRoundTrip(
  claim: Claim,
): { ok: true; claim: Claim; row: ClaimDbRow } | ClaimDbCodecError {
  const enc = claimToDbRow(claim)
  if (!enc.ok) return enc
  const dec = claimFromDbRow(enc.row)
  if (!dec.ok) return dec
  return { ok: true, claim: dec.claim, row: enc.row }
}

/** Column names of `claims` as persisted in knowledge-schema.sql (documentation aid). */
export const CLAIMS_TABLE_COLUMNS = [
  'id',
  'contract_version',
  'kind',
  'subject_id',
  'statement_json',
  'state',
  'confidence',
  'created_at',
  'updated_at',
] as const

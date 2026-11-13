/**
 * Claim.statement / DB statement_json shapes (WLang Phase 1 · #48 C4).
 *
 * Authority for column layout: docs/sql/knowledge-schema.sql `claims.statement_json`
 * and docs/knowledge-db.md §4.4. This module is pure TypeScript (no DB IO).
 *
 * Validation is structural only — SI/η gates live in gates/efficiency.ts.
 */

import type { ClaimKind } from './types'

/** Shared optional condition bag (temperature, pressure, …). */
export type StatementConditions = Record<string, unknown>

/**
 * conversion.efficiency — matches efficiency gate + knowledge-db examples.
 * Prefer point value + metric; range form (etaMin/etaMax) allowed for catalogs.
 */
export interface EfficiencyStatement {
  metric?: string
  value?: number
  etaMin?: number
  etaMax?: number
  unit?: string
  conditions?: StatementConditions
  source?: string
  note?: string
  [key: string]: unknown
}

/** conversion.mechanism */
export interface MechanismStatement {
  mechanism?: string
  source?: string
  score?: number
  level?: number
  conceptId?: string
  workTitle?: string
  [key: string]: unknown
}

/** conversion.edge (provisional static-refs shell) */
export interface EdgeStatement {
  edgeId?: string
  source?: string
  refCount?: number
  [key: string]: unknown
}

/** conversion.formula */
export interface FormulaStatement {
  formulaId?: string
  expr?: string
  source?: string
  [key: string]: unknown
}

/**
 * sim.param_pack — released numeric bag for resolveJob / w-sim JobSpec.
 * `kind` here is the sim/job kind string, not Claim.kind.
 */
export interface SimParamPackStatement {
  kind: string
  parameters: Record<string, unknown>
  units?: Record<string, string>
  conditions?: StatementConditions
  [key: string]: unknown
}

/** sim.material — material id + property bag or refs into material_properties. */
export interface SimMaterialStatement {
  materialId: string
  properties?: Array<Record<string, unknown>>
  propertyRefs?: string[]
  conditions?: StatementConditions
  [key: string]: unknown
}

/** Bibliographic / catch-all (kind `other`). */
export interface OtherStatement {
  source?: string
  [key: string]: unknown
}

export type KnownStatement =
  | EfficiencyStatement
  | MechanismStatement
  | EdgeStatement
  | FormulaStatement
  | SimParamPackStatement
  | SimMaterialStatement
  | OtherStatement

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

function numOk(x: unknown): boolean {
  return typeof x === 'number' && Number.isFinite(x)
}

function strOk(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0
}

/**
 * When a documented optional field is present it must carry the documented
 * type (mirrors the conversion.efficiency / sim.param_pack checks below).
 * Returns an error message or null.
 */
function typedField(
  kind: string,
  field: string,
  value: unknown,
  expect: 'string' | 'number' | 'object',
): string | null {
  if (value === undefined) return null
  const ok =
    expect === 'string'
      ? strOk(value)
      : expect === 'number'
        ? numOk(value)
        : isPlainObject(value)
  const label = expect === 'string' ? 'non-empty string' : expect
  return ok ? null : `${kind}: ${field} must be ${label} when present`
}

/**
 * Validate statement object for a known claim kind against K schema fields.
 * Required fields must be present; documented optional fields must carry the
 * documented type when present (non-empty string / finite number / plain
 * object). Returns null when ok, else a short error message.
 * Unknown kinds: require plain object only (forward-compatible).
 */
export function validateStatementForKind(
  kind: ClaimKind | string,
  statement: unknown,
): string | null {
  if (!isPlainObject(statement)) {
    return 'statement_json: must be a plain JSON object'
  }

  switch (kind) {
    case 'conversion.efficiency': {
      const hasValue = statement.value !== undefined
      const hasRange = statement.etaMin !== undefined || statement.etaMax !== undefined
      if (!hasValue && !hasRange) {
        return 'conversion.efficiency: need value or etaMin/etaMax'
      }
      if (hasValue && !numOk(statement.value)) {
        return 'conversion.efficiency: value must be finite number'
      }
      if (statement.etaMin !== undefined && !numOk(statement.etaMin)) {
        return 'conversion.efficiency: etaMin must be finite number'
      }
      if (statement.etaMax !== undefined && !numOk(statement.etaMax)) {
        return 'conversion.efficiency: etaMax must be finite number'
      }
      if (
        statement.metric !== undefined
        && typeof statement.metric !== 'string'
      ) {
        return 'conversion.efficiency: metric must be string when present'
      }
      if (statement.unit !== undefined && typeof statement.unit !== 'string') {
        return 'conversion.efficiency: unit must be string when present'
      }
      if (
        statement.conditions !== undefined
        && !isPlainObject(statement.conditions)
      ) {
        return 'conversion.efficiency: conditions must be object when present'
      }
      return null
    }
    case 'conversion.mechanism': {
      const fieldErr =
        typedField('conversion.mechanism', 'mechanism', statement.mechanism, 'string') ??
        typedField('conversion.mechanism', 'source', statement.source, 'string') ??
        typedField('conversion.mechanism', 'score', statement.score, 'number') ??
        typedField('conversion.mechanism', 'level', statement.level, 'number') ??
        typedField('conversion.mechanism', 'conceptId', statement.conceptId, 'string') ??
        typedField('conversion.mechanism', 'workTitle', statement.workTitle, 'string')
      if (fieldErr) return fieldErr
      if (
        statement.mechanism === undefined
        && statement.source === undefined
      ) {
        return 'conversion.mechanism: need mechanism or source'
      }
      return null
    }
    case 'conversion.edge': {
      const fieldErr =
        typedField('conversion.edge', 'edgeId', statement.edgeId, 'string') ??
        typedField('conversion.edge', 'source', statement.source, 'string') ??
        typedField('conversion.edge', 'refCount', statement.refCount, 'number')
      if (fieldErr) return fieldErr
      if (
        statement.edgeId === undefined
        && statement.refCount === undefined
        && statement.source === undefined
      ) {
        return 'conversion.edge: need edgeId, refCount, or source'
      }
      return null
    }
    case 'conversion.formula': {
      const fieldErr =
        typedField('conversion.formula', 'expr', statement.expr, 'string') ??
        typedField('conversion.formula', 'formulaId', statement.formulaId, 'string') ??
        typedField('conversion.formula', 'source', statement.source, 'string')
      if (fieldErr) return fieldErr
      if (statement.expr === undefined && statement.formulaId === undefined) {
        return 'conversion.formula: need expr or formulaId'
      }
      return null
    }
    case 'sim.param_pack': {
      if (typeof statement.kind !== 'string' || statement.kind.length === 0) {
        return 'sim.param_pack: kind (sim/job kind string) required'
      }
      if (!isPlainObject(statement.parameters)) {
        return 'sim.param_pack: parameters object required'
      }
      if (
        statement.units !== undefined
        && !isPlainObject(statement.units)
      ) {
        return 'sim.param_pack: units must be object when present'
      }
      if (
        isPlainObject(statement.units)
        && !Object.values(statement.units).every(
          (v) => typeof v === 'string',
        )
      ) {
        return 'sim.param_pack: units values must be strings'
      }
      if (
        statement.conditions !== undefined
        && !isPlainObject(statement.conditions)
      ) {
        return 'sim.param_pack: conditions must be object when present'
      }
      return null
    }
    case 'sim.material': {
      if (
        typeof statement.materialId !== 'string'
        || statement.materialId.length === 0
      ) {
        return 'sim.material: materialId required'
      }
      if (
        statement.properties !== undefined
        && !Array.isArray(statement.properties)
      ) {
        return 'sim.material: properties must be array when present'
      }
      if (
        Array.isArray(statement.properties)
        && !statement.properties.every(isPlainObject)
      ) {
        return 'sim.material: properties entries must be objects'
      }
      if (
        statement.propertyRefs !== undefined
        && !(
          Array.isArray(statement.propertyRefs)
          && statement.propertyRefs.every(strOk)
        )
      ) {
        return 'sim.material: propertyRefs must be array of non-empty strings when present'
      }
      const condErr = typedField(
        'sim.material',
        'conditions',
        statement.conditions,
        'object',
      )
      if (condErr) return condErr
      return null
    }
    case 'other':
    case 'conversion.device':
    case 'conversion.maturity':
      return null
    default:
      // Unknown kind: structural plain-object only
      return null
  }
}

/** Stable JSON serialization for statement_json column (key-sorted via JSON.stringify is not enough — callers may use canonicalJson). */
export function statementToJsonText(statement: Record<string, unknown>): string {
  return JSON.stringify(statement)
}

/**
 * Parse DB `statement_json` TEXT into a plain object.
 * Rejects arrays, primitives, and empty/invalid JSON.
 */
export function parseStatementJson(text: string): Record<string, unknown> | string {
  if (typeof text !== 'string' || text.trim() === '') {
    return 'statement_json: empty'
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return 'statement_json: invalid JSON'
  }
  if (!isPlainObject(parsed)) {
    return 'statement_json: must parse to a plain object'
  }
  return parsed
}

import { describe, expect, it } from 'vitest'
import {
  CLAIMS_TABLE_COLUMNS,
  claimDbRoundTrip,
  claimFromDbRow,
  claimToDbRow,
} from './claimDb'
import { validateStatementForKind } from './statementSchema'
import {
  KNOWLEDGE_CONTRACT_VERSION,
  KNOWLEDGE_LIFECYCLE_STATES,
  LIFECYCLE_TRANSITIONS,
  type Claim,
} from './types'
import { canTransition, validateClaim } from './validate'

function baseClaim(partial: Partial<Claim> & Pick<Claim, 'kind' | 'statement'>): Claim {
  return {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: partial.id ?? 'cl-rt-1',
    kind: partial.kind,
    subjectId: partial.subjectId ?? 'edge:pv-si',
    statement: partial.statement,
    state: partial.state ?? 'candidate',
    confidence: partial.confidence,
    createdAt: partial.createdAt ?? '2026-08-06T00:00:00.000Z',
    updatedAt: partial.updatedAt,
  }
}

describe('claim statement_json / DB row alignment (C-claim-schema)', () => {
  it('documents claims table columns matching knowledge-schema.sql', () => {
    expect(CLAIMS_TABLE_COLUMNS).toEqual([
      'id',
      'contract_version',
      'kind',
      'subject_id',
      'statement_json',
      'state',
      'confidence',
      'created_at',
      'updated_at',
    ])
  })

  it('lifecycle states match DB CHECK constraint', () => {
    expect([...KNOWLEDGE_LIFECYCLE_STATES]).toEqual([
      'candidate',
      'quarantine',
      'validated',
      'released',
    ])
    // released terminal
    expect(LIFECYCLE_TRANSITIONS.released).toEqual([])
    expect(canTransition('validated', 'released')).toBe(true)
    expect(canTransition('released', 'candidate')).toBe(false)
  })

  it('round-trips conversion.efficiency point form', () => {
    const claim = baseClaim({
      kind: 'conversion.efficiency',
      statement: {
        metric: 'eta',
        value: 0.22,
        unit: '1',
        conditions: { T_K: 298 },
        source: 'fixture',
      },
      confidence: 0.85,
      state: 'validated',
    })
    expect(validateClaim(claim)).toBeNull()
    expect(validateStatementForKind(claim.kind, claim.statement)).toBeNull()

    const rt = claimDbRoundTrip(claim)
    expect(rt.ok).toBe(true)
    if (!rt.ok) return
    expect(rt.row.subject_id).toBe(claim.subjectId)
    expect(rt.row.contract_version).toBe(1)
    expect(rt.row.state).toBe('validated')
    expect(rt.row.confidence).toBe(0.85)
    expect(JSON.parse(rt.row.statement_json)).toEqual(claim.statement)
    expect(rt.claim).toEqual(claim)
  })

  it('round-trips conversion.efficiency range form (etaMin/etaMax)', () => {
    const claim = baseClaim({
      kind: 'conversion.efficiency',
      statement: { etaMin: 0.1, etaMax: 0.8, unit: '1' },
    })
    const rt = claimDbRoundTrip(claim)
    expect(rt.ok).toBe(true)
    if (!rt.ok) return
    expect(rt.claim.statement).toEqual({ etaMin: 0.1, etaMax: 0.8, unit: '1' })
  })

  it('round-trips sim.param_pack K schema fields', () => {
    const claim = baseClaim({
      kind: 'sim.param_pack',
      subjectId: 'pack:thermal-default',
      statement: {
        kind: 'thermal.steady',
        parameters: { k: 1.2, thickness_m: 0.01 },
        units: { k: 'W/(m·K)', thickness_m: 'm' },
        conditions: { T_K: 300 },
      },
      state: 'released',
      confidence: 1,
    })
    const rt = claimDbRoundTrip(claim)
    expect(rt.ok).toBe(true)
    if (!rt.ok) return
    expect(rt.row.kind).toBe('sim.param_pack')
    expect(JSON.parse(rt.row.statement_json).parameters.k).toBe(1.2)
    expect(rt.claim.subjectId).toBe('pack:thermal-default')
  })

  it('round-trips sim.material K schema fields', () => {
    const claim = baseClaim({
      kind: 'sim.material',
      subjectId: 'mat:si',
      statement: {
        materialId: 'si',
        properties: [{ key: 'bandgap_eV', value: 1.12, unit: 'eV' }],
      },
    })
    const rt = claimDbRoundTrip(claim)
    expect(rt.ok).toBe(true)
    if (!rt.ok) return
    expect(rt.claim.statement.materialId).toBe('si')
  })

  it('round-trips conversion.mechanism and conversion.edge', () => {
    for (const claim of [
      baseClaim({
        kind: 'conversion.mechanism',
        statement: { mechanism: 'Photovoltaics', source: 'openalex.concepts', score: 0.9 },
      }),
      baseClaim({
        kind: 'conversion.edge',
        statement: { edgeId: 'edge:pv-si', source: 'static-edge-refs', refCount: 2 },
      }),
    ]) {
      const rt = claimDbRoundTrip(claim)
      expect(rt.ok).toBe(true)
      if (rt.ok) expect(rt.claim).toEqual(claim)
    }
  })

  it('rejects efficiency statement missing value and range', () => {
    const claim = baseClaim({
      kind: 'conversion.efficiency',
      statement: { metric: 'eta', unit: '1' },
    })
    const enc = claimToDbRow(claim)
    expect(enc.ok).toBe(false)
    if (!enc.ok) {
      expect(enc.error).toMatch(/value or etaMin/)
    }
  })

  it('rejects sim.param_pack without parameters', () => {
    const claim = baseClaim({
      kind: 'sim.param_pack',
      statement: { kind: 'thermal.steady' },
    })
    const enc = claimToDbRow(claim)
    expect(enc.ok).toBe(false)
  })

  it('parses DB row with null confidence and updated_at', () => {
    const row = {
      id: 'cl-db-1',
      contract_version: 1,
      kind: 'other',
      subject_id: 'openalex:W1',
      statement_json: JSON.stringify({ source: 'openalex.open_access', isOpenAccess: true }),
      state: 'candidate' as const,
      confidence: null,
      created_at: '2026-08-06T12:00:00.000Z',
      updated_at: null,
    }
    const dec = claimFromDbRow(row)
    expect(dec.ok).toBe(true)
    if (!dec.ok) return
    expect(dec.claim.confidence).toBeUndefined()
    expect(dec.claim.updatedAt).toBeUndefined()
    expect(dec.claim.statement.isOpenAccess).toBe(true)
  })

  it('rejects non-object statement_json', () => {
    const dec = claimFromDbRow({
      id: 'cl-bad',
      contract_version: 1,
      kind: 'other',
      subject_id: 'x',
      statement_json: '[1,2]',
      state: 'candidate',
      confidence: null,
      created_at: '2026-08-06T00:00:00.000Z',
      updated_at: null,
    })
    expect(dec.ok).toBe(false)
    if (!dec.ok) expect(dec.error).toMatch(/plain object/)
  })

  it('rejects invalid lifecycle state from DB', () => {
    const dec = claimFromDbRow({
      id: 'cl-bad-state',
      contract_version: 1,
      kind: 'other',
      subject_id: 'x',
      statement_json: '{}',
      state: 'open',
      confidence: null,
      created_at: '2026-08-06T00:00:00.000Z',
      updated_at: null,
    })
    expect(dec.ok).toBe(false)
  })

  it('rejects wrongly-typed fields on documented kinds (typed-field residuals)', () => {
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      // presence fields must be non-empty strings, not just defined
      ['conversion.mechanism', { mechanism: 42 }, /mechanism must be non-empty string/],
      ['conversion.mechanism', { mechanism: '' }, /mechanism must be non-empty string/],
      ['conversion.mechanism', { mechanism: 'ok', score: 'high' }, /score must be number/],
      ['conversion.edge', { refCount: 'two' }, /refCount must be number/],
      ['conversion.edge', { edgeId: {} }, /edgeId must be non-empty string/],
      ['conversion.formula', { expr: {} }, /expr must be non-empty string/],
      ['sim.material', { materialId: 'si', propertyRefs: 'mprop:si:k' }, /propertyRefs must be array/],
      ['sim.material', { materialId: 'si', properties: [42] }, /properties entries must be objects/],
      ['sim.material', { materialId: 'si', conditions: 'warm' }, /conditions must be object/],
      ['sim.param_pack', { kind: 'lbm-d3q19', parameters: {}, units: { k: 1.2 } }, /units values must be strings/],
    ]
    for (const [kind, statement, re] of cases) {
      const err = validateStatementForKind(kind, statement)
      expect(err, `${kind} ${JSON.stringify(statement)}`).toMatch(re)
      const enc = claimToDbRow(baseClaim({ kind, statement }))
      expect(enc.ok).toBe(false)
    }
  })

  it('still accepts well-typed optional fields on documented kinds', () => {
    const okCases: Array<[string, Record<string, unknown>]> = [
      ['conversion.mechanism', { mechanism: 'piezo', source: 'openalex.concepts', score: 0.9, level: 1, conceptId: 'C1', workTitle: 't' }],
      ['conversion.edge', { edgeId: 'edge:x', refCount: 3, source: 'static-edge-refs' }],
      ['conversion.formula', { formulaId: 'f:ohm', source: 'static' }],
      ['sim.material', { materialId: 'si', propertyRefs: ['mprop:si:k'], conditions: { T_K: 300 } }],
      ['sim.param_pack', { kind: 'lbm-d3q19', parameters: { u: 0.05 }, units: { u: 'lu/ts' } }],
    ]
    for (const [kind, statement] of okCases) {
      expect(validateStatementForKind(kind, statement)).toBeNull()
    }
  })
})

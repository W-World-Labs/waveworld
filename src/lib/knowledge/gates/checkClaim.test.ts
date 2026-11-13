import { describe, expect, it } from 'vitest'
import {
  applyCheckClaim,
  checkClaim,
} from './checkClaim'
import type { Claim } from '../types'
import { KNOWLEDGE_CONTRACT_VERSION } from '../types'

function base(
  kind: string,
  statement: Record<string, unknown>,
  extra?: Partial<Claim>,
): Claim {
  const {
    id,
    subjectId,
    state,
    confidence,
    createdAt,
    kind: kindOverride,
    statement: statementOverride,
    ...rest
  } = extra ?? {}
  return {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: id ?? 'cl-check',
    kind: kindOverride ?? kind,
    subjectId: subjectId ?? 'sub',
    statement: statementOverride ?? statement,
    state: state ?? 'candidate',
    confidence: confidence ?? 0.8,
    createdAt: createdAt ?? '2026-08-06T00:00:00.000Z',
    ...rest,
  }
}

describe('checkClaim unified entry (#48 C4)', () => {
  it('passes good efficiency (envelope + statement + SI/η)', () => {
    const r = checkClaim(
      base('conversion.efficiency', { metric: 'eta', value: 0.42, unit: '1' }),
    )
    expect(r.ok).toBe(true)
    expect(r.failedLayers).toEqual([])
    expect(r.layers.envelope.ok).toBe(true)
    expect(r.layers.statement.ok).toBe(true)
    expect(r.layers.efficiency.ok).toBe(true)
  })

  it('fails envelope before statement/efficiency', () => {
    const r = checkClaim({ id: 'x' })
    expect(r.ok).toBe(false)
    expect(r.failedLayers).toEqual(['envelope'])
    expect(r.reasons.some((x) => x.startsWith('envelope:'))).toBe(true)
    expect(r.layers.statement.reasons[0]).toMatch(/^skip:/)
  })

  it('fails statement schema for empty efficiency object', () => {
    const r = checkClaim(base('conversion.efficiency', {}))
    expect(r.ok).toBe(false)
    expect(r.failedLayers).toContain('statement')
    expect(r.reasons.some((x) => x.includes('need value or etaMin/etaMax'))).toBe(
      true,
    )
  })

  it('fails efficiency layer on η > 1 (first law) with valid statement shape', () => {
    const r = checkClaim(
      base('conversion.efficiency', { metric: 'eta', value: 1.2, unit: '1' }),
    )
    expect(r.ok).toBe(false)
    expect(r.failedLayers).toContain('efficiency')
    expect(r.layers.statement.ok).toBe(true)
    expect(
      r.reasons.some((x) => x.includes('eta_out_of_range') || x.includes('first_law')),
    ).toBe(true)
  })

  it('accepts efficiency range form (etaMin/etaMax) at statement layer', () => {
    // Range form is schema-valid; SI gate may still want a point value.
    const r = checkClaim(
      base('conversion.efficiency', { metric: 'eta', etaMin: 0.1, etaMax: 0.3, unit: '1' }),
    )
    // statement ok; efficiency layer may fail missing point value
    expect(r.layers.statement.ok).toBe(true)
    if (!r.ok) {
      expect(r.failedLayers).toContain('efficiency')
    }
  })

  it('passes mechanism with schema-valid statement; skips efficiency', () => {
    const r = checkClaim(
      base('conversion.mechanism', { mechanism: 'Photovoltaics' }),
    )
    expect(r.ok).toBe(true)
    expect(r.layers.efficiency.reasons).toContain('skip:non-efficiency-kind')
  })

  it('fails mechanism missing mechanism/source (statement schema)', () => {
    const r = checkClaim(base('conversion.mechanism', { note: 'empty' }))
    expect(r.ok).toBe(false)
    expect(r.failedLayers).toEqual(['statement'])
  })

  it('passes sim.param_pack with required fields', () => {
    const r = checkClaim(
      base('sim.param_pack', {
        kind: 'thermal.steady',
        parameters: { T_hot: 900 },
        units: { T_hot: 'K' },
      }),
    )
    expect(r.ok).toBe(true)
  })

  it('fails sim.param_pack without parameters', () => {
    const r = checkClaim(
      base('sim.param_pack', { kind: 'thermal.steady' }),
    )
    expect(r.ok).toBe(false)
    expect(r.failedLayers).toContain('statement')
  })

  it('applyCheckClaim: good efficiency candidate → validated', () => {
    const r = applyCheckClaim(
      base('conversion.efficiency', { metric: 'eta', value: 0.22, unit: '1' }),
      '2026-08-06T01:00:00.000Z',
    )
    expect(r.verdict.ok).toBe(true)
    expect(r.transitionedTo).toBe('validated')
    expect(r.claim.state).toBe('validated')
    expect(r.claim.updatedAt).toBe('2026-08-06T01:00:00.000Z')
  })

  it('applyCheckClaim: bad efficiency → quarantine', () => {
    const r = applyCheckClaim(
      base('conversion.efficiency', { metric: 'eta', value: 2, unit: '1' }),
    )
    expect(r.verdict.ok).toBe(false)
    expect(r.transitionedTo).toBe('quarantine')
  })

  it('applyCheckClaim: schema-bad mechanism → quarantine (not silent promote)', () => {
    const r = applyCheckClaim(base('conversion.mechanism', {}))
    expect(r.verdict.ok).toBe(false)
    expect(r.transitionedTo).toBe('quarantine')
  })

  it('applyCheckClaim: good mechanism candidate → validated', () => {
    const r = applyCheckClaim(
      base('conversion.mechanism', { mechanism: 'piezo' }),
    )
    expect(r.verdict.ok).toBe(true)
    expect(r.transitionedTo).toBe('validated')
  })

  it('applyCheckClaim: released is never mutated', () => {
    const c = base(
      'conversion.efficiency',
      { metric: 'eta', value: 0.5, unit: '1' },
      { state: 'released' },
    )
    const r = applyCheckClaim(c)
    expect(r.claim.state).toBe('released')
    expect(r.transitionedTo).toBe('released')
  })

  it('applyCheckClaim: low confidence efficiency → quarantine', () => {
    const r = applyCheckClaim(
      base(
        'conversion.efficiency',
        { metric: 'eta', value: 0.3, unit: '1' },
        { confidence: 0.35 },
      ),
    )
    expect(r.verdict.ok).toBe(false)
    expect(r.transitionedTo).toBe('quarantine')
  })
})

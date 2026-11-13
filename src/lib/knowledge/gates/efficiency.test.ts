import { describe, expect, it } from 'vitest'
import {
  applyEfficiencyGate,
  COP_MAX,
  evaluateEfficiencyGate,
} from './efficiency'
import type { Claim } from '../types'
import { KNOWLEDGE_CONTRACT_VERSION } from '../types'

function eff(
  statement: Record<string, unknown>,
  extra?: Partial<Claim>,
): Claim {
  return {
    contractVersion: KNOWLEDGE_CONTRACT_VERSION,
    id: extra?.id ?? 'cl-test',
    kind: 'conversion.efficiency',
    subjectId: 'sub',
    statement,
    state: extra?.state ?? 'candidate',
    confidence: extra?.confidence ?? 0.8,
    createdAt: '2026-08-04T00:00:00.000Z',
  }
}

describe('efficiency gates (#48-D)', () => {
  it('passes η in [0,1]', () => {
    const v = evaluateEfficiencyGate(eff({ metric: 'eta', value: 0.42, unit: '1' }))
    expect(v.ok).toBe(true)
  })

  it('rejects η > 1 (first law)', () => {
    const v = evaluateEfficiencyGate(eff({ metric: 'eta', value: 1.2, unit: '1' }))
    expect(v.ok).toBe(false)
    expect(v.reasons.some((r) => r.includes('eta_out_of_range') || r.includes('first_law'))).toBe(
      true,
    )
  })

  it('rejects negative η', () => {
    const v = evaluateEfficiencyGate(eff({ metric: 'percent', value: -0.1, unit: '1' }))
    expect(v.ok).toBe(false)
  })

  it('rejects COP out of range', () => {
    const v = evaluateEfficiencyGate(eff({ metric: 'cop', value: COP_MAX + 1, unit: '1' }))
    expect(v.ok).toBe(false)
  })

  it('rejects missing value', () => {
    const v = evaluateEfficiencyGate(eff({ metric: 'eta', unit: '1' }))
    expect(v.ok).toBe(false)
    expect(v.reasons).toContain('missing_or_non_numeric_value')
  })

  it('rejects unnormalized percent unit', () => {
    const v = evaluateEfficiencyGate(eff({ metric: 'eta', value: 0.5, unit: '%' }))
    expect(v.ok).toBe(false)
  })

  it('low confidence efficiency → quarantine even if numeric ok', () => {
    const r = applyEfficiencyGate(
      eff({ metric: 'eta', value: 0.3, unit: '1' }, { confidence: 0.35 }),
      '2026-08-04T01:00:00.000Z',
    )
    expect(r.verdict.ok).toBe(false)
    expect(r.transitionedTo).toBe('quarantine')
    expect(r.claim.state).toBe('quarantine')
  })

  it('good efficiency candidate → validated', () => {
    const r = applyEfficiencyGate(
      eff({ metric: 'eta', value: 0.22, unit: '1' }, { confidence: 0.7 }),
      '2026-08-04T01:00:00.000Z',
    )
    expect(r.verdict.ok).toBe(true)
    expect(r.transitionedTo).toBe('validated')
    expect(r.claim.state).toBe('validated')
  })

  it('bad efficiency candidate → quarantine', () => {
    const r = applyEfficiencyGate(eff({ metric: 'eta', value: 2, unit: '1' }))
    expect(r.transitionedTo).toBe('quarantine')
  })

  it('non-efficiency candidate → validated (skip SI η)', () => {
    const c: Claim = {
      contractVersion: KNOWLEDGE_CONTRACT_VERSION,
      id: 'cl-m',
      kind: 'conversion.mechanism',
      subjectId: 's',
      statement: { mechanism: 'Photovoltaics' },
      state: 'candidate',
      createdAt: '2026-08-04T00:00:00.000Z',
    }
    const r = applyEfficiencyGate(c)
    expect(r.verdict.ok).toBe(true)
    expect(r.transitionedTo).toBe('validated')
  })

  it('released claims are not mutated', () => {
    const c = eff({ metric: 'eta', value: 0.5, unit: '1' }, { state: 'released', confidence: 0.9 })
    const r = applyEfficiencyGate(c)
    expect(r.claim.state).toBe('released')
    expect(r.transitionedTo).toBe('released')
  })
})

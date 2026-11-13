/**
 * #48-D Efficiency / SI-ish gates for conversion.efficiency claims.
 *
 * First-law style: η (fraction) must be in [0, 1]; COP in (0, COP_MAX].
 * Does not establish truth — only automatic quarantine vs validated promotion.
 */

import type { Claim } from '../types'
import { canTransition, validateClaim, validateTransition } from '../validate'

export const COP_MAX = 20
export const ETA_MIN = 0
export const ETA_MAX = 1

export type GateVerdict =
  | { ok: true; reasons: string[] }
  | { ok: false; reasons: string[] }

export type GateApplyResult = {
  claim: Claim
  verdict: GateVerdict
  /** Lifecycle target applied (or same state if already terminal / blocked). */
  transitionedTo: Claim['state']
}

const EFFICIENCY_KINDS = new Set(['conversion.efficiency'])

function num(x: unknown): number | null {
  if (typeof x === 'number' && Number.isFinite(x)) return x
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x)
    if (Number.isFinite(n)) return n
  }
  return null
}

/**
 * Structural + SI/η checks for a single efficiency claim statement.
 * Returns ok:true when no automatic rejection fires.
 */
export function evaluateEfficiencyGate(claim: Claim): GateVerdict {
  const reasons: string[] = []

  if (!EFFICIENCY_KINDS.has(String(claim.kind))) {
    return { ok: true, reasons: ['skip:non-efficiency-kind'] }
  }

  const st = claim.statement
  const metric = typeof st.metric === 'string' ? st.metric.toLowerCase() : ''
  const value = num(st.value)
  const unit = typeof st.unit === 'string' ? st.unit.trim() : ''

  if (value == null) {
    reasons.push('missing_or_non_numeric_value')
    return { ok: false, reasons }
  }

  if (metric === 'eta' || metric === 'percent' || metric === 'efficiency') {
    // Expect dimensionless fraction in [0, 1]. Reject percent-scale leftovers (>1).
    if (unit && unit !== '1' && unit !== '' && unit !== 'fraction' && unit !== '1 (fraction)') {
      // allow explicit percent only if value already normalized? prefer fail closed
      if (unit === '%' || unit.toLowerCase() === 'percent') {
        reasons.push('unit_percent_not_normalized: use fraction in [0,1] with unit "1"')
      } else if (!/^1|dimensionless|ratio$/i.test(unit)) {
        reasons.push(`unsupported_eta_unit:${unit}`)
      }
    }
    if (value < ETA_MIN || value > ETA_MAX) {
      reasons.push(`eta_out_of_range:${value} (require [${ETA_MIN},${ETA_MAX}])`)
    }
    // First-law: conversion efficiency cannot exceed 100%
    if (value > 1) {
      reasons.push('first_law:eta_gt_1')
    }
    if (value < 0) {
      reasons.push('eta_negative')
    }
  } else if (metric === 'cop') {
    if (unit && unit !== '1' && unit.toLowerCase() !== 'dimensionless') {
      reasons.push(`unsupported_cop_unit:${unit}`)
    }
    if (!(value > 0 && value <= COP_MAX)) {
      reasons.push(`cop_out_of_range:${value} (require (0,${COP_MAX}])`)
    }
  } else if (metric === '') {
    reasons.push('missing_metric')
  } else {
    // Unknown metric: quarantine for human review rather than silent pass
    reasons.push(`unknown_efficiency_metric:${metric}`)
  }

  // Very low confidence extractions stay quarantine even if numerically ok
  if (claim.confidence != null && claim.confidence < 0.4 && reasons.length === 0) {
    reasons.push('low_confidence_needs_review')
  }

  if (reasons.length === 0) return { ok: true, reasons: ['pass'] }
  // low_confidence alone → fail gate (quarantine)
  if (reasons.length === 1 && reasons[0] === 'low_confidence_needs_review') {
    return { ok: false, reasons }
  }
  // if only skip markers — shouldn't happen for efficiency
  const hard = reasons.filter((r) => r !== 'pass')
  return hard.length === 0 ? { ok: true, reasons: ['pass'] } : { ok: false, reasons: hard }
}

/**
 * Apply gate to a claim:
 * - non-efficiency: candidate → validated (bibliographic/mechanism defaults)
 * - efficiency pass: candidate → validated
 * - efficiency fail: candidate → quarantine
 * - already validated/released/quarantine: re-check efficiency only when candidate/validated
 */
export function applyEfficiencyGate(claim: Claim, nowIso?: string): GateApplyResult {
  const baseErr = validateClaim(claim)
  if (baseErr) {
    const quarantined: Claim = {
      ...claim,
      state: claim.state === 'released' ? 'released' : 'quarantine',
      updatedAt: nowIso ?? new Date().toISOString(),
    }
    return {
      claim: quarantined,
      verdict: { ok: false, reasons: [`schema:${baseErr}`] },
      transitionedTo: quarantined.state,
    }
  }

  const isEff = EFFICIENCY_KINDS.has(String(claim.kind))
  const verdict = isEff
    ? evaluateEfficiencyGate(claim)
    : ({ ok: true, reasons: ['skip:non-efficiency-kind'] } as GateVerdict)

  let target: Claim['state']
  if (claim.state === 'released') {
    return { claim, verdict, transitionedTo: 'released' }
  }
  if (!isEff) {
    // Mechanism / OA etc.: promote candidate → validated without SI efficiency checks
    target = claim.state === 'candidate' ? 'validated' : claim.state
    if (claim.state === 'quarantine') {
      // leave quarantine for non-efficiency unless explicitly re-run — stay
      target = 'quarantine'
    }
  } else {
    target = verdict.ok ? 'validated' : 'quarantine'
  }

  if (target !== claim.state) {
    const tErr = validateTransition(claim.state, target)
    if (tErr) {
      // If transition illegal, keep state but report
      return {
        claim,
        verdict: { ok: false, reasons: [...(verdict.ok ? [] : verdict.reasons), `transition:${tErr}`] },
        transitionedTo: claim.state,
      }
    }
  }

  const next: Claim = {
    ...claim,
    state: target,
    updatedAt: nowIso ?? new Date().toISOString(),
  }
  return { claim: next, verdict, transitionedTo: target }
}

/** Batch helper. */
export function applyEfficiencyGates(claims: Claim[], nowIso?: string): GateApplyResult[] {
  return claims.map((c) => applyEfficiencyGate(c, nowIso))
}

export function isEfficiencyKind(kind: string): boolean {
  return EFFICIENCY_KINDS.has(kind)
}

// re-export for tests that check transition table still holds
export { canTransition }

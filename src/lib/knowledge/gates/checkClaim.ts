/**
 * Unified claim checker (WLang Phase 1 · #48 C4).
 *
 * Single entry that composes:
 * 1. Claim envelope (`validateClaim`)
 * 2. Kind-specific statement shape (`validateStatementForKind`)
 * 3. SI/η physics gate for `conversion.efficiency` (`evaluateEfficiencyGate`)
 *
 * Structural schema is independent of the efficiency gate; both must pass
 * for efficiency claims. Non-efficiency kinds skip the SI/η layer.
 *
 * Does not open SQLite or touch knowledge-db/** (K track owns DB IO).
 */

import type { Claim } from '../types'
import { validateStatementForKind } from '../statementSchema'
import { validateClaim, validateTransition } from '../validate'
import {
  evaluateEfficiencyGate,
  isEfficiencyKind,
  type GateApplyResult,
  type GateVerdict,
} from './efficiency'

export type CheckClaimLayer = 'envelope' | 'statement' | 'efficiency'

export type CheckClaimResult = GateVerdict & {
  /** Layers that contributed a hard failure (empty when ok). */
  failedLayers: CheckClaimLayer[]
  /** Per-layer detail (efficiency may be skip for non-efficiency kinds). */
  layers: Record<CheckClaimLayer, GateVerdict>
}

function layerOk(reasons: string[] = ['pass']): GateVerdict {
  return { ok: true, reasons }
}

function layerFail(reasons: string[]): GateVerdict {
  return { ok: false, reasons }
}

/**
 * Pure multi-layer check. Does not mutate claim lifecycle state.
 */
export function checkClaim(claim: unknown): CheckClaimResult {
  const envelopeErr = validateClaim(claim)
  if (envelopeErr) {
    const envelope = layerFail([`envelope:${envelopeErr}`])
    const skip = layerOk(['skip:envelope_failed'])
    return {
      ok: false,
      reasons: envelope.reasons,
      failedLayers: ['envelope'],
      layers: {
        envelope,
        statement: skip,
        efficiency: skip,
      },
    }
  }

  const c = claim as Claim
  const envelope = layerOk(['pass'])

  const statementErr = validateStatementForKind(c.kind, c.statement)
  const statement: GateVerdict = statementErr
    ? layerFail([`statement:${statementErr}`])
    : layerOk(['pass'])

  let efficiency: GateVerdict
  if (!isEfficiencyKind(String(c.kind))) {
    efficiency = layerOk(['skip:non-efficiency-kind'])
  } else if (!statement.ok) {
    // Still run SI/η when envelope is ok so callers see physics reasons too,
    // but missing value etc. may duplicate statement failures — prefix stays distinct.
    efficiency = evaluateEfficiencyGate(c)
  } else {
    efficiency = evaluateEfficiencyGate(c)
  }

  const failedLayers: CheckClaimLayer[] = []
  const reasons: string[] = []

  if (!statement.ok) {
    failedLayers.push('statement')
    reasons.push(...statement.reasons)
  }
  if (!efficiency.ok) {
    failedLayers.push('efficiency')
    // Avoid double-counting pure skip markers
    for (const r of efficiency.reasons) {
      if (r !== 'pass' && !r.startsWith('skip:')) reasons.push(r)
    }
  }

  if (failedLayers.length === 0) {
    return {
      ok: true,
      reasons: ['pass'],
      failedLayers: [],
      layers: { envelope, statement, efficiency },
    }
  }

  return {
    ok: false,
    reasons: reasons.length > 0 ? reasons : ['check_failed'],
    failedLayers,
    layers: { envelope, statement, efficiency },
  }
}

/**
 * Apply unified check to lifecycle:
 * - pass + candidate → validated
 * - fail → quarantine (unless already released)
 * - released → never mutated
 * - non-efficiency in quarantine stays quarantine unless re-checked pass from candidate path
 *
 * Transition rules match `applyEfficiencyGate` for efficiency kinds; statement
 * failures also quarantine mechanism/sim packs that previously skipped SI checks.
 */
export function applyCheckClaim(claim: Claim, nowIso?: string): GateApplyResult {
  const result = checkClaim(claim)
  const verdict: GateVerdict = { ok: result.ok, reasons: result.reasons }

  if (claim.state === 'released') {
    return { claim, verdict, transitionedTo: 'released' }
  }

  // Envelope invalid: force quarantine without illegal transitions from released (handled above)
  if (result.failedLayers.includes('envelope')) {
    const quarantined: Claim = {
      ...claim,
      state: 'quarantine',
      updatedAt: nowIso ?? new Date().toISOString(),
    }
    return {
      claim: quarantined,
      verdict,
      transitionedTo: 'quarantine',
    }
  }

  // Quarantine → validated only on pass; candidate → quarantine/validated as needed.
  // If already validated and still pass, stay validated; if fail, re-open quarantine.
  let nextState: Claim['state'] = claim.state
  if (verdict.ok) {
    if (claim.state === 'candidate' || claim.state === 'quarantine') {
      nextState = 'validated'
    }
  } else {
    if (claim.state === 'candidate' || claim.state === 'validated') {
      nextState = 'quarantine'
    }
    // quarantine + fail stays quarantine
  }

  if (nextState !== claim.state) {
    const tErr = validateTransition(claim.state, nextState)
    if (tErr) {
      return {
        claim,
        verdict: {
          ok: false,
          reasons: [...(verdict.ok ? [] : verdict.reasons), `transition:${tErr}`],
        },
        transitionedTo: claim.state,
      }
    }
  }

  const next: Claim = {
    ...claim,
    state: nextState,
    updatedAt: nowIso ?? new Date().toISOString(),
  }
  return { claim: next, verdict, transitionedTo: nextState }
}

/** Batch helper. */
export function applyCheckClaims(claims: Claim[], nowIso?: string): GateApplyResult[] {
  return claims.map((c) => applyCheckClaim(c, nowIso))
}

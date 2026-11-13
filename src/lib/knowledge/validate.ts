import {
  KNOWLEDGE_CONTRACT_VERSION,
  KNOWLEDGE_LIFECYCLE_STATES,
  LIFECYCLE_TRANSITIONS,
  type Claim,
  type ConflictSet,
  type EvidenceBinding,
  type KnowledgeLifecycleState,
  type KnowledgeRelease,
  type KnowledgeReleaseBody,
  type SourceSnapshot,
} from './types'

export function isKnowledgeLifecycleState(x: unknown): x is KnowledgeLifecycleState {
  return typeof x === 'string' && (KNOWLEDGE_LIFECYCLE_STATES as readonly string[]).includes(x)
}

/** Whether a lifecycle transition is allowed by the state machine. */
export function canTransition(
  from: KnowledgeLifecycleState,
  to: KnowledgeLifecycleState,
): boolean {
  if (from === to) return false
  return (LIFECYCLE_TRANSITIONS[from] as readonly string[]).includes(to)
}

/**
 * Validate a requested transition. Returns null when ok, else an error message.
 * Released is terminal — no outbound transitions.
 */
export function validateTransition(
  from: KnowledgeLifecycleState,
  to: KnowledgeLifecycleState,
): string | null {
  if (!isKnowledgeLifecycleState(from) || !isKnowledgeLifecycleState(to)) {
    return `invalid lifecycle state: ${String(from)} → ${String(to)}`
  }
  if (from === 'released') {
    return 'released is terminal; cannot transition away'
  }
  if (!canTransition(from, to)) {
    return `disallowed transition: ${from} → ${to}`
  }
  return null
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0
}

function isSha256Hex(x: unknown): x is string {
  return typeof x === 'string' && /^[a-f0-9]{64}$/.test(x)
}

export function validateSourceSnapshot(x: unknown): string | null {
  if (!x || typeof x !== 'object') return 'SourceSnapshot: not an object'
  const s = x as Partial<SourceSnapshot>
  if (s.contractVersion !== KNOWLEDGE_CONTRACT_VERSION) {
    return `SourceSnapshot: unsupported contractVersion ${String(s.contractVersion)}`
  }
  if (!isNonEmptyString(s.id)) return 'SourceSnapshot: id required'
  if (!isNonEmptyString(s.locator)) return 'SourceSnapshot: locator required'
  if (s.locatorKind !== 'url' && s.locatorKind !== 'doi' && s.locatorKind !== 'citation' && s.locatorKind !== 'other') {
    return 'SourceSnapshot: invalid locatorKind'
  }
  if (!isNonEmptyString(s.capturedAt)) return 'SourceSnapshot: capturedAt required'
  if (!isSha256Hex(s.contentSha256)) return 'SourceSnapshot: contentSha256 must be 64-char lowercase hex'
  if (s.captureStatus !== 'locator-only' && s.captureStatus !== 'bytes-captured') {
    return 'SourceSnapshot: invalid captureStatus'
  }
  return null
}

export function validateClaim(x: unknown): string | null {
  if (!x || typeof x !== 'object') return 'Claim: not an object'
  const c = x as Partial<Claim>
  if (c.contractVersion !== KNOWLEDGE_CONTRACT_VERSION) {
    return `Claim: unsupported contractVersion ${String(c.contractVersion)}`
  }
  if (!isNonEmptyString(c.id)) return 'Claim: id required'
  if (!isNonEmptyString(c.kind)) return 'Claim: kind required'
  if (!isNonEmptyString(c.subjectId)) return 'Claim: subjectId required'
  if (!c.statement || typeof c.statement !== 'object' || Array.isArray(c.statement)) {
    return 'Claim: statement must be a plain object'
  }
  if (!isKnowledgeLifecycleState(c.state)) return 'Claim: invalid state'
  if (c.confidence != null && (typeof c.confidence !== 'number' || c.confidence < 0 || c.confidence > 1)) {
    return 'Claim: confidence must be in [0, 1]'
  }
  if (!isNonEmptyString(c.createdAt)) return 'Claim: createdAt required'
  return null
}

export function validateEvidenceBinding(x: unknown): string | null {
  if (!x || typeof x !== 'object') return 'EvidenceBinding: not an object'
  const b = x as Partial<EvidenceBinding>
  if (b.contractVersion !== KNOWLEDGE_CONTRACT_VERSION) {
    return `EvidenceBinding: unsupported contractVersion ${String(b.contractVersion)}`
  }
  if (!isNonEmptyString(b.id)) return 'EvidenceBinding: id required'
  if (!isNonEmptyString(b.claimId)) return 'EvidenceBinding: claimId required'
  if (!isNonEmptyString(b.sourceSnapshotId)) return 'EvidenceBinding: sourceSnapshotId required'
  if (b.support !== 'supports' && b.support !== 'refutes' && b.support !== 'context') {
    return 'EvidenceBinding: invalid support'
  }
  return null
}

export function validateConflictSet(x: unknown): string | null {
  if (!x || typeof x !== 'object') return 'ConflictSet: not an object'
  const c = x as Partial<ConflictSet>
  if (c.contractVersion !== KNOWLEDGE_CONTRACT_VERSION) {
    return `ConflictSet: unsupported contractVersion ${String(c.contractVersion)}`
  }
  if (!isNonEmptyString(c.id)) return 'ConflictSet: id required'
  if (!Array.isArray(c.claimIds) || c.claimIds.length < 2) {
    return 'ConflictSet: claimIds must list at least two claims'
  }
  if (!c.claimIds.every(isNonEmptyString)) return 'ConflictSet: claimIds must be non-empty strings'
  if (!isNonEmptyString(c.reason)) return 'ConflictSet: reason required'
  if (!isKnowledgeLifecycleState(c.state)) return 'ConflictSet: invalid state'
  return null
}

/**
 * Structural + referential checks for a release body (before or after hashing).
 * Requires every included claim to be in state `released`.
 */
export function validateKnowledgeReleaseBody(body: KnowledgeReleaseBody): string | null {
  if (body.contractVersion !== KNOWLEDGE_CONTRACT_VERSION) {
    return `KnowledgeRelease: unsupported contractVersion ${String(body.contractVersion)}`
  }
  if (!isNonEmptyString(body.id)) return 'KnowledgeRelease: id required'
  if (!isNonEmptyString(body.releasedAt)) return 'KnowledgeRelease: releasedAt required'
  if (body.state !== 'released') return 'KnowledgeRelease: state must be released'
  if (!Array.isArray(body.claims) || !Array.isArray(body.evidenceBindings)
    || !Array.isArray(body.sourceSnapshots) || !Array.isArray(body.conflictSets)) {
    return 'KnowledgeRelease: claims/bindings/snapshots/conflicts must be arrays'
  }

  for (const s of body.sourceSnapshots) {
    const err = validateSourceSnapshot(s)
    if (err) return err
  }
  for (const c of body.claims) {
    const err = validateClaim(c)
    if (err) return err
    if (c.state !== 'released') {
      return `KnowledgeRelease: claim ${c.id} is not released (state=${c.state})`
    }
  }
  for (const b of body.evidenceBindings) {
    const err = validateEvidenceBinding(b)
    if (err) return err
  }
  for (const c of body.conflictSets) {
    const err = validateConflictSet(c)
    if (err) return err
  }

  const claimIds = new Set(body.claims.map((c) => c.id))
  const snapshotIds = new Set(body.sourceSnapshots.map((s) => s.id))

  for (const b of body.evidenceBindings) {
    if (!claimIds.has(b.claimId)) {
      return `KnowledgeRelease: binding ${b.id} references missing claim ${b.claimId}`
    }
    if (!snapshotIds.has(b.sourceSnapshotId)) {
      return `KnowledgeRelease: binding ${b.id} references missing snapshot ${b.sourceSnapshotId}`
    }
  }
  for (const conf of body.conflictSets) {
    for (const cid of conf.claimIds) {
      if (!claimIds.has(cid)) {
        return `KnowledgeRelease: conflict ${conf.id} references missing claim ${cid}`
      }
    }
  }

  return null
}

export function validateKnowledgeRelease(release: KnowledgeRelease): string | null {
  const bodyErr = validateKnowledgeReleaseBody(release)
  if (bodyErr) return bodyErr
  if (!isSha256Hex(release.sha256)) return 'KnowledgeRelease: sha256 must be 64-char lowercase hex'
  return null
}

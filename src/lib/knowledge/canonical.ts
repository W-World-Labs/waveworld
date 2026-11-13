/**
 * Deterministic JSON canonicalization for knowledge digests.
 * - Sort object keys lexicographically at every level
 * - Preserve array order (callers must sort arrays they consider unordered)
 * - Drop `undefined` values (JSON.stringify would too)
 * - Reject BigInt / non-finite numbers to avoid silent divergence
 */

export function canonicalize(value: unknown): unknown {
  if (value === null) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`canonicalize: non-finite number ${String(value)}`)
    }
    return value
  }
  if (typeof value === 'bigint') {
    throw new Error('canonicalize: BigInt is not supported')
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key]
      if (v === undefined) continue
      out[key] = canonicalize(v)
    }
    return out
  }
  throw new Error(`canonicalize: unsupported type ${typeof value}`)
}

/** Stable JSON string used as the preimage for SHA-256. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

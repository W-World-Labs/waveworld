/**
 * Content-sha helpers for Host knowledge snapshots reverse index (C2/K19).
 * Used by SPA Controversies / publish UI before calling
 * GET /api/v1/knowledge/snapshots?sha=
 */

/** True when s is a 64-char hex SHA-256 digest (case-insensitive). */
export function isContentSha256(s: string): boolean {
  return /^[a-f0-9]{64}$/i.test(s.trim())
}

/** Normalize to lowercase 64-hex, or null if invalid. */
export function normalizeContentSha256(s: string): string | null {
  const t = s.trim().toLowerCase()
  return isContentSha256(t) ? t : null
}

/** Build relative Host API path for reverse index lookup. */
export function knowledgeSnapshotsByShaPath(sha: string): string | null {
  const n = normalizeContentSha256(sha)
  if (!n) return null
  return `/api/v1/knowledge/snapshots?sha=${encodeURIComponent(n)}`
}

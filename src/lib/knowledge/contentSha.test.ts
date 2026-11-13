import { describe, expect, it } from 'vitest'
import {
  isContentSha256,
  knowledgeSnapshotsByShaPath,
  normalizeContentSha256,
} from './contentSha.ts'

const SAMPLE =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('contentSha (C snapshots API client helpers)', () => {
  it('accepts 64-hex and normalizes case', () => {
    expect(isContentSha256(SAMPLE)).toBe(true)
    expect(isContentSha256(SAMPLE.toUpperCase())).toBe(true)
    expect(normalizeContentSha256(`  ${SAMPLE.toUpperCase()}  `)).toBe(SAMPLE)
  })

  it('rejects short / non-hex', () => {
    expect(isContentSha256('abc')).toBe(false)
    expect(isContentSha256('g'.repeat(64))).toBe(false)
    expect(normalizeContentSha256('not-a-sha')).toBeNull()
  })

  it('builds Host snapshots reverse-index path', () => {
    expect(knowledgeSnapshotsByShaPath(SAMPLE)).toBe(
      `/api/v1/knowledge/snapshots?sha=${SAMPLE}`,
    )
    expect(knowledgeSnapshotsByShaPath('bad')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { isEdgesDataChunk, summarizeAssets } from './check-bundle-budget.mjs'

describe('check-bundle-budget (#4)', () => {
  it('isEdgesDataChunk matches vite manualChunks output names', () => {
    expect(isEdgesDataChunk('edges-data-AbCd12.js')).toBe(true)
    expect(isEdgesDataChunk('edges-data.js')).toBe(true)
    expect(isEdgesDataChunk('edges-tiVRnXt5.js')).toBe(false)
    expect(isEdgesDataChunk('index-xxx.js')).toBe(false)
  })

  it('summarizeAssets fails only when edges-data exceeds budget', () => {
    const files = [
      { path: '/x/edges-data-aaa.js', bytes: 800 * 1024 },
      { path: '/x/vendor-bbb.js', bytes: 2000 * 1024 },
    ]
    const ok = summarizeAssets(files, 900 * 1024)
    expect(ok.ok).toBe(true)
    expect(ok.maxEdges).toBe(800 * 1024)

    const bad = summarizeAssets(files, 500 * 1024)
    expect(bad.ok).toBe(false)
    expect(bad.violations.length).toBe(1)
  })
})

import { describe, expect, it } from 'vitest'
import { MAX_SU2_MESH_SOURCE_BYTES, preflightSu2MeshSource } from './su2MeshPreflight'

const points = `NPOIN= 4
0 0 0
1 0 1
1 1 2
0 1 3
`
const elements = `NELEM= 1
9 0 1 2 3 0
`
const markers = `NMARK= 1
MARKER_TAG= wall
MARKER_ELEMS= 4
3 0 1
3 1 2
3 2 3
3 3 0
`

describe('preflightSu2MeshSource', () => {
  it('reorders a canonical NPOIN-first mesh without changing section records', () => {
    const input = `% generated
NDIME= 2
${points}${elements}${markers}`
    const result = preflightSu2MeshSource(input)
    expect(result).toMatchObject({
      ok: true,
      report: { ndime: 2, nodeCount: 4, elementCount: 1, markerCount: 1, tags: ['wall'] },
    })
    if (!result.ok) throw new Error(result.error)
    expect(result.normalizedText).toBe(`% generated
NDIME= 2
${elements}${points}${markers}`)
  })

  it('passes an already importer-ordered mesh through exactly', () => {
    const input = `NDIME= 2\r\n${elements.replace(/\n/g, '\r\n')}${points.replace(/\n/g, '\r\n')}${markers.replace(/\n/g, '\r\n')}`
    const result = preflightSu2MeshSource(input)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.normalizedText).toBe(input)
  })

  it('rejects unsupported sections, extra trailing data, and multizone meshes', () => {
    for (const suffix of ['NZONE= 2\n', 'CONこれは']) {
      const result = preflightSu2MeshSource(`NDIME= 2\n${points}${elements}${markers}${suffix}`)
      expect(result.ok).toBe(false)
    }
  })

  it('rejects malformed coordinates, bad references, and nonlinear element codes', () => {
    const badCoordinate = preflightSu2MeshSource(`NDIME= 2\nNPOIN= 1\nnan 0\n${elements}${markers}`)
    expect(badCoordinate).toMatchObject({ ok: false })
    const badIndex = preflightSu2MeshSource(`NDIME= 2\n${points}NELEM= 1\n9 0 1 2 4\nNMARK= 0\n`)
    expect(badIndex).toMatchObject({ ok: false })
    const nonlinear = preflightSu2MeshSource(`NDIME= 2\n${points}NELEM= 1\n22 0 1 2 3 4 5 6\nNMARK= 0\n`)
    expect(nonlinear).toMatchObject({ ok: false })
  })

  it('enforces ASCII, the shared 1 MiB cap, and bounded lines/counts', () => {
    expect(MAX_SU2_MESH_SOURCE_BYTES).toBe(1024 * 1024)
    expect(preflightSu2MeshSource(`NDIME= 2\n${points}${elements}${markers}é`).ok).toBe(false)
    expect(preflightSu2MeshSource(' '.repeat(MAX_SU2_MESH_SOURCE_BYTES + 1)).ok).toBe(false)
    expect(preflightSu2MeshSource(`NDIME= 2\nNPOIN= 262145\n`).ok).toBe(false)
    expect(preflightSu2MeshSource(`NDIME= 2\n${'x'.repeat(16 * 1024 + 1)}\n`).ok).toBe(false)
  })
})

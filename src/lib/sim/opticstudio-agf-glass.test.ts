import { describe, expect, it } from 'vitest'
import { OPTICSTUDIO_AGF_METADATA_SCOPE_NOTE, parseOpticStudioAgfGlass } from './opticstudio-agf-glass'

// Small synthetic AGF records keep these checks independent of vendor fixtures.
const glass = (name = 'Synthetic-BK7') => `NM ${name} 2 MIL-TEST 1.5168 64.17 0 0`

describe('parseOpticStudioAgfGlass', () => {
  it('parses multiple NM entries and keeps each record’s identity and dispersion metadata together', () => {
    const result = parseOpticStudioAgfGlass([
      'CC Synthetic catalog',
      glass('Synthetic-BK7'),
      'GC BK7 formula metadata',
      'ED 1 2 3 4 5',
      'CD 1 2 3 4 5 6 7 8',
      glass('Synthetic-Fused-Silica').replace('2 MIL-TEST 1.5168 64.17 0 0', '1 MIL-SILICA 1.4585 67.82 1 2'),
      'GC Silica formula metadata',
      'ED 11 12 13 14 15',
    ].join('\n'))

    expect(result.errors).toEqual([])
    expect(result.glasses).toHaveLength(2)
    expect(result.glasses[0]).toMatchObject({ name: 'Synthetic-BK7', formulaId: 2, nd: 1.5168, vd: 64.17 })
    expect(result.glasses[1]).toMatchObject({ name: 'Synthetic-Fused-Silica', formulaId: 1, nd: 1.4585, vd: 67.82 })
    expect(result.glasses[0].metadata).toEqual(expect.arrayContaining([
      expect.objectContaining({ tag: 'GC', raw: 'GC BK7 formula metadata' }),
      expect.objectContaining({
        tag: 'ED', raw: 'ED 1 2 3 4 5', scopeNote: OPTICSTUDIO_AGF_METADATA_SCOPE_NOTE,
      }),
      expect.objectContaining({ tag: 'CD', raw: 'CD 1 2 3 4 5 6 7 8' }),
    ]))
    expect(result.glasses[1].metadata).toEqual(expect.arrayContaining([
      expect.objectContaining({ tag: 'GC', raw: 'GC Silica formula metadata' }),
      expect.objectContaining({
        tag: 'ED', raw: 'ED 11 12 13 14 15', scopeNote: OPTICSTUDIO_AGF_METADATA_SCOPE_NOTE,
      }),
    ]))
    expect(result.glasses[0].metadata.every(({ line }) => Number.isInteger(line) && line > 0)).toBe(true)
  })

  it('retains CD and LD records as metadata without treating them as parsed dispersion data', () => {
    const result = parseOpticStudioAgfGlass([
      glass(),
      'CD 1 0.01 2 0.02 3 0.03',
      'LD 0.3 2.5',
    ].join('\n'))

    expect(result.errors).toEqual([])
    expect(result.glasses).toHaveLength(1)
    expect(result.glasses[0]).not.toHaveProperty('dispersion')
    expect(result.glasses[0]).not.toHaveProperty('coefficients')
    expect(result.glasses[0].metadata.map(({ tag }) => tag)).toEqual(['CD', 'LD'])
    expect(result.glasses[0].metadata.map(({ raw }) => raw)).toEqual([
      'CD 1 0.01 2 0.02 3 0.03', 'LD 0.3 2.5',
    ])
    expect(result.glasses[0].metadata.every(({ scopeNote }) => scopeNote === OPTICSTUDIO_AGF_METADATA_SCOPE_NOTE)).toBe(true)
  })

  it('reports status, standard metadata, and accepted status labels on each glass', () => {
    const parsed = parseOpticStudioAgfGlass(glass())
    expect(parsed.glasses[0]).toMatchObject({
      milNumber: 'MIL-TEST',
      excludeSubstitution: false,
      statusId: 0,
      status: 'standard',
    })
    expect(parseOpticStudioAgfGlass('NM Test 2 MIL-TEST 1.5 60 1 4 3').glasses[0])
      .toMatchObject({ excludeSubstitution: true, statusId: 4, status: 'melt', meltFrequency: 3 })
  })

  it('rejects malformed numeric fields, invalid status, and short NM records fail closed', () => {
    const invalidRecords = [
      glass().replace('1.5168', 'not-a-number'),
      glass().replace(/ 0$/, ' invalid-status'),
      'NM Too Short 2 MIL-TEST 1.5',
    ]
    for (const record of invalidRecords) {
      const result = parseOpticStudioAgfGlass(record)
      expect(result.errors.length, record).toBeGreaterThan(0)
      expect(result.glasses, record).toEqual([])
    }
  })

  it('rejects duplicate glass names without returning a partial catalog', () => {
    const result = parseOpticStudioAgfGlass([glass('Duplicate'), glass('Duplicate')].join('\n'))
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.glasses).toEqual([])
  })

  it('rejects inputs beyond documented resource bounds without returning partial results', () => {
    // The exact limits are implementation constants; these oversized inputs
    // are intentionally far above ordinary catalog records.
    const oversized = [
      'x'.repeat(5 * 1024 * 1024),
      Array.from({ length: 100_001 }, () => 'CC synthetic').join('\n'),
      Array.from({ length: 20_001 }, (_, i) => glass(`Synthetic-${i}`)).join('\n'),
      `NM ${'x'.repeat(4_100)} 2 MIL-TEST 1.5 60 0 0`,
    ]
    for (const text of oversized) {
      const result = parseOpticStudioAgfGlass(text)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.glasses).toEqual([])
    }
  })

  it('accepts one leading BOM and rejects interior BOMs, replacement characters, and NUL', () => {
    const leadingBom = parseOpticStudioAgfGlass(`\uFEFF${glass()}`)
    expect(leadingBom.errors).toEqual([])
    expect(leadingBom.glasses).toHaveLength(1)
    expect(leadingBom.glasses[0].name).toBe('Synthetic-BK7')

    for (const text of [
      '\u0000' + glass(),
      `${glass()}\nGC malformed � text`,
      `${glass()}\uFEFF`,
      `${glass()}\n\uFEFF${glass('Second-Glass')}`,
      `\uFFFD${glass()}`,
    ]) {
      const result = parseOpticStudioAgfGlass(text)
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.glasses).toEqual([])
    }
  })

  it('does not silently accept unknown or malformed records as glass data', () => {
    const result = parseOpticStudioAgfGlass(`${glass()}\nZZ unrecognized record`)
    expect(result.glasses).toHaveLength(1)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.glasses[0].metadata).toContainEqual(expect.objectContaining({ tag: 'ZZ', raw: 'ZZ unrecognized record' }))
  })
})

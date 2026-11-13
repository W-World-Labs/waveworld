import { describe, expect, it } from 'vitest'
import { importAbaqusOrthotropicElasticSource } from './abaqus-orthotropic-elastic-import'

const ENGINEERING_HEADER = '*ELASTIC, TYPE=ENGINEERING CONSTANTS'

describe('Abaqus orthotropic elastic source import', () => {
  it('maps the literal CalculiX shell4 engineering constants and keeps its temperature', () => {
    // Source evidence: CalculiX test/shell4.inp:1673-1675. Abaqus continuation
    // places the last G23 value and row temperature on the second physical line.
    const imported = importAbaqusOrthotropicElasticSource([
      ENGINEERING_HEADER,
      '181000,10300,1000000,0.28,0,0,7150,5958.3333',
      '5958.3333,295.',
    ].join('\n'))

    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.input.type).toBe('engineering')
    expect(imported.input.lines).toEqual([{
      temperature: 295,
      E1: 181000,
      E2: 10300,
      E3: 1000000,
      nu12: 0.28,
      nu23: 0,
      nu13: 0,
      G12: 7150,
      G13: 5958.3333,
      G23: 5958.3333,
    }])
    expect(imported.source.keyword).toBe('*ELASTIC')
  })

  it('reorders Abaqus nu13/nu23 into the native line order and supports nine constants without temperature', () => {
    const imported = importAbaqusOrthotropicElasticSource([
      ENGINEERING_HEADER,
      '110, 22, 33, .11, .13, .23, 44, 55, 66',
    ].join('\n'))

    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.input.lines).toEqual([{
      E1: 110,
      E2: 22,
      E3: 33,
      nu12: 0.11,
      nu23: 0.23,
      nu13: 0.13,
      G12: 44,
      G13: 55,
      G23: 66,
    }])
    expect(imported.input.lines[0]).not.toHaveProperty('temperature')
  })

  it('accepts case-insensitive headers, comments, and wrapped comma continuation', () => {
    const imported = importAbaqusOrthotropicElasticSource([
      '** standalone engineering constants',
      '*elastic, type="engineering constants"',
      '1D2, 2D2, 3D2, .1, .2, .3,',
      '4D1, 5D1, 6D1, 300.',
    ].join('\r\n'))

    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.input.lines[0]).toMatchObject({ temperature: 300, E1: 100, nu23: 0.3, nu13: 0.2, G23: 60 })
  })

  it('rejects unrelated cards, missing or extra constants, malformed and nonfinite values', () => {
    const cases = [
      [`*DENSITY\n7.8\n${ENGINEERING_HEADER}\n1,2,3,.1,.2,.3,4,5,6`, /outside this standalone/i],
      [`${ENGINEERING_HEADER}\n1,2,3,.1,.2,.3,4,5`, /nine constants/i],
      [`${ENGINEERING_HEADER}\n1,2,3,.1,.2,.3,4,5,6,7,8`, /nine constants/i],
      [`${ENGINEERING_HEADER}\n1,2,3,.1,,.3,4,5,6`, /blank/i],
      [`${ENGINEERING_HEADER}\n1,2,3,.1,.2,.3,4,5,NaN`, /supported decimal|finite/i],
      [`${ENGINEERING_HEADER}\n1,2,3,.1,.2,.3,4,5,1e999`, /finite/i],
      [`${ENGINEERING_HEADER}\n1,2,3,.1,.2,.3,4,5,6,`, /blank|incomplete/i],
    ] as const

    for (const [source, diagnostic] of cases) {
      expect(importAbaqusOrthotropicElasticSource(source)).toMatchObject({
        ok: false,
        diagnostics: [expect.stringMatching(diagnostic)],
      })
    }
  })

  it('rejects duplicate or ambiguous cards and unsupported options', () => {
    const duplicate = importAbaqusOrthotropicElasticSource([
      ENGINEERING_HEADER,
      '1,2,3,.1,.2,.3,4,5,6',
      ENGINEERING_HEADER,
      '1,2,3,.1,.2,.3,4,5,6',
    ].join('\n'))
    const material = importAbaqusOrthotropicElasticSource([
      '*MATERIAL, NAME=FIRST',
      ENGINEERING_HEADER,
      '1,2,3,.1,.2,.3,4,5,6',
      '*MATERIAL, NAME=SECOND',
      ENGINEERING_HEADER,
      '1,2,3,.1,.2,.3,4,5,6',
    ].join('\n'))
    const wrongType = importAbaqusOrthotropicElasticSource('*ELASTIC, TYPE=ISOTROPIC\n1, .3')
    const option = importAbaqusOrthotropicElasticSource('*ELASTIC, TYPE=ENGINEERING CONSTANTS, MODuli=LONGITUDINAL\n1,2,3,.1,.2,.3,4,5,6')
    const positionalOption = importAbaqusOrthotropicElasticSource('*ELASTIC, ENGINEERING CONSTANTS\n1,2,3,.1,.2,.3,4,5,6')
    const duplicateParameter = importAbaqusOrthotropicElasticSource('*ELASTIC, TYPE=ENGINEERING CONSTANTS, TYPE=ENGINEERING CONSTANTS\n1,2,3,.1,.2,.3,4,5,6')

    expect(duplicate).toMatchObject({ ok: false, diagnostics: [expect.stringMatching(/one standalone/i)] })
    expect(material).toMatchObject({ ok: false, diagnostics: [expect.stringMatching(/one standalone|outside this standalone/i)] })
    expect(wrongType).toMatchObject({ ok: false, diagnostics: [expect.stringMatching(/requires TYPE=ENGINEERING CONSTANTS/i)] })
    expect(option).toMatchObject({ ok: false, diagnostics: [expect.stringMatching(/unsupported/i)] })
    expect(positionalOption).toMatchObject({ ok: false, diagnostics: [expect.stringMatching(/unsupported/i)] })
    expect(duplicateParameter).toMatchObject({ ok: false, diagnostics: [expect.stringMatching(/duplicate/i)] })
  })
})

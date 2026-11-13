import { describe, expect, it } from 'vitest'
import { OPTICSTUDIO_AGF_METADATA_SCOPE_NOTE, type OpticStudioAgfGlass } from './opticstudio-agf-glass'
import { createOpticStudioAgfSellmeierJob, readOpticStudioAgfSellmeier } from './opticstudio-agf-sellmeier'

const glass = (records: Array<{ tag: string; raw: string }>, formulaId = 2): OpticStudioAgfGlass => ({
  name: 'Synthetic-Sellmeier',
  formulaId,
  milNumber: 'MIL-TEST',
  nd: 1.5168,
  vd: 64.17,
  excludeSubstitution: false,
  statusId: 0,
  status: 'standard',
  metadata: records.map(({ tag, raw }, index) => ({
    line: index + 1, tag, raw, scopeNote: OPTICSTUDIO_AGF_METADATA_SCOPE_NOTE,
  })),
})

describe('OpticStudio AGF Sellmeier adapter', () => {
  it('maps formula 2 CD values as ordered B/C pairs and builds the exact host multi-term JobSpec', () => {
    const source = glass([
      // Synthetic formula-2 material with every pole below λ=0.6563 µm.
      { tag: 'CD', raw: 'CD 1.03961212 0.00600069867 0.231792344 0.0200179144 1.01046945 0.03' },
      { tag: 'LD', raw: 'LD 0.3 2.5' },
    ])
    const material = readOpticStudioAgfSellmeier(source)

    expect(material).toMatchObject({
      glassName: 'Synthetic-Sellmeier',
      formulaId: 2,
      minLambdaUm: 0.3,
      maxLambdaUm: 2.5,
      terms: [
        { B: 1.03961212, C: 0.00600069867 },
        { B: 0.231792344, C: 0.0200179144 },
        { B: 1.01046945, C: 0.03 },
      ],
    })
    const { input, spec, provenance } = createOpticStudioAgfSellmeierJob(source, 0.6563)
    expect(input).toEqual({
      module: 'sellmeier',
      method: 'method-algo-sellmeier-n-multi',
      lam_um: 0.6563,
      terms: [
        { B: 1.03961212, C: 0.00600069867 },
        { B: 0.231792344, C: 0.0200179144 },
        { B: 1.01046945, C: 0.03 },
      ],
      backend: 'host',
    })
    expect(spec.kind).toBe('waveworld-module')
    expect(spec.parameters).toEqual({ module: 'sellmeier' })
    expect(spec.model).toEqual({ source: 'inline', inline: input })
    expect(spec.run.maxSteps).toBe(1)
    expect(spec.requirements).toEqual({ backends: ['cuda'] })
    expect(provenance).toEqual({
      glassName: 'Synthetic-Sellmeier',
      lam_um: 0.6563,
      minLambdaUm: 0.3,
      maxLambdaUm: 2.5,
      method: 'method-algo-sellmeier-n-multi',
    })
  })

  it('rejects wavelengths at or below a Sellmeier pole even inside the AGF range', () => {
    const source = glass([
      { tag: 'CD', raw: 'CD 1.03961212 0.00600069867 0.231792344 0.0200179144 1.01046945 103.560653' },
      { tag: 'LD', raw: 'LD 0.3 2.5' },
    ])

    expect(() => createOpticStudioAgfSellmeierJob(source, 0.5876)).toThrow(
      /current native Sellmeier pin requires a wavelength above every Sellmeier pole/,
    )
  })

  it('rejects unsupported formulas and missing, duplicate, or malformed CD records', () => {
    const validCD = { tag: 'CD', raw: 'CD 1 0.01 2 0.02' }
    const validLD = { tag: 'LD', raw: 'LD 0.3 2.5' }
    const invalid = [
      glass([validCD, validLD], 1),
      glass([validLD]),
      glass([validCD, validCD, validLD]),
      glass([{ tag: 'CD', raw: 'CD 1 nope' }, validLD]),
      glass([{ tag: 'CD', raw: 'CD 1 0.01 2' }, validLD]),
      glass([{ tag: 'CD', raw: 'CD 1 0.01 2 0.02 3 0.03 4 0.04' }, validLD]),
      // Trailing zero coefficients are still coefficients and cannot pad a pair list.
      glass([{ tag: 'CD', raw: 'CD 1 0.01 2 0.02 0' }, validLD]),
    ]
    for (const source of invalid) {
      expect(() => readOpticStudioAgfSellmeier(source)).toThrow()
      expect(() => createOpticStudioAgfSellmeierJob(source, 0.5)).toThrow()
    }
  })

  it('rejects unrecognized AGF records instead of evaluating a partial glass description', () => {
    const source = glass([
      { tag: 'CD', raw: 'CD 1 0.01 2 0.02' },
      { tag: 'LD', raw: 'LD 0.3 2.5' },
      { tag: 'ZZ', raw: 'ZZ undocumented material setting' },
    ])
    expect(() => readOpticStudioAgfSellmeier(source)).toThrow(/unsupported AGF record ZZ/)
    expect(() => createOpticStudioAgfSellmeierJob(source, 0.5)).toThrow(/unsupported AGF record ZZ/)
  })

  it('rejects missing, duplicate, malformed, and invalid wavelength limits', () => {
    const cd = { tag: 'CD', raw: 'CD 1 0.01 2 0.02' }
    const validLD = { tag: 'LD', raw: 'LD 0.3 2.5' }
    for (const source of [
      glass([cd]),
      glass([cd, validLD, validLD]),
      glass([cd, { tag: 'LD', raw: 'LD 0.3 nope' }]),
      glass([cd, { tag: 'LD', raw: 'LD 2.5 0.3' }]),
    ]) {
      expect(() => readOpticStudioAgfSellmeier(source)).toThrow()
    }
    const bounded = glass([cd, validLD])
    for (const wavelength of [0.2999, 2.5001, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createOpticStudioAgfSellmeierJob(bounded, wavelength)).toThrow()
    }
    expect(() => createOpticStudioAgfSellmeierJob(bounded, 0.3)).not.toThrow()
    expect(() => createOpticStudioAgfSellmeierJob(bounded, 2.5)).not.toThrow()
  })
})

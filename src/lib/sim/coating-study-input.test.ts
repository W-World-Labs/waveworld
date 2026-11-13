import { describe, expect, it } from 'vitest'
import { createCoatingStudyJob, createDefaultCoatingStudyDraft } from './coating-study-input'

describe('bounded thin-film coating study input builder', () => {
  it('builds the exact native operation with inclusive ascending wavelength samples', () => {
    const draft = createDefaultCoatingStudyDraft()
    Object.assign(draft, {
      startWavelength: 400,
      stopWavelength: 700,
      samples: 3,
    })

    const { input, spec } = createCoatingStudyJob(draft)
    expect(input).toMatchObject({
      module: 'sw-optics-thinfilm',
      method: 'method-algo-thinfilm-rt',
      backend: 'host',
      lambda0: 550,
      wavelengths: [400, 550, 700],
    })
    expect(input.wavelengths).toHaveLength(3)
    expect(input.wavelengths[0]).toBe(400)
    expect(input.wavelengths.at(-1)).toBe(700)
    expect(input.wavelengths[0]).toBeLessThan(input.wavelengths[1])
    expect(input.wavelengths[1]).toBeLessThan(input.wavelengths[2])
    expect(spec.model?.inline).toEqual(input)

    const maximum = createDefaultCoatingStudyDraft()
    maximum.samples = 401
    const maxInput = createCoatingStudyJob(maximum).input
    expect(maxInput.wavelengths).toHaveLength(401)
    expect(maxInput.wavelengths[0]).toBe(maximum.startWavelength)
    expect(maxInput.wavelengths.at(-1)).toBe(maximum.stopWavelength)
    expect(maxInput.lambda0).toBe((maximum.startWavelength + maximum.stopWavelength) / 2)
    expect(maxInput.wavelengths.every((sample, index, values) => index === 0 || sample > values[index - 1]!)).toBe(true)
  })

  it('rejects invalid wavelength bounds and sample counts', () => {
    const invalidDrafts = [
      { startWavelength: 99 },
      { startWavelength: 2501 },
      { stopWavelength: 99 },
      { stopWavelength: 2501 },
      { startWavelength: 500, stopWavelength: 500 },
      { startWavelength: 600, stopWavelength: 500 },
      { startWavelength: Number.NaN },
      { stopWavelength: Number.POSITIVE_INFINITY },
      { samples: 2 },
      { samples: 402 },
      { samples: 3.5 },
      { samples: Number.NaN },
    ]
    for (const change of invalidDrafts) {
      expect(() => createCoatingStudyJob({ ...createDefaultCoatingStudyDraft(), ...change })).toThrow()
    }

    for (const points of [3, 401]) {
      const draft = createDefaultCoatingStudyDraft()
      draft.samples = points
      expect(createCoatingStudyJob(draft).input.wavelengths).toHaveLength(points)
    }
  })

  it('rejects non-finite or out-of-range optical constants, thickness, and angle', () => {
    const cases: Array<(draft: ReturnType<typeof createDefaultCoatingStudyDraft>) => void> = [
      draft => { draft.n0 = 0.09 },
      draft => { draft.n0 = 10.01 },
      draft => { draft.n0 = Number.NaN },
      draft => { draft.ns = 0.09 },
      draft => { draft.ns = Number.POSITIVE_INFINITY },
      draft => { draft.ks = -0.01 },
      draft => { draft.ks = 10.01 },
      draft => { draft.ks = Number.NaN },
      draft => { draft.theta = -0.01 },
      draft => { draft.theta = 89.91 },
      draft => { draft.theta = Number.POSITIVE_INFINITY },
      draft => { draft.layers[0]!.n = 0.09 },
      draft => { draft.layers[0]!.n = 10.01 },
      draft => { draft.layers[0]!.n = Number.NaN },
      draft => { draft.layers[0]!.k = -0.01 },
      draft => { draft.layers[0]!.k = 10.01 },
      draft => { draft.layers[0]!.k = Number.POSITIVE_INFINITY },
      draft => { draft.layers[0]!.d = -0.01 },
      draft => { draft.layers[0]!.d = 10_001 },
      draft => { draft.layers[0]!.d = Number.NaN },
    ]
    for (const change of cases) {
      const draft = createDefaultCoatingStudyDraft()
      change(draft)
      expect(() => createCoatingStudyJob(draft)).toThrow()
    }
  })

  it('accepts optical constant and layer bounds while limiting the layer count to sixteen', () => {
    const draft = createDefaultCoatingStudyDraft()
    draft.n0 = 0.1
    draft.ns = 10
    draft.ks = 0
    draft.theta = 89.9
    draft.layers = Array.from({ length: 16 }, (_, index) => ({ n: index === 0 ? 0.1 : 10, k: index === 0 ? 0 : 10, d: index === 0 ? 0 : 10_000 }))
    expect(createCoatingStudyJob(draft).input.layers).toHaveLength(16)

    draft.layers.push({ n: 1.5, k: 0, d: 100 })
    expect(() => createCoatingStudyJob(draft)).toThrow(/layer/i)
  })

  it('rejects unknown draft and layer selector fields and unsupported polarization values', () => {
    const draft = createDefaultCoatingStudyDraft()
    expect(() => createCoatingStudyJob({ ...draft, operation: 'other' } as never)).toThrow(/unsupported field operation/i)
    expect(() => createCoatingStudyJob({ ...draft, polarization: 'circular' } as never)).toThrow(/polarization/i)
    expect(() => createCoatingStudyJob({ ...draft, layers: [{ ...draft.layers[0]!, material: 'ignored' }] } as never)).toThrow(/unsupported field material/i)
    for (const polarization of ['s', 'p', 'unpolarized'] as const) {
      const accepted = createDefaultCoatingStudyDraft()
      accepted.polarization = polarization
      expect(createCoatingStudyJob(accepted).input.polarization).toBe(polarization)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { createDefaultLensStudy, createLensStudyJob } from './lens-study-input'

describe('bounded lens study input builder', () => {
  it('returns independent default drafts', () => {
    const first = createDefaultLensStudy()
    const second = createDefaultLensStudy()

    expect(first).toEqual({
      ambientIndex: 1,
      surfaces: [
        { type: 'plane', radius: 0, aperture: 5, thickness: 5, nAfter: 1.5 },
        { type: 'plane', radius: 0, aperture: 5, thickness: 0, nAfter: 1 },
      ],
      bundle: { launchDistance: 10, launchRadius: 1, rings: 1, spokes: 4, fieldXDeg: 0, fieldYDeg: 0 },
      imageDistance: 20,
    })
    expect(first).not.toBe(second)
    expect(first.surfaces).not.toBe(second.surfaces)
    expect(first.surfaces[0]).not.toBe(second.surfaces[0])
    expect(first.bundle).not.toBe(second.bundle)

    first.surfaces[0].nAfter = 2
    first.bundle.rings = 4
    expect(second.surfaces[0].nAfter).toBe(1.5)
    expect(second.bundle.rings).toBe(1)
  })

  it('derives continuous native indices and keeps the final vertex gap at zero', () => {
    const draft = createDefaultLensStudy()
    draft.ambientIndex = 1.2
    draft.surfaces = [
      { type: 'plane', radius: 0, aperture: 4, thickness: 3, nAfter: 1.5 },
      { type: 'spherical', radius: -12, aperture: 4, thickness: 2, nAfter: 1.7 },
      { type: 'plane', radius: 0, aperture: 4, thickness: 0, nAfter: 1 },
    ]

    const { input } = createLensStudyJob(draft)
    expect(input.surfaces).toEqual([
      { type: 'plane', n1: 1.2, n2: 1.5, aperture: 4, thickness: 3 },
      { type: 'spherical', R: -12, n1: 1.5, n2: 1.7, aperture: 4, thickness: 2 },
      { type: 'plane', n1: 1.7, n2: 1, aperture: 4, thickness: 0 },
    ])
    expect(input.surfaces.at(-1)?.thickness).toBe(0)

    draft.surfaces[2].thickness = 0.01
    expect(() => createLensStudyJob(draft)).toThrow(/Final surface thickness must be 0/)
  })

  it('maps a spherical draft radius to R and checks finite radius and aperture bounds', () => {
    const draft = createDefaultLensStudy()
    draft.surfaces[0] = { type: 'spherical', radius: 10, aperture: 5, thickness: 5, nAfter: 1.5 }
    const { input } = createLensStudyJob(draft)
    expect(input.surfaces[0]).toMatchObject({ type: 'spherical', R: 10, aperture: 5 })
    expect(input.surfaces[0]).not.toHaveProperty('radius')

    for (const change of [
      { radius: Number.NaN },
      { radius: 0 },
      { radius: 4 }, // spherical semi-diameter must be smaller than |R|
      { radius: 1_000_001 },
      { aperture: 0 },
      { aperture: 1_000.1 },
    ]) {
      const invalid = createDefaultLensStudy()
      invalid.surfaces[0] = { ...invalid.surfaces[0], type: 'spherical', radius: 10, ...change }
      expect(() => createLensStudyJob(invalid)).toThrow()
    }
  })

  it('requires finite draft radii but strips radius from native plane surfaces', () => {
    const draft = createDefaultLensStudy()
    draft.surfaces[0].radius = -25
    const { input } = createLensStudyJob(draft)
    expect(input.surfaces[0]).toEqual({ type: 'plane', n1: 1, n2: 1.5, aperture: 5, thickness: 5 })

    draft.surfaces[0].radius = Number.POSITIVE_INFINITY
    expect(() => createLensStudyJob(draft)).toThrow(/finite/)
  })

  it('creates the exact native alias inline with host execution on the cuda transport', () => {
    const { input, spec } = createLensStudyJob(createDefaultLensStudy())
    expect(input).toMatchObject({ module: 'lens-design', method: 'geometric-ray-trace', backend: 'host' })
    expect(spec.model?.inline).toEqual(input)
    expect(spec.model?.inline).not.toHaveProperty('operation')
    expect(spec.requirements).toEqual({ backends: ['cuda'] })
    expect(spec.run.maxSteps).toBe(1)
  })

  it('rejects unknown fields in the draft and its nested surface and bundle objects', () => {
    const draft = createDefaultLensStudy()
    expect(() => createLensStudyJob({ ...draft, mode: 'paraxial' } as never)).toThrow(/unsupported field mode/)
    expect(() => createLensStudyJob({ ...draft, surfaces: [{ ...draft.surfaces[0], coating: 'ignored' }, draft.surfaces[1]] } as never)).toThrow(/unsupported field coating/)
    expect(() => createLensStudyJob({ ...draft, bundle: { ...draft.bundle, pupil: 'entrance' } } as never)).toThrow(/exactly/)
  })
})

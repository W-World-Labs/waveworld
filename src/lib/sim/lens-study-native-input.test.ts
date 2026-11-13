import { describe, expect, it } from 'vitest'
import { createDefaultLensStudy, createLensStudyJob, validateLensTraceInput } from './lens-study-input'

function validInput() {
  return createLensStudyJob(createDefaultLensStudy()).input
}

function changed(change: (input: any) => void) {
  const input = structuredClone(validInput())
  change(input)
  return input
}

describe('validateLensTraceInput direct-caller boundary', () => {
  it('accepts the exact supported lens-design operation input', () => {
    expect(validateLensTraceInput(validInput())).toEqual(validInput())
  })

  it('requires the exact module, method, and host backend selectors', () => {
    for (const patch of [
      { module: 'other-module' },
      { method: 'trace' },
      { backend: 'cuda' },
      { unexpected: true },
    ]) {
      expect(() => validateLensTraceInput({ ...validInput(), ...patch })).toThrow()
    }
  })

  it('rejects unsupported surface types and fields, including aspheres and coatings', () => {
    for (const update of [
      (input: any) => { input.surfaces[0].type = 'aspheric' },
      (input: any) => { input.surfaces[0].conic = -1 },
      (input: any) => { input.surfaces[0].tilt = [1, 0, 0] },
      (input: any) => { input.surfaces[0].coating = 'AR' },
      (input: any) => { input.surfaces[0].decenter = [1, 0] },
    ]) {
      expect(() => validateLensTraceInput(changed(update))).toThrow()
    }
  })

  it('checks surface count, refractive-index continuity, gaps, and final thickness', () => {
    expect(() => validateLensTraceInput(changed(input => { input.surfaces = [] }))).toThrow()
    expect(() => validateLensTraceInput(changed(input => {
      input.surfaces = Array.from({ length: 9 }, () => ({ ...input.surfaces[0], thickness: 1 }))
      input.surfaces[8].thickness = 0
    }))).toThrow()
    expect(() => validateLensTraceInput(changed(input => { input.surfaces[1].n1 = 1.25 }))).toThrow(/n1/)
    expect(() => validateLensTraceInput(changed(input => { input.surfaces[0].thickness = 0 }))).toThrow()
    expect(() => validateLensTraceInput(changed(input => { input.surfaces[0].thickness = 10001 }))).toThrow()
    expect(() => validateLensTraceInput(changed(input => { input.surfaces[1].thickness = 0.1 }))).toThrow(/Final/)
  })

  it('requires positive apertures and valid spherical radii larger than the aperture', () => {
    expect(() => validateLensTraceInput(changed(input => { input.surfaces[0].aperture = 0 }))).toThrow()
    expect(() => validateLensTraceInput(changed(input => {
      input.surfaces[0] = { type: 'spherical', R: 0, n1: 1, n2: 1.5, aperture: 1, thickness: 5 }
    }))).toThrow()
    expect(() => validateLensTraceInput(changed(input => {
      input.surfaces[0] = { type: 'spherical', R: -1, n1: 1, n2: 1.5, aperture: 1, thickness: 5 }
    }))).toThrow()
    expect(() => validateLensTraceInput(changed(input => {
      input.surfaces[0] = { type: 'spherical', R: 1, n1: 1, n2: 1.5, aperture: 1, thickness: 5 }
    }))).toThrow()
  })

  it('requires finite three-dimensional ray vectors with nonzero forward directions', () => {
    for (const update of [
      (input: any) => { input.rays[0].origin = [0, 0] },
      (input: any) => { input.rays[0].direction = [0, 0, 1, 0] },
      (input: any) => { input.rays[0].origin[1] = Number.NaN },
      (input: any) => { input.rays[0].direction[0] = Number.POSITIVE_INFINITY },
      (input: any) => { input.rays[0].direction = [0, 0, 0] },
      (input: any) => { input.rays[0].direction = [0, 0, -1] },
      (input: any) => { input.rays[0].direction = [1, 0, 0] },
    ]) {
      expect(() => validateLensTraceInput(changed(update))).toThrow()
    }
  })

  it('accepts at most 65 rays and rejects empty or oversized ray arrays', () => {
    const input = validInput()
    const ray = input.rays[0]
    expect(validateLensTraceInput({ ...input, rays: Array.from({ length: 65 }, () => structuredClone(ray)) }).rays).toHaveLength(65)
    expect(() => validateLensTraceInput({ ...input, rays: [] })).toThrow()
    expect(() => validateLensTraceInput({ ...input, rays: Array.from({ length: 66 }, () => structuredClone(ray)) })).toThrow()
  })
})

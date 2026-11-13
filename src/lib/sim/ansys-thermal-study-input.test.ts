import { describe, expect, it } from 'vitest'
import {
  createAnsysThermalStudyInput,
  createDefaultAnsysThermalStudy,
  validateAnsysThermalStudyInput,
} from './ansys-thermal-study-input'

describe('Ansys thermal study input', () => {
  it('builds a uniform 1D steady bar with endpoint temperatures', () => {
    const draft = { ...createDefaultAnsysThermalStudy(), nodeCount: 3, lengthM: 2, volumetricSourceWPerM3: 12 }
    expect(createAnsysThermalStudyInput(draft)).toEqual({
      module: 'sw-ansys-thermal-fem', backend: 'host', analysis: 'steady', dimension: 1,
      mesh: { element: 'bar', nodes: [[0], [1], [2]], elements: [[0, 1], [1, 2]] },
      conductivity: 15, thickness: 1, volumetricSource: 12,
      dirichlet: [{ node: 0, temperature: 100 }, { node: 2, temperature: 0 }],
    })
  })

  it('adds the supported transient material, initial field, and theta settings', () => {
    const input = createAnsysThermalStudyInput({
      ...createDefaultAnsysThermalStudy(), analysis: 'transient', nodeCount: 3,
      initialTemperatureC: 20, densityKgPerM3: 7800, specificHeatJPerKgK: 500,
      timeStepS: 0.25, steps: 8, theta: 0.5, capacity: 'lumped',
    })
    expect(input).toMatchObject({
      analysis: 'transient', density: 7800, specificHeat: 500,
      initialTemperature: [20, 20, 20], timeStep: 0.25, steps: 8,
      theta: 0.5, capacity: 'lumped',
    })
    expect(validateAnsysThermalStudyInput(input)).toEqual(input)
  })

  it('rejects invalid draft values, unsupported fields, and transient-only steady settings', () => {
    const base = createDefaultAnsysThermalStudy()
    for (const patch of [
      { analysis: 'harmonic' }, { nodeCount: 1 }, { nodeCount: 2.5 },
      { lengthM: 0 }, { conductivityWPerMK: 0 }, { leftTemperatureC: -300 },
      { unexpected: true }, { analysis: 'steady', theta: 1 },
      { analysis: 'transient', initialTemperatureC: 20 },
    ]) {
      expect(() => createAnsysThermalStudyInput({ ...base, ...patch } as never)).toThrow()
    }
  })

  it('rejects malformed native input and anything outside the connected increasing endpoint-constrained bar', () => {
    const valid = createAnsysThermalStudyInput({ ...createDefaultAnsysThermalStudy(), nodeCount: 3 })
    const mutations: ((value: any) => void)[] = [
      value => { value.module = 'other' },
      value => { value.backend = 'cuda' },
      value => { value.dimension = 2 },
      value => { value.mesh.nodes[1][0] = -0.1 },
      value => { value.mesh.elements[0] = [0, 2] },
      value => { value.dirichlet[0].node = 1 },
      value => { value.extra = true },
      value => { value.conductivity = Number.NaN },
    ]
    for (const mutate of mutations) {
      const altered = structuredClone(valid)
      mutate(altered)
      expect(() => validateAnsysThermalStudyInput(altered)).toThrow()
    }
  })

  it('rejects invalid transient native fields and wrong initial-field size', () => {
    const valid = createAnsysThermalStudyInput({
      ...createDefaultAnsysThermalStudy(), analysis: 'transient', nodeCount: 3,
      initialTemperatureC: 20, densityKgPerM3: 7800, specificHeatJPerKgK: 500,
      timeStepS: 0.25, steps: 8, theta: 0.5, capacity: 'consistent',
    })
    for (const mutate of [
      (value: any) => { value.steps = 0 },
      (value: any) => { value.theta = 0.49 },
      (value: any) => { value.capacity = 'diagonal' },
      (value: any) => { value.initialTemperature.pop() },
      (value: any) => { value.density = 0 },
    ]) {
      const altered = structuredClone(valid)
      mutate(altered)
      expect(() => validateAnsysThermalStudyInput(altered)).toThrow()
    }
  })

  it('enforces the native transient work cap for the selected mesh size', () => {
    const base = createDefaultAnsysThermalStudy()
    const transient = {
      ...base, analysis: 'transient' as const, nodeCount: 256,
      initialTemperatureC: 20, densityKgPerM3: 7800, specificHeatJPerKgK: 500,
      timeStepS: 0.25, steps: 7_000, theta: 1, capacity: 'consistent' as const,
    }
    expect(() => createAnsysThermalStudyInput(transient)).toThrow(/native nFree\^2\*steps limit/)
    const valid = createAnsysThermalStudyInput({ ...transient, nodeCount: 3, steps: 7_000 })
    const expanded = structuredClone(valid)
    expanded.mesh.nodes = Array.from({ length: 256 }, (_, i) => [i] as [number])
    expanded.mesh.elements = Array.from({ length: 255 }, (_, i) => [i, i + 1] as [number, number])
    expanded.dirichlet = [{ node: 0, temperature: 100 }, { node: 255, temperature: 0 }]
    expanded.initialTemperature = Array(256).fill(20)
    expect(() => validateAnsysThermalStudyInput(expanded)).toThrow(/native nFree\^2\*steps limit/)
  })
})

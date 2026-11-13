import { describe, expect, it } from 'vitest'
import { buildAnsysModalStudyInput, createDefaultAnsysModalStudy } from './ansys-modal-study-input'

describe('Ansys 2-DOF modal study input builder', () => {
  it('creates independent valid defaults and the exact host input shape', () => {
    const first = createDefaultAnsysModalStudy()
    const second = createDefaultAnsysModalStudy()
    first.mass.m11 = 3
    expect(second.mass.m11).toBe(1)

    expect(buildAnsysModalStudyInput(second)).toEqual({
      module: 'sw-ansys-modal',
      backend: 'host',
      method: 'block-lanczos',
      stiffness: [[1000, 0], [0, 1000]],
      mass: [[1, 0], [0, 1]],
      direction: [1, 0],
      numModes: 2,
    })
  })

  it('maps symmetric off-diagonal terms and accepts either supported mode count', () => {
    const draft = createDefaultAnsysModalStudy()
    draft.stiffness = { k11: 8, k12: 2, k22: 5 }
    draft.mass = { m11: 4, m12: -1, m22: 3 }
    draft.direction = [0.5, -2]
    draft.numModes = 1

    expect(buildAnsysModalStudyInput(draft)).toEqual({
      module: 'sw-ansys-modal',
      backend: 'host',
      method: 'block-lanczos',
      stiffness: [[8, 2], [2, 5]],
      mass: [[4, -1], [-1, 3]],
      direction: [0.5, -2],
      numModes: 1,
    })
  })

  it('rejects non-finite stiffness and mass entries', () => {
    const cases = [
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.stiffness.k11 = Number.NaN },
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.stiffness.k12 = Number.POSITIVE_INFINITY },
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.stiffness.k22 = Number.NEGATIVE_INFINITY },
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.mass.m11 = Number.NaN },
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.mass.m12 = Number.POSITIVE_INFINITY },
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.mass.m22 = Number.NEGATIVE_INFINITY },
    ]
    for (const change of cases) {
      const draft = createDefaultAnsysModalStudy()
      change(draft)
      expect(() => buildAnsysModalStudyInput(draft)).toThrow(/finite number/)
    }
  })

  it('bounds stiffness and mass entries to 1e12 in magnitude', () => {
    const overLimit = [
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.stiffness.k11 = 1e12 + 1 },
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.stiffness.k12 = -1e12 - 1 },
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.stiffness.k22 = 1e12 + 1 },
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.mass.m11 = 1e12 + 1 },
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.mass.m12 = -1e12 - 1 },
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.mass.m22 = 1e12 + 1 },
    ]
    for (const change of overLimit) {
      const draft = createDefaultAnsysModalStudy()
      change(draft)
      expect(() => buildAnsysModalStudyInput(draft)).toThrow(/magnitude must be <= 1000000000000/)
    }
  })

  it('requires stiffness and mass matrices to be positive definite', () => {
    const invalidMatrices = [
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.stiffness.k11 = 0 },
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.stiffness.k22 = -1 },
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.stiffness.k12 = 1001 },
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.mass.m11 = 0 },
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.mass.m22 = -1 },
      (draft: ReturnType<typeof createDefaultAnsysModalStudy>) => { draft.mass.m12 = 2 },
    ]
    for (const change of invalidMatrices) {
      const draft = createDefaultAnsysModalStudy()
      change(draft)
      expect(() => buildAnsysModalStudyInput(draft)).toThrow(/positive definite/)
    }
  })

  it('requires a finite, two-component, nonzero direction', () => {
    const invalidDirections: unknown[] = [[0, 0], [Number.NaN, 1], [1, Number.POSITIVE_INFINITY], [1], [1, 2, 3]]
    for (const direction of invalidDirections) {
      const draft = { ...createDefaultAnsysModalStudy(), direction } as ReturnType<typeof createDefaultAnsysModalStudy>
      expect(() => buildAnsysModalStudyInput(draft)).toThrow(/Direction/)
    }
  })

  it('bounds direction entries to 1e6 in magnitude', () => {
    const draft = createDefaultAnsysModalStudy()
    draft.direction = [1e6 + 1, 0]
    expect(() => buildAnsysModalStudyInput(draft)).toThrow(/Direction\[0\] magnitude must be <= 1000000/)

    draft.direction = [0, -1e6 - 1]
    expect(() => buildAnsysModalStudyInput(draft)).toThrow(/Direction\[1\] magnitude must be <= 1000000/)
  })

  it('accepts only integer mode counts 1 and 2', () => {
    for (const numModes of [0, 3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const draft = { ...createDefaultAnsysModalStudy(), numModes } as ReturnType<typeof createDefaultAnsysModalStudy>
      expect(() => buildAnsysModalStudyInput(draft)).toThrow(/numModes must be the integer 1 or 2/)
    }
  })
})

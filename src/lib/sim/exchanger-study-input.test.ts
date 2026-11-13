import { describe, expect, it } from 'vitest'
import {
  createDefaultExchangerStudy,
  createExchangerStudyJob,
  validateExchangerSweepInput,
} from './exchanger-study-input'
import { createExchangerUaValues } from './exchanger-sweep-range'

describe('bounded exchanger study input builder', () => {
  it('returns independent default drafts', () => {
    const first = createDefaultExchangerStudy()
    const second = createDefaultExchangerStudy()

    expect(first).toEqual({
      arrangement: 'counterflow',
      Chot: 100,
      Ccold: 100,
      T_hot_in: 363.15,
      T_cold_in: 293.15,
      range: { start: 100, end: 300, points: 3, spacing: 'linear' },
    })
    expect(first).not.toBe(second)
    expect(first.range).not.toBe(second.range)
    first.range.start = 150
    expect(second.range.start).toBe(100)
  })

  it('maps linear and logarithmic ranges to endpoint-inclusive UA values', () => {
    expect(createExchangerUaValues({ start: 100, end: 300, points: 3, spacing: 'linear' }))
      .toEqual([100, 200, 300])
    expect(createExchangerUaValues({ start: 10, end: 1000, points: 3, spacing: 'log' }))
      .toEqual([10, 100, 1000])
  })

  it('creates the exact steady host native input and CUDA transport spec', () => {
    const { input, spec } = createExchangerStudyJob(createDefaultExchangerStudy())
    expect(input).toEqual({
      module: 'sw-openmodelica-heat-exchanger',
      backend: 'host',
      dynamic: false,
      arrangement: 'counterflow',
      Chot: 100,
      Ccold: 100,
      T_hot_in: 363.15,
      T_cold_in: 293.15,
      sweep_UA: [100, 200, 300],
    })
    expect(spec.model?.inline).toEqual(input)
    expect(JSON.parse(JSON.stringify(spec.model?.inline))).toEqual(input)
    expect(spec.requirements).toEqual({ backends: ['cuda'] })
    expect(spec.run.maxSteps).toBe(1)
  })

  it('accepts both arrangements and equal inlet temperatures', () => {
    for (const arrangement of ['counterflow', 'parallel'] as const) {
      const draft = createDefaultExchangerStudy()
      draft.arrangement = arrangement
      draft.T_cold_in = draft.T_hot_in
      const { input } = createExchangerStudyJob(draft)
      expect(input.arrangement).toBe(arrangement)
      expect(input.T_hot_in).toBe(input.T_cold_in)
    }
  })

  it('does not mutate the submitted draft or nested range', () => {
    const draft = createDefaultExchangerStudy()
    const before = structuredClone(draft)
    createExchangerStudyJob(draft)
    expect(draft).toEqual(before)
  })

  it('rejects unsupported draft and input fields', () => {
    const draft = createDefaultExchangerStudy()
    expect(() => createExchangerStudyJob({ ...draft, method: 'steady' } as never)).toThrow(/unsupported field method/)
    expect(() => createExchangerStudyJob({ ...draft, range: { ...draft.range, units: 'W' } } as never))
      .toThrow(/unsupported field units/)

    const { input } = createExchangerStudyJob(draft)
    expect(() => validateExchangerSweepInput({ ...input, UA: 200 } as never)).toThrow(/unsupported field UA/)
    expect(() => validateExchangerSweepInput({ ...input, dynamic: true })).toThrow()
    expect(() => validateExchangerSweepInput({ ...input, backend: 'cuda' })).toThrow()
    expect(() => validateExchangerSweepInput({ ...input, method: 'other' } as never)).toThrow(/unsupported field method/)
  })

  it('rejects out-of-bounds and non-finite physical conditions', () => {
    const changes: Array<(draft: ReturnType<typeof createDefaultExchangerStudy>) => void> = [
      draft => { draft.Chot = 0 },
      draft => { draft.Chot = 1e9 + 1 },
      draft => { draft.Ccold = Number.NaN },
      draft => { draft.T_hot_in = 0.99 },
      draft => { draft.T_cold_in = 2000.01 },
      draft => { draft.T_hot_in = draft.T_cold_in - 0.1 },
      draft => { draft.Chot = 1e9; draft.Ccold = 1e-6 },
    ]
    for (const change of changes) {
      const draft = createDefaultExchangerStudy()
      change(draft)
      expect(() => createExchangerStudyJob(draft)).toThrow()
    }
  })

  it('rejects invalid UA range bounds, point counts, ordering, and generated NTU', () => {
    const changes: Array<(draft: ReturnType<typeof createDefaultExchangerStudy>) => void> = [
      draft => { draft.range.start = 0 },
      draft => { draft.range.end = 1e9 + 1 },
      draft => { draft.range.start = draft.range.end },
      draft => { draft.range.points = 1 },
      draft => { draft.range.points = 65 },
      draft => { draft.range.points = 2.5 },
      draft => { draft.range.spacing = 'geometric' as never },
      draft => { draft.range.end = 1e9; draft.Chot = 1e-6; draft.Ccold = 1e-6 },
    ]
    for (const change of changes) {
      const draft = createDefaultExchangerStudy()
      change(draft)
      expect(() => createExchangerStudyJob(draft)).toThrow()
    }
  })

  it('requires ordered sweep values within UA, count, and NTU limits at the native input boundary', () => {
    const { input } = createExchangerStudyJob(createDefaultExchangerStudy())
    const invalid: unknown[] = [
      { ...input, sweep_UA: [100] },
      { ...input, sweep_UA: Array.from({ length: 65 }, (_, index) => index + 1) },
      { ...input, sweep_UA: [100, 99] },
      { ...input, sweep_UA: [100, Number.POSITIVE_INFINITY] },
      { ...input, sweep_UA: [1e-7, 100] },
      { ...input, sweep_UA: [100, 1e9 + 1] },
      { ...input, Chot: 1e-6, Ccold: 1e-6, sweep_UA: [100, 200] },
    ]
    for (const value of invalid) expect(() => validateExchangerSweepInput(value)).toThrow()
  })
})

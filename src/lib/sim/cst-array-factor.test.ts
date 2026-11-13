import { describe, expect, it } from 'vitest'
import {
  CST_ARRAY_FACTOR_MAX_DIRECTIONS,
  CST_ARRAY_FACTOR_MAX_ELEMENTS,
  CST_ARRAY_FACTOR_MAX_INPUT_BYTES,
  CST_ARRAY_FACTOR_NATIVE_PIN_SHA,
  createCstArrayFactorJob,
  createDefaultCstArrayFactorDraft,
} from './cst-array-factor.js'

describe('CST mapped antenna array-factor job input', () => {
  it('creates the pinned explicit-host operation and retains its inline input', () => {
    const { input, spec } = createCstArrayFactorJob(createDefaultCstArrayFactorDraft())
    expect(input).toMatchObject({
      module: 'antenna-l2', operation: 'cst-array-factor', backend: 'host',
      freqHz: 300_000_000,
      positionsM: [[0, 0, 0], [0, 0, 0.5]],
      weights: [[1, 0], [1, 0]],
    })
    expect(CST_ARRAY_FACTOR_NATIVE_PIN_SHA).toBe('dda2f6f1e1def3d9a49bea48c8766d222b2d8a14')
    expect(spec.model?.inline).toEqual(input)
    expect(new TextEncoder().encode(JSON.stringify(input)).byteLength).toBeLessThanOrEqual(CST_ARRAY_FACTOR_MAX_INPUT_BYTES)
  })

  it('accepts the native element, direction, and evaluation bounds', () => {
    const positionsM = Array.from({ length: CST_ARRAY_FACTOR_MAX_ELEMENTS }, (_, i) => [i, 0, 0] as [number, number, number])
    const weights = positionsM.map(() => [1, 0] as [number, number])
    const directionsRad = Array.from({ length: CST_ARRAY_FACTOR_MAX_DIRECTIONS }, () => [0, 0] as [number, number])
    expect(() => createCstArrayFactorJob({ freqHz: 1, positionsM, weights, directionsRad })).not.toThrow()
  })

  it('rejects invalid counts, mismatched weights, and malformed coordinates', () => {
    const valid = createDefaultCstArrayFactorDraft()
    expect(() => createCstArrayFactorJob({ ...valid, positionsM: [] })).toThrow(/positions/i)
    expect(() => createCstArrayFactorJob({ ...valid, positionsM: Array.from({ length: CST_ARRAY_FACTOR_MAX_ELEMENTS + 1 }, () => [0, 0, 0]), weights: Array.from({ length: CST_ARRAY_FACTOR_MAX_ELEMENTS + 1 }, () => [1, 0]) })).toThrow(/positions/i)
    expect(() => createCstArrayFactorJob({ ...valid, weights: [[1, 0]] })).toThrow(/match/i)
    expect(() => createCstArrayFactorJob({ ...valid, directionsRad: [] })).toThrow(/directions/i)
    expect(() => createCstArrayFactorJob({ ...valid, positionsM: [[0, 0, 1e6 + 1], [0, 0, 0.5]] })).toThrow(/±1e6/)
    expect(() => createCstArrayFactorJob({ ...valid, weights: [[0, 0], [0, 0]] })).toThrow(/nonzero/i)
  })

  it('rejects invalid frequency, angles, non-finite values, and unreliable phase arguments', () => {
    const valid = createDefaultCstArrayFactorDraft()
    expect(() => createCstArrayFactorJob({ ...valid, freqHz: 0 })).toThrow(/greater than zero/i)
    expect(() => createCstArrayFactorJob({ ...valid, freqHz: Number.POSITIVE_INFINITY })).toThrow(/finite/i)
    expect(() => createCstArrayFactorJob({ ...valid, directionsRad: [[Math.PI + 0.01, 0]] })).toThrow(/theta/i)
    expect(() => createCstArrayFactorJob({ ...valid, directionsRad: [[0, Number.NaN]] })).toThrow(/finite/i)
    expect(() => createCstArrayFactorJob({ ...valid, freqHz: 1e20 })).toThrow(/phase|wavenumber/i)
    expect(() => createCstArrayFactorJob({ ...valid, extra: true } as typeof valid)).toThrow(/unsupported/i)
  })
})

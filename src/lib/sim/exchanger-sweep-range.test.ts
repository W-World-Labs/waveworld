import { describe, expect, it } from 'vitest'
import { createExchangerUaValues, type ExchangerSweepRange } from './exchanger-sweep-range'

describe('bounded exchanger UA sampling', () => {
  it('includes both requested endpoints and the expected linear interior samples', () => {
    const values = createExchangerUaValues({ start: 100, end: 300, points: 5, spacing: 'linear' })

    expect(values).toEqual([100, 150, 200, 250, 300])
    expect(values[0]).toBe(100)
    expect(values.at(-1)).toBe(300)
  })

  it('uses geometric spacing while preserving the endpoint order', () => {
    const values = createExchangerUaValues({ start: 1, end: 10_000, points: 5, spacing: 'log' })

    expect(values[0]).toBe(1)
    expect(values.at(-1)).toBe(10_000)
    values.forEach((value, index) => {
      expect(value).toBeCloseTo([1, 10, 100, 1_000, 10_000][index], 10)
      if (index > 0) expect(value).toBeGreaterThan(values[index - 1])
    })
  })

  it('accepts inclusive UA and point-count limits, including the largest supported sweep', () => {
    const endpoints = createExchangerUaValues({ start: 1e-6, end: 1e9, points: 2, spacing: 'linear' })
    const largest = createExchangerUaValues({ start: 1, end: 64, points: 64, spacing: 'linear' })

    expect(endpoints).toEqual([1e-6, 1e9])
    expect(largest).toHaveLength(64)
    expect(largest[0]).toBe(1)
    expect(largest.at(-1)).toBe(64)
    expect(largest.every((value, index) => index === 0 || value > largest[index - 1])).toBe(true)
  })

  it('rejects non-finite, blank, out-of-range, and reversed numeric endpoints', () => {
    const invalidRanges: unknown[] = [
      { start: '', end: 2, points: 2, spacing: 'linear' },
      { start: Number.NaN, end: 2, points: 2, spacing: 'linear' },
      { start: 1, end: Number.POSITIVE_INFINITY, points: 2, spacing: 'linear' },
      { start: 0, end: 2, points: 2, spacing: 'linear' },
      { start: 1, end: 1e9 + 1, points: 2, spacing: 'linear' },
      { start: 2, end: 1, points: 2, spacing: 'linear' },
      { start: 2, end: 2, points: 2, spacing: 'linear' },
    ]

    for (const range of invalidRanges) expect(() => createExchangerUaValues(range as ExchangerSweepRange)).toThrow()
  })

  it('requires integer point counts from two through sixty-four and a known spacing', () => {
    for (const points of [1, 1.5, 65, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createExchangerUaValues({ start: 1, end: 2, points, spacing: 'linear' } as ExchangerSweepRange)).toThrow()
    }
    expect(() => createExchangerUaValues({ start: 1, end: 2, points: 2, spacing: 'quadratic' } as unknown as ExchangerSweepRange)).toThrow()
  })

  it('rejects extra properties instead of silently accepting a different sampling request', () => {
    expect(() => createExchangerUaValues({ start: 1, end: 2, points: 2, spacing: 'linear', includeEnd: false } as ExchangerSweepRange)).toThrow(/includeEnd/)
  })

  it('fails when the requested interior samples collapse at floating-point precision', () => {
    expect(() => createExchangerUaValues({
      start: 999_999_999.999999,
      end: 1_000_000_000,
      points: 64,
      spacing: 'linear',
    })).toThrow(/distinct/)
  })
})

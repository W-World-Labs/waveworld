import { describe, expect, it } from 'vitest'
import { formatParamLabel } from './paramLabel'

describe('formatParamLabel (#2 step 3.4 / #26)', () => {
  it('formats name=value without unit', () => {
    expect(formatParamLabel('质量 m', '1.5')).toBe('质量 m=1.5')
    expect(formatParamLabel('n', '1.00')).toBe('n=1.00')
  })

  it('formats name=value unit with a single space before unit', () => {
    expect(formatParamLabel('频率 f', '1000', 'Hz')).toBe('频率 f=1000 Hz')
    expect(formatParamLabel('R', '50', 'Ω')).toBe('R=50 Ω')
  })

  it('treats empty unit as absent', () => {
    expect(formatParamLabel('k', '100', '')).toBe('k=100')
  })
})

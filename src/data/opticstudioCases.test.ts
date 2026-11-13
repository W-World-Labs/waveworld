import { describe, expect, it } from 'vitest'
import { OPTICSTUDIO_NATIVE_CASES } from './opticstudioCases'

describe('OpticStudio native capability examples', () => {
  it('keeps all 40 worker examples module-bound and uniquely identified', () => {
    expect(OPTICSTUDIO_NATIVE_CASES).toHaveLength(40)
    expect(new Set(OPTICSTUDIO_NATIVE_CASES.map(item => item.module)).size).toBe(40)
    expect(new Set(OPTICSTUDIO_NATIVE_CASES.map(item => item.exampleName)).size).toBe(40)

    const products = new Set(OPTICSTUDIO_NATIVE_CASES.map(item => item.product))
    expect(products).toEqual(new Set([
      'Sequential', 'Non-sequential', 'Materials', 'Polarization', 'Physical optics', 'Image analysis',
    ]))

    for (const example of OPTICSTUDIO_NATIVE_CASES) {
      expect(example.targetSoftware).toBe('OpticStudio')
      expect(example.input.module).toBe(example.module)
      expect(example.input.backend).toBe('host')
      expect(example.opticStudioFeature.length).toBeGreaterThan(0)
      expect(example.selector.length).toBeGreaterThan(0)
      expect(example.limitations.length).toBeGreaterThan(0)
      expect(example.sourceUrls.length).toBeGreaterThan(0)
      for (const sourceUrl of example.sourceUrls) expect(sourceUrl).toMatch(/^https:\/\//)
    }
  })
})

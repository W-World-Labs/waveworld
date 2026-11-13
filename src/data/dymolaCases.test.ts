import { describe, expect, it } from 'vitest'
import { DYMOLA_NATIVE_CASES } from './dymolaCases'

function valuesAtPath(value: unknown, path: string): unknown[] {
  return path.replace(/\[\]/g, '').split('.').reduce<unknown[]>(
    (values, key) => values.flatMap((item) => {
      if (Array.isArray(item)) return item.flatMap((entry) => entry && typeof entry === 'object' && key in entry ? [(entry as Record<string, unknown>)[key]] : [])
      return item && typeof item === 'object' && key in item ? [(item as Record<string, unknown>)[key]] : []
    }),
    [value],
  )
}

describe('Dymola native capability examples', () => {
  it('keeps all 62 worker examples module-bound with valid unique metadata', () => {
    expect(DYMOLA_NATIVE_CASES).toHaveLength(62)
    expect(new Set(DYMOLA_NATIVE_CASES.map(item => item.module)).size).toBe(62)
    expect(new Set(DYMOLA_NATIVE_CASES.map(item => item.exampleName)).size).toBe(62)

    const products = new Set([
      'Equation systems', 'Numerical methods', 'Events and controls', 'Electrical',
      'Thermal and fluid', 'Mechanics', 'Experiments and data',
    ])
    for (const example of DYMOLA_NATIVE_CASES) {
      expect(example.targetSoftware).toBe('Dymola')
      expect(example.file).toMatch(/^sw_openmodelica_[a-z0-9_]+\.rs$/)
      expect(example.module).toMatch(/^sw-openmodelica-/)
      expect(example.input.module).toBe(example.module)
      expect(example.input.backend).toBe('host')
      expect(example.mappedFeature.trim().length).toBeGreaterThan(0)
      expect(example.summary.trim().length).toBeGreaterThan(0)
      expect(example.selector.trim().length).toBeGreaterThan(0)
      expect(example.selectorChecks.length).toBeGreaterThan(0)
      for (const check of example.selectorChecks) {
        expect(check.path.trim().length).toBeGreaterThan(0)
        expect(check.equals !== undefined || check.present === true).toBe(true)
        const values = valuesAtPath(example.input, check.path)
        expect(values.length).toBeGreaterThan(0)
        if (check.equals !== undefined) expect(values).toContain(check.equals)
      }
      expect(products.has(example.product)).toBe(true)
      expect(example.limitations.length).toBeGreaterThan(0)
      expect(example.testsWritten.length).toBeGreaterThan(0)
      expect(example.sourceUrls.length).toBeGreaterThan(0)
      for (const sourceUrl of example.sourceUrls) expect(sourceUrl).toMatch(/^https:\/\//)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { STAR_CCM_NATIVE_CASES } from './starCcmCases'

function valuesAtPath(value: unknown, path: string): unknown[] {
  const keys = path.replace(/\[\]/g, '').split('.')
  return keys.reduce<unknown[]>(
    (values, key) => values.flatMap((item) => {
      if (Array.isArray(item)) return item.flatMap((entry) => entry && typeof entry === 'object' && key in entry ? [(entry as Record<string, unknown>)[key]] : [])
      return item && typeof item === 'object' && key in item ? [(item as Record<string, unknown>)[key]] : []
    }),
    [value],
  ).flat(Infinity) as unknown[]
}

describe('Simcenter STAR-CCM+ native capability examples', () => {
  it('keeps each delivered case complete, uniquely addressable, and aligned with its selector', () => {
    expect(STAR_CCM_NATIVE_CASES).toHaveLength(93)
    expect(new Set(STAR_CCM_NATIVE_CASES.map(item => item.module)).size).toBe(STAR_CCM_NATIVE_CASES.length)
    expect(new Set(STAR_CCM_NATIVE_CASES.map(item => item.exampleName)).size).toBe(STAR_CCM_NATIVE_CASES.length)

    const products = new Set([
      'Mesh and geometry', 'Numerical methods', 'Flow and boundaries', 'Compressible flow',
      'Turbulence', 'Heat transfer', 'Multiphase and particles', 'Reacting flow',
      'Motion and FSI', 'Design and diagnostics', 'Electromagnetics and acoustics',
    ])
    for (const example of STAR_CCM_NATIVE_CASES) {
      expect(example.targetSoftware).toBe('Simcenter STAR-CCM+')
      expect(example.file).toMatch(/^sw_(openfoam|su2)_[a-z0-9_]+\.rs$/)
      expect(example.module).toMatch(/^sw-(openfoam|su2)-/)
      expect(example.module).toBe(example.file.startsWith('sw_openfoam_') ? `sw-openfoam-${example.file.slice('sw_openfoam_'.length, -3).replace(/_/g, '-')}` : `sw-su2-${example.file.slice('sw_su2_'.length, -3).replace(/_/g, '-')}`)
      expect(example.input.module).toBe(example.module)
      expect(example.input.backend).toBe('host')
      expect(Object.keys(example.input).length).toBeGreaterThan(2)
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
      expect(example.exampleName).toMatch(/^unique-starccm-(openfoam|su2)-[a-z0-9-]+$/)
    }
  })
})

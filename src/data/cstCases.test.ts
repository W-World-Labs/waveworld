import { describe, expect, it } from 'vitest'
import { CST_NATIVE_CASES } from './cstCases'

function valuesAtPath(value: unknown, path: string): unknown[] {
  return path.replace(/\[\]/g, '').split('.').reduce<unknown[]>(
    (values, key) => values.flatMap((item) => {
      if (Array.isArray(item)) return item.flatMap((entry) =>
        entry && typeof entry === 'object' && key in entry
          ? [(entry as Record<string, unknown>)[key]]
          : [],
      )
      return item && typeof item === 'object' && key in item
        ? [(item as Record<string, unknown>)[key]]
        : []
    }),
    [value],
  )
}

function findNumericPath(value: unknown, path: Array<string | number> = []): { path: Array<string | number>; value: number } | null {
  if (typeof value === 'number') return { path, value }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findNumericPath(value[index], [...path, index])
      if (found) return found
    }
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (path.length === 0 && ['module', 'backend'].includes(key)) continue
      const found = findNumericPath(child, [...path, key])
      if (found) return found
    }
  }
  return null
}

function setPath(value: unknown, path: Array<string | number>, next: number): void {
  let cursor = value as Record<string | number, unknown>
  for (const segment of path.slice(0, -1)) cursor = cursor[segment] as Record<string | number, unknown>
  cursor[path[path.length - 1]!] = next
}

describe('CST native capability examples', () => {
  it('keeps the first catalog entry usable as the deterministic default selection', () => {
    const first = CST_NATIVE_CASES[0]
    expect(first.file).toBe('abcd_twoport.rs')
    expect(first.exampleName).toBe('unique-cst-abcd-twoport')
    expect(first.input.module).toBe(first.module)
    expect(first.input.backend).toBe('host')
    for (const check of first.selectorChecks) {
      const values = valuesAtPath(first.input, check.path)
      expect(values.length).toBeGreaterThan(0)
      if (check.equals !== undefined) expect(values).toContain(check.equals)
    }
  })

  it('preserves delivered case identities and bounded product classifications', () => {
    expect(CST_NATIVE_CASES).toHaveLength(72)
    expect(new Set(CST_NATIVE_CASES.map(item => item.file)).size).toBe(72)
    expect(new Set(CST_NATIVE_CASES.map(item => item.module)).size).toBe(72)
    expect(new Set(CST_NATIVE_CASES.map(item => item.exampleName)).size).toBe(72)

    const products = new Set([
      'High-frequency fields', 'Materials and dispersion', 'Sources and boundaries',
      'Ports and networks', 'Antennas and radiation', 'Mesh and discretization',
      'Low-frequency electromagnetics', 'Charged particles', 'Multiphysics and exposure',
      'Optimization and diagnostics',
    ])
    for (const example of CST_NATIVE_CASES) {
      expect(example.targetSoftware).toBe('CST Studio Suite')
      expect(example.file).toMatch(/^[a-z0-9_]+\.rs$/)
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
      expect(example.input).not.toHaveProperty('requirements')
    }
  })

  it('admits an example only while its exact discrete selector matches', () => {
    for (const example of CST_NATIVE_CASES) {
      const exactCheck = example.selectorChecks.find(check => check.equals !== undefined)
      expect(exactCheck, `${example.file} needs an exact activating selector`).toBeDefined()
      expect(valuesAtPath(example.input, exactCheck!.path)).toContain(exactCheck!.equals)

      const changed = { ...example.input, [exactCheck!.path]: '__different_selector__' }
      expect(valuesAtPath(changed, exactCheck!.path)).not.toContain(exactCheck!.equals)
    }
  })

  it('keeps numerical sample values editable without changing operation identity', () => {
    for (const example of CST_NATIVE_CASES) {
      const numericField = findNumericPath(example.input)
      expect(numericField, `${example.file} should expose an editable numeric example parameter`).not.toBeNull()
      if (!numericField) {
        throw new Error(`${example.file} has no editable numeric example parameter`)
      }
      const changedInput = structuredClone(example.input)
      setPath(changedInput, numericField.path, numericField.value + 0.25)
      expect(changedInput.module).toBe(example.module)
      expect(changedInput.backend).toBe('host')
      for (const check of example.selectorChecks) {
        const values = valuesAtPath(changedInput, check.path)
        expect(values.length).toBeGreaterThan(0)
        if (check.equals !== undefined) expect(values).toContain(check.equals)
      }
    }
  })
})

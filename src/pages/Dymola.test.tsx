import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { LocaleProvider } from '../lib/i18n'
import { DYMOLA_NATIVE_CASES } from '../data/dymolaCases'
import { createNativeSoftwareResultReport, matchesNativeSoftwareOperation, parseNativeSoftwareEditorInput } from '../components/NativeSoftwareCases'
import type { SwModuleInput } from '../lib/sim/module-compute'
import { Dymola } from './Dymola'

const admittedModules = new Set(DYMOLA_NATIVE_CASES.map(example => example.module))

function editOneUnselectedNumber(value: unknown, path: string, protectedPaths: Set<string>, edited: { value: boolean }): unknown {
  if (edited.value) return value
  if (typeof value === 'number' && !protectedPaths.has(path)) {
    edited.value = true
    return value + 0.125
  }
  if (Array.isArray(value)) return value.map(item => editOneUnselectedNumber(item, `${path}[]`, protectedPaths, edited))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, editOneUnselectedNumber(item, path ? `${path}.${key}` : key, protectedPaths, edited)]))
  return value
}

describe('Dymola mapped native cases', () => {
  it('admits the exact 62 delivered modules and requires explicit host-f64 inputs', () => {
    expect(DYMOLA_NATIVE_CASES).toHaveLength(62)
    expect(admittedModules.size).toBe(62)
    expect(new Set(DYMOLA_NATIVE_CASES.map(item => item.exampleName)).size).toBe(62)
    for (const example of DYMOLA_NATIVE_CASES) {
      expect(example.module).toBe(example.input.module)
      expect(example.module).toMatch(/^sw-openmodelica-/)
      expect(example.input.backend).toBe('host')
      expect(example.mappedFeature?.length).toBeGreaterThan(0)
      expect(example.limitations.length).toBeGreaterThan(0)
      expect(example.sourceUrls?.length).toBeGreaterThan(0)
      expect(example.selectorChecks?.length).toBeGreaterThan(0)
      expect(parseNativeSoftwareEditorInput(JSON.stringify(example.input), example.module, 'sw-openmodelica-', admittedModules, example.input, example.selectorChecks)?.module).toBe(example.module)
      expect(matchesNativeSoftwareOperation(example, example.input)).toBe(true)
      const edited = { value: false }
      const numericEdit = editOneUnselectedNumber(example.input, '', new Set((example.selectorChecks ?? []).filter(check => check.equals !== undefined).map(check => check.path)), edited)
      if (edited.value) {
        expect(parseNativeSoftwareEditorInput(JSON.stringify(numericEdit), example.module, 'sw-openmodelica-', admittedModules, example.input, example.selectorChecks)?.module).toBe(example.module)
      } else {
        // Some operations intentionally take textual equations, names, or a
        // boolean flag and have no numeric sample in their authored input.
        expect(parseNativeSoftwareEditorInput(JSON.stringify(example.input), example.module, 'sw-openmodelica-', admittedModules, example.input, example.selectorChecks)?.module).toBe(example.module)
      }
    }
  })

  it('rejects a different module, selector, or backend for a saved Dymola case', () => {
    const example = DYMOLA_NATIVE_CASES[0]!
    const selectorCase = { ...example, input: { ...example.input, operation: 'listed' }, selectorChecks: [{ path: 'operation', equals: 'listed' }] }
    expect(parseNativeSoftwareEditorInput(JSON.stringify({ ...selectorCase.input, operation: 'unlisted-operation' }), example.module, 'sw-openmodelica-', admittedModules, selectorCase.input, selectorCase.selectorChecks)).toBeNull()
    expect(parseNativeSoftwareEditorInput(JSON.stringify({ ...example.input, backend: 'cuda' }), example.module, 'sw-openmodelica-', admittedModules, example.input)).toBeNull()
    expect(parseNativeSoftwareEditorInput(JSON.stringify({ ...example.input, backend: undefined }), example.module, 'sw-openmodelica-', admittedModules, example.input)).toBeNull()
    expect(parseNativeSoftwareEditorInput(JSON.stringify({ ...example.input, module: 'sw-openmodelica-unlisted' }), example.module, 'sw-openmodelica-', admittedModules, example.input)).toBeNull()
    expect(matchesNativeSoftwareOperation(selectorCase, { ...selectorCase.input, operation: 'unlisted-operation' })).toBe(false)
    const editable = DYMOLA_NATIVE_CASES.find(item => Array.isArray(item.input.sampleTimes))
    if (editable) {
      const changed = { ...editable.input, sampleTimes: [0, 0.2, 0.9] }
      expect(matchesNativeSoftwareOperation(editable, changed)).toBe(true)
      expect(parseNativeSoftwareEditorInput(JSON.stringify(changed), editable.module, 'sw-openmodelica-', admittedModules, editable.input, editable.selectorChecks)?.module).toBe(editable.module)
    }
  })

  it('renders the categorized catalog, honest scope, and native input editor', () => {
    const markup = renderToStaticMarkup(<LocaleProvider initialLocale="en"><MemoryRouter><Dymola /></MemoryRouter></LocaleProvider>)
    expect(markup).toContain('aria-label="Dymola capability"')
    expect(markup).toContain('aria-label="Dymola input"')
    expect(markup).toContain('Submit W-Sim Dymola case to Host')
    expect(markup).toContain('62 native cases available')
    expect(markup).toContain('EnergyPlus EPW weather preparation')
    expect(markup).toContain('Parse selected EPW with native operation')
    expect(markup).toContain('Mapped Dymola feature:')
    expect(markup).toContain('do not call Dymola')
    expect(markup).toContain('host-f64')
  })

  it('exports a saved result with the submitted input and native-binary requirements', () => {
    const example = DYMOLA_NATIVE_CASES[0]!
    const submittedInput = example.input as unknown as SwModuleInput
    const result = { module: example.module, summary: { steps: 1 }, output: [1, 2] }
    const report = JSON.parse(createNativeSoftwareResultReport(example, submittedInput, result, 'job-dymola-1')) as {
      jobId: string; spec: { requirements: { backends: string[] } }; submittedInput: unknown; result: unknown
    }
    expect(report.jobId).toBe('job-dymola-1')
    expect(report.spec.requirements.backends).toEqual(['cuda'])
    expect(report.submittedInput).toEqual(submittedInput)
    expect(report.result).toEqual(result)
  })
})

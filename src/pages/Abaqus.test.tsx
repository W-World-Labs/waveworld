import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { LocaleProvider } from '../lib/i18n'
import { ABAQUS_NATIVE_CASES } from '../data/abaqusCases'
import { createNativeSoftwareResultReport, parseNativeSoftwareEditorInput } from '../components/NativeSoftwareCases'
import type { SwModuleInput } from '../lib/sim/module-compute'
import { Abaqus } from './Abaqus'

const admittedModules = new Set(ABAQUS_NATIVE_CASES.map(example => example.module))

describe('Abaqus mapped native cases', () => {
  it('keeps the 51 exact CalculiX-origin modules admitted with product, feature and input metadata', () => {
    expect(ABAQUS_NATIVE_CASES).toHaveLength(51)
    expect(new Set(ABAQUS_NATIVE_CASES.map(item => item.module)).size).toBe(51)
    expect(new Set(ABAQUS_NATIVE_CASES.map(item => item.exampleName)).size).toBe(51)
    expect(new Set(ABAQUS_NATIVE_CASES.map(item => item.product))).toEqual(new Set(['Standard', 'Explicit', 'Acoustics', 'Shared']))
    for (const example of ABAQUS_NATIVE_CASES) {
      expect(example.module).toMatch(/^sw-calculix-/)
      expect(example.input.module).toBe(example.module)
      expect(example.abaqusFeature.length).toBeGreaterThan(0)
      expect(example.limitations.length).toBeGreaterThan(0)
      expect(parseNativeSoftwareEditorInput(JSON.stringify(example.input), example.module, 'sw-calculix-', admittedModules)?.module).toBe(example.module)
    }
  })

  it('rejects a foreign module even when it shares the CalculiX prefix', () => {
    expect(parseNativeSoftwareEditorInput(JSON.stringify({ module: 'sw-calculix-unrelated' }), 'sw-calculix-unrelated', 'sw-calculix-', admittedModules)).toBeNull()
  })

  it('renders generic product and analysis filtering, editable inputs, Host submission and Lab import link', () => {
    const markup = renderToStaticMarkup(<LocaleProvider initialLocale="en"><MemoryRouter><Abaqus /></MemoryRouter></LocaleProvider>)
    expect(markup).toContain('aria-label="Abaqus product and analysis filter"')
    expect(markup).toContain('aria-label="Abaqus capability"')
    expect(markup).toContain('aria-label="Abaqus input"')
    expect(markup).toContain('aria-label="Submit W-Sim case to Host"')
    expect(markup).toContain('51 native cases available')
    expect(markup).toContain('not commercial Abaqus execution')
    expect(markup).toContain('/app/lab/import/fem')
  })

  it('keeps the B31 study and adds assembled-matrix import as a separate scoped workflow', () => {
    const markup = renderToStaticMarkup(<LocaleProvider initialLocale="en"><MemoryRouter><Abaqus /></MemoryRouter></LocaleProvider>)
    expect(markup).toContain('51 native cases available')
    expect(markup).toContain('data-testid="abaqus-beam-study"')
    expect(markup).toContain('Abaqus-mapped B31 beam study')
    expect(markup).toContain('data-testid="abaqus-material-point"')
    expect(markup).toContain('standalone *MATERIAL')
    expect(markup).toContain('engineering shear')
    expect(markup).toContain('data-testid="abaqus-matrix-workflow"')
    expect(markup).toContain('data-testid="abaqus-matrix-study"')
    expect(markup).toContain('sw-ansys-modal')
    expect(markup).toContain('Host-f64')
    expect(markup).toContain('does not execute Abaqus')
    expect(markup).toContain('solve a full input deck')
    expect(markup).toContain('claim Ansys/Abaqus parity')
    expect(markup).toContain('does not replace the case catalog')
  })

  it('keeps the tabular amplitude source import separate from full-deck FEM mapping', () => {
    const markup = renderToStaticMarkup(<LocaleProvider initialLocale="en"><MemoryRouter><Abaqus /></MemoryRouter></LocaleProvider>)
    expect(markup).toContain('data-testid="abaqus-amplitude-import"')
    expect(markup).toContain('sw-calculix-amplitude')
    expect(markup).toContain('TOTAL TIME')
    expect(markup).toContain('does not parse other deck cards')
    expect(markup).toContain('apply amplitudes to boundary conditions or loads')
    expect(markup).toContain('aria-label="Abaqus amplitude source file"')
    expect(markup).toContain('Submit imported amplitude to Host')
  })

  it('ties the exported report to the submitted sw-calculix module, input, result and job', () => {
    const submitted = ABAQUS_NATIVE_CASES[0]
    const actualInput: SwModuleInput = { ...submitted.input, module: submitted.module as `sw-${string}`, backend: 'host', editedParameter: 42 }
    const result = { module: submitted.module, values: [1, 2, 3] }
    const report = JSON.parse(createNativeSoftwareResultReport(submitted, actualInput, result, 'job-abaqus-1')) as {
      jobId: string; case: { exampleName: string; module: string }; submittedInput: Record<string, unknown>; result: unknown
    }
    expect(report.jobId).toBe('job-abaqus-1')
    expect(report.case).toEqual({ exampleName: submitted.exampleName, module: submitted.module, selector: submitted.selector })
    expect(report.submittedInput).toEqual(actualInput)
    expect(report.result).toEqual(result)
    expect(() => createNativeSoftwareResultReport(ABAQUS_NATIVE_CASES[1], actualInput, result, 'job-abaqus-1')).toThrow(/does not match/i)
  })
})

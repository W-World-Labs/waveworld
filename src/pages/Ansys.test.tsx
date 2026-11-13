import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { LocaleProvider } from '../lib/i18n'
import { ANSYS_NATIVE_CASES } from '../data/ansysCases'
import { createNativeSoftwareResultReport, parseNativeSoftwareEditorInput } from '../components/NativeSoftwareCases'
import { AnsysThermalStudyPanel } from '../components/AnsysThermalStudyPanel'
import type { SwModuleInput } from '../lib/sim/module-compute'
import { Ansys } from './Ansys'

describe('Ansys native capability examples', () => {
  it('keeps all 56 worker examples discoverable with valid module-bound JSON', () => {
    expect(ANSYS_NATIVE_CASES).toHaveLength(56)
    expect(new Set(ANSYS_NATIVE_CASES.map(item => item.exampleName)).size).toBe(56)
    expect(new Set(ANSYS_NATIVE_CASES.map(item => item.product))).toEqual(new Set([
      'Fluent', 'Mechanical', 'Maxwell', 'HFSS', 'Ansys', 'Icepak', 'optiSLang', 'Rocky', 'Twin Builder',
    ]))
    for (const example of ANSYS_NATIVE_CASES) {
      expect(example.input.module).toBe(example.module)
      expect(parseNativeSoftwareEditorInput(JSON.stringify(example.input), example.module, 'sw-ansys-')?.module).toBe(example.module)
      expect(example.limitations.length).toBeGreaterThan(0)
    }
  })

  it('renders the product filter, search, JSON editor and explicit Host submission control', () => {
    const markup = renderToStaticMarkup(
      <LocaleProvider initialLocale="en"><MemoryRouter><Ansys /></MemoryRouter></LocaleProvider>,
    )
    expect(markup).toContain('aria-label="Ansys product filter"')
    expect(markup).toContain('aria-label="Ansys capability"')
    expect(markup).toContain('aria-label="Ansys input"')
    expect(markup).toContain('aria-label="Submit W-Sim case to Host"')
    expect(markup).toContain('56 native cases available')
    expect(markup).toContain('not replacements for or equivalent implementations')
    expect(markup).toContain('.wbpj, .cas/.dat, or .aedt')
    expect(markup).toContain('data-testid="ansys-thermal-tab"')
    expect(markup).toContain('aria-label="Guided Mechanical thermal conduction and MAPDL import"')
    expect(markup).toContain('aria-label="Ansys workflows"')
    expect(markup).toContain('data-testid="ansys-harmonic-tab"')
    expect(markup).toContain('aria-label="Guided Mechanical harmonic response"')
    expect(markup).toContain('data-testid="ansys-modal-tab"')
    expect(markup).toContain('aria-label="Guided Mechanical modal analysis"')
    expect(markup).toContain('aria-pressed="true"')
  })

  it('renders the thermal study panel with an accessible named section and study controls', () => {
    const markup = renderToStaticMarkup(
      <LocaleProvider initialLocale="en"><MemoryRouter><AnsysThermalStudyPanel /></MemoryRouter></LocaleProvider>,
    )

    expect(markup).toContain('data-testid="ansys-thermal-study"')
    expect(markup).toContain('aria-labelledby="ansys-thermal-study-title"')
    expect(markup).toContain('id="ansys-thermal-study-title"')
    expect(markup).toContain('Mechanical · Thermal study')
    expect(markup).toContain('data-testid="ansys-thermal-study-run"')
    expect(markup).toContain('data-testid="ansys-thermal-study-status"')
  })

  it('exports the captured submitted case and edited input, and rejects mismatched case provenance', () => {
    const submitted = ANSYS_NATIVE_CASES[0]
    const actualInput: SwModuleInput = { ...submitted.input, module: submitted.module as `sw-${string}`, backend: 'host', editedParameter: 42 }
    const result = { module: submitted.module, values: [1, 2, 3] }
    const report = JSON.parse(createNativeSoftwareResultReport(submitted, actualInput, result, 'job-ansys-1')) as {
      jobId: string
      case: { exampleName: string; module: string }
      submittedInput: Record<string, unknown>
      spec: { model: { inline: Record<string, unknown> } }
      result: unknown
    }

    expect(report.jobId).toBe('job-ansys-1')
    expect(report.case).toEqual({ exampleName: submitted.exampleName, module: submitted.module, selector: submitted.selector })
    expect(report.submittedInput).toEqual(actualInput)
    expect(report.spec.model.inline).toMatchObject(actualInput)
    expect(report.result).toEqual(result)
    expect(() => createNativeSoftwareResultReport(ANSYS_NATIVE_CASES[1], actualInput, result, 'job-ansys-1')).toThrow(/does not match/i)
  })
})

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { LocaleProvider } from '../lib/i18n'
import { STAR_CCM_NATIVE_CASES } from '../data/starCcmCases'
import { createNativeSoftwareResultReport, matchesNativeSoftwareOperation, parseNativeSoftwareEditorInput } from '../components/NativeSoftwareCases'
import type { SwModuleInput } from '../lib/sim/module-compute'
import { StarCcm } from './StarCcm'

const curatedModules = new Set(STAR_CCM_NATIVE_CASES.map(example => example.module))

function setPath(record: Record<string, unknown>, path: string, value: unknown) {
  const segments = path.split('.')
  const update = (cursor: unknown, index: number): boolean => {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return false
    const segment = segments[index]!
    const isArray = segment.endsWith('[]')
    const key = isArray ? segment.slice(0, -2) : segment
    const target = cursor as Record<string, unknown>
    if (index === segments.length - 1) {
      target[key] = isArray && Array.isArray(target[key]) ? (target[key] as unknown[]).map(() => value) : value
      return true
    }
    if (isArray) {
      if (!Array.isArray(target[key])) return false
      return (target[key] as unknown[]).some(item => update(item, index + 1))
    }
    return update(target[key], index + 1)
  }
  update(record, 0)
}

describe('STAR-CCM+ mapped native cases', () => {
  it('admits only curated OpenFOAM/SU2 module-operation pairs with inline host inputs', () => {
    expect(STAR_CCM_NATIVE_CASES.length).toBeGreaterThan(0)
    expect(new Set(STAR_CCM_NATIVE_CASES.map(example => example.exampleName)).size).toBe(STAR_CCM_NATIVE_CASES.length)
    for (const example of STAR_CCM_NATIVE_CASES) {
      expect(example.module).toBe(example.input.module)
      expect(example.module.startsWith('sw-openfoam-') || example.module.startsWith('sw-su2-')).toBe(true)
      expect(example.input.backend).toBe('host')
      expect(example.mappedFeature.length).toBeGreaterThan(0)
      expect(example.selectorChecks.length).toBeGreaterThan(0)
      expect(matchesNativeSoftwareOperation(example, example.input)).toBe(true)
      expect(parseNativeSoftwareEditorInput(JSON.stringify(example.input), example.module, 'sw-openfoam-', curatedModules, example.input, example.selectorChecks)?.module).toBe(example.module)
      expect(parseNativeSoftwareEditorInput(JSON.stringify({ ...example.input, backend: 'cuda' }), example.module, 'sw-openfoam-', curatedModules, example.input, example.selectorChecks)).toBeNull()
      const equalityCheck = example.selectorChecks.find(check => check.equals !== undefined)
      if (equalityCheck) {
        const altered = { ...example.input } as Record<string, unknown>
        setPath(altered, equalityCheck.path, `unlisted-${String(equalityCheck.equals)}`)
        expect(matchesNativeSoftwareOperation(example, altered)).toBe(false)
        expect(parseNativeSoftwareEditorInput(JSON.stringify(altered), example.module, 'sw-openfoam-', curatedModules, example.input, example.selectorChecks)).toBeNull()
      }
    }
    expect(parseNativeSoftwareEditorInput(JSON.stringify({ module: 'sw-openfoam-unlisted', backend: 'host', operation: 'x' }), 'sw-openfoam-unlisted', 'sw-openfoam-', curatedModules)).toBeNull()
    expect(parseNativeSoftwareEditorInput(JSON.stringify({ module: 'sw-su2-unlisted', backend: 'host', operation: 'x' }), 'sw-su2-unlisted', 'sw-openfoam-', curatedModules)).toBeNull()
  })

  it('renders the mapped catalog with its vendor and solver limits', () => {
    const markup = renderToStaticMarkup(<LocaleProvider initialLocale="en"><MemoryRouter><StarCcm /></MemoryRouter></LocaleProvider>)
    expect(markup).toContain('STAR-CCM+ capability')
    expect(markup).toContain('Submit W-Sim STAR-CCM+ mapped case to Host')
    expect(markup).toContain('Mapped STAR-CCM+ feature:')
    expect(markup).toContain('do not invoke STAR-CCM+')
    expect(markup).toContain('host-f64')
    expect(markup).toContain('Directional CFL estimate')
  })

  it('keeps report provenance on the submitted case and input', () => {
    const example = STAR_CCM_NATIVE_CASES[0]!
    const submittedInput = example.input as unknown as SwModuleInput
    const result = { module: example.module, output: [0.25], summary: { iterations: 1 } }
    const report = JSON.parse(createNativeSoftwareResultReport(example, submittedInput, result, 'job-star-ccm-1')) as {
      jobId: string; spec: { requirements: { backends: string[] } }; submittedInput: unknown; result: unknown
    }
    expect(report.jobId).toBe('job-star-ccm-1')
    expect(report.spec.requirements.backends).toEqual(['cuda'])
    expect(report.submittedInput).toEqual(submittedInput)
    expect(report.result).toEqual(result)
  })
})

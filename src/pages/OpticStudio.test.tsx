import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { LocaleProvider } from '../lib/i18n'
import { OPTICSTUDIO_NATIVE_CASES } from '../data/opticstudioCases'
import { createNativeSoftwareResultReport, parseNativeSoftwareEditorInput } from '../components/NativeSoftwareCases'
import type { SwModuleInput } from '../lib/sim/module-compute'
import { OpticStudio } from './OpticStudio'

const admittedModules = new Set(OPTICSTUDIO_NATIVE_CASES.map(example => example.module))

describe('OpticStudio native optics cases', () => {
  it('keeps the 40 exact module IDs, explicit host inputs, workflow labels and boundaries', () => {
    expect(OPTICSTUDIO_NATIVE_CASES).toHaveLength(40)
    expect(admittedModules.size).toBe(40)
    expect(new Set(OPTICSTUDIO_NATIVE_CASES.map(item => item.exampleName)).size).toBe(40)
    for (const example of OPTICSTUDIO_NATIVE_CASES) {
      expect(example.module).toBe(example.input.module)
      expect(example.input.backend).toBe('host')
      expect(example.opticStudioFeature.length).toBeGreaterThan(0)
      expect(example.limitations.length).toBeGreaterThan(0)
      expect(parseNativeSoftwareEditorInput(JSON.stringify(example.input), example.module, 'sw-optics-', admittedModules, example.input)?.module).toBe(example.module)
    }
  })

  it('rejects IDs outside the exact OpticStudio catalog even if the prefix is plausible', () => {
    expect(parseNativeSoftwareEditorInput(JSON.stringify({ module: 'sw-optics-unrelated', backend: 'host' }), 'sw-optics-unrelated', 'sw-optics-', admittedModules)).toBeNull()
    expect(parseNativeSoftwareEditorInput(JSON.stringify({ module: 'laser', backend: 'host' }), 'laser', 'sw-optics-', admittedModules)).toBeNull()
  })

  it('pins every edited case to its delivered selector and explicit Host backend', () => {
    const example = OPTICSTUDIO_NATIVE_CASES[0]
    const selectorKey = ['operation', 'method', 'analysis', 'selector', 'algo', 'methodId'].find(key => typeof example.input[key] === 'string')!
    expect(parseNativeSoftwareEditorInput(JSON.stringify({ ...example.input, [selectorKey]: 'unlisted-operation' }), example.module, 'sw-optics-', admittedModules, example.input)).toBeNull()
    expect(parseNativeSoftwareEditorInput(JSON.stringify({ ...example.input, backend: 'cuda' }), example.module, 'sw-optics-', admittedModules, example.input)).toBeNull()
    expect(parseNativeSoftwareEditorInput(JSON.stringify({ ...example.input, backend: undefined }), example.module, 'sw-optics-', admittedModules, example.input)).toBeNull()
  })

  it('renders workflow groups, bounded scope and the exact native editor', () => {
    const markup = renderToStaticMarkup(<LocaleProvider initialLocale="en"><MemoryRouter><OpticStudio /></MemoryRouter></LocaleProvider>)
    expect(markup).toContain('aria-label="Ansys Zemax OpticStudio capability"')
    expect(markup).toContain('aria-label="Ansys Zemax OpticStudio input"')
    expect(markup).toContain('Submit W-Sim OpticStudio case to Host')
    expect(markup).toContain('40 native cases available')
    expect(markup).toContain('Optical workflow:')
    expect(markup).toContain('do not call commercial Ansys Zemax OpticStudio')
    expect(markup).toContain('Sampled wavefront Zernike fit')
    expect(markup).toContain('rho,thetaRadians,wavefront,weight')
  })

  it('binds exported reports to the submitted module, exact input, result and job', () => {
    const submitted = OPTICSTUDIO_NATIVE_CASES.find(item => item.module.startsWith('sw-optics-')) ?? OPTICSTUDIO_NATIVE_CASES[0]
    const actualInput = { ...submitted.input, module: submitted.module as `sw-${string}`, backend: 'host' } as SwModuleInput
    const output = { module: submitted.module, values: [1, 2, 3] }
    const report = JSON.parse(createNativeSoftwareResultReport(submitted, actualInput, output, 'job-opticstudio-1')) as {
      jobId: string; case: { exampleName: string; module: string }; submittedInput: Record<string, unknown>; result: unknown
    }
    expect(report.jobId).toBe('job-opticstudio-1')
    expect(report.case).toEqual({ exampleName: submitted.exampleName, module: submitted.module, selector: submitted.selector })
    expect(report.submittedInput).toEqual(actualInput)
    expect(report.result).toEqual(output)
    expect(() => createNativeSoftwareResultReport(OPTICSTUDIO_NATIVE_CASES[1], actualInput, output, 'job-opticstudio-1')).toThrow(/does not match/i)
  })
})

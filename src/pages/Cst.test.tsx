import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { LocaleProvider } from '../lib/i18n'
import { CST_NATIVE_CASES } from '../data/cstCases'
import { createNativeSoftwareResultReport, matchesNativeSoftwareOperation, parseNativeSoftwareEditorInput } from '../components/NativeSoftwareCases'
import type { ModuleComputeInput } from '../lib/sim/module-compute'
import { Cst } from './Cst'

const curatedModules = new Set(CST_NATIVE_CASES.map(example => example.module))

describe('CST Studio Suite mapped native cases', () => {
  it('admits only catalogued modules, checked selectors, and explicit host inputs', () => {
    expect(CST_NATIVE_CASES.length).toBeGreaterThan(0)
    expect(new Set(CST_NATIVE_CASES.map(example => example.exampleName)).size).toBe(CST_NATIVE_CASES.length)
    for (const example of CST_NATIVE_CASES) {
      expect(example.module).toBe(example.input.module)
      expect(example.input.backend).toBe('host')
      expect(example.mappedFeature.length).toBeGreaterThan(0)
      expect(example.selectorChecks.length).toBeGreaterThan(0)
      expect(matchesNativeSoftwareOperation(example, example.input)).toBe(true)
      expect(parseNativeSoftwareEditorInput(JSON.stringify(example.input), example.module, 'sw-em', curatedModules, example.input, example.selectorChecks)?.module).toBe(example.module)
      expect(parseNativeSoftwareEditorInput(JSON.stringify({ ...example.input, backend: 'cuda' }), example.module, 'sw-em', curatedModules, example.input, example.selectorChecks)).toBeNull()
      expect(parseNativeSoftwareEditorInput(JSON.stringify({ ...example.input, module: `${example.module}-unlisted` }), example.module, 'sw-em', curatedModules, example.input, example.selectorChecks)).toBeNull()
    }
    const operationCase = CST_NATIVE_CASES.find(example => example.selectorChecks.some(check => check.path === 'operation' && check.equals !== undefined))
    if (operationCase) {
      const changed = { ...operationCase.input, operation: 'cst-unlisted-operation' }
      expect(matchesNativeSoftwareOperation(operationCase, changed)).toBe(false)
      expect(parseNativeSoftwareEditorInput(JSON.stringify(changed), operationCase.module, 'sw-em', curatedModules, operationCase.input, operationCase.selectorChecks)).toBeNull()
    }
  })

  it('renders the scope, mapped feature, Host submission and implementation limits', () => {
    const markup = renderToStaticMarkup(<LocaleProvider><MemoryRouter><Cst /></MemoryRouter></LocaleProvider>)
    expect(markup).toContain('三维天线阵列因子研究')
    expect(markup).toContain('3D array factor')
    expect(markup).toContain('Element positions and complex voltage weights')
    expect(markup).toContain('Observation directions')
    expect(markup).toContain('unique-cst-antenna-l2')
    expect(markup).toContain('提交所选 W-Sim 案例到 Host')
    expect(markup).toContain('映射的 CST Studio Suite 功能')
    expect(markup).toContain('不调用 CST')
    expect(markup).toContain('原生二进制传输要求')
  })

  it('stores the submitted case and actual submitted input in result reports', () => {
    const example = CST_NATIVE_CASES[0]!
    const submittedInput = example.input as unknown as ModuleComputeInput
    const result = { module: example.module, output: [0.25], summary: { iterations: 1 } }
    const report = JSON.parse(createNativeSoftwareResultReport(example, submittedInput, result, 'job-cst-1')) as {
      jobId: string; case: { exampleName: string; module: string }; submittedInput: unknown; result: unknown
    }
    expect(report.jobId).toBe('job-cst-1')
    expect(report.case).toMatchObject({ exampleName: example.exampleName, module: example.module })
    expect(report.submittedInput).toEqual(submittedInput)
    expect(report.result).toEqual(result)
  })
})

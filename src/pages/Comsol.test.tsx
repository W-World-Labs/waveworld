import { describe, expect, it, vi } from 'vitest'
import type { ContextType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { COMSOL_NATIVE_CASES } from '../data/comsolCases'
import { LocaleProvider } from '../lib/i18n'
import { ModuleComputeContext } from '../lib/hooks/useModuleCompute'
import {
  Comsol,
  createComsolJobInput,
  createComsolResultReport,
  parseComsolEditorInput,
} from './Comsol'

const example = COMSOL_NATIVE_CASES[0]
const inputText = (input: unknown) => JSON.stringify(input, null, 2)

describe('COMSOL case editor contract', () => {
  it('defaults an omitted backend to host and preserves an explicit backend and edited parameters', () => {
    const original = example.input as Record<string, unknown>
    const withoutBackend = { ...original }
    delete withoutBackend.backend
    const defaulted = parseComsolEditorInput(inputText(withoutBackend), example.module)
    expect(defaulted).toMatchObject({ module: example.module, backend: 'host' })

    const edited = {
      ...original,
      backend: 'auto',
      c: 344,
      customParameter: { enabled: true, samples: [1, 2, 3] },
    }
    const jobInput = createComsolJobInput(example, inputText(edited))
    expect(jobInput).toEqual(edited)
    expect(jobInput.backend).toBe('auto')
    expect(jobInput.c).toBe(344)
    expect(jobInput.customParameter).toEqual({ enabled: true, samples: [1, 2, 3] })
  })

  it('rejects malformed JSON, a different selected module, and unsupported backends', () => {
    expect(parseComsolEditorInput('{', example.module)).toBeNull()
    expect(parseComsolEditorInput(inputText({ ...example.input, module: 'sw-comsol-other' }), example.module)).toBeNull()
    expect(parseComsolEditorInput(inputText({ ...example.input, backend: 'webgpu' }), example.module)).toBeNull()
    expect(() => createComsolJobInput(example, '{')).toThrow(/valid JSON/i)
  })

  it('renders the accessible capability selector, input editor and explicit submit control', () => {
    const markup = renderToStaticMarkup(
      <LocaleProvider initialLocale="en">
        <MemoryRouter>
          <Comsol />
        </MemoryRouter>
      </LocaleProvider>,
    )

    expect(markup).toContain('aria-label="COMSOL capability"')
    expect(markup).toContain('aria-label="COMSOL input"')
    expect(markup).toContain('aria-label="Submit to COMSOL"')
    expect(markup).toContain('COMSOL native cases')
  })

  it('does not assign a saved result to a case without captured submission provenance', () => {
    const edited = { ...example.input, backend: 'cuda', c: 344 }
    const jobInput = createComsolJobInput(example, inputText(edited))
    const result = { module: example.module, result: { value: 1.25 } }
    const initialInput = { ...example.input, backend: (example.input as Record<string, unknown>).backend ?? 'host' }
    const key = JSON.stringify(initialInput)
    const start = vi.fn()
    const execution = {
      target: 'backend' as const,
      setTarget: async () => {},
      register: () => {},
      reportLocalError: () => {},
      connected: true,
      browserAgent: true,
      precision: null,
      result: { key, input: initialInput, output: result },
      status: 'succeeded',
      error: null,
      loginRequired: false,
      jobId: 'job-123',
      busy: false,
      cancelPending: false,
      start,
      stop: async () => true,
      clear: () => {},
    } as unknown as NonNullable<ContextType<typeof ModuleComputeContext>>
    const markup = renderToStaticMarkup(
      <LocaleProvider initialLocale="en">
        <MemoryRouter>
          <ModuleComputeContext.Provider value={execution}>
            <Comsol />
          </ModuleComputeContext.Provider>
        </MemoryRouter>
      </LocaleProvider>,
    )
    const report = JSON.parse(createComsolResultReport(example, jobInput, result, 'job-123')) as {
      jobId: string
      spec: { model: { inline: Record<string, unknown> } }
    }

    expect(markup).not.toContain('aria-label="Download result"')
    expect(start).not.toHaveBeenCalled()
    expect(report.jobId).toBe('job-123')
    expect(report.spec.model.inline).toMatchObject({ module: example.module, backend: 'cuda', c: 344 })
    expect(JSON.parse(createComsolResultReport(example, jobInput, result, 'job-123'))).toMatchObject({
      case: { exampleName: example.exampleName },
      submittedInput: { module: example.module, backend: 'cuda', c: 344 },
    })
  })
})

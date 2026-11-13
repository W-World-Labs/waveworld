// @vitest-environment happy-dom
import { act, createElement, type ContextType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModuleComputeContext } from '../lib/hooks/useModuleCompute'
import { LocaleProvider } from '../lib/i18n'
import type { ModuleComputeInput, ModuleComputeOutput } from '../lib/sim/module-compute'
import { StarCcmTurboStudy } from './StarCcmTurboStudy'

type Execution = NonNullable<ContextType<typeof ModuleComputeContext>>

const nativeOutput = {
  module: 'sw-su2-turbo-metrics',
  result: {
    kind: 'compressor',
    pressureRatioTT: 2,
    correctedMassFlow: 1.5,
    correctedShaftSpeed: 10000,
    isentropicEfficiency: 0.82,
    polytropicEfficiency: 0.8,
  },
} as ModuleComputeOutput

function createExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    target: 'backend',
    setTarget: vi.fn(async () => {}),
    register: vi.fn(),
    reportLocalError: vi.fn(),
    connected: true,
    browserAgent: false,
    precision: null,
    result: null,
    status: 'idle',
    error: null,
    loginRequired: false,
    jobId: null,
    busy: false,
    cancelPending: false,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => true),
    clear: vi.fn(),
    ...overrides,
  } as Execution
}

const roots: Root[] = []
const containers: HTMLElement[] = []

function render(execution: Execution) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  const update = (next: Execution) => act(() => {
    root.render(createElement(LocaleProvider, { initialLocale: 'en', children:
      createElement(MemoryRouter, null,
        createElement(ModuleComputeContext.Provider, { value: next }, createElement(StarCcmTurboStudy))) }))
  })
  update(execution)
  return { container, update }
}

function click(element: Element) {
  act(() => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
}

function submitButton(container: HTMLElement) {
  return [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Submit this point') || button.textContent?.includes('Job running'))!
}

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
})

describe('STAR-CCM+ turbomachinery study compute lifecycle', () => {
  it('binds only a completed result to the frozen submitted input and job ID', () => {
    const start = vi.fn(async () => {})
    const initial = createExecution({ start })
    const { container, update } = render(initial)

    click(submitButton(container))
    expect(start).toHaveBeenCalledOnce()

    const submitted = (initial.register as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
    expect(submitted).toBeTypeOf('function')
    const frozenInput = submitted!() as ModuleComputeInput
    expect(frozenInput).toMatchObject({ module: 'sw-su2-turbo-metrics', backend: 'host', kind: 'compressor' })

    const key = JSON.stringify(frozenInput)
    update(createExecution({
      start,
      result: { key, input: frozenInput, output: nativeOutput },
      status: 'succeeded',
      jobId: 'star-turbo-job-17',
    }))

    expect(container.textContent).toContain('star-turbo-job-17')
    expect(container.textContent).toContain('Saved native job star-turbo-job-17.')
    expect(container.textContent).toContain('2')
    expect(container.textContent).toContain('1 completed points')
    expect(container.querySelector('svg[aria-label="Pressure ratio versus corrected mass flow"]')).not.toBeNull()
    expect(container.querySelector('tbody')?.textContent).toContain('1.5')
  })

  it.each(['cancelled', 'failed'] as const)('does not append results after %s', status => {
    const initial = createExecution()
    const { container, update } = render(initial)
    click(submitButton(container))
    const capture = (initial.register as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]!
    const input = capture()! as ModuleComputeInput
    const key = JSON.stringify(input)

    update(createExecution({
      status,
      jobId: 'star-turbo-job-failed',
      result: { key, input, output: nativeOutput },
    }))

    expect(container.textContent).toContain('0 completed points')
    expect(container.textContent).not.toContain('star-turbo-job-failed')
  })

  it.each([
    ['browser target', { target: 'browser' as const }],
    ['busy execution', { busy: true }],
    ['pending cancellation', { cancelPending: true }],
  ])('suppresses submission for %s', (_label, blocked) => {
    const start = vi.fn(async () => {})
    const { container } = render(createExecution({ ...blocked, start }))

    expect(submitButton(container).disabled).toBe(true)
    click(submitButton(container))
    expect(start).not.toHaveBeenCalled()
  })

  it('ignores a succeeded result whose submitted input no longer matches the pending point', () => {
    const initial = createExecution()
    const { container, update } = render(initial)
    click(submitButton(container))
    const capture = (initial.register as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]!
    const input = capture()! as ModuleComputeInput
    const staleInput = { ...input, rpm: 12000 } as ModuleComputeInput

    update(createExecution({
      status: 'succeeded',
      jobId: 'stale-star-turbo-job',
      result: { key: JSON.stringify(staleInput), input: staleInput, output: nativeOutput },
    }))

    expect(container.textContent).toContain('0 completed points')
    expect(container.textContent).not.toContain('stale-star-turbo-job')
  })
})

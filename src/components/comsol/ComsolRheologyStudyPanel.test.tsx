// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../lib/i18n'
import { ComsolRheologyStudyPanel } from './ComsolRheologyStudyPanel'

const settlement = vi.hoisted(() => ({
  createSettlementClient: vi.fn(),
  runRemoteJob: vi.fn(),
  options: null as null | { baseUrl: string; fetchImpl: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response> },
  client: { requireUser: vi.fn() },
}))

vi.mock('../../lib/hostApi', () => ({
  getStoredUserToken: () => 'test-user-token',
  hostApiBase: () => 'https://host.example.test',
  oidcStartHref: () => '/login',
}))

vi.mock('../../../apps/lab/src/lib/w-sim/settlement-client', () => ({
  createSettlementClient: (options: typeof settlement.options) => {
    settlement.options = options
    return settlement.client
  },
  runRemoteJob: (...args: unknown[]) => settlement.runRemoteJob(...args),
}))

const nativeSuccess = {
  schemaVersion: 1,
  moduleResult: {
    ok: true,
    module: 'sw-comsol-nonnewtonian-b',
    backend: { id: 'host-f64', deviceName: 'host-f64' },
    result: {
      methodId: 'method-algo-rheology-viscosity',
      nSamples: 2,
      samples: [
        { shearRate: 2, effectiveViscosity: 1.5, shearStress: 3, singular: false },
        { shearRate: 4, effectiveViscosity: 1.5, shearStress: 6, singular: false },
      ],
    },
  },
} as const

let roots: Root[] = []
let containers: HTMLElement[] = []

function render() {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => root.render(createElement(LocaleProvider, null, createElement(ComsolRheologyStudyPanel))))
  return { container, root }
}

function click(container: HTMLElement, testId: string) {
  const button = container.querySelector(`[data-testid="${testId}"]`)
  if (!(button instanceof HTMLElement)) throw new Error(`missing ${testId}`)
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function change(container: HTMLElement, selector: string, value: string) {
  const input = container.querySelector(selector)
  if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement)) {
    throw new Error(`missing control: ${selector}`)
  }
  act(() => {
    const prototype = input instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function submitEditor(container: HTMLElement) {
  const button = Array.from(container.querySelectorAll('button')).find(item => item.textContent?.trim() === 'Validate and apply rheology model')
  if (!(button instanceof HTMLElement)) throw new Error('missing rheology validation button')
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => {
  settlement.options = null
  settlement.client.requireUser.mockReset().mockResolvedValue(undefined)
  settlement.runRemoteJob.mockReset().mockImplementation((_client: unknown, _spec: unknown, options: { onStatus: (id: string, status: string) => void }) => {
    options.onStatus('rheology-job-42', 'running')
    return Promise.resolve(nativeSuccess)
  })
  settlement.createSettlementClient.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')))
})

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('COMSOL rheology study panel lifecycle', () => {
  it('binds native results and exported provenance to the submitted draft snapshot', async () => {
    const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rheology-report')
    const { container } = render()
    change(container, '[aria-label="Rheology model"]', 'newtonian')
    change(container, '[aria-label="Dynamic viscosity (Pa·s)"]', '1.5')
    change(container, '[aria-label="Shear-rate CSV (one column)"]', 'shearRate\n2\n4')
    submitEditor(container)
    await settle()

    expect(settlement.client.requireUser).toHaveBeenCalledOnce()
    expect(settlement.runRemoteJob).toHaveBeenCalledOnce()
    const [client, spec, options] = settlement.runRemoteJob.mock.calls[0] as [unknown, Record<string, any>, Record<string, any>]
    expect(client).toBe(settlement.client)
    expect(spec.model.inline).toEqual({
      module: 'sw-comsol-nonnewtonian-b', backend: 'host', method: 'method-algo-rheology-viscosity',
      model: 'newtonian', shearRates: [2, 4], viscosity: 1.5,
    })
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(settlement.options?.baseUrl).toBe('https://host.example.test')
    await settlement.options!.fetchImpl('https://host.example.test/api/v1/jobs', { headers: { 'X-Test': 'present' } })
    const requestInit = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit
    expect(new Headers(requestInit.headers).get('Authorization')).toBe('Bearer test-user-token')

    const results = container.querySelector('[data-testid="comsol-rheology-results"]')
    expect(results?.textContent).toContain('rheology-job-42')
    expect(container.querySelectorAll('[data-testid="comsol-rheology-samples"] tbody tr')).toHaveLength(2)
    expect(results?.textContent).toContain('1.5')
    expect(container.querySelector('[data-testid="comsol-rheology-status"]')?.textContent).toContain('succeeded')

    click(container, 'comsol-rheology-download-json')
    const report = await (objectUrl.mock.calls[0]?.[0] as Blob).text()
    expect(JSON.parse(report)).toMatchObject({
      jobId: 'rheology-job-42',
      draft: { model: 'newtonian', viscosity: 1.5, shearRates: [2, 4], csv: 'shearRate\n2\n4' },
      input: { module: 'sw-comsol-nonnewtonian-b', method: 'method-algo-rheology-viscosity', model: 'newtonian', shearRates: [2, 4] },
      result: { result: { methodId: 'method-algo-rheology-viscosity', nSamples: 2 } },
    })
  })

  it('aborts cancellation and ignores a late settlement from the cancelled job', async () => {
    let resolveJob!: (value: unknown) => void
    settlement.runRemoteJob.mockImplementationOnce((_client: unknown, _spec: unknown, options: { onStatus: (id: string, status: string) => void }) => {
      options.onStatus('rheology-pending', 'running')
      return new Promise(resolve => { resolveJob = resolve })
    })
    const { container } = render()
    submitEditor(container)
    await settle()
    const signal = (settlement.runRemoteJob.mock.calls[0]![2] as { signal: AbortSignal }).signal
    expect(container.querySelector('[data-testid="comsol-rheology-status"]')?.textContent).toContain('rheology-pending')

    click(container, 'comsol-rheology-cancel')
    expect(signal.aborted).toBe(true)
    expect(container.querySelector('[data-testid="comsol-rheology-status"]')?.textContent).toContain('cancelled')
    resolveJob(nativeSuccess)
    await settle()
    expect(container.querySelector('[data-testid="comsol-rheology-results"]')).toBeNull()
    expect(container.querySelector('[data-testid="comsol-rheology-status"]')?.textContent).not.toContain('rheology-pending')
  })

  it('reports authentication, transport, and invalid-result failures without displaying results', async () => {
    const { container } = render()
    settlement.client.requireUser.mockRejectedValueOnce(new Error('Sign in required'))
    submitEditor(container)
    await settle()
    expect(container.querySelector('[data-testid="comsol-rheology-error"]')?.textContent).toContain('Sign in required')
    expect(container.querySelector('[data-testid="comsol-rheology-status"]')?.textContent).toContain('failed')
    expect(container.querySelector('[data-testid="comsol-rheology-results"]')).toBeNull()

    settlement.runRemoteJob.mockRejectedValueOnce(new Error('Host job failed'))
    submitEditor(container)
    await settle()
    expect(container.querySelector('[data-testid="comsol-rheology-error"]')?.textContent).toContain('Host job failed')
    expect(container.querySelector('[data-testid="comsol-rheology-results"]')).toBeNull()

    settlement.runRemoteJob.mockResolvedValueOnce({ schemaVersion: 1, moduleResult: { module: 'wrong-module', result: {} } })
    submitEditor(container)
    await settle()
    expect(container.querySelector('[data-testid="comsol-rheology-error"]')?.textContent).toContain('does not match the requested module')
    expect(container.querySelector('[data-testid="comsol-rheology-results"]')).toBeNull()
  })
})

// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocaleProvider } from '../../lib/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AbaqusOrthotropicElasticImportPanel } from './AbaqusOrthotropicElasticImportPanel'

const settlement = vi.hoisted(() => ({
  createSettlementClient: vi.fn(),
  runRemoteJob: vi.fn(),
  options: null as null | { baseUrl: string; fetchImpl: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response> },
  client: { requireUser: vi.fn() },
}))

vi.mock('../../lib/hostApi', () => ({
  getStoredUserToken: () => 'test-user-token',
  hostApiBase: () => 'https://host.example.test',
}))

vi.mock('../../../apps/lab/src/lib/w-sim/settlement-client', async () => {
  class TaskLoginRequiredError extends Error {
    constructor() { super('发布计算任务需要登录；本机模拟可直接使用。') }
  }
  class RemoteJobCancelError extends Error { jobId = 'orthotropic-job-1' }
  return {
    TaskLoginRequiredError,
    RemoteJobCancelError,
    createSettlementClient: (options: typeof settlement.options) => {
      settlement.options = options
      return settlement.client
    },
    runRemoteJob: (...args: unknown[]) => settlement.runRemoteJob(...args),
  }
})

const source = '*ELASTIC, TYPE=ENGINEERING CONSTANTS\n181000,10300,1000000,0.28,0,0,7150,5958.3333,5958.3333'
const unsupportedSource = `${source}\n*DENSITY\n7.8`

function nativeResult(input: Record<string, any>) {
  const row = input.lines?.[0] ?? input
  const identity = Array.from({ length: 36 }, (_, index) => index % 7 === 0 ? 1 : 0)
  const strain = input.eps ?? [0, 0, 0, 0, 0, 0]
  return {
    module: 'sw-calculix-orthotropic-elastic',
    backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host', precision: 'float64' },
    ok: true,
    result: {
      methodId: 'method-algo-calculix-elastic-card',
      elasticType: 'engineering',
      voigtOrder: ['11', '22', '33', '12', '13', '23'],
      lineCount: 1,
      cardConstants: Object.fromEntries(['E1', 'E2', 'E3', 'nu12', 'nu23', 'nu13', 'G12', 'G13', 'G23'].map(key => [key, row[key]])),
      stiffness: identity,
      compliance: identity,
      mechanicalStrain: strain,
      stress: strain,
    },
  }
}

let roots: Root[] = []
let containers: HTMLElement[] = []

function render() {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root); containers.push(container)
  act(() => root.render(createElement(LocaleProvider, null, createElement(AbaqusOrthotropicElasticImportPanel))))
  return { container }
}

function click(container: HTMLElement, label: string) {
  const button = container.querySelector(`[aria-label="${label}"]`)
  if (!(button instanceof HTMLElement)) throw new Error(`missing ${label}`)
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

async function upload(container: HTMLElement, name: string, contents: string) {
  const input = container.querySelector('[aria-label="Abaqus orthotropic elastic source file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('missing orthotropic elastic file input')
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([contents], name, { type: 'text/plain' })] })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); await Promise.resolve() })
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => {
  settlement.options = null
  settlement.client.requireUser.mockReset().mockResolvedValue(undefined)
  settlement.runRemoteJob.mockReset().mockImplementation(async (_client: unknown, spec: Record<string, any>, options: { onStatus?: (id: string, status: string) => void }) => {
    options.onStatus?.('orthotropic-job-1', 'running')
    return { schemaVersion: 1, summary: { steps: 1 }, moduleResult: nativeResult(spec.model.inline) }
  })
  settlement.createSettlementClient.mockClear()
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:orthotropic-result')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')))
})

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Abaqus orthotropic elastic source import panel', () => {
  it('reads a source file and rejects unrelated deck cards with diagnostics before submission', async () => {
    const { container } = render()
    expect(container.querySelector('[data-testid="abaqus-orthotropic-elastic-import"]')).not.toBeNull()
    expect(container.textContent).toContain('does not assemble a mesh')
    expect((container.querySelector('[aria-label="Submit imported orthotropic material to Host"]') as HTMLButtonElement).disabled).toBe(true)

    await upload(container, 'material.inp', source)
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Read one material card')
    expect((container.querySelector('[aria-label="Submit imported orthotropic material to Host"]') as HTMLButtonElement).disabled).toBe(false)

    await upload(container, 'full-deck.inp', unsupportedSource)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('outside this standalone')
    expect((container.querySelector('[aria-label="Submit imported orthotropic material to Host"]') as HTMLButtonElement).disabled).toBe(true)
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
  })

  it('submits through authenticated Host settlement and exposes a validated result report after settlement', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { container } = render()
    await upload(container, 'material.inp', source)
    click(container, 'Submit imported orthotropic material to Host')
    await settle()

    expect(settlement.client.requireUser).toHaveBeenCalledOnce()
    expect(settlement.runRemoteJob).toHaveBeenCalledOnce()
    const [client, spec, options] = settlement.runRemoteJob.mock.calls[0] as [unknown, Record<string, any>, { signal: AbortSignal }]
    expect(client).toBe(settlement.client)
    expect(spec.kind).toBe('waveworld-module')
    expect(spec.model.inline).toMatchObject({
      module: 'sw-calculix-orthotropic-elastic',
      method: 'method-algo-calculix-elastic-card',
      type: 'engineering',
      backend: 'host',
      eps: [0.001, 0, 0, 0, 0, 0],
    })
    expect(options.signal).toBeInstanceOf(AbortSignal)
    const response = await settlement.options!.fetchImpl('https://host.example.test/api/v1/jobs', { headers: { 'X-Test': 'present' } })
    expect(response.ok).toBe(true)
    const sentInit = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit
    expect(new Headers(sentInit.headers).get('Authorization')).toBe('Bearer test-user-token')

    expect(container.querySelector('[aria-label="Orthotropic elastic material-point result"]')?.textContent).toContain('C, S, and stress checks passed')
    click(container, 'Download orthotropic elastic result')
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(anchorClick).toHaveBeenCalledOnce()
    const report = JSON.parse(await (vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob).text())
    expect(report).toMatchObject({
      jobId: 'orthotropic-job-1',
      sourceWorkflow: 'abaqus-orthotropic-elastic-source-import',
      submittedInput: spec.model.inline,
      source: { keyword: '*ELASTIC' },
      limitations: expect.arrayContaining([expect.stringContaining('does not run Abaqus or CalculiX')]),
    })
  })

  it('clears prior results when a new source is selected and aborts a pending submission', async () => {
    const { container } = render()
    await upload(container, 'material.inp', source)
    click(container, 'Submit imported orthotropic material to Host')
    await settle()
    expect(container.querySelector('[aria-label="Orthotropic elastic material-point result"]')).not.toBeNull()

    let signal: AbortSignal | undefined
    settlement.runRemoteJob.mockImplementationOnce((_client: unknown, _spec: unknown, options: { signal: AbortSignal; onStatus?: (id: string, status: string) => void }) => {
      signal = options.signal
      options.onStatus?.('orthotropic-pending', 'running')
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
    })
    const submitButton = container.querySelector('[aria-label="Submit imported orthotropic material to Host"]') as HTMLButtonElement
    expect(submitButton.disabled).toBe(false)
    click(container, 'Submit imported orthotropic material to Host')
    await settle()
    expect(submitButton.textContent).toContain('Submitting job')
    await upload(container, 'unsupported.inp', unsupportedSource)
    await settle()
    expect(signal?.aborted).toBe(true)
    expect(container.querySelector('[aria-label="Orthotropic elastic material-point result"]')).toBeNull()
    expect((container.querySelector('[aria-label="Submit imported orthotropic material to Host"]') as HTMLButtonElement).disabled).toBe(true)
  })

  it('cancels a pending Host run when stopped and does not show a late result', async () => {
    const { container } = render()
    await upload(container, 'material.inp', source)
    let signal: AbortSignal | undefined
    settlement.runRemoteJob.mockImplementationOnce((_client: unknown, _spec: unknown, options: { signal: AbortSignal; onStatus?: (id: string, status: string) => void }) => {
      signal = options.signal
      options.onStatus?.('orthotropic-pending', 'running')
      return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
    })
    click(container, 'Submit imported orthotropic material to Host')
    await settle()
    expect([...container.querySelectorAll('button')].some(button => button.textContent?.includes('Stop job'))).toBe(true)
    const stop = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Stop job'))
    if (!(stop instanceof HTMLElement)) throw new Error('missing Stop job button')
    act(() => stop.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await settle()
    expect(signal?.aborted).toBe(true)
    expect(container.textContent).toContain('cancelled')
    expect(container.querySelector('[aria-label="Orthotropic elastic material-point result"]')).toBeNull()
  })
})

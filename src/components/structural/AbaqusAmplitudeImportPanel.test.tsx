// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocaleProvider } from '../../lib/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AbaqusAmplitudeImportPanel } from './AbaqusAmplitudeImportPanel'

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
  class RemoteJobCancelError extends Error { jobId = 'amplitude-job-1' }
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

const source = `*AMPLITUDE, NAME=Ramp, TIME=STEP TIME
0., 0., 0.5, 0.25,
1., 1.
*AMPLITUDE, NAME="Hold", TIME=TOTAL TIME, DEFINITION=TABULAR
0, 2, 2, 2`

const nativeResult = (input: Record<string, any>) => ({
  module: 'sw-calculix-amplitude',
  backend: { id: 'host-f64-sw-calculix-amplitude', kind: 'cpu', deviceName: 'w-sim-cuda-host', precision: 'float64' },
  curves: input.curves.map((curve: Record<string, any>) => ({
    name: curve.name, time: curve.time, definition: 'tabular', nPairs: curve.pairs.length,
    tMin: curve.pairs[0][0], tMax: curve.pairs.at(-1)[0],
  })),
  eval: input.curves.flatMap((curve: Record<string, any>) => curve.pairs.map(([t, amplitude]: number[]) => ({ curve: curve.name, t, amplitude }))),
})

let roots: Root[] = []
let containers: HTMLElement[] = []

function render() {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root); containers.push(container)
  act(() => root.render(createElement(LocaleProvider, null, createElement(AbaqusAmplitudeImportPanel))))
  return { container }
}

function click(container: HTMLElement, label: string) {
  const button = container.querySelector(`[aria-label="${label}"]`)
  if (!(button instanceof HTMLElement)) throw new Error(`missing ${label}`)
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function clickText(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label))
  if (!(button instanceof HTMLElement)) throw new Error(`missing button text ${label}`)
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

async function upload(container: HTMLElement, name: string, contents: string) {
  const input = container.querySelector('[aria-label="Abaqus amplitude source file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('missing amplitude file input')
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([contents], name, { type: 'text/plain' })] })
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); await Promise.resolve() })
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => {
  settlement.options = null
  settlement.client.requireUser.mockReset().mockResolvedValue(undefined)
  settlement.runRemoteJob.mockReset().mockImplementation(async (_client: unknown, spec: Record<string, any>, options: { onStatus: (id: string, status: string) => void }) => {
    options.onStatus('amplitude-job-1', 'running')
    return { schemaVersion: 1, summary: { steps: 1 }, moduleResult: nativeResult(spec.model.inline) }
  })
  settlement.createSettlementClient.mockClear()
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:amplitude-result')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')))
})

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Abaqus amplitude source import panel', () => {
  it('renders the standalone workflow and prevents submission after an unsupported deck card', async () => {
    const { container } = render()
    expect(container.querySelector('[data-testid="abaqus-amplitude-import"]')).not.toBeNull()
    expect(container.textContent).toContain('does not parse other deck cards')
    expect(container.textContent).toContain('does not parse other deck cards or apply amplitudes to boundary conditions or loads')
    expect((container.querySelector('[aria-label="Submit imported amplitude to Host"]') as HTMLButtonElement).disabled).toBe(true)

    await upload(container, 'unsupported.inp', '*AMPLITUDE, NAME=A\n0, 0, 1, 1\n*STEP\n')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('outside this standalone')
    expect((container.querySelector('[aria-label="Submit imported amplitude to Host"]') as HTMLButtonElement).disabled).toBe(true)
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
  })

  it('submits the exact shared JobSpec for named step/total-time curves with knot queries and auth', async () => {
    const { container } = render()
    await upload(container, 'amplitudes.inp', source)
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Imported 2 curves and 5 knot queries')
    click(container, 'Submit imported amplitude to Host')
    await settle()

    expect(settlement.client.requireUser).toHaveBeenCalledOnce()
    expect(settlement.runRemoteJob).toHaveBeenCalledOnce()
    const [client, spec, options] = settlement.runRemoteJob.mock.calls[0] as [unknown, Record<string, any>, { signal: AbortSignal }]
    expect(client).toBe(settlement.client)
    expect(spec).toEqual({
      schemaVersion: 1, kind: 'waveworld-module', name: 'sw-calculix-amplitude',
      parameters: { module: 'sw-calculix-amplitude' },
      model: { source: 'inline', inline: {
        module: 'sw-calculix-amplitude', backend: 'host',
        curves: [
          { name: 'Ramp', time: 'step', definition: 'tabular', pairs: [[0, 0], [0.5, 0.25], [1, 1]] },
          { name: 'Hold', time: 'total', definition: 'tabular', pairs: [[0, 2], [2, 2]] },
        ],
        queries: [{ curve: 'Ramp', t: 0 }, { curve: 'Ramp', t: 0.5 }, { curve: 'Ramp', t: 1 }, { curve: 'Hold', t: 0 }, { curve: 'Hold', t: 2 }],
      } },
      run: { maxSteps: 1 }, outputs: {}, requirements: { backends: ['cuda'] },
    })
    expect(options.signal).toBeInstanceOf(AbortSignal)
    const response = await settlement.options!.fetchImpl('https://host.example.test/api/v1/jobs', { headers: { 'X-Test': 'present' } })
    expect(response.ok).toBe(true)
    const sentInit = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit
    expect(new Headers(sentInit.headers).get('Authorization')).toBe('Bearer test-user-token')
    expect(container.querySelector('[aria-label="Imported amplitude result"]')?.textContent).toContain('result matches the current imported input knot by knot')
  })

  it('surfaces login-required and Host errors without presenting a result', async () => {
    const loginError = new (await import('../../../apps/lab/src/lib/w-sim/settlement-client')).TaskLoginRequiredError()
    const { container } = render()
    await upload(container, 'amplitudes.inp', source)
    settlement.client.requireUser.mockRejectedValueOnce(loginError)
    click(container, 'Submit imported amplitude to Host')
    await settle()
    expect(container.querySelector('[data-testid="abaqus-amplitude-login-required"]')?.textContent).toContain('Sign in before submitting')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('发布计算任务需要登录')
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="Imported amplitude result"]')).toBeNull()

    settlement.runRemoteJob.mockRejectedValueOnce(new Error('Host job failed'))
    click(container, 'Submit imported amplitude to Host')
    await settle()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Host job failed')
    expect(container.querySelector('[aria-label="Imported amplitude result"]')).toBeNull()
  })

  it('aborts a pending Host run when stopped and suppresses the late result', async () => {
    const { container } = render()
    await upload(container, 'amplitudes.inp', source)
    settlement.runRemoteJob.mockImplementationOnce((_client: unknown, _spec: unknown, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    }))
    click(container, 'Submit imported amplitude to Host')
    await settle()
    expect((container.querySelector('[aria-label="Submit imported amplitude to Host"]') as HTMLButtonElement).textContent).toContain('Submitting job')
    clickText(container, 'Stop job')
    await settle()
    expect(container.querySelector('[data-testid="abaqus-amplitude-execution-status"]')?.textContent).toContain('cancelled')
    expect(container.querySelector('[aria-label="Imported amplitude result"]')).toBeNull()
  })

  it('ties validated results and JSON export to the submitted source and rejects a mismatched knot', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { container } = render()
    await upload(container, 'amplitudes.inp', source)
    click(container, 'Submit imported amplitude to Host')
    await settle()
    expect(container.querySelector('[aria-label="Imported amplitude result"]')?.textContent).toContain('amplitude-job-1')
    click(container, 'Download amplitude result')
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(anchorClick).toHaveBeenCalledOnce()
    const report = JSON.parse(await (vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob).text())
    const [, spec] = settlement.runRemoteJob.mock.calls[0] as [unknown, Record<string, any>]
    expect(report).toMatchObject({
      jobId: 'amplitude-job-1', sourceWorkflow: 'abaqus-amplitude-source-import', module: 'sw-calculix-amplitude',
      submittedInput: spec.model.inline,
      limitations: expect.arrayContaining([expect.stringContaining('does not run Abaqus or CalculiX')]),
    })

    settlement.runRemoteJob.mockResolvedValueOnce({
      schemaVersion: 1, summary: { steps: 1 },
      moduleResult: { ...nativeResult(spec.model.inline), eval: [{ ...nativeResult(spec.model.inline).eval[0], amplitude: 99 }, ...nativeResult(spec.model.inline).eval.slice(1)] },
    })
    click(container, 'Submit imported amplitude to Host')
    await settle()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('does not match its imported tabular knot')
    expect(container.querySelector('[aria-label="Imported amplitude result"]')).toBeNull()
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
  })
})

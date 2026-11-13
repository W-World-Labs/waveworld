// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocaleProvider } from '../../lib/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CoatingStudyPanel } from './CoatingStudyPanel'
import { createDefaultCoatingStudyDraft } from '../../lib/sim/coating-study-input'

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

const samples = Array.from({ length: 31 }, (_, index) => ({ lambda: 400 + index * 10 })).map(({ lambda }) => ({
  lambda, Rs: 0.1, Ts: 0.8, As: 0.1,
  Rp: 0.2, Tp: 0.7, Ap: 0.1,
  R: 0.15, T: 0.75, A: 0.1, energyResidual: 0,
}))

const nativeSuccess = {
  schemaVersion: 1,
  moduleResult: {
    ok: true,
    module: 'sw-optics-thinfilm',
    backend: { id: 'w-sim-cuda-host', deviceName: 'w-sim-cuda-host' },
    result: {
      ok: true,
      methodId: 'method-algo-thinfilm-rt',
      familyId: 'method-sw-optics-thinfilm',
      polarization: 'unpolarized',
      spectrum: samples,
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
  act(() => root.render(createElement(LocaleProvider, null, createElement(CoatingStudyPanel))))
  return { container }
}

function click(container: HTMLElement, testId: string) {
  const button = container.querySelector(`[data-testid="${testId}"]`)
  if (!(button instanceof HTMLElement)) throw new Error(`missing ${testId}`)
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function change(container: HTMLElement, testId: string, value: string) {
  const input = container.querySelector(`[data-testid="${testId}"]`)
  if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) throw new Error(`missing ${testId}`)
  act(() => {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => {
  settlement.options = null
  settlement.client.requireUser.mockReset().mockResolvedValue(undefined)
  settlement.runRemoteJob.mockReset().mockImplementation(async (_client: unknown, _spec: unknown, options: { onStatus: (id: string, status: string) => void }) => {
    options.onStatus('coating-job-1', 'running')
    return nativeSuccess
  })
  settlement.createSettlementClient.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('thin-film coating study panel', () => {
  it('renders the bounded editor defaults, layer controls, and stated claim limits', () => {
    const { container } = render()
    const defaults = createDefaultCoatingStudyDraft()
    expect(container.textContent).toContain('Thin-film coating spectrum study')
    expect(container.textContent).toContain('no commercial OpticStudio equivalence or GPU execution claim')
    expect((container.querySelector('[data-testid="coating-study-start-wavelength"]') as HTMLInputElement).value).toBe(String(defaults.startWavelength))
    expect((container.querySelector('[data-testid="coating-study-stop-wavelength"]') as HTMLInputElement).value).toBe(String(defaults.stopWavelength))
    expect((container.querySelector('[data-testid="coating-study-samples"]') as HTMLInputElement).value).toBe(String(defaults.samples))
    expect((container.querySelector('[data-testid="coating-study-samples"]') as HTMLInputElement).min).toBe('3')
    expect((container.querySelector('[data-testid="coating-study-samples"]') as HTMLInputElement).max).toBe('401')
    expect((container.querySelector('[data-testid="coating-study-n0"]') as HTMLInputElement).min).toBe('0.1')
    expect((container.querySelector('[data-testid="coating-study-angle"]') as HTMLInputElement).max).toBe('89.9')
    expect((container.querySelector('[data-testid="coating-study-layer-0-d"]') as HTMLInputElement).max).toBe('10000')
    expect(container.querySelectorAll('[data-testid^="coating-study-layer-"][data-testid$="-n"]')).toHaveLength(1)
    expect(container.querySelector('[data-testid="coating-study-run"]')?.textContent).toContain('Run coating study')
  })

  it('submits the exact host inline native input over the CUDA job transport with user authentication', async () => {
    const { container } = render()
    click(container, 'coating-study-run')
    await settle()

    expect(settlement.client.requireUser).toHaveBeenCalledOnce()
    expect(settlement.runRemoteJob).toHaveBeenCalledOnce()
    const [client, spec, options] = settlement.runRemoteJob.mock.calls[0] as [unknown, Record<string, any>, Record<string, any>]
    expect(client).toBe(settlement.client)
    expect(spec.model).toMatchObject({ source: 'inline', inline: {
      module: 'sw-optics-thinfilm', method: 'method-algo-thinfilm-rt', backend: 'host',
      lambda0: 550, wavelengths: [400, 410, 420, 430, 440, 450, 460, 470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600, 610, 620, 630, 640, 650, 660, 670, 680, 690, 700],
      n0: 1, ns: 1.52, ks: 0, theta: 0, polarization: 'unpolarized', layers: [{ n: 2.1, k: 0, d: 100 }],
    } })
    expect(spec.requirements).toEqual({ backends: ['cuda'] })
    expect(options.signal).toBeInstanceOf(AbortSignal)

    const requestInit: RequestInit = { headers: { 'X-Test': 'present' } }
    const response = await settlement.options!.fetchImpl('https://host.example.test/api/v1/jobs', requestInit)
    expect(response.ok).toBe(true)
    const sentInit = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit
    expect(new Headers(sentInit.headers).get('Authorization')).toBe('Bearer test-user-token')
    expect((container.querySelector('[data-testid="coating-study-status"]') as HTMLElement).textContent).toContain('succeeded')
  })

  it('renders returned coefficients and downloads only after validated success', async () => {
    const create = URL.createObjectURL as ReturnType<typeof vi.fn>
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { container } = render()
    expect(container.querySelector('[data-testid="coating-study-results"]')).toBeNull()
    click(container, 'coating-study-run')
    await settle()

    expect(container.querySelectorAll('[data-testid="coating-study-row"]')).toHaveLength(31)
    expect(container.textContent).toContain('w-sim-cuda-host')
    expect(container.textContent).toContain('400')
    expect(container.textContent).toContain('0.15')
    click(container, 'coating-study-csv')
    click(container, 'coating-study-json')
    expect(create).toHaveBeenCalledTimes(2)
    expect(anchorClick).toHaveBeenCalledTimes(2)
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
    anchorClick.mockRestore()
  })

  it('hides an invalid native response and reports the validation error', async () => {
    settlement.runRemoteJob.mockResolvedValueOnce({ ...nativeSuccess, moduleResult: { ...nativeSuccess.moduleResult, backend: { id: 'native-cuda-0', kind: 'cuda', deviceName: 'GPU' } } })
    const { container } = render()
    click(container, 'coating-study-run')
    await settle()
    expect(container.querySelector('[data-testid="coating-study-results"]')).toBeNull()
    expect(container.querySelector('[data-testid="coating-study-error"]')?.textContent).toContain("does not satisfy the requested backend 'host'")
  })

  it('clears completed results on edit and aborts a pending request without showing its late response', async () => {
    const { container } = render()
    click(container, 'coating-study-run')
    await settle()
    expect(container.querySelector('[data-testid="coating-study-results"]')).not.toBeNull()
    change(container, 'coating-study-start-wavelength', '405')
    expect(container.querySelector('[data-testid="coating-study-results"]')).toBeNull()

    let resolveJob!: (value: unknown) => void
    settlement.runRemoteJob.mockImplementationOnce((_client: unknown, _spec: unknown, options: { signal: AbortSignal; onStatus: (id: string, status: string) => void }) => new Promise(resolve => {
      resolveJob = resolve
      options.onStatus('coating-job-pending', 'running')
    }))
    click(container, 'coating-study-run')
    await settle()
    const runOptions = settlement.runRemoteJob.mock.calls[settlement.runRemoteJob.mock.calls.length - 1]![2] as { signal: AbortSignal }
    expect(runOptions.signal.aborted).toBe(false)
    change(container, 'coating-study-start-wavelength', '410')
    expect(runOptions.signal.aborted).toBe(true)
    expect(container.querySelector('[data-testid="coating-study-results"]')).toBeNull()
    resolveJob(nativeSuccess)
    await settle()
    expect(container.querySelector('[data-testid="coating-study-results"]')).toBeNull()
    expect(container.textContent).not.toContain('coating-job-pending')
  })

  it('cancels an active job and suppresses a late success', async () => {
    let resolveJob!: (value: unknown) => void
    settlement.runRemoteJob.mockImplementationOnce(() => new Promise(resolve => { resolveJob = resolve }))
    const { container } = render()
    click(container, 'coating-study-run')
    await settle()
    const signal = (settlement.runRemoteJob.mock.calls[0]![2] as { signal: AbortSignal }).signal
    click(container, 'coating-study-cancel')
    expect(signal.aborted).toBe(true)
    expect(container.querySelector('[data-testid="coating-study-status"]')?.textContent).toContain('cancelled')
    resolveJob(nativeSuccess)
    await settle()
    expect(container.querySelector('[data-testid="coating-study-results"]')).toBeNull()
  })

  it('shows authentication and remote job errors without rendering results', async () => {
    settlement.client.requireUser.mockRejectedValueOnce(new Error('需要登录'))
    const { container } = render()
    click(container, 'coating-study-run')
    await settle()
    expect(container.querySelector('[data-testid="coating-study-error"]')?.textContent).toContain('需要登录')
    expect(container.querySelector('[data-testid="coating-study-results"]')).toBeNull()

    settlement.runRemoteJob.mockRejectedValueOnce(new Error('Host job failed'))
    click(container, 'coating-study-run')
    await settle()
    expect(container.querySelector('[data-testid="coating-study-error"]')?.textContent).toContain('Host job failed')
    expect(container.querySelector('[data-testid="coating-study-results"]')).toBeNull()
  })
})

// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocaleProvider } from '../../lib/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AbaqusMaterialPointPanel } from './AbaqusMaterialPointPanel'

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

vi.mock('./AbaqusMaterialPointResults', () => ({
  AbaqusMaterialPointResults: ({ input, jobId }: { input: Record<string, unknown>; jobId: string | null }) =>
    createElement('div', { 'data-testid': 'abaqus-material-point-results', 'data-yield': input.yieldStress, 'data-job-id': jobId }),
}))

const nativeSuccess = {
  schemaVersion: 1,
  summary: { steps: 1, wallTimeMs: 1 },
  moduleResult: {
    ok: true,
    module: 'sw-calculix-plasticity',
    backend: { id: 'host-f64-sw-calculix-plasticity', kind: 'cpu', deviceName: 'w-sim-cuda-host', precision: 'float64' },
    history: [0, 1].map(step => ({
      step,
      totalStrain: [0.001 * (step + 1), 0, 0, 0, 0, 0],
      stress: [210, 0, 0, 0, 0, 0],
      plasticStrain: [0, 0, 0, 0, 0, 0],
      equivalentPlasticStrain: 0,
      vonMises: 210,
      yielded: false,
    })),
    summary: { steps: 2, yieldedSteps: 0, finalEquivalentPlasticStrain: 0, finalVonMises: 210 },
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
  act(() => root.render(createElement(LocaleProvider, null, createElement(AbaqusMaterialPointPanel))))
  return { container }
}

function click(container: HTMLElement, testId: string) {
  const button = container.querySelector(`[data-testid="${testId}"]`)
  if (!(button instanceof HTMLElement)) throw new Error(`missing ${testId}`)
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function change(container: HTMLElement, testId: string, value: string) {
  const input = container.querySelector(`[data-testid="${testId}"]`)
  if (!(input instanceof HTMLTextAreaElement)) throw new Error(`missing ${testId}`)
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
  settlement.runRemoteJob.mockReset().mockResolvedValue(nativeSuccess)
  settlement.createSettlementClient.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')))
})

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Abaqus material-point panel', () => {
  it('explains its material-point scope and renders the stable editors', () => {
    const { container } = render()
    expect(container.querySelector('[data-testid="abaqus-material-point"]')).not.toBeNull()
    expect(container.textContent).toContain('material point')
    expect(container.textContent).toContain('does not solve mesh equilibrium')
    expect(container.textContent).toContain('does not solve mesh equilibrium or run the full Abaqus solver')
    expect(container.textContent).toContain('no Pa conversion is assumed')
    expect(container.querySelector('[data-testid="abaqus-material-point-card"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="abaqus-material-point-strains"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="abaqus-material-point-run"]')?.textContent).toContain('Run material-point response')
  })

  it('submits parsed material and bounded total-strain increments as an authenticated Host job', async () => {
    const { container } = render()
    change(container, 'abaqus-material-point-card', '*MATERIAL, NAME=Asymmetric\n*ELASTIC\n210000, 0.3\n*PLASTIC\n250, 0\n320, 0.02')
    change(container, 'abaqus-material-point-strains', '[[0.001, -0.002, 0, 0.01, 0, 0], [0, 0, 0, -0.005, 0, 0.001]]')
    click(container, 'abaqus-material-point-run')
    await settle()

    expect(settlement.client.requireUser).toHaveBeenCalledOnce()
    expect(settlement.runRemoteJob).toHaveBeenCalledOnce()
    const [client, spec, options] = settlement.runRemoteJob.mock.calls[0] as [unknown, Record<string, any>, Record<string, any>]
    expect(client).toBe(settlement.client)
    expect(spec.model).toMatchObject({ source: 'inline', inline: {
      module: 'sw-calculix-plasticity', backend: 'host', E: 210000, nu: 0.3, yieldStress: 250,
      hardeningCurve: [[0, 250], [0.02, 320]],
      strainIncrements: [[0.001, -0.002, 0, 0.01, 0, 0], [0, 0, 0, -0.005, 0, 0.001]],
    } })
    expect(spec.model.inline).not.toHaveProperty('hardening')
    expect(options.signal).toBeInstanceOf(AbortSignal)

    const requestInit: RequestInit = { headers: { 'X-Test': 'present' } }
    const response = await settlement.options!.fetchImpl('https://host.example.test/api/v1/jobs', requestInit)
    expect(response.ok).toBe(true)
    const sentInit = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit
    expect(new Headers(sentInit.headers).get('Authorization')).toBe('Bearer test-user-token')
    expect(container.querySelector('[data-testid="abaqus-material-point-results"]')?.getAttribute('data-yield')).toBe('250')
    expect(container.querySelector('[data-testid="abaqus-material-point-status"]')?.textContent).toContain('succeeded')
  })

  it('uses zero linear hardening for a one-row plastic table', async () => {
    const { container } = render()
    change(container, 'abaqus-material-point-card', '*MATERIAL, NAME=ElasticPerfectlyPlastic\n*ELASTIC\n1000, 0.25\n*PLASTIC\n10, 0')
    click(container, 'abaqus-material-point-run')
    await settle()
    const [, spec] = settlement.runRemoteJob.mock.calls[0] as [unknown, Record<string, any>]
    expect(spec.model.inline).toMatchObject({ yieldStress: 10, hardening: 0 })
    expect(spec.model.inline).not.toHaveProperty('hardeningCurve')
  })

  it('rejects increments outside the count, six-component, finite, and magnitude bounds before submission', async () => {
    const { container } = render()
    change(container, 'abaqus-material-point-strains', '[[0, 0, 0, 0, 0, 0.1001]]')
    click(container, 'abaqus-material-point-run')
    await settle()
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="abaqus-material-point-error"]')?.textContent).toContain('magnitude at most 0.1')
  })

  it('rejects a malformed native history before showing results', async () => {
    settlement.runRemoteJob.mockResolvedValueOnce({
      ...nativeSuccess,
      moduleResult: { ...nativeSuccess.moduleResult, history: nativeSuccess.moduleResult.history.slice(0, 1) },
    })
    const { container } = render()
    click(container, 'abaqus-material-point-run')
    await settle()
    expect(container.querySelector('[data-testid="abaqus-material-point-results"]')).toBeNull()
    expect(container.querySelector('[data-testid="abaqus-material-point-error"]')?.textContent).toContain('history length')
  })

  it('rejects a result whose Host backend identity differs', async () => {
    settlement.runRemoteJob.mockResolvedValueOnce({
      ...nativeSuccess,
      moduleResult: { ...nativeSuccess.moduleResult, backend: { ...nativeSuccess.moduleResult.backend, id: 'native-cuda-0' } },
    })
    const { container } = render()
    click(container, 'abaqus-material-point-run')
    await settle()
    expect(container.querySelector('[data-testid="abaqus-material-point-results"]')).toBeNull()
    expect(container.querySelector('[data-testid="abaqus-material-point-error"]')?.textContent).toContain('pinned host-f64 backend')
  })

  it('rejects an outer job summary whose step count differs from the one-step job spec', async () => {
    settlement.runRemoteJob.mockResolvedValueOnce({ ...nativeSuccess, summary: { ...nativeSuccess.summary, steps: 2 } })
    const { container } = render()
    click(container, 'abaqus-material-point-run')
    await settle()
    expect(container.querySelector('[data-testid="abaqus-material-point-results"]')).toBeNull()
    expect(container.querySelector('[data-testid="abaqus-material-point-error"]')?.textContent).toContain('submitted job spec')
  })

  it('keeps the submitted snapshot attached to the completed response', async () => {
    const { container } = render()
    click(container, 'abaqus-material-point-run')
    await settle()
    const saved = container.querySelector('[data-testid="abaqus-material-point-results"]')
    expect(saved?.getAttribute('data-yield')).toBe('250')
    change(container, 'abaqus-material-point-card', '*MATERIAL, NAME=Changed\n*ELASTIC\n1000, 0.2\n*PLASTIC\n15, 0')
    expect(container.querySelector('[data-testid="abaqus-material-point-results"]')).toBeNull()
    click(container, 'abaqus-material-point-run')
    await settle()
    expect(container.querySelector('[data-testid="abaqus-material-point-results"]')?.getAttribute('data-yield')).toBe('15')
  })
})

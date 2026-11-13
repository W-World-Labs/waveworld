// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocaleProvider } from '../../lib/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanteraNasa7ThermoPanel } from './CanteraNasa7ThermoPanel'

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

const prepared = {
  name: 'O2',
  model: 'nasa7',
  'temperature-ranges': [200, 1000, 3500],
  data: [
    [3.782456360, -2.996734160e-3, 9.847302010e-6, -9.681295090e-9, 3.243728370e-12, -1.063943560e3, 3.657675730],
    [3.282537840, 1.483087540e-3, -7.579666690e-7, 2.094705550e-10, -2.167177940e-14, -1.088457720e3, 5.453231290],
  ],
  source: { file: 'ideal-gas.yaml', species: 'O2' },
}
const nativeSuccess = {
  schemaVersion: 1,
  summary: { steps: 1, wallTimeMs: 1 },
  moduleResult: {
    module: 'sw-cantera-nasa-poly',
    method: 'nasa7',
    nTemperatures: 1,
    species: [{
      name: 'O2', model: 'nasa7', temperatureRanges: [200, 1000, 3500],
      nRegions: 2,
      evaluations: [{ T: 900, region: 0, rangeName: 'low', cpOverR: 3.96, hOverRT: 2.61, sOverR: 25.3, cp: 32.9, h: 19550, s: 210.4, gOverRT: -22.69 }],
    }],
  },
} as const
const nasa9Success = {
  schemaVersion: 1,
  summary: { steps: 1, wallTimeMs: 1 },
  moduleResult: {
    module: 'sw-cantera-nasa-poly',
    method: 'nasa9',
    nTemperatures: 1,
    species: [{
      name: 'ALCL3', model: 'nasa9', nRegions: 2, temperatureRanges: [200, 1000, 6000],
      evaluations: [{ T: 900, region: 0, rangeName: 'low', cpOverR: 7.2, hOverRT: -75.4, sOverR: 39.1, cp: 59.9, h: -564000, s: 325.2, gOverRT: -118.8 }],
    }],
  },
} as const

let roots: Root[] = []
let containers: HTMLElement[] = []
const blobs: Blob[] = []

function render() {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => root.render(createElement(LocaleProvider, null, createElement(CanteraNasa7ThermoPanel))))
  return { container }
}

function element<T extends HTMLElement>(container: HTMLElement, testId: string): T {
  const found = container.querySelector(`[data-testid="${testId}"]`)
  if (!(found instanceof HTMLElement)) throw new Error(`missing ${testId}`)
  return found as T
}

function click(container: HTMLElement, testId: string) {
  act(() => element(container, testId).dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function change(container: HTMLElement, testId: string, value: string) {
  const field = element<HTMLInputElement | HTMLTextAreaElement>(container, testId)
  act(() => {
    const setter = field instanceof HTMLTextAreaElement
      ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

function importPrepared(container: HTMLElement, record = prepared) {
  change(container, 'cantera-nasa7-prepared-json', JSON.stringify(record))
  click(container, 'cantera-nasa7-import')
}

beforeEach(() => {
  blobs.length = 0
  settlement.options = null
  settlement.createSettlementClient.mockClear()
  settlement.client.requireUser.mockReset().mockResolvedValue(undefined)
  settlement.runRemoteJob.mockReset().mockImplementation(async (_client: unknown, _spec: unknown, options: { onStatus: (id: string, status: string) => void }) => {
    options.onStatus('job-id', 'running')
    return nativeSuccess
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')))
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    blobs.push(blob as Blob)
    return 'blob:cantera-nasa7-report'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Cantera NASA7 thermo panel', () => {
  it('imports a prepared W-Sim parser record and previews the O2 coefficient ranges', () => {
    const { container } = render()
    importPrepared(container)

    expect(container.textContent).toContain('O2')
    expect(container.textContent).toContain('200')
    expect(container.textContent).toContain('3500')
    expect((element<HTMLInputElement>(container, 'cantera-nasa7-submit')).disabled).toBe(false)
  })

  it('rejects malformed prepared JSON and does not submit a Host job', async () => {
    const { container } = render()
    change(container, 'cantera-nasa7-prepared-json', '{"name":')
    click(container, 'cantera-nasa7-import')

    expect(element(container, 'cantera-nasa7-error').textContent).toMatch(/JSON|parse|invalid/i)
    expect(container.querySelector('[data-testid="cantera-nasa7-submit"]')).toBeNull()
    await settle()
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
  })

  it('submits the selected in-range temperature to the native Host operation and renders returned cp, h, and s', async () => {
    const { container } = render()
    importPrepared(container)
    change(container, 'cantera-nasa7-temperature', '900')
    click(container, 'cantera-nasa7-submit')
    await settle()

    expect(settlement.client.requireUser).toHaveBeenCalledOnce()
    expect(settlement.runRemoteJob).toHaveBeenCalledOnce()
    const [client, spec, options] = settlement.runRemoteJob.mock.calls[0] as [unknown, Record<string, any>, Record<string, any>]
    expect(client).toBe(settlement.client)
    expect(spec.model).toMatchObject({ source: 'inline', inline: {
      module: 'sw-cantera-nasa-poly', backend: 'host', model: 'nasa7', T: [900],
      species: [{ name: 'O2', 'temperature-ranges': [200, 1000, 3500], data: prepared.data }],
    } })
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(element(container, 'cantera-nasa7-results').textContent).toContain('32.9')
    expect(element(container, 'cantera-nasa7-results').textContent).toContain('19550')
    expect(element(container, 'cantera-nasa7-results').textContent).toContain('210.4')
    expect(container.textContent).toContain('Host')
    expect(container.textContent).toContain('O2')

    const requestInit: RequestInit = { headers: { 'X-Test': 'present' } }
    await settlement.options!.fetchImpl('https://host.example.test/api/v1/jobs', requestInit)
    const sentInit = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit
    expect(new Headers(sentInit.headers).get('Authorization')).toBe('Bearer test-user-token')
  })

  it('loads ALCL3 NASA9, previews and submits NASA9 coefficients, renders its result, and exports the captured snapshot', async () => {
    settlement.runRemoteJob.mockImplementationOnce(async (_client: unknown, _spec: unknown, options: { onStatus: (id: string, status: string) => void }) => {
      options.onStatus('nasa9-job-id', 'running')
      return nasa9Success
    })
    const { container } = render()
    click(container, 'cantera-nasa9-load-example')

    expect(container.textContent).toContain('ALCL3 · NASA9')
    expect(container.textContent).toContain('200 · 1000 · 6000')
    const preview = JSON.parse(element(container, 'cantera-nasa7-native-input').textContent ?? 'null') as Record<string, any>
    expect(preview).toMatchObject({
      module: 'sw-cantera-nasa-poly', backend: 'host', model: 'nasa9', T: [300],
      species: [{
        name: 'ALCL3', 'temperature-ranges': [200, 1000, 6000],
        data: [
          [77506.0097, -1440.779717, 14.01744141, -0.00638163124, 5.87167472e-6, -2.908872278e-9, 5.99405089e-13, -65793.4318, -44.94017799],
          [-137863.0916, -55.7920729, 10.04190387, -1.682165339e-5, 3.72466466e-9, -4.27552678e-13, 1.982341329e-17, -73434.0747, -20.45130429],
        ],
      }],
    })
    expect((element<HTMLInputElement>(container, 'cantera-nasa7-submit')).disabled).toBe(false)

    change(container, 'cantera-nasa7-temperature', '900')
    click(container, 'cantera-nasa7-submit')
    await settle()

    const [, spec] = settlement.runRemoteJob.mock.calls[0] as [unknown, Record<string, any>]
    expect(spec.model.inline).toMatchObject({ module: 'sw-cantera-nasa-poly', model: 'nasa9', T: [900] })
    expect(element(container, 'cantera-nasa7-results').textContent).toContain('ALCL3')
    expect(element(container, 'cantera-nasa7-results').textContent).toContain('59.9')
    expect(element(container, 'cantera-nasa7-results').textContent).toContain('-564000')
    expect(element(container, 'cantera-nasa7-results').textContent).toContain('325.2')

    click(container, 'cantera-nasa7-export')
    expect(blobs).toHaveLength(1)
    const report = JSON.parse(await blobs[0]!.text()) as Record<string, any>
    expect(report).toMatchObject({
      jobId: 'nasa9-job-id',
      source: { file: 'Cantera v2.6.0 test/data/nasa9-test.yaml', species: 'ALCL3' },
      selectedTemperatureK: 900,
      submittedInput: { module: 'sw-cantera-nasa-poly', model: 'nasa9', T: [900], species: [{ name: 'ALCL3' }] },
      nativeResult: nasa9Success.moduleResult,
    })
    expect(report.preparedSourceJson).toContain('"model": "nasa9"')
  })

  it('cancels an active Host request and ignores its late native result', async () => {
    let resolveJob!: (value: unknown) => void
    settlement.runRemoteJob.mockImplementationOnce((_client: unknown, _spec: unknown, _options: unknown) => new Promise(resolve => { resolveJob = resolve }))
    const { container } = render()
    importPrepared(container)
    click(container, 'cantera-nasa7-submit')
    await settle()
    const options = settlement.runRemoteJob.mock.calls[0]![2] as { signal: AbortSignal }

    click(container, 'cantera-nasa7-cancel')
    expect(options.signal.aborted).toBe(true)
    expect(element(container, 'cantera-nasa7-status').textContent).toMatch(/cancel/i)
    resolveJob(nativeSuccess)
    await settle()
    expect(container.querySelector('[data-testid="cantera-nasa7-results"]')).toBeNull()
  })

  it('exports provenance, the captured prepared JSON, submitted input, and validated native result', async () => {
    const { container } = render()
    importPrepared(container)
    change(container, 'cantera-nasa7-temperature', '900')
    click(container, 'cantera-nasa7-submit')
    await settle()
    vi.useFakeTimers()
    try {
      click(container, 'cantera-nasa7-export')
      vi.runAllTimers()
    } finally { vi.useRealTimers() }

    expect(blobs).toHaveLength(1)
    expect(blobs[0]!.type).toBe('application/json;charset=utf-8')
    const report = JSON.parse(await blobs[0]!.text()) as Record<string, any>
    expect(report).toMatchObject({
      jobId: expect.any(String),
      source: { file: 'ideal-gas.yaml', species: 'O2' },
      preparedSourceJson: JSON.stringify(prepared),
      submittedInput: {
        module: 'sw-cantera-nasa-poly', model: 'nasa7', T: [900],
        species: [{ name: 'O2', 'temperature-ranges': [200, 1000, 3500], data: prepared.data }],
      },
      nativeResult: nativeSuccess.moduleResult,
    })
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
  })
})

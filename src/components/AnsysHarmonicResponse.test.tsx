// @vitest-environment happy-dom
import { act, createElement, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { LocaleProvider } from '../lib/i18n/LocaleContext'
import { useModuleExecution, ModuleComputeContext } from '../lib/hooks/useModuleCompute'

const settlement = vi.hoisted(() => ({
  createSettlementClient: vi.fn(),
  runRemoteJob: vi.fn(),
  client: { requireUser: vi.fn(), cancel: vi.fn() },
}))

vi.mock('../../apps/lab/src/lib/w-sim/settlement-client', () => ({
  createSettlementClient: (...args: unknown[]) => {
    settlement.createSettlementClient(...args)
    return settlement.client
  },
  RemoteJobCancelError: class RemoteJobCancelError extends Error {
    constructor(public jobId: string) { super('cancel failed') }
  },
  TaskLoginRequiredError: class TaskLoginRequiredError extends Error {
    constructor() { super('Sign in before submitting') }
  },
  runRemoteJob: (...args: unknown[]) => settlement.runRemoteJob(...args),
}))

vi.mock('../lib/hostApi', () => ({
  getStoredUserToken: () => 'test-user-token',
  hostApiBase: () => 'https://host.example.test',
}))

import { AnsysHarmonicResponse } from './AnsysHarmonicResponse'

type RunMode = 'success' | 'pending'
let runMode: RunMode = 'success'
let roots: Root[] = []
let containers: HTMLElement[] = []

function ExecutionHarness({ children }: { children: ReactNode }) {
  const execution = useModuleExecution()
  useEffect(() => {
    if (execution.target === 'browser') void execution.setTarget('backend')
  }, [execution.target])
  return <ModuleComputeContext.Provider value={execution}>{children}</ModuleComputeContext.Provider>
}

function render() {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => root.render(createElement(LocaleProvider, null,
    createElement(MemoryRouter, null,
      createElement(ExecutionHarness, null, createElement(AnsysHarmonicResponse))))))
  return container
}

function click(container: HTMLElement, testId: string) {
  const button = container.querySelector(`[data-testid="${testId}"]`)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button ${testId}`)
  act(() => button.click())
}

function change(container: HTMLElement, testId: string, value: string) {
  const input = container.querySelector(`[data-testid="${testId}"]`)
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing input ${testId}`)
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function nativeResult(input: Record<string, any>) {
  const mass = input.mass
  const stiffness = input.stiffness
  const dampingRatio = input.dampingRatio ?? 0
  const naturalFrequencyHz = Math.sqrt(stiffness / mass) / (2 * Math.PI)
  const sweep = input.freqs.map((freqHz: number, index: number) => ({
    freqHz,
    freqRads: freqHz * 2 * Math.PI,
    response: [{ re: index + 1, im: -(index + 1) / 10 }],
    amplitude: [index + 1],
    phaseDeg: [index === 0 ? 0 : -5 * index],
  }))
  const peakIndex = sweep.length - 1
  return {
    module: 'sw-ansys-harmonic-response',
    familyId: 'method-ansys-harmonic-response',
    methodId: 'method-mode-superposition',
    method: 'mode-superposition',
    system: 'sdof',
    backend: { id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' },
    freqUnit: input.freqUnit,
    nDof: 1,
    nModes: 1,
    excitation: 'force',
    dofs: [0],
    nPoints: input.freqs.length,
    modes: null,
    sdof: {
      mass, stiffness, dampingCoefficient: 2 * dampingRatio * Math.sqrt(stiffness * mass), dampingRatio,
      naturalFrequencyHz, naturalFrequencyRads: Math.sqrt(stiffness / mass), staticResponse: input.force / stiffness,
    },
    sweep,
    peak: { frequencyHz: [sweep[peakIndex].freqHz], amplitude: [sweep[peakIndex].amplitude[0]] },
    ok: true,
  }
}

beforeEach(() => {
  runMode = 'success'
  settlement.client.requireUser.mockReset().mockResolvedValue(undefined)
  settlement.client.cancel.mockReset().mockResolvedValue(undefined)
  settlement.createSettlementClient.mockClear()
  settlement.runRemoteJob.mockReset().mockImplementation(async (_client: unknown, spec: Record<string, any>, options: Record<string, any>) => {
    options.onStatus?.('harmonic-job-1', 'running')
    if (runMode === 'pending') {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    }
    return {
      schemaVersion: 1,
      summary: { steps: 1 },
      moduleResult: nativeResult(spec.model.inline),
    }
  })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ansys-harmonic-report')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
  vi.restoreAllMocks()
})

describe('Ansys SDOF harmonic Host study lifecycle', () => {
  it('renders the guided numeric controls and disables submission without a Host execution', () => {
    window.localStorage.setItem('waveworld-locale', 'en')
    const markup = renderToStaticMarkup(<LocaleProvider><MemoryRouter><AnsysHarmonicResponse /></MemoryRouter></LocaleProvider>)
    expect(markup).toContain('Mechanical · Harmonic response study')
    expect((markup.match(/type="number"/g) ?? [])).toHaveLength(7)
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('Submit to Host')
  })

  it('binds the completed result and both exports to the submitted input snapshot', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const container = render()
    await settle()
    change(container, 'ansys-harmonic-mass', '2.5')
    change(container, 'ansys-harmonic-endFrequency', '12')
    click(container, 'ansys-harmonic-submit')
    await settle()

    expect(settlement.client.requireUser).toHaveBeenCalledOnce()
    expect(settlement.runRemoteJob).toHaveBeenCalledOnce()
    const [, spec, options] = settlement.runRemoteJob.mock.calls[0] as [unknown, Record<string, any>, Record<string, any>]
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(spec.model.inline).toMatchObject({
      module: 'sw-ansys-harmonic-response', backend: 'host', system: 'sdof', freqUnit: 'hz',
      mass: 2.5, stiffness: 1000, dampingRatio: 0.05, force: 1, freqs: [0, 4, 8, 12],
    })
    expect(container.querySelector('[data-testid="ansys-harmonic-result"]')?.textContent).toContain('harmonic-job-1')

    click(container, 'ansys-harmonic-download-json')
    click(container, 'ansys-harmonic-download-csv')
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
    expect(anchorClick).toHaveBeenCalledTimes(2)
    const json = JSON.parse(await (vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob).text())
    expect(json.submittedInput).toEqual(spec.model.inline)
    expect(json.result).toEqual(nativeResult(spec.model.inline))
    expect(json.jobId).toBe('harmonic-job-1')
    const csv = await (vi.mocked(URL.createObjectURL).mock.calls[1]?.[0] as Blob).text()
    expect(csv).toContain('12')

    change(container, 'ansys-harmonic-mass', '3')
    expect(container.querySelector('[data-testid="ansys-harmonic-result"]')).toBeNull()
    expect(container.querySelector('[data-testid="ansys-harmonic-download-json"]')).toBeNull()
  })

  it('aborts a pending Host run on cancel and suppresses a stale completion after editing', async () => {
    const container = render()
    await settle()
    runMode = 'pending'
    click(container, 'ansys-harmonic-submit')
    await settle()
    const [, , options] = settlement.runRemoteJob.mock.calls[0] as [unknown, unknown, Record<string, any>]
    expect(options.signal.aborted).toBe(false)
    change(container, 'ansys-harmonic-stiffness', '250')
    expect(options.signal.aborted).toBe(true)
    await settle()
    expect(container.querySelector('[data-testid="ansys-harmonic-result"]')).toBeNull()

    click(container, 'ansys-harmonic-submit')
    await settle()
    const [, , cancelOptions] = settlement.runRemoteJob.mock.calls[1] as [unknown, unknown, Record<string, any>]
    click(container, 'ansys-harmonic-cancel')
    await settle()
    expect(cancelOptions.signal.aborted).toBe(true)
    expect(container.querySelector('[data-testid="ansys-harmonic-result"]')).toBeNull()

    runMode = 'success'
    click(container, 'ansys-harmonic-submit')
    await settle()
    expect(container.querySelector('[data-testid="ansys-harmonic-result"]')).not.toBeNull()
    click(container, 'ansys-harmonic-reset')
    expect(container.querySelector('[data-testid="ansys-harmonic-result"]')).toBeNull()
  })
})

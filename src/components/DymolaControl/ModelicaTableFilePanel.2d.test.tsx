// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocaleProvider } from '../../lib/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelicaTableFilePanel } from './ModelicaTableFilePanel'

const settlement = vi.hoisted(() => ({
  createSettlementClient: vi.fn(),
  runRemoteJob: vi.fn(),
  client: { requireUser: vi.fn() },
}))

vi.mock('../../lib/hostApi', () => ({
  getStoredUserToken: () => 'test-user-token',
  hostApiBase: () => 'https://host.example.test',
  oidcStartHref: () => '/login',
}))

vi.mock('../../../apps/lab/src/lib/w-sim/settlement-client', () => ({
  createSettlementClient: (...args: unknown[]) => {
    settlement.createSettlementClient(...args)
    return settlement.client
  },
  runRemoteJob: (...args: unknown[]) => settlement.runRemoteJob(...args),
}))

const TABLE_FILE = `#1\ndouble Surface(3, 3)\n  0 1 2\n0 10 20\n1 11 21\n`
const nativeSuccess = {
  schemaVersion: 1,
  moduleResult: {
    ok: true,
    module: 'sw-openmodelica-table',
    backend: { id: 'w-sim-cuda-host' },
    result: {
      operation: 'bilinear2d',
      nU1: 2,
      nU2: 2,
      extrapolation: 'linear',
      uv: [[0.25, 0.5], [0.75, 1.5]],
      y: [123.456, 234.567],
      dyDu1: [3.25, 4.5],
      dyDu2: [6.75, 8.125],
      methodId: 'method-combi-table-2d-bilinear',
      familyId: 'method-table-interpolation',
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
  act(() => root.render(createElement(LocaleProvider, null, createElement(ModelicaTableFilePanel))))
  return { container }
}

function click(container: HTMLElement, testId: string) {
  const button = container.querySelector(`[data-testid="${testId}"]`)
  if (!(button instanceof HTMLElement)) throw new Error(`missing ${testId}`)
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function clickButtonText(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(element => element.textContent?.trim() === label)
  if (!(button instanceof HTMLElement)) throw new Error(`missing button: ${label}`)
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function change(container: HTMLElement, testId: string, value: string) {
  const control = container.querySelector(`[data-testid="${testId}"]`)
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) throw new Error(`missing ${testId}`)
  act(() => {
    const prototype = control instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(control, value)
    control.dispatchEvent(new Event('input', { bubbles: true }))
    control.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

async function upload(container: HTMLElement, contents = TABLE_FILE) {
  vi.spyOn(File.prototype, 'text').mockResolvedValue(contents)
  const input = container.querySelector('[data-testid="modelica-table-file-input"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('missing Modelica table file input')
  const file = new File([contents], 'surface.txt', { type: 'text/plain' })
  act(() => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await settle()
}

async function choose2dAndAddPair(container: HTMLElement, u1: string, u2: string) {
  change(container, 'modelica-table-mode', '2d')
  change(container, 'modelica-table-u1-query-input', u1)
  change(container, 'modelica-table-u2-query-input', u2)
  click(container, 'modelica-table-u1-query-add')
}

beforeEach(() => {
  settlement.client.requireUser.mockReset().mockResolvedValue(undefined)
  settlement.createSettlementClient.mockClear()
  settlement.runRemoteJob.mockReset().mockResolvedValue(nativeSuccess)
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

describe('Modelica 2-D imported table panel', () => {
  it('keeps 1-D as the default mode and exposes parsed named matrix selection', async () => {
    const { container } = render()
    expect((container.querySelector('[data-testid="modelica-table-mode"]') as HTMLSelectElement).value).toBe('1d')
    await upload(container)

    const matrix = container.querySelector('[data-testid="modelica-table-select"]') as HTMLSelectElement
    expect(Array.from(matrix.options, option => option.value)).toContain('Surface')
    expect(matrix.value).toBe('Surface')
    change(container, 'modelica-table-mode', '2d')
    expect(container.querySelector('[data-testid="modelica-table-u1-query-input"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="modelica-table-u2-query-input"]')).not.toBeNull()
  })

  it('submits explicit paired coordinates and the selected matrix to native bilinear2d', async () => {
    const { container } = render()
    await upload(container)
    await choose2dAndAddPair(container, '0.25', '0.5')
    await choose2dAndAddPair(container, '0.75', '1.5')
    click(container, 'modelica-table-run')
    await settle()

    expect(settlement.client.requireUser).toHaveBeenCalledOnce()
    expect(settlement.runRemoteJob).toHaveBeenCalledOnce()
    const [, spec] = settlement.runRemoteJob.mock.calls[0] as [unknown, Record<string, any>]
    expect(spec.model.inline).toMatchObject({
      module: 'sw-openmodelica-table',
      backend: 'host',
      operation: 'bilinear2d',
      table2d: [[0, 1, 2], [0, 10, 20], [1, 11, 21]],
      uv: [[0.25, 0.5], [0.75, 1.5]],
      extrapolation: 'linear',
    })
  })

  it('shows native values and both partial derivatives, then exports returned data', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    settlement.runRemoteJob.mockResolvedValueOnce({
      ...nativeSuccess,
      moduleResult: {
        ...nativeSuccess.moduleResult,
        result: {
          ...nativeSuccess.moduleResult.result,
          uv: [[0.25, 0.5]],
          y: [123.456],
          dyDu1: [3.25],
          dyDu2: [6.75],
        },
      },
    })
    const { container } = render()
    await upload(container)
    await choose2dAndAddPair(container, '0.25', '0.5')
    click(container, 'modelica-table-run')
    await settle()

    const result = container.querySelector('[data-testid="modelica-table-result"]')
    expect(result).not.toBeNull()
    expect(result?.textContent).toContain('dy/du1')
    expect(result?.textContent).toContain('dy/du2')
    expect(result?.textContent).toContain('123.456')
    expect(result?.textContent).toContain('method-combi-table-2d-bilinear')
    clickButtonText(container, 'Download CSV')
    clickButtonText(container, 'Download JSON report')
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
    expect(anchorClick).toHaveBeenCalledTimes(2)
    anchorClick.mockRestore()
  })

  it('rejects repeated axis coordinates and nonnumeric query pairs before submission', async () => {
    const { container } = render()
    await upload(container, `#1\ndouble Surface(3, 3)\n0 0 1\n0 10 20\n1 11 21\n`)
    expect(container.querySelector('[data-testid="modelica-table-run"]')?.hasAttribute('disabled')).toBe(true)
    expect(container.textContent).toContain('strictly ascending')

    await upload(container)
    change(container, 'modelica-table-mode', '2d')
    change(container, 'modelica-table-u1-query-input', 'NaN')
    change(container, 'modelica-table-u2-query-input', '0.5')
    expect(container.querySelector('[data-testid="modelica-table-u1-query-add"]')?.hasAttribute('disabled')).toBe(true)
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
  })

  it('cancels a pending query and ignores its late native response', async () => {
    let resolveJob!: (value: unknown) => void
    settlement.runRemoteJob.mockImplementationOnce(() => new Promise(resolve => { resolveJob = resolve }))
    const { container } = render()
    await upload(container)
    await choose2dAndAddPair(container, '0.25', '0.5')
    click(container, 'modelica-table-run')
    await settle()
    const signal = (settlement.runRemoteJob.mock.calls[0]![2] as { signal: AbortSignal }).signal

    click(container, 'modelica-table-cancel')
    expect(signal.aborted).toBe(true)
    expect(container.querySelector('[data-testid="modelica-table-job-status"]')?.textContent).toContain('cancelled')
    resolveJob(nativeSuccess)
    await settle()
    expect(container.querySelector('[data-testid="modelica-table-result"]')).toBeNull()
  })

  it('invalidates a pending result when the selected source matrix changes', async () => {
    let resolveJob!: (value: unknown) => void
    settlement.runRemoteJob.mockImplementationOnce(() => new Promise(resolve => { resolveJob = resolve }))
    const { container } = render()
    await upload(container, `${TABLE_FILE}double Other(3, 3)\n0 1 2\n0 2 4\n1 3 5\n`)
    await choose2dAndAddPair(container, '0.25', '0.5')
    click(container, 'modelica-table-run')
    await settle()
    const signal = (settlement.runRemoteJob.mock.calls[0]![2] as { signal: AbortSignal }).signal
    change(container, 'modelica-table-select', 'Other')
    expect(signal.aborted).toBe(true)
    resolveJob(nativeSuccess)
    await settle()
    expect(container.querySelector('[data-testid="modelica-table-result"]')).toBeNull()
  })
})

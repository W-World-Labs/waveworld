// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocaleProvider } from '../../lib/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgfReferenceGlassImport } from './AgfReferenceGlassImport'

const settlement = vi.hoisted(() => ({
  createSettlementClient: vi.fn(),
  runRemoteJob: vi.fn(),
  client: { requireUser: vi.fn() },
}))

vi.mock('../../lib/hostApi', () => ({
  getStoredUserToken: () => 'test-user-token',
  hostApiBase: () => 'https://host.example.test',
}))

vi.mock('../../../apps/lab/src/lib/w-sim/settlement-client', () => ({
  createSettlementClient: (...args: unknown[]) => {
    settlement.createSettlementClient(...args)
    return settlement.client
  },
  runRemoteJob: (...args: unknown[]) => settlement.runRemoteJob(...args),
}))

const sellmeierGlass = [
  'NM SYNTHETIC-CROWN 2 0 1.520000 60.000000 0 0',
  'LD 0.300000 2.500000',
  'CD 1.000000 0.010000 0.200000 0.020000 0.500000 0.030000',
].join('\n')

const nativeSuccess = {
  schemaVersion: 1,
  summary: { steps: 1, wallTimeMs: 1 },
  moduleResult: {
    module: 'sellmeier',
    result: {
      lam_um: 0.6328,
      terms: [{ B: 1, C: 0.01 }, { B: 0.2, C: 0.02 }, { B: 0.5, C: 0.03 }],
      n: 1.612345,
      n2: 2.59966,
      methodId: 'method-algo-sellmeier-n-multi',
      familyId: 'method-sellmeier',
    },
    backend: { id: 'host-f64' },
  },
} as const

let roots: Root[] = []
let containers: HTMLElement[] = []

function render(onApply = vi.fn()) {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => root.render(createElement(LocaleProvider, null, createElement(AgfReferenceGlassImport, {
    surfaces: [{}, {}] as any,
    onApply,
  }))))
  return { container, onApply }
}

function button(container: HTMLElement, testId: string) {
  const element = container.querySelector(`[data-testid="${testId}"]`)
  if (!(element instanceof HTMLElement)) throw new Error(`missing ${testId}`)
  return element
}

function click(container: HTMLElement, testId: string) {
  act(() => button(container, testId).dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function change(container: HTMLElement, testId: string, value: string) {
  const input = container.querySelector(`[data-testid="${testId}"]`)
  if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) throw new Error(`missing ${testId}`)
  act(() => {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

async function loadGlass(container: HTMLElement, source = sellmeierGlass) {
  const input = container.querySelector('[data-testid="agf-glass-file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('missing AGF file input')
  const file = new File([source], 'reference.agf', { type: 'text/plain' })
  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(source) })
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })))
  await settle()
}

beforeEach(() => {
  settlement.createSettlementClient.mockClear()
  settlement.client.requireUser.mockReset().mockResolvedValue(undefined)
  settlement.runRemoteJob.mockReset().mockResolvedValue(nativeSuccess)
  vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')))
})

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AGF Sellmeier reference import', () => {
  it('loads supported AGF records, submits the selected wavelength through the host job path, and displays the returned index', async () => {
    const { container } = render()
    await loadGlass(container)

    expect(container.textContent).toContain('SYNTHETIC-CROWN')
    change(container, 'agf-sellmeier-wavelength', '0.6328')
    click(container, 'agf-sellmeier-compute')
    await settle()

    expect(settlement.client.requireUser).toHaveBeenCalledOnce()
    expect(settlement.runRemoteJob).toHaveBeenCalledOnce()
    const [client, spec] = settlement.runRemoteJob.mock.calls[0] as [unknown, Record<string, any>]
    expect(client).toBe(settlement.client)
    expect(spec.model).toMatchObject({ source: 'inline', inline: {
      module: 'sellmeier', method: 'method-algo-sellmeier-n-multi', backend: 'host',
      lam_um: 0.6328,
      terms: [{ B: 1, C: 0.01 }, { B: 0.2, C: 0.02 }, { B: 0.5, C: 0.03 }],
    } })
    expect(container.querySelector('[data-testid="agf-sellmeier-result"]')?.textContent).toContain('1.612345')
  })

  it('applies the returned scalar with wavelength provenance and preserves the NM d-line fallback', async () => {
    const { container, onApply } = render()
    await loadGlass(container)
    change(container, 'agf-glass-surface', '1')
    change(container, 'agf-sellmeier-wavelength', '0.6328')
    click(container, 'agf-sellmeier-compute')
    await settle()
    click(container, 'agf-sellmeier-apply')

    expect(onApply).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'SYNTHETIC-CROWN', nd: 1.52 }), 1.612345, 0.6328)

    onApply.mockClear()
    click(container, 'agf-glass-apply-dline')
    expect(onApply).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'SYNTHETIC-CROWN', nd: 1.52 }))
  })

  it('rejects unsupported formula metadata without submitting a job and keeps the d-line value usable', async () => {
    const { container, onApply } = render()
    await loadGlass(container, sellmeierGlass.replace('CROWN 2 ', 'CROWN 3 '))
    expect((button(container, 'agf-sellmeier-compute') as HTMLButtonElement).disabled).toBe(true)
    expect(container.textContent).toMatch(/formula ID 2|formula 3/i)

    click(container, 'agf-glass-apply-dline')
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
    expect(onApply).toHaveBeenCalledWith(0, expect.objectContaining({ nd: 1.52 }))
  })

  it('reports host job failures and invalid Sellmeier metadata', async () => {
    const { container } = render()
    await loadGlass(container)
    settlement.runRemoteJob.mockRejectedValueOnce(new Error('Host Sellmeier job failed'))
    click(container, 'agf-sellmeier-compute')
    await settle()
    expect(container.querySelector('[data-testid="agf-glass-status"]')?.textContent).toContain('Host Sellmeier job failed')
    expect(container.querySelector('[data-testid="agf-sellmeier-result"]')).toBeNull()

    const invalid = render()
    await loadGlass(invalid.container, sellmeierGlass.replace('LD 0.300000 2.500000', 'LD 2.500000 0.300000'))
    expect((button(invalid.container, 'agf-sellmeier-compute') as HTMLButtonElement).disabled).toBe(true)
    expect(invalid.container.textContent).toMatch(/valid CD coefficients and LD limits/i)
  })
})

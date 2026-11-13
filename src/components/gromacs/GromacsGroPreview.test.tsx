// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../lib/i18n'
import { GromacsGroPreview } from './GromacsGroPreview'

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

vi.mock('../../../apps/lab/src/lib/w-sim/settlement-client', () => ({
  createSettlementClient: (options: typeof settlement.options) => {
    settlement.options = options
    return settlement.client
  },
  runRemoteJob: (...args: unknown[]) => settlement.runRemoteJob(...args),
}))

const source = [
  'water box',
  '6',
  ...Array.from({ length: 6 }, (_, index) => groAtom(index + 1)),
  '1.00000 1.00000 1.00000',
  '',
].join('\n')

function groAtom(number: number) {
  return `${String(1).padStart(5)}${'SOL'.padStart(5)}${`O${number}`.padStart(5)}${String(number).padStart(5)}${'0.10000'.padStart(8)}${'0.20000'.padStart(8)}${'0.30000'.padStart(8)}`
}

function previewAtom(number: number) {
  return { resid: 1, resname: 'SOL', atom: `O${number}`, number, posNm: [number / 10, 0.2, 0.3], velNmPs: null }
}

function nativeSuccess(result: unknown = { files: { gro: {
  title: 'water box', natoms: 6, boxNm: [1, 1, 1], nVelocities: 0,
  atomsPreview: [1, 2, 3, 4, 5].map(previewAtom),
} } }) {
  return {
    schemaVersion: 1,
    summary: { steps: 1, wallTimeMs: 1 },
    moduleResult: { module: 'sw-gromacs-inputdeck', result },
  }
}

const roots: Root[] = []
const containers: HTMLElement[] = []

function render() {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => root.render(createElement(LocaleProvider, null, createElement(GromacsGroPreview))))
  return { container }
}

function click(container: HTMLElement, name: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(name))
  if (!button) throw new Error(`missing button: ${name}`)
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function changeSource(container: HTMLElement, value: string) {
  const textarea = container.querySelector('#gromacs-gro-source')
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('GROMACS source textarea is missing')
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => {
  settlement.options = null
  settlement.createSettlementClient.mockClear()
  settlement.client.requireUser.mockReset().mockResolvedValue(undefined)
  settlement.runRemoteJob.mockReset().mockResolvedValue(nativeSuccess())
  vi.stubGlobal('fetch', vi.fn(async () => new Response('ok')))
})

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('GROMACS .gro preview workflow', () => {
  it('rejects mixed position-only and position-plus-velocity atom rows before auth', () => {
    const { container } = render()
    const position = groAtom(1)
    const withVelocity = `${position}${'0.01000'.padStart(8)}${'0.02000'.padStart(8)}${'0.03000'.padStart(8)}`
    changeSource(container, ['mixed velocities', '2', position, withVelocity, '1 1 1', ''].join('\n'))

    click(container, 'Read coordinates')

    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/velocities|velocity|速度/i)
    expect(settlement.createSettlementClient).not.toHaveBeenCalled()
    expect(settlement.client.requireUser).not.toHaveBeenCalled()
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
  })

  it('rejects a second frame before auth', () => {
    const { container } = render()
    const twoFrames = ['frame one', '1', groAtom(1), '1 1 1', 'frame two', '1', groAtom(2), '1 1 1', ''].join('\n')
    changeSource(container, twoFrames)

    click(container, 'Read coordinates')

    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/one .*frame|单帧/i)
    expect(settlement.createSettlementClient).not.toHaveBeenCalled()
    expect(settlement.client.requireUser).not.toHaveBeenCalled()
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
  })

  it('rejects a serialized GRO module input over 1 MiB before auth or Host submission', () => {
    const { container } = render()
    const atomCount = 16_000
    const oversized = ['large frame', String(atomCount), ...Array.from({ length: atomCount }, () => 'x'.repeat(68)), '1 1 1', ''].join('\n')
    expect(new Blob([JSON.stringify({ module: 'sw-gromacs-inputdeck', backend: 'host', gro: oversized })]).size).toBeGreaterThan(1 << 20)
    changeSource(container, oversized)

    click(container, 'Read coordinates')

    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/1 MiB|1 MiB|1,048,576/i)
    expect(settlement.createSettlementClient).not.toHaveBeenCalled()
    expect(settlement.client.requireUser).not.toHaveBeenCalled()
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
  })

  it('submits the exact source and renders the five native preview rows', async () => {
    const { container } = render()
    changeSource(container, source)

    click(container, 'Read coordinates')
    await settle()

    expect(settlement.client.requireUser).toHaveBeenCalledOnce()
    expect(settlement.runRemoteJob).toHaveBeenCalledOnce()
    const jobSpec = (settlement.runRemoteJob.mock.calls[0] as unknown[])[1] as { model: { inline: unknown } }
    expect(jobSpec.model.inline).toEqual({ module: 'sw-gromacs-inputdeck', backend: 'host', gro: source })
    const rows = [...container.querySelectorAll('tbody tr')]
    expect(rows).toHaveLength(5)
    expect(rows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent))).toEqual([
      ['1 SOL', 'O1', '1', '0.1', '0.2', '0.3', '—'],
      ['1 SOL', 'O2', '2', '0.2', '0.2', '0.3', '—'],
      ['1 SOL', 'O3', '3', '0.3', '0.2', '0.3', '—'],
      ['1 SOL', 'O4', '4', '0.4', '0.2', '0.3', '—'],
      ['1 SOL', 'O5', '5', '0.5', '0.2', '0.3', '—'],
    ])
  })

  it('fails closed when a native preview atom has malformed coordinates', async () => {
    settlement.runRemoteJob.mockResolvedValueOnce(nativeSuccess({ files: { gro: {
      title: 'water box', natoms: 6, boxNm: [1, 1, 1], nVelocities: 0,
      atomsPreview: [{ ...previewAtom(1), posNm: [0.1, Number.NaN, 0.3] }],
    } } }))
    const { container } = render()
    changeSource(container, source)

    click(container, 'Read coordinates')
    await settle()

    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/unsupported shape/i)
    expect(container.querySelector('tbody')).toBeNull()
    expect(container.textContent).not.toContain('Download original .gro')
  })
})

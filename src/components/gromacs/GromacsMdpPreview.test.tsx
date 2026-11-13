// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../../lib/i18n'
import { GromacsMdpPreview } from './GromacsMdpPreview'

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

const source = 'integrator = md\ndt = 0.002\nDT = 0.002\nnsteps = 500\nnstxout = 10\n'

function nativeSuccess(result: unknown = {
  methodId: 'method-gromacs-deck-ingest',
  familyId: 'family-gromacs-inputdeck',
  ok: true,
  diagnostics: [],
  files: { mdp: {
    nEntries: 4, cppDirectives: 0, duplicateKeys: 1, integrator: 'md', dtPs: 0.002,
    nsteps: 500, tinitPs: 0, outputKeys: [{ key: 'nstxout', nst: 10 }],
  } },
  runPlan: {
    integrator: 'md', dtPs: 0.002, nsteps: 500, tinitPs: 0, totalTimePs: 1,
    natoms: null, outputs: [{ key: 'nstxout', nst: 10, frames: 50 }],
  },
}) {
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
  act(() => root.render(createElement(LocaleProvider, null, createElement(GromacsMdpPreview))))
  return { container }
}

function click(container: HTMLElement, name: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(name))
  if (!button) throw new Error(`missing button: ${name}`)
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function changeSource(container: HTMLElement, value: string) {
  const textarea = container.querySelector('#gromacs-mdp-source')
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('GROMACS MDP source textarea is missing')
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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
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

describe('GROMACS .mdp preview workflow', () => {
  it('rejects conflicting case-insensitive duplicate keys before auth or Host submission', () => {
    const { container } = render()
    changeSource(container, 'integrator = md\ndt = 0.002\nDT = 0.003\nnsteps = 500\n')

    click(container, 'Prepare preview on Host')

    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/line 3.*conflicting duplicate.*dt/i)
    expect(settlement.createSettlementClient).not.toHaveBeenCalled()
    expect(settlement.client.requireUser).not.toHaveBeenCalled()
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
  })

  it('authenticates before submitting the exact MDP input to the Host operation', async () => {
    const { container } = render()
    changeSource(container, source)

    click(container, 'Prepare preview on Host')
    await settle()

    expect(settlement.client.requireUser).toHaveBeenCalledOnce()
    expect(settlement.runRemoteJob).toHaveBeenCalledOnce()
    const jobSpec = (settlement.runRemoteJob.mock.calls[0] as unknown[])[1] as { model: { inline: unknown } }
    expect(jobSpec.model.inline).toEqual({ module: 'sw-gromacs-inputdeck', backend: 'host', mdp: source })
    expect(container.querySelector('[aria-label="GROMACS MDP setup summary"]')).not.toBeNull()
    expect(container.textContent).toContain('1 duplicate keys')

    const fetchImpl = settlement.options?.fetchImpl
    expect(fetchImpl).toBeTypeOf('function')
    await fetchImpl!('https://host.example.test/api/v1/jobs')
    const request = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit
    expect(new Headers(request.headers).get('Authorization')).toBe('Bearer test-user-token')
  })

  it('aborts a pending submission on cancel and ignores a response that arrives afterward', async () => {
    const pending = deferred<ReturnType<typeof nativeSuccess>>()
    settlement.runRemoteJob.mockReturnValueOnce(pending.promise)
    const { container } = render()
    changeSource(container, source)

    click(container, 'Prepare preview on Host')
    await settle()
    const options = settlement.runRemoteJob.mock.calls[0]?.[2] as { signal: AbortSignal }
    click(container, 'Cancel request')
    expect(options.signal.aborted).toBe(true)
    expect(container.querySelector('[role="status"]')?.textContent).toBe('cancelled')

    await act(async () => { pending.resolve(nativeSuccess()); await pending.promise })
    await settle()
    expect(container.querySelector('[aria-label="GROMACS MDP setup summary"]')).toBeNull()
    expect(container.querySelector('[role="status"]')?.textContent).toBe('cancelled')
  })

  it('discards a pending native response after the MDP text changes', async () => {
    const pending = deferred<ReturnType<typeof nativeSuccess>>()
    settlement.runRemoteJob.mockReturnValueOnce(pending.promise)
    const { container } = render()
    changeSource(container, source)

    click(container, 'Prepare preview on Host')
    await settle()
    const options = settlement.runRemoteJob.mock.calls[0]?.[2] as { signal: AbortSignal }
    changeSource(container, 'integrator = steep\ndt = 0.001\nnsteps = 10\n')
    expect(options.signal.aborted).toBe(true)

    await act(async () => { pending.resolve(nativeSuccess()); await pending.promise })
    await settle()
    expect(container.querySelector('[aria-label="GROMACS MDP setup summary"]')).toBeNull()
    expect(container.querySelector('[role="status"]')?.textContent).toBe('idle')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows native failure and rejects a malformed native MDP preview result', async () => {
    settlement.runRemoteJob.mockRejectedValueOnce(new Error('native GROMACS admission failed'))
    const { container } = render()
    changeSource(container, source)

    click(container, 'Prepare preview on Host')
    await settle()
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/native GROMACS admission failed/i)
    expect(container.querySelector('[aria-label="GROMACS MDP setup summary"]')).toBeNull()

    changeSource(container, source)
    settlement.runRemoteJob.mockResolvedValueOnce(nativeSuccess({
      methodId: 'method-gromacs-deck-ingest', familyId: 'family-gromacs-inputdeck', ok: true,
      diagnostics: [], files: { mdp: { nEntries: -1 } }, runPlan: {},
    }))
    click(container, 'Prepare preview on Host')
    await settle()
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/unsupported shape/i)
    expect(container.querySelector('[aria-label="GROMACS MDP setup summary"]')).toBeNull()
  })

  it('enforces the shared 1 MiB serialized sw-module input cap before authentication', () => {
    const { container } = render()
    // JSON escapes each NUL as six characters, so this source stays within the
    // component's 512 KiB text limit while its serialized module input exceeds 1 MiB.
    const oversized = `title = ${'\0'.repeat(180_000)}`
    expect(new Blob([oversized]).size).toBeLessThan(512 * 1024)
    expect(JSON.stringify({ module: 'sw-gromacs-inputdeck', backend: 'host', mdp: oversized }).length).toBeGreaterThan(1 << 20)
    changeSource(container, oversized)

    click(container, 'Prepare preview on Host')

    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/1 MiB|1,048,576/i)
    expect(settlement.createSettlementClient).not.toHaveBeenCalled()
    expect(settlement.client.requireUser).not.toHaveBeenCalled()
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
  })
})

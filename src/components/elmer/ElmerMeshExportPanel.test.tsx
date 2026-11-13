// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LocaleProvider } from '../../lib/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElmerMeshExportPanel } from './ElmerMeshExportPanel'

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

vi.mock('../../../apps/lab/src/lib/w-sim/settlement-client', async () => {
  class TaskLoginRequiredError extends Error {}
  class RemoteJobCancelError extends Error { jobId = 'mesh-job-1' }
  return {
    TaskLoginRequiredError,
    RemoteJobCancelError,
    createSettlementClient: () => settlement.client,
    runRemoteJob: (...args: unknown[]) => settlement.runRemoteJob(...args),
  }
})

const validInput = {
  module: 'sw-elmer-mesh-convert-b',
  backend: 'host',
  nodes: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
  elements: [{ elmer: 504, body: 1, nodes: [1, 2, 3, 4] }],
}

const nativeOutput = {
  ok: true,
  module: 'sw-elmer-mesh-convert-b',
  result: {
    ok: true,
    methodId: 'method-algo-elmergrid-convert',
    nodeCount: 4,
    elementCount: 1,
    elementCodes: [504],
    native: {
      nodes: '1 0 0 0 0\n2 0 1 0 0\n3 0 0 1 0\n4 0 0 0 1\n',
      elements: '1 1 504 1 2 3 4\n',
    },
  },
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
  act(() => root.render(createElement(LocaleProvider, null, createElement(ElmerMeshExportPanel))))
  return container
}

function setInput(container: HTMLElement, input: unknown) {
  const textarea = container.querySelector('[data-testid="elmer-mesh-json-input"]')
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Elmer mesh input is missing')
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, typeof input === 'string' ? input : JSON.stringify(input))
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function button(container: HTMLElement, testId: string): HTMLButtonElement {
  const found = container.querySelector(`[data-testid="${testId}"]`)
  if (!(found instanceof HTMLButtonElement)) throw new Error(`missing button ${testId}`)
  return found
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => {
  settlement.client.requireUser.mockReset().mockResolvedValue(undefined)
  settlement.runRemoteJob.mockReset().mockImplementation(async () => ({
    schemaVersion: 1,
    summary: { steps: 1 },
    moduleResult: nativeOutput,
  }))
  settlement.createSettlementClient.mockClear()
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:elmer-mesh-result')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
  vi.restoreAllMocks()
})

describe('Elmer native mesh export panel', () => {
  it.each([
    ['wrong module', { ...validInput, module: 'sw-other-module' }],
    ['wrong backend', { ...validInput, backend: 'cuda' }],
  ])('blocks %s during preflight', (_label, input) => {
    const container = render()
    setInput(container, input)

    expect(button(container, 'elmer-mesh-submit').disabled).toBe(true)
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('valid bounded JSON')
    expect(settlement.client.requireUser).not.toHaveBeenCalled()
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
    expect(container.querySelector('input[type="file"]')).toBeNull()
    expect(container.textContent).toContain('It does not import an Elmer mesh')
  })

  it('blocks projected output above the row bound before remote submission', () => {
    const container = render()
    const input = {
      ...validInput,
      nodes: Array.from({ length: 5000 }, () => [0, 0, 0]),
      extrude: { layers: 1000 },
    }
    setInput(container, input)

    expect(button(container, 'elmer-mesh-submit').disabled).toBe(true)
    expect(settlement.client.requireUser).not.toHaveBeenCalled()
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
  })

  it('rejects oversized inline JSON before remote submission', () => {
    const container = render()
    setInput(container, `${JSON.stringify(validInput)}${' '.repeat((1 << 20))}`)

    expect(button(container, 'elmer-mesh-submit').disabled).toBe(true)
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
  })

  it('validates native output and downloads all four Elmer files', async () => {
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const downloaded: string[] = []
    anchorClick.mockImplementation(function (this: HTMLAnchorElement) { downloaded.push(this.download) })
    const container = render()
    setInput(container, validInput)

    act(() => button(container, 'elmer-mesh-submit').click())
    await settle()

    expect(settlement.client.requireUser).toHaveBeenCalledOnce()
    expect(settlement.runRemoteJob).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="status"]')?.textContent).toContain('succeeded')
    expect(container.textContent).toContain('does not import an Elmer mesh')

    for (const name of ['header', 'nodes', 'elements', 'boundary']) {
      act(() => button(container, `elmer-mesh-download-${name}`).click())
    }
    expect(downloaded).toEqual(['mesh.header', 'mesh.nodes', 'mesh.elements', 'mesh.boundary'])
    expect(URL.createObjectURL).toHaveBeenCalledTimes(4)
    const blobs = vi.mocked(URL.createObjectURL).mock.calls.map(([blob]) => blob as Blob)
    expect(await blobs[0]!.text()).toBe('4 1 0\n1\n504 1\n')
    expect(await blobs[1]!.text()).toBe('1 -1 0 0 0\n2 -1 1 0 0\n3 -1 0 1 0\n4 -1 0 0 1\n')
    expect(await blobs[2]!.text()).toBe('1 1 504 1 2 3 4\n')
    expect(await blobs[3]!.text()).toBe('')
  })

  it('rejects malformed native rows and presents no downloads', async () => {
    settlement.runRemoteJob.mockResolvedValueOnce({
      schemaVersion: 1,
      summary: { steps: 1 },
      moduleResult: {
        ...nativeOutput,
        result: { ...nativeOutput.result, native: { ...nativeOutput.result.native, nodes: '1 0 0 0 NaN\n' } },
      },
    })
    const container = render()
    setInput(container, validInput)

    act(() => button(container, 'elmer-mesh-submit').click())
    await settle()

    expect(container.querySelector('[role="status"]')?.textContent).toContain('failed')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('do not match the reported node count')
    expect(container.querySelector('[data-testid="elmer-mesh-download-header"]')).toBeNull()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })
})

// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const settlement = vi.hoisted(() => ({
  createSettlementClient: vi.fn(),
  runRemoteJob: vi.fn(),
  options: null as null | { baseUrl: string; fetchImpl: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response> },
  client: {
    requireUser: vi.fn(),
    cancel: vi.fn(),
  },
}))

vi.mock('../../../../../src/lib/hostApi', () => ({
  getStoredUserToken: () => 'test-user-token',
  hostApiBase: () => 'https://host.example.test',
}))

vi.mock('../../lib/w-sim/settlement-client', () => ({
  createSettlementClient: (options: typeof settlement.options) => {
    settlement.options = options
    return settlement.client
  },
  RemoteJobCancelError: class RemoteJobCancelError extends Error {
    constructor(public jobId: string) { super('cancel failed') }
  },
  runRemoteJob: (...args: unknown[]) => settlement.runRemoteJob(...args),
}))

import { FdsNamelistWorkflow } from './fds-namelist-workflow'

const nativeSuccess = {
  schemaVersion: 1,
  summary: { steps: 1, wallTimeMs: 1 },
  moduleResult: {
    module: 'sw-fds-namelist',
    id: 'sw-fds-namelist',
    ok: true,
    familyId: 'method-fds-namelist',
    methodId: 'method-fds-namelist-parse',
    backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
    result: {
      groups: [{ index: 0, name: 'HEAD', keys: { CHID: 'fixture' }, keyCount: 1 }],
      groupCount: 1,
    },
  },
}

let roots: Root[] = []
let containers: HTMLElement[] = []

function mount(element: ReactNode = createElement(FdsNamelistWorkflow)) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => root.render(element))
  return container
}

function chooseFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('missing FDS file input')
  act(() => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function clickButton(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing button: ${label}`)
  act(() => button.click())
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

function fdsFile(content: string, name = 'synthetic.fds') {
  return new File([content], name, { type: 'text/plain', lastModified: 1234 })
}

beforeEach(() => {
  settlement.options = null
  settlement.client.requireUser.mockReset().mockResolvedValue(undefined)
  settlement.client.cancel.mockReset().mockResolvedValue(undefined)
  settlement.createSettlementClient.mockClear()
  settlement.runRemoteJob.mockReset().mockResolvedValue(nativeSuccess)
})

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
  vi.restoreAllMocks()
})

describe('FDS namelist file-to-job workflow', () => {
  it('builds the selected parser module, method, and host backend into an inline JobSpec', async () => {
    const container = mount()
    const content = "&HEAD CHID='room' /\n&TAIL /\n"
    chooseFile(container, fdsFile(content))
    clickButton(container, '上传并解析 namelist')
    await settle()

    expect(settlement.client.requireUser).toHaveBeenCalledOnce()
    expect(settlement.runRemoteJob).toHaveBeenCalledOnce()
    const [client, spec, options] = settlement.runRemoteJob.mock.calls[0] as [unknown, Record<string, any>, Record<string, any>]
    expect(client).toBe(settlement.client)
    expect(spec.kind).toBe('waveworld-module')
    expect(spec.model).toMatchObject({ source: 'inline', inline: {
      module: 'sw-fds-namelist', method: 'method-fds-namelist-parse', backend: 'host', content,
    } })
    expect(spec.parameters.module).toBe('sw-fds-namelist')
    expect(spec.requirements?.backends).toEqual(['cuda'])
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(container.textContent).toContain('已验证的 parser 结果')
    expect(container.textContent).toContain('&HEAD')
  })

  it('rejects whitespace-delimited numeric vectors before authentication or settlement', async () => {
    const container = mount()
    chooseFile(container, fdsFile('&OBST XB=0 1 0 1 0 1 /\n'))
    clickButton(container, '上传并解析 namelist')
    await settle()

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('空格分隔的数值向量')
    expect(settlement.client.requireUser).not.toHaveBeenCalled()
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
  })

  it('rejects raw blank vector slots before authentication or settlement', async () => {
    const container = mount()
    chooseFile(container, fdsFile('&SURF XB=0,1,0,1,0,1,, /\n'))
    clickButton(container, '上传并解析 namelist')
    await settle()

    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/省略.*项|连续逗号/)
    expect(settlement.client.requireUser).not.toHaveBeenCalled()
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
  })

  it('rejects an inline JobSpec larger than 1 MiB before authentication or settlement', async () => {
    const container = mount()
    const prefix = '&HEAD /\n'
    const content = prefix + 'x'.repeat((1 << 20) - prefix.length - 64)
    const file = fdsFile(content, 'near-limit.fds')
    expect(file.size).toBeLessThanOrEqual(1 << 20)
    chooseFile(container, file)
    clickButton(container, '上传并解析 namelist')
    await settle()

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('超过 1 MiB 上限')
    expect(settlement.client.requireUser).not.toHaveBeenCalled()
    expect(settlement.runRemoteJob).not.toHaveBeenCalled()
  })

  it('submits through the existing settlement client and exports only the validated response', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fds-report')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    let downloadedName = ''
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedName = this.download
    })
    const container = mount()
    chooseFile(container, fdsFile('&HEAD CHID=\'export-me\' /\n', 'case.fds'))
    clickButton(container, '上传并解析 namelist')
    await settle()

    expect(container.textContent).toContain('w-sim-cuda-host / host-f64')
    expect(settlement.runRemoteJob).toHaveBeenCalledOnce()
    clickButton(container, '导出已验证的 JSON 结果')

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledOnce()
    expect(anchorClick).toHaveBeenCalledOnce()
    expect(downloadedName).toBe('case-namelist.json')
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob
    const report = JSON.parse(await blob.text())
    expect(report).toMatchObject({
      source: { name: 'case.fds', sizeBytes: expect.any(Number), lastModifiedMs: 1234 },
      jobId: 'completed',
      module: 'sw-fds-namelist',
      method: 'method-fds-namelist-parse',
      result: nativeSuccess.moduleResult,
    })
  })

  it('rejects mismatched method, backend, and malformed group responses before rendering or export', async () => {
    const invalidResults = [
      { ...nativeSuccess, moduleResult: { ...nativeSuccess.moduleResult, module: 'sw-other', id: 'sw-other' } },
      { ...nativeSuccess, moduleResult: { ...nativeSuccess.moduleResult, familyId: 'method-other' } },
      { ...nativeSuccess, moduleResult: { ...nativeSuccess.moduleResult, methodId: 'method-other' } },
      { ...nativeSuccess, moduleResult: { ...nativeSuccess.moduleResult, backend: { ...nativeSuccess.moduleResult.backend, deviceName: 'other-host' } } },
      { ...nativeSuccess, moduleResult: { ...nativeSuccess.moduleResult, result: { ...nativeSuccess.moduleResult.result, groupCount: 2 } } },
      { ...nativeSuccess, moduleResult: { ...nativeSuccess.moduleResult, result: { ...nativeSuccess.moduleResult.result, groups: [{ ...nativeSuccess.moduleResult.result.groups[0]!, keyCount: 2 }] } } },
      { ...nativeSuccess, moduleResult: { ...nativeSuccess.moduleResult, result: { ...nativeSuccess.moduleResult.result, groups: [{ ...nativeSuccess.moduleResult.result.groups[0]!, index: 1 }] } } },
    ]

    for (const invalid of invalidResults) {
      settlement.runRemoteJob.mockResolvedValueOnce(invalid)
      const container = mount()
      chooseFile(container, fdsFile('&HEAD /\n'))
      clickButton(container, '上传并解析 namelist')
      await settle()

      expect(container.querySelector('[role="alert"]')).not.toBeNull()
      expect(container.textContent).not.toContain('已验证的 parser 结果')
      expect([...container.querySelectorAll('button')].some(button => button.textContent?.includes('导出已验证的 JSON 结果'))).toBe(false)
      act(() => roots.pop()?.unmount())
      containers.pop()?.remove()
    }
  })
})

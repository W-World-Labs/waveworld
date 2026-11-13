// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CstArrayFactorStudy } from './CstArrayFactorStudy'

const workflow = vi.hoisted(() => ({
  createSettlementClient: vi.fn(),
  runRemoteJob: vi.fn(),
  client: { requireUser: vi.fn() },
  resultParser: vi.fn(),
  editorProps: null as null | { value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void },
  resultProps: null as null | Record<string, unknown>,
}))

vi.mock('../../lib/hostApi', () => ({
  getStoredUserToken: () => 'user-token',
  hostApiBase: () => 'https://host.example.test',
  oidcStartHref: () => '/login',
}))
vi.mock('../../lib/i18n', () => ({ useLocale: () => ({ locale: 'en' }) }))
vi.mock('../../../apps/lab/src/lib/w-sim/settlement-client', () => ({
  createSettlementClient: (...args: unknown[]) => { workflow.createSettlementClient(...args); return workflow.client },
  runRemoteJob: (...args: unknown[]) => workflow.runRemoteJob(...args),
}))
vi.mock('../../lib/sim/cst-array-factor-result', () => ({
  readCstArrayFactorResult: (...args: unknown[]) => workflow.resultParser(...args),
}))
vi.mock('./CstArrayFactorInput', () => ({
  CstArrayFactorInput: (props: typeof workflow.editorProps) => {
    workflow.editorProps = props
    return createElement('div', { 'data-testid': 'array-editor' })
  },
}))
vi.mock('./CstArrayFactorResults', () => ({
  CstArrayFactorResults: (props: typeof workflow.resultProps) => {
    workflow.resultProps = props
    return createElement('div', { 'data-testid': 'array-results' })
  },
}))

const parsed = {
  backend: 'host-f64', frequencyHz: 300_000_000, elementCount: 2, directionCount: 2,
  normalization: 'sum of excitation magnitudes; isotropic uncoupled elements', samples: [],
}
const remote = { schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, moduleResult: {} }
let roots: Root[] = []
let containers: HTMLElement[] = []

function render() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => root.render(createElement(CstArrayFactorStudy)))
  return container
}

function click(container: HTMLElement, id: string) {
  const button = container.querySelector(`[data-testid="${id}"]`)
  if (!(button instanceof HTMLElement)) throw new Error(`missing ${id}`)
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}

beforeEach(() => {
  workflow.createSettlementClient.mockClear()
  workflow.runRemoteJob.mockReset().mockResolvedValue(remote)
  workflow.client.requireUser.mockReset().mockResolvedValue(undefined)
  workflow.resultParser.mockReset().mockReturnValue(parsed)
  workflow.editorProps = null
  workflow.resultProps = null
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  for (const container of containers) container.remove()
  containers = []
})

describe('CstArrayFactorStudy lifecycle', () => {
  it('authenticates, parses the returned operation, and retains submitted input in result provenance', async () => {
    const container = render()
    click(container, 'cst-array-factor-submit')
    await settle()

    expect(workflow.client.requireUser).toHaveBeenCalledOnce()
    expect(workflow.runRemoteJob).toHaveBeenCalledOnce()
    const [client, spec, options] = workflow.runRemoteJob.mock.calls[0] as [unknown, Record<string, any>, Record<string, any>]
    expect(client).toBe(workflow.client)
    expect(spec.model.inline).toMatchObject({ module: 'antenna-l2', operation: 'cst-array-factor', backend: 'host' })
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(workflow.resultParser).toHaveBeenCalledOnce()
    expect(container.querySelector('[data-testid="array-results"]')).not.toBeNull()
    expect(workflow.resultProps).toMatchObject({ result: parsed, backend: { id: 'host-f64' } })
    expect(workflow.resultProps?.submittedInput).toEqual(spec.model.inline)
  })

  it('keeps the exact input snapshot and explicit error when Host settlement fails', async () => {
    workflow.runRemoteJob.mockRejectedValueOnce(new Error('Host array-factor job failed'))
    const container = render()
    click(container, 'cst-array-factor-submit')
    await settle()

    expect(container.querySelector('[data-testid="cst-array-factor-status"]')?.textContent).toBe('failed')
    expect(container.querySelector('[data-testid="cst-array-factor-error"]')?.textContent).toContain('Host array-factor job failed')
    expect(container.querySelector('[data-testid="cst-array-factor-provenance"]')?.textContent).toContain('cst-array-factor')
    expect(container.querySelector('[data-testid="array-results"]')).toBeNull()
  })

  it('cancels an active request and ignores a late response', async () => {
    let resolveRemote!: (value: unknown) => void
    workflow.runRemoteJob.mockImplementationOnce((_client: unknown, _spec: unknown, options: { signal: AbortSignal }) => new Promise(resolve => {
      resolveRemote = resolve
      expect(options.signal.aborted).toBe(false)
    }))
    const container = render()
    click(container, 'cst-array-factor-submit')
    await settle()
    const signal = (workflow.runRemoteJob.mock.calls[0]![2] as { signal: AbortSignal }).signal
    click(container, 'cst-array-factor-cancel')
    expect(signal.aborted).toBe(true)
    expect(container.querySelector('[data-testid="cst-array-factor-status"]')?.textContent).toBe('cancelled')
    resolveRemote(remote)
    await settle()
    expect(container.querySelector('[data-testid="array-results"]')).toBeNull()
  })

  it('keeps the authentication failure visible with the attempted case input', async () => {
    workflow.client.requireUser.mockRejectedValueOnce(new Error('需要登录'))
    const container = render()
    click(container, 'cst-array-factor-submit')
    await settle()
    expect(container.querySelector('[data-testid="cst-array-factor-error"]')?.textContent).toContain('需要登录')
    expect(container.querySelector('[data-testid="cst-array-factor-error"] a')?.getAttribute('href')).toBe('/login')
    expect(container.querySelector('[data-testid="cst-array-factor-provenance"]')?.textContent).toContain('antenna-l2')
  })
})

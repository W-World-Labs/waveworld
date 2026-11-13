// @vitest-environment happy-dom
import { act, createElement, type ContextType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModuleComputeContext } from '../../lib/hooks/useModuleCompute'
import { LocaleProvider } from '../../lib/i18n'
import type { ModuleComputeInput, ModuleComputeOutput } from '../../lib/sim/module-compute'
import { STAR_CCM_CFL_CSV_COLUMNS } from '../../lib/star-ccm-cfl-csv'
import { StarCcmCflPanel } from './StarCcmCflPanel'

type Execution = NonNullable<ContextType<typeof ModuleComputeContext>>

const sourceCsv = `${STAR_CCM_CFL_CSV_COLUMNS.join(',')}\r\n1,0.01,0.02,0.03,10,-2,1,340\r\n`
const hostOutput = {
  module: 'sw-su2-cfl' as const,
  methodId: 'method-algo-su2-cfl-directional-local',
  result: { dtRef: 0.0004, cells: [{ dt: 0.0004, directionalSpectralRate: 2500, localRatio: 1 }] },
}

function createExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    target: 'backend',
    setTarget: vi.fn(async () => {}),
    register: vi.fn(),
    reportLocalError: vi.fn(),
    connected: true,
    browserAgent: false,
    precision: null,
    result: null,
    status: 'idle',
    error: null,
    loginRequired: false,
    jobId: null,
    busy: false,
    cancelPending: false,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => true),
    clear: vi.fn(),
    ...overrides,
  } as Execution
}

const roots: Root[] = []
const containers: HTMLElement[] = []
const blobs: Blob[] = []

function render(execution: Execution) {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  const update = (next: Execution) => act(() => {
    root.render(createElement(LocaleProvider, null,
      createElement(ModuleComputeContext.Provider, { value: next }, createElement(StarCcmCflPanel))))
  })
  update(execution)
  return { container, update }
}

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function pasteCsv(container: HTMLElement, value = sourceCsv) {
  const textarea = container.querySelector('textarea[aria-label="Paste CFL CSV"]')
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('CFL CSV paste box is missing')
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function button(container: HTMLElement, name: string) {
  const found = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(name))
  if (!found) throw new Error(`missing button: ${name}`)
  return found
}

function capturedInput(execution: Execution): ModuleComputeInput {
  const registration = (execution.register as ReturnType<typeof vi.fn>).mock.calls.find(call => typeof call[1] === 'function')
  if (!registration) throw new Error('CFL input was not registered with Host execution')
  return (registration[1] as () => ModuleComputeInput)()
}

beforeEach(() => {
  blobs.length = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    blobs.push(blob as Blob)
    return 'blob:starccm-cfl-report'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
  vi.restoreAllMocks()
})

describe('STAR-CCM+ directional CFL estimate panel', () => {
  it('accepts and previews a user-provided WaveWorld CSV', () => {
    const { container } = render(createExecution())

    pasteCsv(container)

    expect(container.textContent).toContain('Parsed 1/5000 cells.')
    expect(container.querySelector('tbody')?.textContent).toContain('1')
    expect(container.querySelector('tbody')?.textContent).toContain('0.01, 0.02, 0.03')
    expect(container.querySelector('tbody')?.textContent).toContain('10, -2, 1')
    expect((button(container, 'Submit CFL estimate to Host') as HTMLButtonElement).disabled).toBe(false)
  })

  it('fails closed for invalid CSV and CFL values', () => {
    const execution = createExecution()
    const { container } = render(execution)
    pasteCsv(container, `${STAR_CCM_CFL_CSV_COLUMNS.join(',')}\r\n1,0,0.02,0.03,10,-2,1,340\r\n`)

    expect(container.textContent).toContain('Invalid WaveWorld directional CFL CSV')
    expect((button(container, 'Submit CFL estimate to Host') as HTMLButtonElement).disabled).toBe(true)
    click(button(container, 'Submit CFL estimate to Host'))
    expect(execution.start).not.toHaveBeenCalled()

    pasteCsv(container)
    const cfl = container.querySelector('input[type="number"]')
    if (!(cfl instanceof HTMLInputElement)) throw new Error('CFL factor input is missing')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(cfl, '0')
      cfl.dispatchEvent(new Event('input', { bubbles: true }))
      cfl.dispatchEvent(new Event('change', { bubbles: true }))
    })

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('CFL must be a finite value greater than 0')
    expect((button(container, 'Submit CFL estimate to Host') as HTMLButtonElement).disabled).toBe(true)
    click(button(container, 'Submit CFL estimate to Host'))
    expect(execution.start).not.toHaveBeenCalled()
  })

  it('submits the exact Host operation and preserves the successful estimate for download', async () => {
    const initial = createExecution()
    const { container, update } = render(initial)
    pasteCsv(container)

    click(button(container, 'Submit CFL estimate to Host'))
    expect(initial.start).toHaveBeenCalledOnce()
    const input = capturedInput(initial)
    expect(input).toEqual({
      module: 'sw-su2-cfl',
      backend: 'host',
      method: 'method-algo-su2-cfl-directional-local',
      cfl: 1,
      cells: [[0.01, 0.02, 0.03, 10, -2, 1, 340]],
    })

    update(createExecution({
      status: 'succeeded',
      jobId: 'cfl-job-17',
      result: { key: JSON.stringify(input), input, output: hostOutput },
    }))

    expect(container.textContent).toContain('Saved CFL estimate from Host job cfl-job-17.')
    expect(container.textContent).toContain('1 cells · CFL 1 · Host job cfl-job-17')
    expect(container.textContent).toContain('JSON report')
    expect(container.textContent).toContain('Result CSV')
    expect(container.textContent).toContain('exact submitted input, and full Host response')
    expect(container.textContent).toContain('not a full solver timestep')
    expect(container.textContent).toContain('no STAR-CCM+ vendor file, API, or macro interoperability')
    expect(container.textContent).not.toMatch(/STAR-CCM\+ (?:execution|run|result) (?:completed|succeeded)/i)

    click(button(container, 'JSON report'))
    expect(blobs).toHaveLength(1)
    expect(blobs[0].type).toBe('application/json;charset=utf-8')
    const report = JSON.parse(await blobs[0].text()) as Record<string, unknown>
    expect(report).toMatchObject({
      format: 'waveworld-star-ccm-cfl-report-v1',
      jobId: 'cfl-job-17',
      sourceCsv,
      submittedInput: input,
      result: hostOutput,
    })
    expect(report.parsedCellIds).toEqual([1])
    expect(report.limitations).toEqual(expect.arrayContaining([
      'This estimate is not a full solver timestep.',
      'No vendor numerical validation or STAR-CCM+ equivalence is claimed.',
    ]))

    click(button(container, 'Result CSV'))
    expect(blobs).toHaveLength(2)
    const csv = await blobs[1].text()
    expect(csv).toContain('cellId,dt,directionalSpectralRate,localRatio')
    expect(csv).toContain('1,0.0004,2500,1')
  })

  const malformedResponses: Array<[string, Record<string, unknown>]> = [
    ['row count', { ...hostOutput, result: { ...hostOutput.result, cells: [] } }],
    ['row shape', { ...hostOutput, result: { ...hostOutput.result, cells: [{ ...hostOutput.result.cells[0], dt: '0.0004' }] } }],
    ['operation module', { ...hostOutput, module: 'sw-other' }],
    ['operation method', { ...hostOutput, methodId: 'method-algo-other' }],
  ]

  it.each(malformedResponses)('rejects a successful Host response with malformed %s and offers no report downloads', (_kind, malformedOutput) => {
    const initial = createExecution()
    const { container, update } = render(initial)
    pasteCsv(container)
    click(button(container, 'Submit CFL estimate to Host'))
    const input = capturedInput(initial)

    update(createExecution({
      status: 'succeeded',
      jobId: 'cfl-job-invalid',
      result: { key: JSON.stringify(input), input, output: malformedOutput as unknown as ModuleComputeOutput },
    }))

    expect(container.querySelector('[aria-label="Saved CFL estimate"]')).toBeNull()
    expect(container.textContent).not.toContain('Saved CFL estimate from Host job')
    expect([...container.querySelectorAll('button')].map(item => item.textContent).join(' ')).not.toContain('JSON report')
    expect(container.textContent).not.toContain('Result CSV')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Invalid directional CFL Host result')
    expect(blobs).toHaveLength(0)
  })
})

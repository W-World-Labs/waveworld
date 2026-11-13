// @vitest-environment happy-dom
import { act, createElement, type ContextType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModuleComputeContext } from '../../lib/hooks/useModuleCompute'
import { LocaleProvider } from '../../lib/i18n'
import type { ModuleComputeInput, ModuleComputeOutput } from '../../lib/sim/module-compute'
import { STAR_CCM_SURFACE_LOADS_CSV_COLUMNS } from '../../lib/star-ccm-surface-loads-csv'
import { StarCcmSurfaceLoadsPanel } from './StarCcmSurfaceLoadsPanel'

type Execution = NonNullable<ContextType<typeof ModuleComputeContext>>

const sourceCsv = `${STAR_CCM_SURFACE_LOADS_CSV_COLUMNS.join(',')}\r\n1,0,0,1,100000,0,0,0,0,0,0\r\n`
const nativeOutput = {
  module: 'sw-su2-force-coeffs-b',
  result: {
    pressureForce: { x: 1, y: 2, z: 3 },
    viscousForce: { x: 0.1, y: 0.2, z: 0.3 },
    force: { x: 1.1, y: 2.2, z: 3.3 },
    moment: { x: 0, y: 0, z: 0 },
    coefficients: { CD: 0.4, CL: 0.8 },
    faceCount: 1,
  },
} as unknown as ModuleComputeOutput

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
      createElement(ModuleComputeContext.Provider, { value: next }, createElement(StarCcmSurfaceLoadsPanel))))
  })
  update(execution)
  return { container, update }
}

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function pasteCsv(container: HTMLElement, value = sourceCsv) {
  const textarea = container.querySelector('textarea[aria-label="Paste surface-load CSV"]')
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('surface-load CSV paste box is missing')
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
  if (!registration) throw new Error('surface-load input was not registered with Host execution')
  return (registration[1] as () => ModuleComputeInput)()
}

beforeEach(() => {
  blobs.length = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    blobs.push(blob as Blob)
    return 'blob:surface-load-report'
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
  vi.restoreAllMocks()
})

describe('STAR-CCM+ surface-load report lifecycle', () => {
  it('parses pasted CSV and previews the imported face row', () => {
    const { container } = render(createExecution())

    pasteCsv(container)

    expect(container.textContent).toContain('Parsed 1/5000 face samples.')
    expect(container.querySelector('tbody')?.textContent).toContain('1')
    expect(container.querySelector('tbody')?.textContent).toContain('100000')
    expect((button(container, 'Submit surface-load report to Host') as HTMLButtonElement).disabled).toBe(false)
  })

  it('submits and retains the exact imported source, settings, native result, and export actions', async () => {
    const initial = createExecution()
    const { container, update } = render(initial)
    pasteCsv(container)

    click(button(container, 'Submit surface-load report to Host'))
    expect(initial.start).toHaveBeenCalledOnce()
    const input = capturedInput(initial)
    expect(input).toMatchObject({
      module: 'sw-su2-force-coeffs-b',
      backend: 'host',
      method: 'surface',
      faces: [{ pressure: 100000, areaX: 0, areaY: 0, areaZ: 1 }],
    })

    update(createExecution({
      status: 'succeeded',
      jobId: 'surface-load-job-17',
      result: { key: JSON.stringify(input), input, output: nativeOutput },
    }))

    expect(container.textContent).toContain('Saved surface-load report from Host job surface-load-job-17.')
    expect(container.textContent).toContain('1 faces · Host job surface-load-job-17')
    expect(container.textContent).toContain('JSON report')
    expect(container.textContent).toContain('Result CSV')
    expect(container.textContent).toContain('original CSV, parsed table, pressure reference, exact submitted input, and Host result')

    click(button(container, 'JSON report'))
    expect(blobs).toHaveLength(1)
    expect(blobs[0].type).toBe('application/json;charset=utf-8')
    const report = JSON.parse(await blobs[0].text()) as Record<string, unknown>
    expect(report).toMatchObject({
      format: 'waveworld-star-ccm-surface-loads-v1',
      jobId: 'surface-load-job-17',
      sourceCsv,
      submittedInput: input,
      result: nativeOutput,
    })
    expect(report.sourceRows).toEqual([{ faceId: 1, areaX_m2: 0, areaY_m2: 0, areaZ_m2: 1, pressure_Pa: 100000, shearForceX_N: 0, shearForceY_N: 0, shearForceZ_N: 0, centroidX_m: 0, centroidY_m: 0, centroidZ_m: 0 }])

    click(button(container, 'Result CSV'))
    expect(blobs).toHaveLength(2)
    expect(await blobs[1].text()).toContain('coefficients.CD,0.4')
  })

  it.each(['failed', 'cancelled'] as const)('suppresses a result returned with %s status', status => {
    const initial = createExecution()
    const { container, update } = render(initial)
    pasteCsv(container)
    click(button(container, 'Submit surface-load report to Host'))
    const input = capturedInput(initial)

    update(createExecution({
      status,
      jobId: `surface-load-${status}-17`,
      result: { key: JSON.stringify(input), input, output: nativeOutput },
    }))

    expect(container.textContent).not.toContain('Saved native report')
    expect(container.textContent).not.toContain('Host job surface-load-')
    expect(container.textContent).not.toContain('JSON report')
    expect(container.textContent).not.toContain('Result CSV')
  })
})

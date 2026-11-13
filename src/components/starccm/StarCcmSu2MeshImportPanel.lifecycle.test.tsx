// @vitest-environment happy-dom
import { act, createElement, type ContextType } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModuleComputeContext } from '../../lib/hooks/useModuleCompute'
import { LocaleProvider } from '../../lib/i18n'
import type { ModuleComputeInput, ModuleComputeOutput } from '../../lib/sim/module-compute'
import { StarCcmSu2MeshImportPanelContent } from './StarCcmSu2MeshImportPanel'

type Execution = NonNullable<ContextType<typeof ModuleComputeContext>>

const meshText = [
  'NDIME= 2',
  'NPOIN= 3',
  '0.0 0.0 0',
  '1.0 0.0 1',
  '0.0 1.0 2',
  'NELEM= 1',
  '5 0 1 2 0',
  'NMARK= 1',
  'MARKER_TAG= wall',
  'MARKER_ELEMS= 3',
  '3 0 1',
  '3 1 2',
  '3 2 0',
].join('\n') + '\n'

const normalizedMeshText = [
  'NDIME= 2',
  'NELEM= 1',
  '5 0 1 2 0',
  'NPOIN= 3',
  '0.0 0.0 0',
  '1.0 0.0 1',
  '0.0 1.0 2',
  'NMARK= 1',
  'MARKER_TAG= wall',
  'MARKER_ELEMS= 3',
  '3 0 1',
  '3 1 2',
  '3 2 0',
].join('\n') + '\n'

const nativeOutput = {
  module: 'sw-su2-mesh-import',
  backend: { id: 'host-f64' },
  result: {
    format: 'su2-native', dimension: 2, elementDimension: 2,
    nodeCount: 3, elementCount: 1, markerCount: 1, markerElementCount: 3,
    markers: [{ tag: 'wall', elementCount: 3, elementTypeCounts: { line2: 3 }, measure: 3.414213562373095 }],
    boundingBox: { xMin: 0, xMax: 1, yMin: 0, yMax: 1, zMin: 0, zMax: 0 },
    elementTypeCounts: { tri3: 1 }, elementTypeMeasure: { tri3: 0.5 },
    totalLength: 0, totalArea: 0.5, totalVolume: 0, totalMarkerMeasure: 3.414213562373095,
    minElementMeasure: 0.5, maxElementMeasure: 0.5, referencedNodeCount: 3,
    unusedNodeCount: 0, maxNodeIndex: 2, invertedElements: 0, ok: true,
    methodId: 'method-algo-su2-native-mesh-import', familyId: 'mesh-generation',
  },
} satisfies ModuleComputeOutput

function createExecution(overrides: Partial<Execution> = {}): Execution {
  return {
    target: 'backend', setTarget: vi.fn(async () => {}), register: vi.fn(),
    reportLocalError: vi.fn(), connected: true, browserAgent: false, precision: null,
    result: null, status: 'idle', error: null, loginRequired: false, jobId: null,
    busy: false, cancelPending: false, start: vi.fn(async () => {}),
    stop: vi.fn(async () => true), clear: vi.fn(), ...overrides,
  } as Execution
}

const roots: Root[] = []
const containers: HTMLElement[] = []

function render(execution: Execution) {
  const container = document.createElement('div')
  document.body.append(container)
  window.localStorage.setItem('waveworld-locale', 'en')
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  const update = (next: Execution) => act(() => {
    root.render(createElement(LocaleProvider, null,
      createElement(ModuleComputeContext.Provider, { value: next }, createElement(StarCcmSu2MeshImportPanelContent))))
  })
  update(execution)
  return { container, update }
}

function click(element: Element) {
  act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

function button(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label))
  if (!found) throw new Error(`missing button: ${label}`)
  return found
}

function pasteMesh(container: HTMLElement, value = meshText) {
  const textarea = container.querySelector('textarea[aria-label="SU2 native mesh text"]')
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('SU2 mesh text box is missing')
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, value)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function capturedInput(execution: Execution): ModuleComputeInput {
  const registration = (execution.register as ReturnType<typeof vi.fn>).mock.calls.find(call => typeof call[1] === 'function')
  if (!registration) throw new Error('SU2 mesh input was not registered with Host execution')
  return (registration[1] as () => ModuleComputeInput)()
}

afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  containers.splice(0).forEach(container => container.remove())
})

describe('STAR-CCM+ SU2 mesh import lifecycle', () => {
  it('uses authenticated Host settlement and keeps the matching result with its job ID', () => {
    const initial = createExecution()
    const { container, update } = render(initial)
    pasteMesh(container)

    click(button(container, 'Submit SU2 mesh to Host'))
    expect(initial.start).toHaveBeenCalledOnce()
    expect(initial.start).toHaveBeenCalledWith(true)
    const input = capturedInput(initial)
    expect(input).toMatchObject({ module: 'sw-su2-mesh-import', backend: 'host', mesh: normalizedMeshText })

    update(createExecution({
      status: 'succeeded', jobId: 'su2-mesh-job-17',
      result: { key: JSON.stringify(input), input, output: nativeOutput },
    }))

    expect(container.textContent).toContain('su2-mesh-job-17')
    expect(container.textContent).toContain('3')
    expect(container.querySelector('[aria-label="SU2 mesh summary"]')).not.toBeNull()
  })

  it('rejects an unwrapped result with mismatched native method provenance', () => {
    const initial = createExecution()
    const { container, update } = render(initial)
    pasteMesh(container)
    click(button(container, 'Submit SU2 mesh to Host'))
    const input = capturedInput(initial)
    update(createExecution({
      status: 'succeeded', jobId: 'invalid-su2-mesh-job',
      result: { key: JSON.stringify(input), input, output: {
        ...nativeOutput, result: { ...nativeOutput.result, methodId: 'wrong-importer' },
      } },
    }))
    expect(container.textContent).toContain('Result methodId does not match the native SU2 mesh importer.')
    expect(container.textContent).not.toContain('invalid-su2-mesh-job')
    expect(container.querySelector('[aria-label="SU2 mesh summary"]')).toBeNull()
  })

  it('requests cancellation and discards the canceled Host response', () => {
    const initial = createExecution()
    const { container, update } = render(initial)
    pasteMesh(container)
    click(button(container, 'Submit SU2 mesh to Host'))
    const input = capturedInput(initial)
    const running = createExecution({ busy: true, status: 'running', jobId: 'su2-mesh-running-job' })
    const stop = running.stop as ReturnType<typeof vi.fn>
    update(running)

    click(button(container, 'Cancel SU2 mesh job'))
    expect(stop).toHaveBeenCalledOnce()

    update(createExecution({
      status: 'cancelled', jobId: 'su2-mesh-cancelled-job',
      result: { key: JSON.stringify(input), input, output: nativeOutput },
    }))

    expect(container.textContent).not.toContain('su2-mesh-cancelled-job')
    expect(container.querySelector('[aria-label="SU2 mesh summary"]')).toBeNull()
  })

  it('rejects stale responses and leaves the imported mesh uncommitted', () => {
    const initial = createExecution()
    const { container, update } = render(initial)
    pasteMesh(container)
    click(button(container, 'Submit SU2 mesh to Host'))
    const submitted = capturedInput(initial)
    const stale = { ...submitted, mesh: `${normalizedMeshText}% edited after submission\n` } as ModuleComputeInput

    update(createExecution({
      status: 'succeeded', jobId: 'stale-su2-mesh-job',
      result: { key: JSON.stringify(submitted), input: stale, output: nativeOutput },
    }))

    expect(container.textContent).not.toContain('stale-su2-mesh-job')
    expect(container.querySelector('[aria-label="SU2 mesh summary"]')).toBeNull()
  })
})

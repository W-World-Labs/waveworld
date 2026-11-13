// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostJobDetail } from '../../lib/hostApi'
import { ThermalFieldResult } from './ThermalFieldResult'

const mocks = vi.hoisted(() => ({
  fetchHostJobResult: vi.fn(),
  getStoredUserToken: vi.fn(() => 'test-token'),
  hostApiBase: vi.fn(() => 'https://host.test'),
  downloadThermalFieldArtifact: vi.fn(),
  downloadThermalKpiSummaryArtifact: vi.fn(),
  exportThermalFieldDirectory: vi.fn(),
  isFrameExportSupported: vi.fn(() => true),
}))

vi.mock('../../lib/hostApi', () => ({
  fetchHostJobResult: mocks.fetchHostJobResult,
  getStoredUserToken: mocks.getStoredUserToken,
  hostApiBase: mocks.hostApiBase,
}))
vi.mock('../../../apps/lab/src/lib/w-sim/thermal-field-artifact', () => ({
  downloadThermalFieldArtifact: mocks.downloadThermalFieldArtifact,
  downloadThermalKpiSummaryArtifact: mocks.downloadThermalKpiSummaryArtifact,
  exportThermalFieldDirectory: mocks.exportThermalFieldDirectory,
}))
vi.mock('../../../apps/lab/src/lib/cfd/frame-export', () => ({ isFrameExportSupported: mocks.isFrameExportSupported }))

const jobId = 'thermal-job-1'
const fieldRef = { artifactId: 'field-1', kind: 'thermal-temperature-field', contentType: 'application/octet-stream', bytes: 16 }
const result = {
  schemaVersion: 1,
  artifacts: [fieldRef],
  derived: { fieldArtifactId: 'field-1', fieldFormat: 'float64-le-x-fastest-v1', cellCount: 2, fieldBytes: 16, temperatureUnit: 'C' },
} as Record<string, unknown>
const spec = { schemaVersion: 1, kind: 'thermal-3d-transient', parameters: { dimension: 1, nx: 2, units: { temperature: 'C' } }, run: {}, outputs: {} }
const job = {
  id: jobId, name: 'synthetic thermal', kind: 'thermal-3d-transient', status: 'succeeded', progress: null,
  result, error: null, createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z',
  specFingerprint: 'fingerprint-1', spec,
} as unknown as HostJobDetail
const stored = (metadata: Array<Record<string, unknown>> = [{
  id: 'field-1', jobId, kind: 'thermal-temperature-field', bytes: 16,
  contentType: 'application/octet-stream', sha256: 'a'.repeat(64),
}]) => ({ jobId, status: 'succeeded', specFingerprint: 'fingerprint-1', result, artifacts: metadata })
const loadedField = { bytes: new ArrayBuffer(16), values: new Float64Array([20, 25]), sha256: 'a'.repeat(64), nx: 2, ny: 1, nz: 1, unit: 'C' }
const steadyDigest = '0123456789abcdef0123456789abcdef'
const kpiRef = { artifactId: 'host-random-kpi', kind: 'thermal-kpi-summary', contentType: 'application/json', bytes: 42 }
const steadySummary = { inputDigest: steadyDigest, iterations: 20, converged: true, temperatureMinC: 20, temperatureMaxC: 25 }
const steadyResult = {
  ...result, summary: steadySummary, artifacts: [fieldRef, kpiRef],
  derived: { ...(result.derived as Record<string, unknown>), fieldArtifactId: fieldRef.artifactId },
}
const steadySpec = { ...spec, kind: 'thermal-3d-steady', parameters: { dimension: 3, nx: 2, ny: 2, nz: 2, units: { temperature: 'C' } } }
const loadedKpi = { bytes: new ArrayBuffer(42), sha256: 'b'.repeat(64), inputDigest: steadyDigest, summary: steadySummary }

let roots: Root[] = []
let containers: HTMLElement[] = []
let pickerDescriptor: PropertyDescriptor | undefined

function render(resultValue = result) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  containers.push(container)
  act(() => root.render(createElement(ThermalFieldResult, { job: { ...job, result: resultValue }, zh: false })))
  return container
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label))
  if (!found) throw new Error(`missing button: ${label}`)
  return found
}

async function click(container: HTMLElement, label: string) {
  await act(async () => {
    button(container, label).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve(); await Promise.resolve()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mocks.getStoredUserToken.mockReturnValue('test-token')
  mocks.isFrameExportSupported.mockReturnValue(true)
  mocks.downloadThermalFieldArtifact.mockResolvedValue(loadedField)
  mocks.downloadThermalKpiSummaryArtifact.mockResolvedValue(loadedKpi)
  mocks.exportThermalFieldDirectory.mockResolvedValue(undefined)
  pickerDescriptor = Object.getOwnPropertyDescriptor(window, 'showDirectoryPicker')
})

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  for (const container of containers) container.remove()
  containers = []
  if (pickerDescriptor === undefined) delete (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker
  else Object.defineProperty(window, 'showDirectoryPicker', pickerDescriptor)
})

describe('ThermalFieldResult', () => {
  it('loads the saved result, matches its artifact SHA metadata, and downloads without submitting work', async () => {
    mocks.fetchHostJobResult.mockResolvedValue(stored())
    const container = render()
    expect(mocks.fetchHostJobResult).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Read every saved node')

    await click(container, 'Read complete field')

    expect(mocks.fetchHostJobResult).toHaveBeenCalledOnce()
    expect(mocks.fetchHostJobResult).toHaveBeenCalledWith(jobId)
    expect(mocks.downloadThermalFieldArtifact).toHaveBeenCalledOnce()
    expect(mocks.downloadThermalFieldArtifact).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://host.test', jobId, artifact: fieldRef, expectedSha256: 'a'.repeat(64),
      headers: { Authorization: 'Bearer test-token' },
    }))
    expect(container.textContent).toContain('2 nodes')
  })

  it('selects the directory during the click before fetching, then exports the verified field', async () => {
    const order: string[] = []
    const dir = { marker: 'picked-directory' } as unknown as FileSystemDirectoryHandle
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: vi.fn(async () => { order.push('picker'); return dir }) })
    mocks.fetchHostJobResult.mockImplementation(async () => { order.push('saved-result'); return stored() })
    mocks.downloadThermalFieldArtifact.mockImplementation(async () => { order.push('download'); return loadedField })
    mocks.exportThermalFieldDirectory.mockImplementation(async () => { order.push('export') })
    const container = render()

    await click(container, 'Export complete field')

    expect(order).toEqual(['picker', 'saved-result', 'download', 'export'])
    expect(mocks.exportThermalFieldDirectory).toHaveBeenCalledWith(expect.objectContaining({ dir, runName: `thermal-${jobId}`, field: loadedField }))
    expect(container.textContent).toContain('Exported')
  })

  it('loads and exports both saved 3D steady artifacts using their Host-assigned IDs', async () => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: vi.fn(async () => ({ marker: 'picked' })) })
    const steadyJob = { ...job, kind: 'thermal-3d-steady', spec: steadySpec, result: steadyResult } as unknown as HostJobDetail
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container); roots.push(root); containers.push(container)
    act(() => root.render(createElement(ThermalFieldResult, { job: steadyJob, zh: false })))
    mocks.fetchHostJobResult.mockResolvedValue({ ...stored([
      { id: fieldRef.artifactId, jobId, kind: fieldRef.kind, bytes: fieldRef.bytes, contentType: fieldRef.contentType, sha256: 'a'.repeat(64) },
      { id: kpiRef.artifactId, jobId, kind: kpiRef.kind, bytes: kpiRef.bytes, contentType: kpiRef.contentType, sha256: 'b'.repeat(64) },
    ]), result: steadyResult })

    await click(container, 'Export complete field')

    expect(mocks.downloadThermalFieldArtifact).toHaveBeenCalledWith(expect.objectContaining({ artifact: fieldRef, expectedSha256: 'a'.repeat(64) }))
    expect(mocks.downloadThermalKpiSummaryArtifact).toHaveBeenCalledWith(expect.objectContaining({ artifact: kpiRef, expectedSha256: 'b'.repeat(64) }))
    expect(mocks.exportThermalFieldDirectory).toHaveBeenCalledWith(expect.objectContaining({ field: loadedField, kpi: loadedKpi }))
    expect(container.textContent).toContain('Saved KPI summary verified')
  })

  it.each([
    ['missing metadata', []],
    ['missing SHA metadata', [{ id: 'field-1', jobId, kind: 'thermal-temperature-field', bytes: 16, contentType: 'application/octet-stream' }]],
    ['corrupt metadata', [{ id: 'field-1', jobId: 'other-job', kind: 'thermal-temperature-field', bytes: 8, contentType: 'application/octet-stream', sha256: 'a'.repeat(64) }]],
  ])('shows an error for %s and does not download or export', async (_label, metadata) => {
    mocks.fetchHostJobResult.mockResolvedValue(stored(metadata as Array<Record<string, unknown>>))
    const container = render()
    await click(container, 'Read complete field')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('missing')
    expect(mocks.downloadThermalFieldArtifact).not.toHaveBeenCalled()
    expect(mocks.exportThermalFieldDirectory).not.toHaveBeenCalled()
  })

  it('does not expose read/export actions for a legacy result format', () => {
    const legacy = { ...result, derived: { ...(result.derived as Record<string, unknown>), fieldFormat: undefined } }
    const container = render(legacy)
    expect(container.textContent).toContain('did not save a verifiable complete temperature field')
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(mocks.fetchHostJobResult).not.toHaveBeenCalled()
    expect(mocks.downloadThermalFieldArtifact).not.toHaveBeenCalled()
  })
})

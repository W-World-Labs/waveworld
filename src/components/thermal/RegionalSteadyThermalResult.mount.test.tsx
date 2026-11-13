// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts'
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

type Capture = {
  caseId: string
  spec: { kind: string; parameters: { dimension: number; nx: number; ny: number; nz: number; materials?: unknown[]; units: { temperature: string } } }
  result: {
    artifacts: Array<{ artifactId: string; kind: string; bytes: number; contentType: string }>
    summary: Record<string, unknown>
    derived: Record<string, unknown>
  }
  temperature: number[]
}
type LedgerEntry = { path: string; bytes: number; sha256: string }
type CaptureBundle = { id: string; capture: Capture; ledger: LedgerEntry[]; kpiBytes: Uint8Array }

const fixture = (name: string) => resolve(process.cwd(), 'src/components/thermal/fixtures', name)
function readBundle(id: string): CaptureBundle {
  return {
    id,
    capture: JSON.parse(readFileSync(fixture(`${id}.native.json`), 'utf8')) as Capture,
    ledger: JSON.parse(readFileSync(fixture(`${id}.artifact-files.json`), 'utf8')) as LedgerEntry[],
    kpiBytes: new Uint8Array(readFileSync(fixture(`${id}.kpi-summary.json`))),
  }
}
const smallRegional = readBundle('matrix-3d-mixed')
const largeRegional = readBundle('regional-bulk-sink-7cube')
const uniform3d = readBundle('box-dirichlet-source-n5')
function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex') }
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
function single<T>(items: T[], description: string): T {
  if (items.length !== 1) throw new Error(`expected one ${description}`)
  return items[0]!
}
function mountedCapture(bundle: CaptureBundle) {
  const { capture } = bundle
  const fieldRef = single(capture.result.artifacts.filter(item => item.kind === 'thermal-temperature-field'), 'field artifact')
  const kpiRef = single(capture.result.artifacts.filter(item => item.kind === 'thermal-kpi-summary'), 'KPI artifact')
  const fieldLedger = single(bundle.ledger.filter(item => item.path === `artifacts/${fieldRef.artifactId}`), 'field ledger row')
  const kpiLedger = single(bundle.ledger.filter(item => item.path === `artifacts/${kpiRef.artifactId}`), 'KPI ledger row')
  const fieldBytes = Buffer.alloc(capture.temperature.length * 8)
  capture.temperature.forEach((value, index) => fieldBytes.writeDoubleLE(value, index * 8))
  const summaryBytes = JSON.parse(new TextDecoder().decode(bundle.kpiBytes)) as Record<string, unknown>
  const spec = capture.spec as unknown as JobSpecV1
  const result = capture.result as unknown as JobResultV1
  const inputDigest = String(capture.result.summary.inputDigest)
  const field = {
    bytes: asArrayBuffer(fieldBytes), values: Float64Array.from(capture.temperature), sha256: fieldLedger.sha256,
    inputDigest, nx: capture.spec.parameters.nx, ny: capture.spec.parameters.ny, nz: capture.spec.parameters.nz,
    unit: capture.spec.parameters.units.temperature,
  }
  const kpi = { bytes: asArrayBuffer(bundle.kpiBytes), sha256: kpiLedger.sha256, inputDigest, summary: summaryBytes }
  const jobId = `saved-${capture.caseId}`
  const fingerprint = `fixture-${capture.caseId}`
  const job = {
    id: jobId, name: capture.spec.kind, kind: capture.spec.kind, status: 'succeeded', progress: null, result,
    error: null, createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', specFingerprint: fingerprint, spec,
  } as unknown as HostJobDetail
  const saved = {
    jobId, status: 'succeeded', specFingerprint: fingerprint, result,
    artifacts: [fieldRef, kpiRef].map(ref => ({
      id: ref.artifactId, jobId, kind: ref.kind, bytes: ref.bytes, contentType: ref.contentType,
      sha256: ref.kind === 'thermal-temperature-field' ? fieldLedger.sha256 : kpiLedger.sha256,
    })),
  }
  return { capture, fieldRef, kpiRef, fieldLedger, kpiLedger, fieldBytes, summaryBytes, spec, result, inputDigest, field, kpi, job, saved }
}

let roots: Root[] = []
let containers: HTMLElement[] = []
let pickerDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mocks.getStoredUserToken.mockReturnValue('test-token')
  mocks.isFrameExportSupported.mockReturnValue(true)
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

async function mountAndExport(bundle: CaptureBundle, options: { regional: boolean; methodLabel: string }) {
  const savedCapture = mountedCapture(bundle)
  expect(savedCapture.fieldBytes.byteLength).toBe(savedCapture.fieldLedger.bytes)
  expect(sha256(savedCapture.fieldBytes)).toBe(savedCapture.fieldLedger.sha256)
  expect(bundle.kpiBytes.byteLength).toBe(savedCapture.kpiLedger.bytes)
  expect(sha256(bundle.kpiBytes)).toBe(savedCapture.kpiLedger.sha256)
  expect(savedCapture.summaryBytes).toEqual(savedCapture.capture.result.summary)
  mocks.fetchHostJobResult.mockResolvedValue(savedCapture.saved)
  mocks.downloadThermalFieldArtifact.mockResolvedValue(savedCapture.field)
  mocks.downloadThermalKpiSummaryArtifact.mockResolvedValue(savedCapture.kpi)

  const directory = { marker: 'picked-directory' } as unknown as FileSystemDirectoryHandle
  Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: vi.fn(async () => directory) })
  const container = document.createElement('div')
  document.body.append(container)
  containers.push(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => root.render(createElement(ThermalFieldResult, { job: savedCapture.job, zh: false })))

  await act(async () => {
    const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes('Export complete field'))
    expect(button).toBeTruthy()
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve(); await Promise.resolve()
  })
  if (options.regional) expect(savedCapture.capture.spec.parameters.materials?.length).toBeGreaterThan(0)
  else expect(savedCapture.capture.spec.parameters.materials).toBeUndefined()
  expect(container.textContent).toContain(options.methodLabel)
  expect(container.textContent).toContain(`Verified ${savedCapture.field.nx} × ${savedCapture.field.ny} × ${savedCapture.field.nz} · ${savedCapture.field.values.length} nodes`)
  const faceKeys = [
    ['heatFlowLeftW', 'Left face'], ['heatFlowRightW', 'Right face'], ['heatFlowBottomW', 'Bottom face'],
    ['heatFlowTopW', 'Top face'], ['heatFlowFrontW', 'Front face'], ['heatFlowBackW', 'Back face'],
  ] as const
  if (options.regional) {
    expect(container.textContent).toContain('Positive heat flow enters the domain; negative heat flow leaves it (W).')
    for (const [key, label] of faceKeys) {
      const value = savedCapture.capture.result.summary[key]
      expect(typeof value).toBe('number')
      expect(container.textContent).toContain(label)
      expect(container.textContent).toContain(`${String(value)} W`)
    }
  }
  expect(mocks.downloadThermalFieldArtifact).toHaveBeenCalledWith(expect.objectContaining({ artifact: savedCapture.fieldRef, expectedSha256: savedCapture.fieldLedger.sha256 }))
  expect(mocks.downloadThermalKpiSummaryArtifact).toHaveBeenCalledWith(expect.objectContaining({ artifact: savedCapture.kpiRef, expectedSha256: savedCapture.kpiLedger.sha256 }))
  expect(mocks.exportThermalFieldDirectory).toHaveBeenCalledWith(expect.objectContaining({
    dir: directory, field: savedCapture.field, kpi: savedCapture.kpi, spec: savedCapture.spec, result: savedCapture.result,
  }))
  expect(mocks.exportThermalFieldDirectory.mock.calls[0]?.[0].kpi.summary).toEqual(savedCapture.capture.result.summary)
  expect(mocks.exportThermalFieldDirectory.mock.calls[0]?.[0].result).toEqual(savedCapture.capture.result)
  return { container, capture: savedCapture.capture }
}

describe('regional 3D steady result mount', () => {
  it('mounts the exact 3×3×3 saved regional capture and passes its KPI/result through export', async () => {
    const { capture } = await mountAndExport(smallRegional, { regional: true, methodLabel: 'Regional finite-volume steady state' })
    expect(capture.caseId).toBe('matrix-3d-mixed')
    expect(capture.result.derived.fieldInline).toBe(1)
    expect(typeof capture.result.derived.temperatureCsv).toBe('string')
  })

  it('mounts the exact 7×7×7 regional capture with no inline CSV and preserves its six face values', async () => {
    const { capture } = await mountAndExport(largeRegional, { regional: true, methodLabel: 'Regional finite-volume steady state' })
    expect(capture.caseId).toBe('regional-bulk-sink-7cube')
    expect(capture.result.derived.cellCount).toBe(343)
    expect(capture.result.derived.fieldInline).toBe(0)
    expect('temperatureCsv' in capture.result.derived).toBe(false)
  })

  it('mounts an exact uniform 3D capture with a readable saved-method label', async () => {
    const { capture } = await mountAndExport(uniform3d, { regional: false, methodLabel: 'Uniform-material steady state' })
    expect(capture.caseId).toBe('box-dirichlet-source-n5')
    expect(capture.result.summary.method).toBe('thermal-steady-fd-gs-v1')
  })
})

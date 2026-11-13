// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostJobDetail } from '../../lib/hostApi'
import { LocaleProvider } from '../../lib/i18n/LocaleContext'
import { JobResultView } from '../JobResultView'

const mocks = vi.hoisted(() => ({
  fetchHostJobResult: vi.fn(), getStoredUserToken: vi.fn(() => 'capture-user'), hostApiBase: vi.fn(() => 'https://host.test'),
  downloadThermalFieldArtifact: vi.fn(), downloadThermalKpiSummaryArtifact: vi.fn(), exportThermalFieldDirectory: vi.fn(),
  isFrameExportSupported: vi.fn(() => true),
}))
vi.mock('../../lib/hostApi', () => ({ fetchHostJobResult: mocks.fetchHostJobResult, getStoredUserToken: mocks.getStoredUserToken, hostApiBase: mocks.hostApiBase }))
vi.mock('../../../apps/lab/src/lib/w-sim/thermal-field-artifact', () => ({
  downloadThermalFieldArtifact: mocks.downloadThermalFieldArtifact,
  downloadThermalKpiSummaryArtifact: mocks.downloadThermalKpiSummaryArtifact,
  exportThermalFieldDirectory: mocks.exportThermalFieldDirectory,
}))
vi.mock('../../../apps/lab/src/lib/cfd/frame-export', () => ({ isFrameExportSupported: mocks.isFrameExportSupported }))

const captureDir = join(process.cwd(), 'src/components/thermal/fixtures/igbt-spatial-single-die-robin-c')
type CapturedArtifact = { artifactId: string; kind: string; contentType: string; bytes: number }
type CapturedSpatial = {
  spec: Record<string, unknown>
  result: Record<string, unknown> & {
    artifacts: CapturedArtifact[]
    derived: Record<string, unknown> & { temperatureCsv: string; igbtDieIds: string[] | string; inputDigest?: string }
    summary: Record<string, unknown> & { inputDigest: string }
  }
}
const captured = JSON.parse(readFileSync(join(captureDir, 'native.json'), 'utf8')) as CapturedSpatial
const fieldBuffer = readFileSync(join(captureDir, 'temperature.f64le'))
const kpiBuffer = readFileSync(join(captureDir, 'summary.json'))
const arrayBuffer = (buffer: Buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')
const fieldBytes = arrayBuffer(fieldBuffer), kpiBytes = arrayBuffer(kpiBuffer)
const fieldSha = sha256(fieldBuffer), kpiSha = sha256(kpiBuffer)
const jobId = 'igbt-capture-job'
const fieldRef = { ...captured.result.artifacts.find(item => item.kind === 'thermal-temperature-field')!, artifactId: 'host-field-7ac1' }
const kpiRef = { ...captured.result.artifacts.find(item => item.kind === 'thermal-kpi-summary')!, artifactId: 'host-kpi-3f91' }
// This only adapts the retained capture's pre-contract array field and source IDs to Host-assigned IDs.
// The temperature bytes, KPI bytes, summary values, spec and input digest remain the captured bytes.
const result = {
  ...captured.result,
  artifacts: [fieldRef, kpiRef],
  derived: { ...captured.result.derived, fieldArtifactId: fieldRef.artifactId, igbtDieIds: JSON.stringify(captured.result.derived.igbtDieIds) },
} as Record<string, unknown> & { summary: Record<string, unknown>; derived: Record<string, unknown>; artifacts: CapturedArtifact[] }
const spec = captured.spec
const fieldValues = new Float64Array(captured.result.derived.temperatureCsv.split(',').map(Number))
const loadedField = { bytes: fieldBytes, values: fieldValues, sha256: fieldSha, inputDigest: captured.result.summary.inputDigest, nx: 5, ny: 4, nz: 3, unit: 'C', lengthUnit: 'm', lengthX: 0.04, lengthY: 0.03, lengthZ: 0.02 }
const loadedKpi = { bytes: kpiBytes, sha256: kpiSha, inputDigest: captured.result.summary.inputDigest, summary: JSON.parse(kpiBuffer.toString('utf8')) }
const metadata = [
  { id: fieldRef.artifactId, jobId, kind: fieldRef.kind, bytes: fieldRef.bytes, contentType: fieldRef.contentType, sha256: fieldSha },
  { id: kpiRef.artifactId, jobId, kind: kpiRef.kind, bytes: kpiRef.bytes, contentType: kpiRef.contentType, sha256: kpiSha },
]
const job = {
  id: jobId, name: 'captured IGBT spatial case', kind: 'electro-thermal-igbt', status: 'succeeded', progress: null,
  result, error: null, createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', specFingerprint: 'captured-fingerprint', spec,
} as unknown as HostJobDetail

let roots: Root[] = []
let containers: HTMLElement[] = []
let pickerDescriptor: PropertyDescriptor | undefined

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(candidate => candidate.textContent?.includes(text))
  if (!found) throw new Error(`missing button: ${text}`)
  return found
}

async function click(container: HTMLElement, text: string) {
  await act(async () => {
    button(container, text).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  mocks.fetchHostJobResult.mockResolvedValue({ jobId, status: 'succeeded', specFingerprint: 'captured-fingerprint', result, artifacts: metadata })
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

describe('saved spatial IGBT result card', () => {
  it('mounts the retained field/KPI capture, displays ordered die and coupling KPIs, and exports exact bytes', async () => {
    expect(fieldSha).toBe('b05e96482bdc70befa4cb151284c341a88084977a45361c9812b3d1652e74de8')
    expect(kpiSha).toBe('db709fb484ea08de998c507ba6741f12474ef5ee029e5f85c6c6649e92a5c1b4')
    const dir = { marker: 'capture-export-directory' } as unknown as FileSystemDirectoryHandle
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: vi.fn(async () => dir) })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root); containers.push(container)
    act(() => root.render(createElement(LocaleProvider, null, createElement(JobResultView, { job }))))
    expect(container.textContent).toContain('读取已保存的空间温度场')
    expect(mocks.fetchHostJobResult).not.toHaveBeenCalled()

    await click(container, '导出完整温度场')

    expect(mocks.fetchHostJobResult).toHaveBeenCalledWith(jobId)
    expect(mocks.downloadThermalFieldArtifact).toHaveBeenCalledWith(expect.objectContaining({ jobId, artifact: fieldRef, expectedSha256: fieldSha }))
    expect(mocks.downloadThermalKpiSummaryArtifact).toHaveBeenCalledWith(expect.objectContaining({ jobId, artifact: kpiRef, expectedSha256: kpiSha }))
    expect(mocks.exportThermalFieldDirectory).toHaveBeenCalledWith(expect.objectContaining({ dir, field: loadedField, kpi: loadedKpi, spec, result }))
    expect(container.textContent).toContain('空间电热芯片模型')
    expect(container.textContent).toContain('器件 · die1')
    expect(container.textContent).toContain('结温均值')
    expect(container.textContent).toContain('结温最低值')
    expect(container.textContent).toContain('结温最高值')
    expect(container.textContent).toContain('本轮已使用总损耗')
    expect(container.textContent).toContain('当前温度重新评估总损耗')
    expect(container.textContent).toContain('损耗相对变化')
    const residualLabel = Array.from(container.querySelectorAll('dt')).find(node => node.textContent === '温度场更新残差')
    expect(residualLabel).toBeDefined()
    expect(residualLabel?.nextElementSibling?.textContent).toMatch(/°C$/)
    expect(residualLabel?.nextElementSibling?.textContent).not.toMatch(/W$/)
    expect(container.textContent).toContain('能量不平衡')
    expect(container.textContent).toContain('底面')
    expect(container.textContent).toContain('0.04 × 0.03 × 0.02 m')
    expect(container.textContent).toContain('W')
    expect(container.textContent).toContain('已导出')
  })
})

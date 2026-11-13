import type { JobResultArtifact, JobResultV1, JobSpecV1 } from '@w-sim/contracts'

export const THERMAL_FIELD_FORMAT = 'float64-le-x-fastest-v1'
export const THERMAL_FIELD_KIND = 'thermal-temperature-field'
export const IGBT_SPATIAL_METHOD = 'thermal-igbt-spatial-chip-v1'
export const MAX_THERMAL_ARTIFACT_BYTES = 32 * 1024 * 1024

export type ThermalFieldDownload = {
  bytes: ArrayBuffer
  values: Float64Array
  sha256: string
  inputDigest?: string
  nx: number
  ny: number
  nz: number
  unit: string
  lengthUnit?: string
  lengthX?: number
  lengthY?: number
  lengthZ?: number
}

export type ThermalKpiSummaryDownload = {
  bytes: ArrayBuffer
  sha256: string
  inputDigest: string
  summary: Record<string, unknown>
}

function invalid(message: string): never { throw new Error(`温度场附件无效：${message}`) }
function hex(bytes: Uint8Array): string { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('') }
async function sha256(bytes: ArrayBuffer): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))) }
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
function transientGrid(p: Record<string, unknown>): { nx: number; ny: number; nz: number; count: number } {
  if (p.dimension !== undefined && p.dimension !== null && (!Number.isSafeInteger(p.dimension) || ![1, 2, 3].includes(p.dimension as number))) invalid('dimension must be 1, 2 or 3')
  const dimension = p.dimension != null ? p.dimension as number : p.nz != null || p.lengthZ != null ? 3 : p.ny != null || p.lengthY != null ? 2 : 1
  const gridN = p.gridN
  const axis = (key: 'nx' | 'ny' | 'nz', active: boolean): number => {
    if (!active) return 1
    const value = p[key] != null ? p[key] : gridN != null ? gridN : 32
    if (!Number.isSafeInteger(value)) invalid(`${key} must be a safe integer`)
    const n = value as number
    if (n < 2 || n > 128) invalid(`${key} is outside the active grid bounds`)
    return n
  }
  const nx = axis('nx', true), ny = axis('ny', dimension >= 2), nz = axis('nz', dimension >= 3)
  return { nx, ny, nz, count: nx * ny * nz }
}

function thermalGrid(spec: JobSpecV1): { nx: number; ny: number; nz: number; count: number; unit: string; lengthUnit?: string; lengthX?: number; lengthY?: number; lengthZ?: number } {
  const p = spec.parameters as Record<string, unknown>
  let grid: { nx: number; ny: number; nz: number; count: number }
  if (spec.kind === 'thermal-3d-transient' || (spec.kind === 'electro-thermal-igbt' && p.mode === 'spatial-chip' && p.dimension === 3)) {
    grid = transientGrid(p)
  } else if (spec.kind === 'thermal-3d-steady' && p.dimension === 3) {
    grid = transientGrid(p)
  } else {
    invalid('仅支持瞬态结果或显式三维稳态温度场')
  }
  const units = asRecord(p.units)
  const unit = units?.temperature
  if (typeof unit !== 'string' || !['C', 'K'].includes(unit)) invalid('温度单位无效')
  return {
    ...grid, unit,
    ...(typeof units?.length === 'string' ? { lengthUnit: units.length } : {}),
    ...(typeof p.lengthX === 'number' ? { lengthX: p.lengthX } : {}),
    ...(typeof p.lengthY === 'number' ? { lengthY: p.lengthY } : {}),
    ...(typeof p.lengthZ === 'number' ? { lengthZ: p.lengthZ } : {}),
  }
}

function isIgbtSpatialSpec(spec: JobSpecV1): boolean {
  const p = asRecord(spec.parameters)
  return spec.kind === 'electro-thermal-igbt' && p?.mode === 'spatial-chip' && p.dimension === 3
}

function igbtSpatialInputDigest(spec: JobSpecV1, result: JobResultV1): string {
  if (!isIgbtSpatialSpec(spec)) invalid('IGBT空间电热模式无效')
  const digest = resultInputDigest(result, true)!
  const summary = asRecord(result.summary), derived = asRecord(result.derived)
  if (summary?.method !== IGBT_SPATIAL_METHOD || derived?.inputDigest !== digest) invalid('空间电热方法或输入摘要与结果不一致')
  const parameters = asRecord(spec.parameters)!, dies = parameters.dies
  const units = asRecord(parameters.units)
  const nx = parameters.nx, ny = parameters.ny, nz = parameters.nz
  const count = typeof nx === 'number' && typeof ny === 'number' && typeof nz === 'number' ? nx * ny * nz : NaN
  if (![nx, ny, nz, count].every(Number.isSafeInteger) || summary.gridNx !== nx || summary.gridNy !== ny || summary.gridNz !== nz || summary.cellCount !== count || derived.dimension !== 3 || derived.gridNx !== nx || derived.gridNy !== ny || derived.gridNz !== nz || derived.cellCount !== count) invalid('空间电热网格尺寸与结果不一致')
  if (units?.length !== 'm' || derived.lengthUnit !== 'm' || derived.temperatureUnit !== units.temperature || !['C', 'K'].includes(String(units.temperature))) invalid('空间电热场单位与输入不一致')
  for (const key of ['lengthX', 'lengthY', 'lengthZ'] as const) {
    if (typeof parameters[key] !== 'number' || !Number.isFinite(parameters[key]) || parameters[key] <= 0 || derived[key] !== parameters[key]) invalid(`空间电热${key}与结果不一致`)
  }
  const lengths = [parameters.lengthX, parameters.lengthY, parameters.lengthZ] as number[]
  const counts = [nx, ny, nz] as number[]
  for (let axis = 0; axis < 3; axis++) {
    const key = (['dx', 'dy', 'dz'] as const)[axis]!
    if (derived[key] !== lengths[axis]! / (counts[axis]! - 1)) invalid('空间电热网格间距与输入不一致')
  }
  if (!Array.isArray(dies) || dies.length < 1 || dies.length > 16) invalid('空间电热die清单无效')
  const expectedIds = dies.map(die => asRecord(die)?.id)
  if (!expectedIds.every(id => typeof id === 'string' && id.length > 0)) invalid('空间电热die ID无效')
  if (typeof derived.igbtDieIds !== 'string') invalid('空间电热die ID顺序必须以JSON字符串保存')
  let storedIds: unknown
  try { storedIds = JSON.parse(derived.igbtDieIds) } catch { invalid('空间电热die ID JSON无效') }
  if (!Array.isArray(storedIds) || storedIds.length !== expectedIds.length || storedIds.some((id, index) => id !== expectedIds[index])) invalid('空间电热die ID顺序与输入不一致')
  if (summary.dieCount !== dies.length) invalid('空间电热die数量与结果不一致')
  const requiredKpis = [
    'steps', 'wallTimeMs', 'tMin', 'tMax', 'tjMaxC', 'caseMeanC', 'dieCount', 'couplingIterations',
    'temperatureChangeC', 'relativePowerChange', 'sourcePowerW', 'totalLossW', 'conductionLossW',
    'switchingLossW', 'residual', 'iterations', 'converged', 'energyImbalance',
    'heatFlowLeftW', 'heatFlowRightW', 'heatFlowBottomW', 'heatFlowTopW', 'heatFlowFrontW', 'heatFlowBackW',
  ]
  for (const index of dies.keys()) requiredKpis.push(
    `die${index}JunctionMeanC`, `die${index}JunctionMinC`, `die${index}JunctionMaxC`,
    `die${index}LossEvaluationTempC`, `die${index}ConductionLossW`, `die${index}SwitchingLossW`,
    `die${index}TotalLossW`, `die${index}EvaluatedLossW`,
  )
  if (requiredKpis.some(key => !Number.isFinite(summary[key]))) invalid('空间电热KPI缺失或不是有限数')
  return digest
}

function resultInputDigest(result: JobResultV1, required = false): string | undefined {
  const digest = asRecord(result.summary)?.inputDigest
  if (digest === undefined && !required) return undefined
  if (typeof digest !== 'string' || !/^[a-f0-9]{32}$/.test(digest)) invalid('结果 inputDigest 缺失或格式无效')
  return digest
}

async function downloadVerifiedBytes(input: {
  baseUrl?: string
  jobId: string
  artifact: JobResultArtifact
  expectedSha256: string
  signal: AbortSignal
  fetchImpl?: typeof fetch
  headers?: HeadersInit
  maxBytes: number
}): Promise<{ bytes: ArrayBuffer; sha256: string }> {
  const { artifact, signal } = input
  if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > input.maxBytes) invalid('附件大小超出限制')
  if (!/^[a-f0-9]{64}$/.test(input.expectedSha256)) invalid('预期 SHA-256 格式无效')
  signal.throwIfAborted()
  const base = (input.baseUrl ?? '').replace(/\/$/, '')
  const f = input.fetchImpl ?? fetch
  const jobQuery = `?jobId=${encodeURIComponent(input.jobId)}`
  const url = `${base}/api/v1/artifacts/${encodeURIComponent(artifact.artifactId)}${jobQuery}`
  const requestHeaders = new Headers(input.headers)
  const response = await f(url, { credentials: 'include', headers: requestHeaders, cache: 'no-store', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) })
  if (!response.ok) invalid(`Host 下载失败 HTTP ${response.status}`)
  if (response.headers.get('content-type')?.split(';')[0]?.trim() !== artifact.contentType) invalid('Host Content-Type 与声明不一致')
  if (response.headers.get('content-length') !== String(artifact.bytes)) invalid('Host Content-Length 与声明不一致')
  const headerDigest = response.headers.get('x-artifact-sha256')
  if (!headerDigest || !/^[a-f0-9]{64}$/.test(headerDigest)) invalid('Host SHA-256 header 缺失或无效')
  const reader = response.body?.getReader()
  if (!reader) invalid('Host 文件内容缺失')
  const bytes = new ArrayBuffer(artifact.bytes), output = new Uint8Array(bytes)
  let offset = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (offset + value.byteLength > output.byteLength) invalid('Host 文件超过声明长度或大小限制')
      output.set(value, offset); offset += value.byteLength
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  signal.throwIfAborted()
  if (offset !== artifact.bytes) invalid('Host 文件长度与声明不一致')
  const digest = await sha256(bytes)
  if (digest !== headerDigest || digest !== input.expectedSha256) invalid('本地 SHA-256、Host header 与预期值不一致')
  return { bytes, sha256: digest }
}

/** Authenticated Host artifact GET, with byte count, content type and server+local SHA verification. */
export async function downloadThermalFieldArtifact(input: {
  baseUrl?: string
  jobId: string
  artifact: JobResultArtifact
  expectedSha256: string
  spec: JobSpecV1
  result: JobResultV1
  signal: AbortSignal
  fetchImpl?: typeof fetch
  headers?: HeadersInit
}): Promise<ThermalFieldDownload> {
  const { artifact, spec, result } = input
  if (artifact.kind !== THERMAL_FIELD_KIND || artifact.contentType !== 'application/octet-stream') invalid('温度场附件元数据/格式不支持')
  const grid = thermalGrid(spec), derived = asRecord(result.derived)
  const spatial = isIgbtSpatialSpec(spec)
  const inputDigest = spatial ? igbtSpatialInputDigest(spec, result) : resultInputDigest(result, spec.kind === 'thermal-3d-steady')
  if (derived?.fieldArtifactId !== artifact.artifactId || derived.fieldFormat !== THERMAL_FIELD_FORMAT || derived.cellCount !== grid.count || derived.fieldBytes !== artifact.bytes || derived.temperatureUnit !== grid.unit || artifact.bytes !== grid.count * 8 || !Number.isSafeInteger(grid.count)) invalid('尺寸、单位、digest或结果引用不匹配')
  if (spatial) {
    const refs = result.artifacts?.filter(saved => saved.kind === THERMAL_FIELD_KIND) ?? []
    if (refs.length !== 1 || refs[0]?.artifactId !== artifact.artifactId || refs[0]?.bytes !== artifact.bytes || refs[0]?.contentType !== artifact.contentType) invalid('空间电热场文件未由已保存结果唯一引用')
  }
  const { bytes, sha256: digest } = await downloadVerifiedBytes({ ...input, maxBytes: MAX_THERMAL_ARTIFACT_BYTES })
  const values = new Float64Array(grid.count)
  const view = new DataView(bytes)
  for (let i = 0; i < grid.count; i++) {
    const value = view.getFloat64(i * 8, true)
    if (!Number.isFinite(value)) invalid(`第 ${i} 个温度不是有限数`)
    values[i] = value
  }
  return { bytes, values, sha256: digest, inputDigest, nx: grid.nx, ny: grid.ny, nz: grid.nz, unit: grid.unit, lengthUnit: grid.lengthUnit, lengthX: grid.lengthX, lengthY: grid.lengthY, lengthZ: grid.lengthZ }
}

/** Download and bind the saved steady KPI JSON bytes to the native result summary. */
export async function downloadThermalKpiSummaryArtifact(input: {
  baseUrl?: string
  jobId: string
  artifact: JobResultArtifact
  expectedSha256: string
  spec: JobSpecV1
  result: JobResultV1
  signal: AbortSignal
  fetchImpl?: typeof fetch
  headers?: HeadersInit
}): Promise<ThermalKpiSummaryDownload> {
  const spatial = isIgbtSpatialSpec(input.spec)
  const steady = input.spec.kind === 'thermal-3d-steady' && (input.spec.parameters as Record<string, unknown>).dimension === 3
  if ((!steady && !spatial) || input.artifact.kind !== 'thermal-kpi-summary' || input.artifact.contentType !== 'application/json') invalid('稳态/空间电热KPI附件元数据或维度不支持')
  const inputDigest = spatial ? igbtSpatialInputDigest(input.spec, input.result) : resultInputDigest(input.result, true)!
  const refs = input.result.artifacts?.filter(artifact => artifact.kind === 'thermal-kpi-summary') ?? []
  if (refs.length !== 1 || refs[0]?.artifactId !== input.artifact.artifactId || refs[0]?.bytes !== input.artifact.bytes || refs[0]?.contentType !== input.artifact.contentType) invalid('KPI附件未由已保存结果唯一引用')
  const { bytes, sha256: digest } = await downloadVerifiedBytes({ ...input, maxBytes: MAX_THERMAL_ARTIFACT_BYTES })
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { invalid('KPI JSON 无效') }
  const summary = asRecord(parsed)
  if (!summary || canonicalJson(summary) !== canonicalJson(input.result.summary)) invalid('KPI JSON 与JobResult summary不一致')
  return { bytes, sha256: digest, inputDigest, summary }
}

export type ThermalExportFile = { name: string; data: ArrayBuffer | string }
export function createThermalFieldExportFiles(input: {
  field: ThermalFieldDownload
  kpi?: ThermalKpiSummaryDownload
  spec: JobSpecV1
  result: JobResultV1
}): ThermalExportFile[] {
  const { field, kpi, spec, result } = input
  const steady = spec.kind === 'thermal-3d-steady' && (spec.parameters as Record<string, unknown>).dimension === 3
  const spatial = isIgbtSpatialSpec(spec)
  if ((steady || spatial) && (!kpi || !field.inputDigest || kpi.inputDigest !== field.inputDigest)) invalid('三维稳态/空间电热导出需要匹配的KPI附件')
  const files: ThermalExportFile[] = [
    { name: 'temperature.f64le', data: field.bytes },
    ...((steady || spatial) && kpi ? [{ name: 'thermal-kpi-summary.json', data: kpi.bytes }] : []),
    { name: 'spec.json', data: JSON.stringify(spec, null, 2) },
    { name: 'result.json', data: JSON.stringify(result, null, 2) },
    { name: 'manifest.json', data: JSON.stringify({
      format: 'waveworld-thermal-field-export-v1', fieldFormat: THERMAL_FIELD_FORMAT,
      file: 'temperature.f64le', bytes: field.bytes.byteLength, sha256: field.sha256,
      dtype: 'float64-le', layout: 'x-fastest', dimensions: { nx: field.nx, ny: field.ny, nz: field.nz },
      temperatureUnit: field.unit, spec: 'spec.json', result: 'result.json',
      ...(steady && kpi ? { inputDigest: field.inputDigest, kpi: { file: 'thermal-kpi-summary.json', bytes: kpi.bytes.byteLength, sha256: kpi.sha256 } } : {}),
      ...(spatial && kpi ? { method: IGBT_SPATIAL_METHOD, inputDigest: field.inputDigest, kpi: { file: 'thermal-kpi-summary.json', bytes: kpi.bytes.byteLength, sha256: kpi.sha256 } } : {}),
      ...(spatial ? { domainSize: { x: field.lengthX, y: field.lengthY, z: field.lengthZ, lengthUnit: field.lengthUnit } } : {}),
    }, null, 2) },
  ]
  return files
}

async function writeFile(dir: FileSystemDirectoryHandle, path: string[], name: string, data: ArrayBuffer | string): Promise<void> {
  let target = dir
  for (const segment of path) target = await target.getDirectoryHandle(segment, { create: true })
  const handle = await target.getFileHandle(name, { create: true })
  const writable = await handle.createWritable()
  await writable.write(data)
  await writable.close()
}

/** Write the checked field bundle using the same user-picked directory model as frame-export.ts. */
export async function exportThermalFieldDirectory(input: {
  dir: FileSystemDirectoryHandle
  runName: string
  field: ThermalFieldDownload
  kpi?: ThermalKpiSummaryDownload
  spec: JobSpecV1
  result: JobResultV1
  signal: AbortSignal
}): Promise<void> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(input.runName) || input.runName.includes('..')) invalid('导出目录名称无效')
  for (const file of createThermalFieldExportFiles(input)) {
    input.signal.throwIfAborted()
    await writeFile(input.dir, [input.runName], file.name, file.data)
  }
}

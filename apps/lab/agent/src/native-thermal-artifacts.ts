import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import path from 'node:path'
import type { JobResultV1, JobSpecV1, JobResultArtifact } from '@w-sim/contracts'

export const THERMAL_FIELD_FORMAT = 'float64-le-x-fastest-v1'
export const THERMAL_FIELD_KIND = 'thermal-temperature-field'
export const THERMAL_HISTORY_KIND = 'thermal-history'
export const THERMAL_KPI_KIND = 'thermal-kpi-summary'
export const IGBT_SPATIAL_METHOD = 'thermal-igbt-spatial-chip-v1'
export const MAX_THERMAL_ARTIFACT_BYTES = 32 * 1024 * 1024
const FIELD_TYPE = 'application/octet-stream'
const HISTORY_TYPE = 'application/json'

export type ThermalArtifactUploadAck = { artifactId: string; bytes: number; kind: string; contentType: string; sha256: string }
export type ThermalArtifactUploader = (kind: string, contentType: string, bytes: ArrayBuffer, signal?: AbortSignal) => Promise<ThermalArtifactUploadAck>

function fail(message: string): never { throw new Error(`Invalid native thermal artifact: ${message}`) }
function safeId(id: unknown): id is string { return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) && !id.includes('..') }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value)
}
function thermalGrid(p: Record<string, unknown>): { nx: number; ny: number; nz: number; count: number } {
  let dimension: number
  if (p.dimension !== undefined && p.dimension !== null) {
    if (!Number.isSafeInteger(p.dimension) || ![1, 2, 3].includes(p.dimension as number)) fail('spec dimension is invalid')
    dimension = p.dimension as number
  } else dimension = p.nz != null || p.lengthZ != null ? 3 : p.ny != null || p.lengthY != null ? 2 : 1
  const gridN = p.gridN
  const axis = (key: 'nx' | 'ny' | 'nz', active: boolean): number => {
    if (!active) return 1
    const value = p[key] != null ? p[key] : gridN != null ? gridN : 32
    if (!Number.isSafeInteger(value)) fail(`spec ${key} must be a safe integer`)
    const n = value as number
    if (n < 2 || n > 128) fail(`spec ${key} is outside the active grid bounds`)
    return n
  }
  const nx = axis('nx', true), ny = axis('ny', dimension >= 2), nz = axis('nz', dimension >= 3)
  return { nx, ny, nz, count: nx * ny * nz }
}

/** Validate and upload native full fields and their history/KPI JSON before complete. */
export async function materializeNativeThermalArtifacts(
  spec: JobSpecV1,
  result: JobResultV1,
  resultDir: string,
  upload: ThermalArtifactUploader | undefined,
  signal?: AbortSignal,
): Promise<JobResultV1> {
  const p = spec.parameters as Record<string, unknown>
  const steady = spec.kind === 'thermal-3d-steady' && p.dimension === 3
  const spatialIgbt = spec.kind === 'electro-thermal-igbt' && p.mode === 'spatial-chip'
  if (spec.kind !== 'thermal-3d-transient' && !steady && !spatialIgbt) return result
  if (spatialIgbt && result.backend?.id !== 'native-cuda') fail('spatial-chip results require native-cuda')
  if (!upload) fail('artifact uploader is unavailable')
  signal?.throwIfAborted()
  const { nx, ny, nz, count } = thermalGrid(p)
  const expectedBytes = count * 8
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > MAX_THERMAL_ARTIFACT_BYTES) fail('field exceeds byte limit')
  const unit = (p.units as Record<string, unknown> | undefined)?.temperature
  if (typeof unit !== 'string' || !['C', 'K'].includes(unit)) fail('spec temperature unit must be C or K')
  const derived = result.derived as Record<string, unknown> | undefined
  if (derived?.fieldFormat !== THERMAL_FIELD_FORMAT || derived.cellCount !== count || derived.fieldBytes !== expectedBytes || derived.temperatureUnit !== unit) fail('result field metadata does not match spec')
  if (spatialIgbt && (p.dimension !== 3 || (p.units as Record<string, unknown> | undefined)?.length !== 'm' || derived.dimension !== 3 || derived.lengthUnit !== 'm')) fail('spatial-chip field dimension or length unit does not match spec')
  const summary = result.summary as Record<string, unknown>
  if (summary.gridNx !== nx || summary.gridNy !== ny || summary.gridNz !== nz) fail('summary grid dimensions do not match spec')
  if ((steady || spatialIgbt) && (summary.cellCount !== count || typeof summary.inputDigest !== 'string' || !/^[a-f0-9]{32}$/.test(summary.inputDigest))) fail('steady summary cell count or input digest is invalid')
  if (derived.fieldInline !== (count <= 256 ? 1 : 0) || (count > 256 && derived.temperatureCsv !== undefined)) fail('inline field declaration does not match cell count')
  const tempRoot = path.resolve(resultDir)
  const artifactsRoot = path.join(tempRoot, 'artifacts')
  const rootStat = await lstat(artifactsRoot)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail('artifacts directory is not a regular directory')
  const fieldId = derived.fieldArtifactId
  const descriptors = result.artifacts ?? []
  const hasKpi = steady || spatialIgbt
  const secondaryKind = hasKpi ? THERMAL_KPI_KIND : THERMAL_HISTORY_KIND
  const secondaryId = hasKpi ? descriptors.find(a => a.kind === secondaryKind)?.artifactId : derived.historyArtifactId
  if (!safeId(fieldId) || !safeId(secondaryId) || fieldId === secondaryId) fail('artifact identifiers are unsafe or duplicated')
  if (descriptors.length !== 2) fail('thermal result must declare exactly two artifacts')
  const fieldDescriptor = descriptors.find(a => a.artifactId === fieldId)
  const secondaryDescriptor = descriptors.find(a => a.artifactId === secondaryId)
  if (!fieldDescriptor || fieldDescriptor.kind !== THERMAL_FIELD_KIND || fieldDescriptor.contentType !== FIELD_TYPE || fieldDescriptor.bytes !== expectedBytes ||
      !secondaryDescriptor || secondaryDescriptor.kind !== secondaryKind || secondaryDescriptor.contentType !== HISTORY_TYPE || !Number.isSafeInteger(secondaryDescriptor.bytes) || secondaryDescriptor.bytes < 1 || secondaryDescriptor.bytes > MAX_THERMAL_ARTIFACT_BYTES) fail('artifact descriptors do not exactly match local references')

  async function readRegular(id: string, expected: number | null): Promise<Buffer> {
    const file = path.join(artifactsRoot, id)
    if (path.dirname(file) !== artifactsRoot) fail('artifact path escapes work directory')
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || (expected !== null && stat.size !== expected) || stat.size < 1 || stat.size > MAX_THERMAL_ARTIFACT_BYTES) fail(`${id} has an invalid size`)
      return await handle.readFile()
    } finally { await handle.close() }
  }
  const field = await readRegular(fieldId, expectedBytes)
  let min = Infinity, max = -Infinity
  for (let offset = 0; offset < field.byteLength; offset += 8) {
    const value = field.readDoubleLE(offset)
    if (!Number.isFinite(value)) fail(`field contains a non-finite value at cell ${offset / 8}`)
    min = Math.min(min, value); max = Math.max(max, value)
  }
  if (steady || spatialIgbt) {
    if (summary.tMin !== min || summary.tMax !== max) fail('steady field extrema do not match summary')
    if (count <= 256) {
      if (typeof derived.temperatureCsv !== 'string') fail('inline temperature CSV is missing')
      const tokens = derived.temperatureCsv.split(',')
      if (tokens.length !== count) fail('inline temperature CSV cell count does not match field')
      for (let i = 0; i < count; i++) {
        const token = tokens[i]!.trim()
        if (!/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(token) || !Number.isFinite(Number(token)) || Number(token) !== field.readDoubleLE(i * 8)) fail(`inline temperature CSV differs from field at cell ${i}`)
      }
    }
  }
  const secondary = await readRegular(secondaryId, secondaryDescriptor.bytes)
  let parsedSecondary: unknown
  try { parsedSecondary = JSON.parse(secondary.toString('utf8')) } catch { return fail(`${hasKpi ? 'KPI' : 'history'} is not valid JSON`) }
  if (spatialIgbt) validateSpatialIgbtSummary(spec, result, summary, count)
  if (canonical(parsedSecondary) !== canonical(hasKpi ? result.summary : result.history)) fail(`${hasKpi ? 'KPI' : 'history'} artifact does not equal result.${hasKpi ? 'summary' : 'history'}`)
  signal?.throwIfAborted()

  const fieldAck = await upload(THERMAL_FIELD_KIND, FIELD_TYPE, field.buffer.slice(field.byteOffset, field.byteOffset + field.byteLength) as ArrayBuffer, signal)
  validateAck(fieldAck, THERMAL_FIELD_KIND, FIELD_TYPE, field.byteLength, field)
  signal?.throwIfAborted()
  const secondaryAck = await upload(secondaryKind, HISTORY_TYPE, secondary.buffer.slice(secondary.byteOffset, secondary.byteOffset + secondary.byteLength) as ArrayBuffer, signal)
  validateAck(secondaryAck, secondaryKind, HISTORY_TYPE, secondary.byteLength, secondary)
  if (fieldAck.artifactId === secondaryAck.artifactId) fail('uploader returned duplicate artifact identifiers')

  const refs: JobResultArtifact[] = [
    { artifactId: fieldAck.artifactId, kind: fieldAck.kind, contentType: fieldAck.contentType, bytes: fieldAck.bytes },
    { artifactId: secondaryAck.artifactId, kind: secondaryAck.kind, contentType: secondaryAck.contentType, bytes: secondaryAck.bytes },
  ]
  return { ...result, artifacts: [...(result.artifacts ?? []).filter(a => a.artifactId !== fieldId && a.artifactId !== secondaryId), ...refs],
    derived: { ...derived, fieldArtifactId: fieldAck.artifactId, ...(!hasKpi ? { historyArtifactId: secondaryAck.artifactId } : {}) } }
}

function validateSpatialIgbtSummary(spec: JobSpecV1, result: JobResultV1, summary: Record<string, unknown>, count: number): void {
  const p = spec.parameters as Record<string, unknown>
  const dies = Array.isArray(p.dies) ? p.dies : []
  const digest = summary.inputDigest
  const derived = result.derived as Record<string, unknown> | undefined
  if (summary.method !== IGBT_SPATIAL_METHOD || typeof digest !== 'string' || !/^[a-f0-9]{32}$/.test(digest) || derived?.inputDigest !== digest) fail('spatial-chip method or input digest is invalid')
  if (dies.length < 1 || dies.length > 16 || summary.cellCount !== count || summary.dieCount !== dies.length || summary.converged !== 1 || summary.convergenceStatus !== 'converged') fail('spatial-chip summary counts or convergence status do not match spec')
  const ids = dies.map((die) => die && typeof die === 'object' ? (die as Record<string, unknown>).id : undefined)
  if (!ids.every((id) => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(id)) || new Set(ids).size !== ids.length || typeof derived?.igbtDieIds !== 'string' || derived.igbtDieIds !== JSON.stringify(ids)) fail('spatial-chip ordered die IDs do not match spec')
  const finiteKeys = [
    'tMin', 'tMax', 'tjMaxC', 'caseMeanC', 'sourcePowerW', 'totalLossW', 'conductionLossW', 'switchingLossW',
    'energyImbalance', 'residual', 'iterations', 'steps', 'wallTimeMs', 'couplingIterations',
    'temperatureChangeC', 'relativePowerChange', 'gridNx', 'gridNy', 'gridNz', 'cellCount', 'dieCount',
    'heatFlowInW', 'heatFlowLeftW', 'heatFlowRightW', 'heatFlowBottomW', 'heatFlowTopW', 'heatFlowFrontW', 'heatFlowBackW',
  ]
  for (const key of finiteKeys) if (typeof summary[key] !== 'number' || !Number.isFinite(summary[key])) fail(`spatial-chip KPI ${key} is missing or non-finite`)
  for (const [key, value] of Object.entries(summary)) if (typeof value === 'number' && !Number.isFinite(value)) fail(`spatial-chip KPI ${key} is non-finite`)
  for (let i = 0; i < dies.length; i++) {
    for (const metric of ['JunctionMeanC', 'JunctionMinC', 'JunctionMaxC', 'LossEvaluationTempC', 'ConductionLossW', 'SwitchingLossW', 'TotalLossW', 'EvaluatedLossW']) {
      const key = `die${i}${metric}`
      if (typeof summary[key] !== 'number' || !Number.isFinite(summary[key])) fail(`spatial-chip KPI ${key} is missing or non-finite`)
    }
  }
  const tolerances = (p.coupling ?? {}) as Record<string, unknown>
  const tempTol = tolerances.temperatureToleranceC ?? 1e-8
  const powerTol = tolerances.relativePowerTolerance ?? 1e-10
  const couplingLimit = tolerances.maxIterations ?? 100
  const innerLimit = p.maxIterations ?? 50_000
  const residualTol = p.residualTol ?? 1e-12
  const iterations = summary.iterations as number
  const couplingIterations = summary.couplingIterations as number
  if (typeof tempTol !== 'number' || !Number.isFinite(tempTol) || tempTol <= 0 ||
      typeof powerTol !== 'number' || !Number.isFinite(powerTol) || powerTol <= 0 ||
      typeof couplingLimit !== 'number' || !Number.isSafeInteger(couplingLimit) || couplingLimit < 1 ||
      typeof innerLimit !== 'number' || !Number.isSafeInteger(innerLimit) || innerLimit < 1 ||
      typeof residualTol !== 'number' || !Number.isFinite(residualTol) || residualTol <= 0 ||
      !Number.isSafeInteger(summary.steps) || (summary.steps as number) < 1 ||
      !Number.isSafeInteger(couplingIterations) || couplingIterations < 1 || couplingIterations > couplingLimit || summary.steps !== couplingIterations ||
      !Number.isSafeInteger(iterations) || iterations < 1 || iterations > couplingIterations * innerLimit ||
      (summary.wallTimeMs as number) < 0 || (summary.temperatureChangeC as number) < 0 ||
      (summary.relativePowerChange as number) < 0 || (summary.residual as number) < 0 || (summary.residual as number) >= residualTol ||
      (summary.temperatureChangeC as number) > tempTol || (summary.relativePowerChange as number) > powerTol) fail('spatial-chip convergence metrics or counts exceed submitted limits')
  const maxJunctionTempC = tolerances.maxJunctionTempC
  if (typeof maxJunctionTempC !== 'number' || (summary.tjMaxC as number) > maxJunctionTempC) fail('spatial-chip junction temperature exceeds the submitted limit')
  const caseFace = p.caseFace
  const boundaries = p.boundaries as Record<string, unknown> | undefined
  const caseBoundary = boundaries?.[String(caseFace)] as Record<string, unknown> | undefined
  if (caseBoundary?.type === 'robin') {
    if (typeof summary.ambientTempC !== 'number' || !Number.isFinite(summary.ambientTempC)) fail('spatial-chip Robin case requires finite ambientTempC')
  } else if (summary.ambientTempC !== undefined) fail('spatial-chip non-Robin case must omit ambientTempC')
}

function validateAck(ack: ThermalArtifactUploadAck, kind: string, contentType: string, bytes: number, data: Buffer): void {
  if (!ack || !safeId(ack.artifactId) || ack.kind !== kind || ack.contentType !== contentType || ack.bytes !== bytes) fail(`uploader acknowledgement mismatch for ${kind}`)
  if (!/^[a-f0-9]{64}$/.test(ack.sha256) || ack.sha256 !== createHash('sha256').update(data).digest('hex')) fail(`uploader digest mismatch for ${kind}`)
}

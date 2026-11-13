import { createHash } from 'node:crypto'
import type { JobRecord } from '../../types/task'
import type { JobResultArtifact, JobResultV1 } from '../../types/task'
import type { StoredArtifact } from './artifacts'

export const THERMAL_FIELD_FORMAT = 'float64-le-x-fastest-v1'
export const THERMAL_FIELD_KIND = 'thermal-temperature-field'
export const THERMAL_HISTORY_KIND = 'thermal-history'
export const THERMAL_KPI_KIND = 'thermal-kpi-summary'
export const IGBT_SPATIAL_METHOD = 'thermal-igbt-spatial-chip-v1'
export const MAX_THERMAL_ARTIFACT_BYTES = 32 * 1024 * 1024

export type ThermalArtifactLookup = (id: string) => { meta: StoredArtifact; data: Uint8Array } | null

function reject(message: string): never { throw new Error(`Invalid thermal artifact: ${message}`) }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value)
}
function transientGrid(p: Record<string, unknown>): { nx: number; ny: number; nz: number; count: number } {
  let dimension: number
  if (p.dimension !== undefined && p.dimension !== null) {
    if (!Number.isSafeInteger(p.dimension) || ![1, 2, 3].includes(p.dimension as number)) reject('submitted dimension is invalid')
    dimension = p.dimension as number
  } else dimension = p.nz != null || p.lengthZ != null ? 3 : p.ny != null || p.lengthY != null ? 2 : 1
  const gridN = p.gridN
  const axis = (key: 'nx' | 'ny' | 'nz', active: boolean): number => {
    if (!active) return 1
    const value = p[key] != null ? p[key] : gridN != null ? gridN : 32
    if (!Number.isSafeInteger(value)) reject(`submitted ${key} must be a safe integer`)
    const n = value as number
    if (n < 2 || n > 128) reject(`submitted ${key} is outside the active grid bounds`)
    return n
  }
  const nx = axis('nx', true), ny = axis('ny', dimension >= 2), nz = axis('nz', dimension >= 3)
  return { nx, ny, nz, count: nx * ny * nz }
}

/** Complete-time integrity check for saved thermal fields; storage remains Host-owned. */
export function validateThermalArtifacts(input: {
  job: Pick<JobRecord, 'id' | 'agentId' | 'createdBy' | 'projectId' | 'spec'>
  agentId: string
  result: JobResultV1
  lookup: ThermalArtifactLookup
}): void {
  const { job, agentId, result, lookup } = input
  const isTransient = job.spec.kind === 'thermal-3d-transient'
  const p = (job.spec.parameters ?? {}) as Record<string, unknown>
  const isIgbtSpatial = job.spec.kind === 'electro-thermal-igbt' && p.mode === 'spatial-chip'
  const isSteady3d = (job.spec.kind === 'thermal-3d-steady' && p.dimension === 3) || isIgbtSpatial
  if (!isTransient && !isSteady3d) return
  if (isIgbtSpatial && result.backend?.id !== 'native-cuda') reject('spatial-chip completion requires native-cuda')
  if (!job.agentId || job.agentId !== agentId) reject('settling agent does not own this job lease')
  const { nx, ny, nz, count } = transientGrid(p)
  const bytes = count * 8
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_THERMAL_ARTIFACT_BYTES) reject('field exceeds byte limit')
  const d = result.derived as Record<string, unknown> | undefined
  const unit = (p.units as Record<string, unknown> | undefined)?.temperature
  if (typeof unit !== 'string' || !['C', 'K'].includes(unit) || d?.fieldFormat !== THERMAL_FIELD_FORMAT || d.cellCount !== count || d.fieldBytes !== bytes || d.temperatureUnit !== unit) reject('field metadata does not match submitted spec')
  const summary = (result.summary ?? {}) as Record<string, unknown>
  if (summary.gridNx !== nx || summary.gridNy !== ny || summary.gridNz !== nz) reject('summary grid dimensions do not match submitted spec')
  if (isSteady3d && (d.dimension !== 3 || d.lengthUnit !== 'm' || (p.units as Record<string, unknown> | undefined)?.length !== 'm' || summary.cellCount !== count)) reject('steady field units, dimension, or cell count do not match submitted spec')
  if (d.fieldInline !== (count <= 256 ? 1 : 0) || (count > 256 && d.temperatureCsv !== undefined)) reject('inline field declaration does not match cell count')
  if (count <= 256 && typeof d.temperatureCsv !== 'string') reject('inline temperature CSV is missing')
  const fieldId = d.fieldArtifactId
  const auxiliaryKind = isTransient ? THERMAL_HISTORY_KIND : THERMAL_KPI_KIND
  const auxiliaryId = isTransient ? d.historyArtifactId : undefined
  if (typeof fieldId !== 'string' || !fieldId || (isTransient && (typeof auxiliaryId !== 'string' || !auxiliaryId || fieldId === auxiliaryId))) reject('field/summary artifact references are missing')
  const refs = result.artifacts ?? []
  const fieldRefs = refs.filter(a => a.artifactId === fieldId)
  const auxiliaryRefs = isTransient ? refs.filter(a => a.artifactId === auxiliaryId) : refs.filter(a => a.kind === auxiliaryKind)
  const fieldRef = fieldRefs[0], auxiliaryRef = auxiliaryRefs[0]
  if (refs.length !== 2 || fieldRefs.length !== 1 || auxiliaryRefs.length !== 1 || !fieldRef || !auxiliaryRef || fieldRef.artifactId === auxiliaryRef.artifactId || refs.filter(a => a.kind === THERMAL_FIELD_KIND).length !== 1 || refs.filter(a => a.kind === auxiliaryKind).length !== 1) reject('result artifact references are incomplete or ambiguous')
  const field = verifyStored(fieldRef, THERMAL_FIELD_KIND, 'application/octet-stream', job, lookup, bytes)
  const view = new DataView(field.buffer, field.byteOffset, field.byteLength)
  let min = Infinity, max = -Infinity
  for (let i = 0; i < count; i++) {
    const t = view.getFloat64(i * 8, true)
    if (!Number.isFinite(t)) reject(`field contains a non-finite value at cell ${i}`)
    min = Math.min(min, t); max = Math.max(max, t)
  }
  if (count <= 256) {
    const values = (d.temperatureCsv as string).split(',')
    if (values.length !== count) reject('inline temperature CSV cell count does not match field')
    for (let i = 0; i < count; i++) {
      const token = values[i]!
      const decimal = token.trim()
      if (decimal === '' || !/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(decimal)) reject(`inline temperature CSV has an invalid decimal value at cell ${i}`)
      const parsed = Number(decimal)
      if (!Number.isFinite(parsed)) reject(`inline temperature CSV has a non-finite value at cell ${i}`)
      if (parsed !== view.getFloat64(i * 8, true)) reject(`inline temperature CSV differs from field at cell ${i}`)
    }
  }
  const auxiliary = verifyStored(auxiliaryRef, auxiliaryKind, 'application/json', job, lookup, MAX_THERMAL_ARTIFACT_BYTES)
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder().decode(auxiliary)) } catch { return reject(`${isTransient ? 'history' : 'KPI summary'} artifact is not valid JSON`) }
  if (typeof summary.tMin !== 'number' || !Number.isFinite(summary.tMin) || typeof summary.tMax !== 'number' || !Number.isFinite(summary.tMax) || summary.tMin !== min || summary.tMax !== max) reject('field extrema do not match result summary')
  if (isIgbtSpatial) validateSpatialIgbtSummary(job.spec, result, summary, count)
  else if (isSteady3d) validateSteadySummary(summary)
  if (canonical(parsed) !== canonical(isTransient ? result.history : result.summary)) reject(`${isTransient ? 'history' : 'KPI summary'} artifact differs from completed result`)
}

/** Kept as the existing caller-facing name while both thermal paths share one validator. */
export function validateThermalTransientArtifacts(input: Parameters<typeof validateThermalArtifacts>[0]): void {
  validateThermalArtifacts(input)
}

function validateSteadySummary(summary: Record<string, unknown>): void {
  const digest = summary.inputDigest
  if (typeof digest !== 'string' || !/^[a-f0-9]{32}$/.test(digest)) reject('steady summary input digest is invalid')
  const requiredFinite = ['sourcePowerW', 'heatFlowInW', 'energyImbalance', 'residual']
  for (const key of requiredFinite) if (typeof summary[key] !== 'number' || !Number.isFinite(summary[key])) reject(`steady KPI ${key} is missing or non-finite`)
}

function validateSpatialIgbtSummary(spec: JobRecord['spec'], result: JobResultV1, summary: Record<string, unknown>, count: number): void {
  const p = spec.parameters as Record<string, unknown>
  const dies = Array.isArray(p.dies) ? p.dies : []
  const derived = result.derived as Record<string, unknown> | undefined
  const digest = summary.inputDigest
  if (summary.method !== IGBT_SPATIAL_METHOD || typeof digest !== 'string' || !/^[a-f0-9]{32}$/.test(digest) || derived?.inputDigest !== digest) reject('spatial-chip method or input digest does not match result metadata')
  if (dies.length < 1 || dies.length > 16 || summary.cellCount !== count || summary.dieCount !== dies.length || summary.converged !== 1 || summary.convergenceStatus !== 'converged') reject('spatial-chip cell/die counts or convergence status do not match submitted job')
  const ids = dies.map(die => die && typeof die === 'object' ? (die as Record<string, unknown>).id : undefined)
  if (!ids.every(id => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(id)) || new Set(ids).size !== ids.length || typeof derived?.igbtDieIds !== 'string' || derived.igbtDieIds !== JSON.stringify(ids)) reject('spatial-chip ordered die IDs do not match submitted job')
  const finiteKeys = [
    'tMin', 'tMax', 'tjMaxC', 'caseMeanC', 'sourcePowerW', 'totalLossW', 'conductionLossW', 'switchingLossW',
    'energyImbalance', 'residual', 'iterations', 'steps', 'wallTimeMs', 'couplingIterations', 'temperatureChangeC',
    'relativePowerChange', 'gridNx', 'gridNy', 'gridNz', 'cellCount', 'dieCount',
    'heatFlowInW', 'heatFlowLeftW', 'heatFlowRightW', 'heatFlowBottomW', 'heatFlowTopW', 'heatFlowFrontW', 'heatFlowBackW',
  ]
  for (const key of finiteKeys) if (typeof summary[key] !== 'number' || !Number.isFinite(summary[key])) reject(`spatial-chip KPI ${key} is missing or non-finite`)
  for (const [key, value] of Object.entries(summary)) if (typeof value === 'number' && !Number.isFinite(value)) reject(`spatial-chip KPI ${key} is non-finite`)
  for (let i = 0; i < dies.length; i++) {
    for (const metric of ['JunctionMeanC', 'JunctionMinC', 'JunctionMaxC', 'LossEvaluationTempC', 'ConductionLossW', 'SwitchingLossW', 'TotalLossW', 'EvaluatedLossW']) {
      const key = `die${i}${metric}`
      if (typeof summary[key] !== 'number' || !Number.isFinite(summary[key])) reject(`spatial-chip KPI ${key} is missing or non-finite`)
    }
  }
  const coupling = (p.coupling ?? {}) as Record<string, unknown>
  const temperatureTolerance = coupling.temperatureToleranceC ?? 1e-8
  const relativePowerTolerance = coupling.relativePowerTolerance ?? 1e-10
  const couplingLimit = coupling.maxIterations ?? 100
  const innerLimit = p.maxIterations ?? 50_000
  const residualTolerance = p.residualTol ?? 1e-12
  const iterations = summary.iterations as number
  const couplingIterations = summary.couplingIterations as number
  if (typeof temperatureTolerance !== 'number' || !Number.isFinite(temperatureTolerance) || temperatureTolerance <= 0 ||
      typeof relativePowerTolerance !== 'number' || !Number.isFinite(relativePowerTolerance) || relativePowerTolerance <= 0 ||
      typeof couplingLimit !== 'number' || !Number.isSafeInteger(couplingLimit) || couplingLimit < 1 ||
      typeof innerLimit !== 'number' || !Number.isSafeInteger(innerLimit) || innerLimit < 1 ||
      typeof residualTolerance !== 'number' || !Number.isFinite(residualTolerance) || residualTolerance <= 0 ||
      !Number.isSafeInteger(summary.steps) || (summary.steps as number) < 1 ||
      !Number.isSafeInteger(couplingIterations) || couplingIterations < 1 || couplingIterations > couplingLimit || summary.steps !== couplingIterations ||
      !Number.isSafeInteger(iterations) || iterations < 1 || iterations > couplingIterations * innerLimit ||
      (summary.wallTimeMs as number) < 0 || (summary.temperatureChangeC as number) < 0 ||
      (summary.relativePowerChange as number) < 0 || (summary.residual as number) < 0 || (summary.residual as number) >= residualTolerance ||
      (summary.temperatureChangeC as number) > temperatureTolerance || (summary.relativePowerChange as number) > relativePowerTolerance) reject('spatial-chip convergence metrics or counts exceed submitted limits')
  const maximum = coupling.maxJunctionTempC
  if (typeof maximum !== 'number' || (summary.tjMaxC as number) > maximum) reject('spatial-chip junction temperature exceeds the submitted limit')
  const face = p.caseFace
  const boundaries = p.boundaries as Record<string, unknown> | undefined
  const caseBoundary = boundaries?.[String(face)] as Record<string, unknown> | undefined
  if (caseBoundary?.type === 'robin') {
    if (typeof summary.ambientTempC !== 'number' || !Number.isFinite(summary.ambientTempC)) reject('spatial-chip Robin case requires finite ambientTempC')
  } else if (summary.ambientTempC !== undefined) reject('spatial-chip non-Robin case must omit ambientTempC')
}

function verifyStored(ref: JobResultArtifact, kind: string, contentType: string, job: { id: string; createdBy: string | null; projectId?: string | null }, lookup: ThermalArtifactLookup, limit: number): Uint8Array {
  if (ref.kind !== kind || ref.contentType !== contentType || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > limit) reject(`result metadata for ${kind} is invalid`)
  const saved = lookup(ref.artifactId)
  if (!saved) reject(`${kind} artifact is missing or corrupt`)
  const { meta, data } = saved
  if (meta.id !== ref.artifactId || meta.jobId !== job.id || meta.kind !== kind || meta.contentType !== contentType || meta.bytes !== ref.bytes || data.byteLength !== ref.bytes) reject(`${kind} is not attached to this job or metadata differs`)
  if (meta.ownerUserId !== job.createdBy || meta.projectId !== (job.projectId ?? null)) reject(`${kind} artifact is outside job ownership scope`)
  const digest = createHash('sha256').update(data).digest('hex')
  if (!meta.sha256 || digest !== meta.sha256) reject(`${kind} artifact SHA-256 mismatch`)
  return data
}

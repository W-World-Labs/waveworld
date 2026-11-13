import type { JobResultV1 } from '@w-sim/contracts'
import { readModuleResult, type ModuleComputeInput } from './module-compute'
import type { LensTraceInput } from './lens-study-input'

export type LensRayOutcome = {
  status: 'ok' | 'vignetted' | 'invalid_geometry' | 'total_internal_reflection'
  opticalPathLength: number
  imageSpot: [number, number] | null
  lastPosition: [number, number, number]
  direction: [number, number, number]
}

export type LensStudyResult = {
  rays: LensRayOutcome[]
  validSpotCount: number
  imageCentroid: [number, number] | null
  imageRmsRadius: number | null
  backend: Record<string, unknown>
}

type RecordValue = Record<string, unknown>

function object(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as RecordValue
}

function finite(value: unknown, label: string, min = -Infinity): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new Error(`${label} must be a finite number${Number.isFinite(min) ? ` >= ${min}` : ''}`)
  }
}

function vector(value: unknown, length: number, label: string): number[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`${label} must be a ${length}-vector`)
  value.forEach((part, index) => finite(part, `${label}[${index}]`))
  return value as number[]
}

function close(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > 1e-9 * Math.max(1, Math.abs(expected))) {
    throw new Error(`lens study ${label} is inconsistent with returned spots`)
  }
}

/** Read and validate native output without deriving or reconstructing ray physics. */
export function readLensStudyResult(result: JobResultV1, submitted: LensTraceInput): LensStudyResult {
  const output = object(readModuleResult(result, submitted as unknown as ModuleComputeInput), 'lens module result')
  if (output.module !== 'lens-design') throw new Error('lens result module does not match the submitted study')

  const backend = object(output.backend, 'lens backend provenance')
  if (backend.id !== 'w-sim-cuda-host' || backend.kind !== 'host-f64') {
    throw new Error('lens result must report the w-sim-cuda-host host-f64 backend')
  }

  const payload = object(output.result, 'lens result payload')
  if (payload.methodId !== 'method-algo-lens-geometric-ray-trace' || payload.familyId !== 'method-lens-design') {
    throw new Error('lens result method or family does not match the native geometric ray trace')
  }
  if (payload.ok !== true || payload.finite !== true) throw new Error('lens result must report a finite successful native trace')
  if (!Array.isArray(payload.rays) || payload.rays.length !== submitted.rays.length) {
    throw new Error('lens result ray count does not match the submitted bundle')
  }

  let spots: Array<[number, number]> = []
  const rays = payload.rays.map((raw, index): LensRayOutcome => {
    const ray = object(raw, `lens ray ${index}`)
    const statuses: LensRayOutcome['status'][] = ['ok', 'vignetted', 'invalid_geometry', 'total_internal_reflection']
    if (!statuses.includes(ray.status as LensRayOutcome['status'])) throw new Error(`lens ray ${index} has an unknown status`)
    const status = ray.status as LensRayOutcome['status']
    finite(ray.opticalPathLength, `lens ray ${index} opticalPathLength`, 0)
    const lastPosition = vector(ray.lastPosition, 3, `lens ray ${index} lastPosition`) as [number, number, number]
    const direction = vector(ray.direction, 3, `lens ray ${index} direction`) as [number, number, number]
    let imageSpot: [number, number] | null
    if (status === 'ok') {
      imageSpot = vector(ray.imageSpot, 2, `lens ray ${index} imageSpot`) as [number, number]
      spots.push(imageSpot)
    } else {
      if (ray.imageSpot !== null) throw new Error(`lens ray ${index} must not report an image spot for status ${status}`)
      imageSpot = null
    }
    return { status, opticalPathLength: ray.opticalPathLength, imageSpot, lastPosition, direction }
  })

  const validSpotCount = rays.filter(ray => ray.status === 'ok').length
  if (!Number.isInteger(payload.validSpotCount) || payload.validSpotCount !== validSpotCount) {
    throw new Error('lens validSpotCount does not match returned successful rays')
  }
  let imageCentroid: [number, number] | null
  let imageRmsRadius: number | null
  if (validSpotCount === 0) {
    if (payload.imageCentroid !== null || payload.imageRmsRadius !== null) {
      throw new Error('lens aggregates must be null when no ray has a valid image spot')
    }
    imageCentroid = null
    imageRmsRadius = null
  } else {
    const centroid = vector(payload.imageCentroid, 2, 'lens imageCentroid') as [number, number]
    finite(payload.imageRmsRadius, 'lens imageRmsRadius', 0)
    const mean: [number, number] = [
      spots.reduce((sum, spot) => sum + spot[0], 0) / spots.length,
      spots.reduce((sum, spot) => sum + spot[1], 0) / spots.length,
    ]
    const rms = Math.sqrt(spots.reduce((sum, spot) => sum + (spot[0] - mean[0]) ** 2 + (spot[1] - mean[1]) ** 2, 0) / spots.length)
    close(centroid[0], mean[0], 'image centroid x')
    close(centroid[1], mean[1], 'image centroid y')
    close(payload.imageRmsRadius, rms, 'image RMS radius')
    imageCentroid = centroid
    imageRmsRadius = payload.imageRmsRadius
  }

  return { rays, validSpotCount, imageCentroid, imageRmsRadius, backend }
}

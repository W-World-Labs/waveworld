/** Safe, UI-facing subset of the existing sw-su2-mesh-import result. */

export type Su2MeshMarkerResult = {
  tag: string
  elementCount: number
  elementTypeCounts: Record<string, number>
  measure: number
}

export type ValidatedSu2MeshResult = {
  format: 'su2-native'
  dimension: 2 | 3
  elementDimension: number
  nodeCount: number
  elementCount: number
  markerCount: number
  markerElementCount: number
  markers: Su2MeshMarkerResult[]
  boundingBox: { xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number }
  elementTypeCounts: Record<string, number>
  elementTypeMeasure: Record<string, number>
  totalLength: number
  totalArea: number
  totalVolume: number
  totalMarkerMeasure: number
  minElementMeasure: number
  maxElementMeasure: number
  referencedNodeCount: number
  unusedNodeCount: number
  maxNodeIndex: number | null
  invertedElements: number
  ok: boolean
  methodId: 'method-algo-su2-native-mesh-import'
  familyId: 'mesh-generation'
}

export type Su2MeshResultValidation =
  | { ok: true; result: ValidatedSu2MeshResult }
  | { ok: false; errors: string[] }

type ObjectValue = Record<string, unknown>

function isObject(value: unknown): value is ObjectValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function countMap(value: unknown): value is Record<string, number> {
  return isObject(value) && Object.values(value).every(isCount)
}

function measureMap(value: unknown): value is Record<string, number> {
  return isObject(value) && Object.values(value).every(isFiniteNonNegative)
}

/**
 * Validates the existing Host result envelope and native module summary. Unknown
 * response fields are ignored so additive Host/native metadata remains usable.
 */
export function validateSu2MeshResult(output: unknown): Su2MeshResultValidation {
  const errors: string[] = []
  if (!isObject(output)) return { ok: false, errors: ['Result envelope must be an object.'] }
  const moduleResult = output.moduleResult
  if (!isObject(moduleResult)) return { ok: false, errors: ['Result moduleResult must be an object.'] }
  if (moduleResult.module !== 'sw-su2-mesh-import') errors.push('Result module must be sw-su2-mesh-import.')
  if (!isObject(moduleResult.backend) || typeof moduleResult.backend.id !== 'string') {
    errors.push('Result module backend must include its native backend id.')
  }
  const raw = moduleResult.result
  if (!isObject(raw)) return { ok: false, errors: [...errors, 'Result moduleResult.result must be an object.'] }

  if (raw.format !== 'su2-native') errors.push('Result format must be su2-native.')
  if (raw.methodId !== 'method-algo-su2-native-mesh-import') errors.push('Result methodId does not match the native SU2 mesh importer.')
  if (raw.familyId !== 'mesh-generation') errors.push('Result familyId must be mesh-generation.')
  if (raw.dimension !== 2 && raw.dimension !== 3) errors.push('Result dimension must be 2 or 3.')
  if (!isCount(raw.elementDimension) || raw.elementDimension > 3 || (raw.dimension === 2 && raw.elementDimension > 2)) errors.push('Result elementDimension must be a non-negative dimension no greater than the mesh dimension.')

  const countFields = ['nodeCount', 'elementCount', 'markerCount', 'markerElementCount', 'referencedNodeCount', 'unusedNodeCount', 'invertedElements'] as const
  for (const field of countFields) if (!isCount(raw[field])) errors.push(`Result ${field} must be a non-negative integer.`)
  for (const field of ['totalLength', 'totalArea', 'totalVolume', 'totalMarkerMeasure', 'minElementMeasure', 'maxElementMeasure'] as const) {
    if (!isFiniteNonNegative(raw[field])) errors.push(`Result ${field} must be a finite non-negative number.`)
  }
  if (typeof raw.ok !== 'boolean') errors.push('Result ok must be a boolean.')
  if (!countMap(raw.elementTypeCounts)) errors.push('Result elementTypeCounts must map element names to non-negative integer counts.')
  if (!measureMap(raw.elementTypeMeasure)) errors.push('Result elementTypeMeasure must map element names to finite non-negative measures.')

  let box: ValidatedSu2MeshResult['boundingBox'] | null = null
  if (!isObject(raw.boundingBox)) {
    errors.push('Result boundingBox must be an object.')
  } else {
    const rawBox = raw.boundingBox
    const keys = ['xMin', 'xMax', 'yMin', 'yMax', 'zMin', 'zMax'] as const
    if (keys.some((key) => typeof rawBox[key] !== 'number' || !Number.isFinite(rawBox[key]))) {
      errors.push('Result boundingBox coordinates must be finite numbers.')
    } else {
      const b = rawBox as ValidatedSu2MeshResult['boundingBox']
      box = b
      if (b.xMin > b.xMax || b.yMin > b.yMax || b.zMin > b.zMax) errors.push('Result boundingBox minima must not exceed maxima.')
    }
  }

  const markers: Su2MeshMarkerResult[] = []
  if (!Array.isArray(raw.markers)) {
    errors.push('Result markers must be an array.')
  } else {
    raw.markers.forEach((marker, index) => {
      if (!isObject(marker)) { errors.push(`Result marker ${index + 1} must be an object.`); return }
      if (typeof marker.tag !== 'string') errors.push(`Result marker ${index + 1} tag must be a string.`)
      if (!isCount(marker.elementCount)) errors.push(`Result marker ${index + 1} elementCount must be a non-negative integer.`)
      if (!countMap(marker.elementTypeCounts)) errors.push(`Result marker ${index + 1} elementTypeCounts must contain non-negative integer counts.`)
      if (!isFiniteNonNegative(marker.measure)) errors.push(`Result marker ${index + 1} measure must be a finite non-negative number.`)
      if (typeof marker.tag === 'string' && isCount(marker.elementCount) && countMap(marker.elementTypeCounts) && isFiniteNonNegative(marker.measure)) {
        markers.push({ tag: marker.tag, elementCount: marker.elementCount, elementTypeCounts: { ...marker.elementTypeCounts }, measure: marker.measure })
      }
    })
  }

  if (isCount(raw.markerCount) && Array.isArray(raw.markers) && raw.markerCount !== raw.markers.length) errors.push('Result markerCount must match the markers array length.')
  if (isCount(raw.nodeCount) && isCount(raw.referencedNodeCount) && isCount(raw.unusedNodeCount) && raw.referencedNodeCount + raw.unusedNodeCount !== raw.nodeCount) errors.push('Result referencedNodeCount plus unusedNodeCount must equal nodeCount.')
  if (isCount(raw.markerElementCount) && Array.isArray(raw.markers) && markers.length === raw.markers.length && raw.markerElementCount !== markers.reduce((sum, marker) => sum + marker.elementCount, 0)) errors.push('Result markerElementCount must match the marker element counts.')
  if (isCount(raw.nodeCount) && raw.maxNodeIndex !== null && (!isCount(raw.maxNodeIndex) || raw.maxNodeIndex >= raw.nodeCount)) errors.push('Result maxNodeIndex must be null or an index below nodeCount.')
  if (raw.maxNodeIndex !== null && raw.maxNodeIndex !== undefined && !isCount(raw.maxNodeIndex)) errors.push('Result maxNodeIndex must be null or a non-negative integer.')

  if (isObject(output.summary)) {
    if (output.summary.steps !== undefined && !isCount(output.summary.steps)) errors.push('Result summary.steps must be a non-negative integer when present.')
    if (output.summary.wallTimeMs !== undefined && !isFiniteNonNegative(output.summary.wallTimeMs)) errors.push('Result summary.wallTimeMs must be a finite non-negative number when present.')
  }

  if (errors.length) return { ok: false, errors }
  return {
    ok: true,
    result: {
      format: 'su2-native', dimension: raw.dimension as 2 | 3, elementDimension: raw.elementDimension as number,
      nodeCount: raw.nodeCount as number, elementCount: raw.elementCount as number, markerCount: raw.markerCount as number,
      markerElementCount: raw.markerElementCount as number, markers,
      boundingBox: box!, elementTypeCounts: { ...(raw.elementTypeCounts as Record<string, number>) },
      elementTypeMeasure: { ...(raw.elementTypeMeasure as Record<string, number>) },
      totalLength: raw.totalLength as number, totalArea: raw.totalArea as number, totalVolume: raw.totalVolume as number,
      totalMarkerMeasure: raw.totalMarkerMeasure as number, minElementMeasure: raw.minElementMeasure as number,
      maxElementMeasure: raw.maxElementMeasure as number, referencedNodeCount: raw.referencedNodeCount as number,
      unusedNodeCount: raw.unusedNodeCount as number, maxNodeIndex: raw.maxNodeIndex as number | null,
      invertedElements: raw.invertedElements as number, ok: raw.ok as boolean,
      methodId: 'method-algo-su2-native-mesh-import', familyId: 'mesh-generation',
    },
  }
}

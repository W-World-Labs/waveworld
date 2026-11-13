import { describe, expect, it } from 'vitest'
import { validateSu2MeshResult } from './su2MeshResult'

const validOutput = {
  schemaVersion: 1,
  moduleResult: {
    module: 'sw-su2-mesh-import',
    backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
    result: {
      format: 'su2-native',
      dimension: 2,
      elementDimension: 2,
      nodeCount: 4,
      elementCount: 1,
      markerCount: 1,
      markerElementCount: 1,
      markers: [{ tag: 'wall', elementCount: 1, elementTypeCounts: { line2: 1 }, measure: 1 }],
      boundingBox: { xMin: 0, xMax: 1, yMin: 0, yMax: 1, zMin: 0, zMax: 0 },
      elementTypeCounts: { quad4: 1 },
      elementTypeMeasure: { quad4: 1 },
      totalLength: 0,
      totalArea: 1,
      totalVolume: 0,
      totalMarkerMeasure: 1,
      minElementMeasure: 1,
      maxElementMeasure: 1,
      referencedNodeCount: 4,
      unusedNodeCount: 0,
      maxNodeIndex: 3,
      invertedElements: 0,
      ok: true,
      methodId: 'method-algo-su2-native-mesh-import',
      familyId: 'mesh-generation',
      additiveNativeField: 'ignored',
    },
  },
  summary: { steps: 1, wallTimeMs: 0 },
  additiveEnvelopeField: true,
}

describe('validateSu2MeshResult', () => {
  it('returns a typed copy of the known module result and tolerates additive fields', () => {
    const validation = validateSu2MeshResult(validOutput)
    expect(validation.ok).toBe(true)
    if (!validation.ok) return
    expect(validation.result).toMatchObject({
      format: 'su2-native', dimension: 2, elementDimension: 2,
      nodeCount: 4, elementCount: 1, markerCount: 1, markerElementCount: 1,
      elementTypeCounts: { quad4: 1 }, elementTypeMeasure: { quad4: 1 },
      totalArea: 1, maxNodeIndex: 3, ok: true,
      markers: [{ tag: 'wall', elementCount: 1, elementTypeCounts: { line2: 1 }, measure: 1 }],
    })
    expect('additiveNativeField' in validation.result).toBe(false)
  })

  it('rejects a different module id and malformed summary values', () => {
    const wrongModule = structuredClone(validOutput)
    wrongModule.moduleResult.module = 'other-operation'
    expect(validateSu2MeshResult(wrongModule)).toMatchObject({ ok: false, errors: expect.arrayContaining(['Result module must be sw-su2-mesh-import.']) })

    const malformed = structuredClone(validOutput)
    malformed.moduleResult.result.totalArea = Number.NaN
    malformed.moduleResult.result.boundingBox.xMin = 2
    expect(validateSu2MeshResult(malformed)).toMatchObject({ ok: false, errors: expect.arrayContaining([
      'Result totalArea must be a finite non-negative number.',
      'Result boundingBox minima must not exceed maxima.',
    ]) })
  })

  it('checks count relationships and marker records', () => {
    const malformed = structuredClone(validOutput)
    malformed.moduleResult.result.unusedNodeCount = 2
    malformed.moduleResult.result.markers[0].elementTypeCounts = { line2: -1 }
    expect(validateSu2MeshResult(malformed)).toMatchObject({ ok: false, errors: expect.arrayContaining([
      'Result referencedNodeCount plus unusedNodeCount must equal nodeCount.',
      'Result marker 1 elementTypeCounts must contain non-negative integer counts.',
    ]) })
  })

  it('accepts an empty mesh summary with null maxNodeIndex', () => {
    const empty = {
      ...structuredClone(validOutput),
      moduleResult: {
        ...validOutput.moduleResult,
        result: {
          ...validOutput.moduleResult.result,
          dimension: 3, elementDimension: 0,
          nodeCount: 0, elementCount: 0, markerCount: 0, markerElementCount: 0,
          markers: [],
          boundingBox: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 },
          elementTypeCounts: {}, elementTypeMeasure: {},
          totalLength: 0, totalArea: 0, totalVolume: 0, totalMarkerMeasure: 0,
          minElementMeasure: 0, maxElementMeasure: 0, maxNodeIndex: null,
          referencedNodeCount: 0, unusedNodeCount: 0,
        },
      },
    }
    expect(validateSu2MeshResult(empty).ok).toBe(true)
  })
})

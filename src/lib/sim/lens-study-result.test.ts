import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import type { LensTraceInput } from './lens-study-input'
import { readLensStudyResult } from './lens-study-result'

// Five-ray, axial bundle through the native parallel-plate golden geometry.
// The expected output is the analytic native golden: 10 mm air, 5 mm of n=1.5
// glass, then 20 mm air to the image plane at z=25 mm.
const input: LensTraceInput = {
  module: 'lens-design',
  method: 'geometric-ray-trace',
  backend: 'host',
  surfaces: [
    { type: 'plane', n1: 1, n2: 1.5, aperture: 5, thickness: 5 },
    { type: 'plane', n1: 1.5, n2: 1, aperture: 5, thickness: 0 },
  ],
  rays: [
    { origin: [0, 0, -10], direction: [0, 0, 1] },
    { origin: [1, 0, -10], direction: [0, 0, 1] },
    { origin: [0, 1, -10], direction: [0, 0, 1] },
    { origin: [-1, 0, -10], direction: [0, 0, 1] },
    { origin: [0, -1, -10], direction: [0, 0, 1] },
  ],
  imageDistance: 20,
}

type NativeRayFixture = {
  status: 'ok' | 'vignetted' | 'invalid_geometry' | 'total_internal_reflection'
  opticalPathLength: number
  imageSpot: [number, number] | null
  lastPosition: [number, number, number]
  direction: [number, number, number]
}

const ray = (x: number, y: number): NativeRayFixture => ({
  status: 'ok',
  opticalPathLength: 37.5,
  imageSpot: [x, y],
  lastPosition: [x, y, 25],
  direction: [0, 0, 1],
})

const nativeResult = (resultOverrides: Record<string, unknown> = {}, rays: NativeRayFixture[] = [
  ray(0, 0), ray(1, 0), ray(0, 1), ray(-1, 0), ray(0, -1),
]) => ({
  schemaVersion: 1,
  status: 'succeeded',
  summary: { steps: 1, wallTimeMs: 1 },
  backend: { id: 'w-sim-cuda' },
  moduleResult: {
    module: 'lens-design',
    backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'CPU' },
    result: {
      methodId: 'method-algo-lens-geometric-ray-trace',
      familyId: 'method-lens-design',
      rays,
      validSpotCount: 5,
      imageCentroid: [0, 0],
      imageRmsRadius: Math.sqrt(0.8),
      finite: true,
      ok: true,
      ...resultOverrides,
    },
  },
})

const read = (value: unknown = nativeResult(), submitted = input) =>
  readLensStudyResult(value as JobResultV1, submitted)

describe('lens study result reader', () => {
  it('reads the native parallel-plate five-ray golden and keeps native spots and aggregates', () => {
    const result = read()

    // The input uses the native selector alias; the output carries its stable
    // full method identity. Do not conflate these two protocol fields.
    expect(input.method).toBe('geometric-ray-trace')
    expect(nativeResult().moduleResult.result.methodId).toBe('method-algo-lens-geometric-ray-trace')
    expect(result).toEqual({
      rays: [
        { status: 'ok', opticalPathLength: 37.5, imageSpot: [0, 0], lastPosition: [0, 0, 25], direction: [0, 0, 1] },
        { status: 'ok', opticalPathLength: 37.5, imageSpot: [1, 0], lastPosition: [1, 0, 25], direction: [0, 0, 1] },
        { status: 'ok', opticalPathLength: 37.5, imageSpot: [0, 1], lastPosition: [0, 1, 25], direction: [0, 0, 1] },
        { status: 'ok', opticalPathLength: 37.5, imageSpot: [-1, 0], lastPosition: [-1, 0, 25], direction: [0, 0, 1] },
        { status: 'ok', opticalPathLength: 37.5, imageSpot: [0, -1], lastPosition: [0, -1, 25], direction: [0, 0, 1] },
      ],
      validSpotCount: 5,
      imageCentroid: [0, 0],
      imageRmsRadius: Math.sqrt(0.8),
      backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'CPU' },
    })
  })

  it('accepts mixed statuses and represents an all-failed bundle with null aggregates', () => {
    const mixedRays: NativeRayFixture[] = [ray(0, 0), { ...ray(1, 0), status: 'vignetted', imageSpot: null }, ray(0, 1),
      { ...ray(-1, 0), status: 'invalid_geometry', imageSpot: null },
      { ...ray(0, -1), status: 'total_internal_reflection', imageSpot: null }]
    const mixed = read(nativeResult({ validSpotCount: 2, imageCentroid: [0, 0.5], imageRmsRadius: 0.5 }, mixedRays))
    expect(mixed.validSpotCount).toBe(2)
    expect(mixed.imageCentroid).toEqual([0, 0.5])
    expect(mixed.rays.slice(1).map(item => item.imageSpot)).toEqual([null, [0, 1], null, null].slice(0, 4))

    const failedRays: NativeRayFixture[] = ['vignetted', 'invalid_geometry', 'total_internal_reflection', 'vignetted', 'invalid_geometry']
      .map(status => ({ ...ray(0, 0), status: status as NativeRayFixture['status'], imageSpot: null }))
    const failed = read(nativeResult({ validSpotCount: 0, imageCentroid: null, imageRmsRadius: null }, failedRays))
    expect(failed.validSpotCount).toBe(0)
    expect(failed.imageCentroid).toBeNull()
    expect(failed.imageRmsRadius).toBeNull()
  })

  it('rejects identity, provenance, success, finiteness, count, and ray-shape inconsistencies', () => {
    const base = nativeResult()
    const rays = base.moduleResult.result.rays
    expect(() => read({ ...base, moduleResult: { ...base.moduleResult, module: 'other' } })).toThrow(/module/)
    expect(() => read({ ...base, moduleResult: { ...base.moduleResult, backend: { id: 'host-f64', kind: 'host-f64' } } })).toThrow(/backend/)
    expect(() => read(nativeResult({ methodId: 'geometric-ray-trace' }))).toThrow(/method or family/)
    expect(() => read(nativeResult({ familyId: 'method-other' }))).toThrow(/method or family/)
    expect(() => read(nativeResult({ ok: false }))).toThrow(/finite successful/)
    expect(() => read(nativeResult({ finite: false }))).toThrow(/finite successful/)
    expect(() => read(nativeResult({}, rays.slice(0, 4)))).toThrow(/ray count/)
    expect(() => read(nativeResult({ validSpotCount: 4 }))).toThrow(/validSpotCount/)
    expect(() => read(nativeResult({}, [{ ...rays[0], opticalPathLength: Number.NaN }, ...rays.slice(1)]))).toThrow(/finite/)
    expect(() => read(nativeResult({}, [{ ...rays[0], imageSpot: [Number.POSITIVE_INFINITY, 0] }, ...rays.slice(1)]))).toThrow(/finite/)
    expect(() => read(nativeResult({}, [{ ...rays[0], direction: [0, Number.NaN, 1] }, ...rays.slice(1)]))).toThrow(/finite/)
    expect(() => read(nativeResult({}, [{ ...rays[0], status: 'unknown' as NativeRayFixture['status'] }, ...rays.slice(1)]))).toThrow(/unknown status/)
    expect(() => read(nativeResult({}, [{ ...rays[0], status: 'vignetted' }, ...rays.slice(1)]))).toThrow(/must not report an image spot/)
    expect(() => read(nativeResult({ imageCentroid: [0, 0.1] }))).toThrow(/inconsistent/)
    expect(() => read(nativeResult({ imageRmsRadius: 0 }))).toThrow(/inconsistent/)
  })

  it('requires null spot aggregates for all-failed output and finite aggregate metrics otherwise', () => {
    const failed: NativeRayFixture[] = Array.from({ length: 5 }, () => ({ ...ray(0, 0), status: 'vignetted', imageSpot: null }))
    expect(() => read(nativeResult({ validSpotCount: 0, imageCentroid: [0, 0], imageRmsRadius: null }, failed))).toThrow(/aggregates must be null/)
    expect(() => read(nativeResult({ validSpotCount: 0, imageCentroid: null, imageRmsRadius: 0 }, failed))).toThrow(/aggregates must be null/)
    expect(() => read(nativeResult({ imageCentroid: [Number.NaN, 0] }))).toThrow(/finite/)
    expect(() => read(nativeResult({ imageRmsRadius: Number.POSITIVE_INFINITY }))).toThrow(/finite/)
  })
})

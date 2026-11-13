import { describe, expect, it } from 'vitest'
import { buildLensRayCsv, buildLensStudyReport } from './lens-study-export'
import type { LensTraceInput, LensStudyDraft } from './lens-study-input'
import type { LensStudyResult } from './lens-study-result'

const draft: LensStudyDraft = {
  ambientIndex: 1,
  surfaces: [
    { type: 'plane', radius: 0, aperture: 5, thickness: 5, nAfter: 1.5 },
    { type: 'plane', radius: 0, aperture: 5, thickness: 0, nAfter: 1 },
  ],
  bundle: { launchDistance: 10, launchRadius: 1, rings: 1, spokes: 4, fieldXDeg: 0, fieldYDeg: 0 },
  imageDistance: 20,
}

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
  ],
  imageDistance: 20,
}

const result: LensStudyResult = {
  rays: [
    { status: 'ok', opticalPathLength: 37.5, imageSpot: [0, 0], lastPosition: [0, 0, 25], direction: [0, 0, 1] },
    { status: 'vignetted', opticalPathLength: 15, imageSpot: null, lastPosition: [1, 0, 5], direction: [0, 0, 1] },
  ],
  validSpotCount: 1,
  imageCentroid: [0, 0],
  imageRmsRadius: 0,
  backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'Host' },
}

describe('lens study exports', () => {
  it('writes stable per-ray CSV rows with empty cells for unavailable image spots', () => {
    expect(buildLensRayCsv(input, result)).toBe([
      '"ray_index","status","optical_path_length_mm","image_x_mm","image_y_mm","last_x_mm","last_y_mm","last_z_mm","direction_x","direction_y","direction_z"',
      '"0","ok","37.5","0","0","0","0","25","0","0","1"',
      '"1","vignetted","15","","","1","0","5","0","0","1"',
      '',
    ].join('\r\n'))
  })

  it('rejects a result whose row count cannot be associated with submitted ray order', () => {
    expect(() => buildLensRayCsv(input, { ...result, rays: result.rays.slice(0, 1) })).toThrow(/count/)
  })

  it('creates deterministic provenance from the supplied snapshot and native result', () => {
    const report = buildLensStudyReport(draft, input, result, 'job-123')
    expect(buildLensStudyReport(draft, input, result, 'job-123')).toBe(report)
    const parsed = JSON.parse(report)
    expect(parsed).toMatchObject({ schemaVersion: 1, jobId: 'job-123', draft, input, result })
    expect(parsed.metadata.notes.join(' ')).toMatch(/independent geometric study/i)
    expect(parsed.metadata.notes.join(' ')).toMatch(/not produced or validated by OpticStudio/i)
    expect(parsed.metadata.notes.join(' ')).toMatch(/No GPU or vendor validation claim/i)
    expect(report.endsWith('\n')).toBe(true)
  })

  it('preserves null aggregate metrics for a study with no valid spots', () => {
    const noSpots: LensStudyResult = {
      ...result,
      rays: result.rays.map(ray => ({ ...ray, status: 'vignetted' as const, imageSpot: null })),
      validSpotCount: 0,
      imageCentroid: null,
      imageRmsRadius: null,
    }
    const parsed = JSON.parse(buildLensStudyReport(draft, input, noSpots, null))
    expect(parsed.result.imageCentroid).toBeNull()
    expect(parsed.result.imageRmsRadius).toBeNull()
    expect(parsed.jobId).toBeNull()
  })
})

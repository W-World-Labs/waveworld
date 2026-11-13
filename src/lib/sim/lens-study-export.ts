import type { LensTraceInput, LensStudyDraft } from './lens-study-input'
import type { LensStudyResult } from './lens-study-result'

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/** Export the native ray outcomes; missing image spots remain empty CSV cells. */
export function buildLensRayCsv(input: LensTraceInput, result: LensStudyResult): string {
  const header = [
    'ray_index', 'status', 'optical_path_length_mm', 'image_x_mm', 'image_y_mm',
    'last_x_mm', 'last_y_mm', 'last_z_mm', 'direction_x', 'direction_y', 'direction_z',
  ]
  const rows = result.rays.map((ray, index) => [
    String(index),
    ray.status,
    String(ray.opticalPathLength),
    ray.imageSpot === null ? '' : String(ray.imageSpot[0]),
    ray.imageSpot === null ? '' : String(ray.imageSpot[1]),
    String(ray.lastPosition[0]), String(ray.lastPosition[1]), String(ray.lastPosition[2]),
    String(ray.direction[0]), String(ray.direction[1]), String(ray.direction[2]),
  ])

  // Referencing the submitted input here makes it explicit that rows correspond to its ray order.
  if (result.rays.length !== input.rays.length) throw new Error('Lens ray result count does not match submitted input')
  return [header, ...rows].map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}

/** Build a deterministic report bound to the captured submitted draft and native result. */
export function buildLensStudyReport(
  draft: LensStudyDraft,
  input: LensTraceInput,
  result: LensStudyResult,
  jobId: string | null,
): string {
  return JSON.stringify({
    schemaVersion: 1,
    jobId,
    metadata: {
      study: 'centered geometric ray trace',
      units: 'mm',
      notes: [
        'Independent geometric study; this report is not produced or validated by OpticStudio.',
        'No GPU or vendor validation claim is made.',
        'Ray samples are equally weighted points on the launch plane; they do not represent irradiance weighting or entrance-pupil ray aiming.',
        'Only native-returned image spots are used; failed-ray last positions are not image intercepts.',
      ],
    },
    draft,
    input,
    result,
  }, null, 2) + '\n'
}

import type { ModuleComputeInput, ModuleComputeOutput } from './sim/module-compute'
import type { StarCcmSurfaceLoadRow } from './star-ccm-surface-loads-csv'

export const STAR_CCM_SURFACE_LOADS_MODULE = 'sw-su2-force-coeffs-b'
export const STAR_CCM_SURFACE_LOADS_MAX_INPUT_BYTES = 1024 * 1024

export type StarCcmSurfaceLoadsSettings = {
  pressureReferencePa: number
  rhoFreestream: number
  velocityFreestream: number
  refArea: number
  refLength: number
  dimension: 2 | 3
  refOriginMoment: [number, number, number]
  aoa: number
  sideslip: number
}

export type StarCcmSurfaceLoadsInput = ModuleComputeInput & {
  module: typeof STAR_CCM_SURFACE_LOADS_MODULE
  backend: 'host'
  method: 'surface'
  faces: Array<Record<string, number>>
}

export function buildStarCcmSurfaceLoadsInput(rows: readonly StarCcmSurfaceLoadRow[], settings: StarCcmSurfaceLoadsSettings): StarCcmSurfaceLoadsInput {
  const faces = rows.map(row => {
    const pressure = row.pressure_Pa - settings.pressureReferencePa
    if (!Number.isFinite(pressure)) throw new Error('Pressure difference must be finite.')
    return {
      areaX: row.areaX_m2,
      areaY: row.areaY_m2,
      areaZ: row.areaZ_m2,
      pressure,
      tauX: row.shearForceX_N,
      tauY: row.shearForceY_N,
      tauZ: row.shearForceZ_N,
      x: row.centroidX_m,
      y: row.centroidY_m,
      z: row.centroidZ_m,
    }
  })
  return {
    module: STAR_CCM_SURFACE_LOADS_MODULE,
    backend: 'host',
    method: 'surface',
    dimension: settings.dimension,
    rhoFreestream: settings.rhoFreestream,
    velocityFreestream: settings.velocityFreestream,
    refArea: settings.refArea,
    refLength: settings.refLength,
    refOriginMoment: settings.refOriginMoment,
    aoa: settings.aoa,
    sideslip: settings.sideslip,
    faces,
  }
}

export function createStarCcmSurfaceLoadsReport(args: {
  jobId: string
  sourceCsv: string
  rows: readonly StarCcmSurfaceLoadRow[]
  settings: StarCcmSurfaceLoadsSettings
  submittedInput: StarCcmSurfaceLoadsInput
  result: ModuleComputeOutput
}) {
  return {
    format: 'waveworld-star-ccm-surface-loads-v1',
    jobId: args.jobId,
    module: STAR_CCM_SURFACE_LOADS_MODULE,
    sourceFormat: 'WaveWorld app-defined surface-sample CSV',
    sourceCsv: args.sourceCsv,
    sourceRows: args.rows,
    settings: args.settings,
    submittedInput: args.submittedInput,
    result: args.result,
    limitations: [
      'The CSV schema is app-defined; it is not a STAR-CCM+ export format or .sim importer.',
      'Pressure is converted to pressure difference by subtracting pressureReferencePa before submission.',
      'Area vectors are oriented area vectors in m²; pressure force is -pressureDifference * areaVector.',
      'Shear force columns are already integrated Cartesian force components per face in N; they are passed through as viscous force and are not multiplied by area.',
      'Centroids and moment origin use the same Cartesian frame and length unit (m). Moment is sum((centroid - origin) × total face force).',
      'Freestream and reference geometry are caller supplied; reported coefficients use q=0.5*rho*V², refArea, and refLength.',
      'This is independent W-Sim Host-f64 post-processing; no STAR-CCM+ execution, proprietary file/API access, or Siemens numerical equivalence is claimed.',
    ],
  }
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function createStarCcmSurfaceLoadsSummaryCsv(result: ModuleComputeOutput): string {
  const resultRecord = (result as unknown as Record<string, unknown>).result
  if (!resultRecord || typeof resultRecord !== 'object' || Array.isArray(resultRecord)) return 'quantity,value\r\n'
  const values = resultRecord as Record<string, unknown>
  const rows: Array<[string, unknown]> = []
  for (const field of ['pressureForce', 'viscousForce', 'force', 'moment', 'coefficients', 'freestream']) {
    const value = values[field]
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === 'number' && Number.isFinite(entry)) rows.push([`${field}.${key}`, entry])
    }
  }
  for (const key of ['CD', 'CL', 'CSF', 'CSide', 'CMx', 'CMy', 'CMz', 'CEff', 'faceCount']) {
    const value = values[key]
    if (typeof value === 'number' && Number.isFinite(value)) rows.push([key, value])
  }
  return [['quantity', 'value'].join(','), ...rows.map(row => row.map(csvCell).join(','))].join('\r\n') + '\r\n'
}

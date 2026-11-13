import type { ModuleComputeInput, ModuleComputeOutput } from './sim/module-compute'
import type { StarCcmCflRow } from './star-ccm-cfl-csv'

export const STAR_CCM_CFL_MODULE = 'sw-su2-cfl'
export const STAR_CCM_CFL_METHOD = 'method-algo-su2-cfl-directional-local'
export const STAR_CCM_CFL_MAX = 1e6

export type StarCcmCflInput = ModuleComputeInput & {
  module: typeof STAR_CCM_CFL_MODULE
  backend: 'host'
  method: typeof STAR_CCM_CFL_METHOD
  cfl: number
  cells: Array<[number, number, number, number, number, number, number]>
}

/** Build the exact flat input shape expected by the released Host operation. */
export function buildStarCcmCflInput(rows: readonly StarCcmCflRow[], cfl: number): StarCcmCflInput {
  if (!Number.isFinite(cfl) || cfl <= 0 || cfl > STAR_CCM_CFL_MAX) {
    throw new Error(`CFL must be finite, greater than zero, and at most ${STAR_CCM_CFL_MAX}.`)
  }
  return {
    module: STAR_CCM_CFL_MODULE,
    backend: 'host',
    method: STAR_CCM_CFL_METHOD,
    cfl,
    cells: rows.map(row => [
      row.hx_m,
      row.hy_m,
      row.hz_m,
      row.ux_m_s,
      row.uy_m_s,
      row.uz_m_s,
      row.soundSpeed_m_s,
    ]),
  }
}

/** App-defined report; this does not represent a native STAR-CCM+ artifact. */
export function createStarCcmCflReport(args: {
  jobId: string
  sourceCsv: string
  rows: readonly StarCcmCflRow[]
  cfl: number
  submittedInput: StarCcmCflInput
  result: ModuleComputeOutput
}) {
  return {
    format: 'waveworld-star-ccm-cfl-report-v1',
    jobId: args.jobId,
    module: STAR_CCM_CFL_MODULE,
    method: STAR_CCM_CFL_METHOD,
    sourceFormat: 'WaveWorld app-defined Cartesian cell CFL CSV',
    sourceCsv: args.sourceCsv,
    parsedCellIds: args.rows.map(row => row.cellId),
    parsedRows: args.rows,
    cfl: args.cfl,
    submittedInput: args.submittedInput,
    // Keep the full Host response so fields added by a newer Host remain available.
    result: args.result,
    limitations: [
      'The cell extents are a Cartesian estimate only; no unstructured face metrics are computed.',
      'Viscous and thermal stability limits are not computed.',
      'This estimate is not a full solver timestep.',
      'The app-defined CSV is not a native STAR-CCM+ file importer and does not provide STAR-CCM+ API or macro compatibility.',
      'No vendor numerical validation or STAR-CCM+ equivalence is claimed.',
    ],
  }
}

import { describe, expect, it } from 'vitest'
import {
  buildStarCcmCflInput,
  createStarCcmCflReport,
  STAR_CCM_CFL_MAX,
  STAR_CCM_CFL_METHOD,
  STAR_CCM_CFL_MODULE,
} from './star-ccm-cfl'
import type { StarCcmCflRow } from './star-ccm-cfl-csv'
import type { ModuleComputeOutput } from './sim/module-compute'

const rows: StarCcmCflRow[] = [
  {
    cellId: 17,
    hx_m: 0.1,
    hy_m: 0.2,
    hz_m: 0.3,
    ux_m_s: 12,
    uy_m_s: -4,
    uz_m_s: 2.5,
    soundSpeed_m_s: 340,
  },
  {
    cellId: 29,
    hx_m: 0.4,
    hy_m: 0.5,
    hz_m: 0.6,
    ux_m_s: -1,
    uy_m_s: 0,
    uz_m_s: 8,
    soundSpeed_m_s: 300,
  },
]

describe('STAR-CCM+ directional CFL helpers', () => {
  it('builds the exact Host module, backend, method, and directional cell tuple mapping', () => {
    expect(buildStarCcmCflInput(rows, 0.5)).toEqual({
      module: 'sw-su2-cfl',
      backend: 'host',
      method: 'method-algo-su2-cfl-directional-local',
      cfl: 0.5,
      cells: [
        [0.1, 0.2, 0.3, 12, -4, 2.5, 340],
        [0.4, 0.5, 0.6, -1, 0, 8, 300],
      ],
    })
    expect(STAR_CCM_CFL_MODULE).toBe('sw-su2-cfl')
    expect(STAR_CCM_CFL_METHOD).toBe('method-algo-su2-cfl-directional-local')
  })

  it('accepts finite CFL values above zero through the configured maximum', () => {
    expect(buildStarCcmCflInput(rows, Number.MIN_VALUE).cfl).toBe(Number.MIN_VALUE)
    expect(buildStarCcmCflInput(rows, STAR_CCM_CFL_MAX).cfl).toBe(STAR_CCM_CFL_MAX)
  })

  it.each([0, -0.1, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, STAR_CCM_CFL_MAX + 1])(
    'rejects invalid or out-of-range CFL value %s',
    cfl => {
      expect(() => buildStarCcmCflInput(rows, cfl)).toThrow(/CFL must be finite/)
    },
  )

  it('preserves source rows, submitted input, the complete result, and explicit scope limitations in its report', () => {
    const input = buildStarCcmCflInput(rows, 0.75)
    const result = {
      module: STAR_CCM_CFL_MODULE,
      result: {
        cells: [{ cellId: 17, localCfl: 0.42 }],
        maximumCfl: 0.42,
        hostExtension: { version: 3, details: ['retained'] },
      },
      hostExtension: { traceId: 'future-host-field' },
    } as unknown as ModuleComputeOutput
    const sourceCsv = 'cellId,hx_m,hy_m,hz_m,ux_m_s,uy_m_s,uz_m_s,soundSpeed_m_s\r\n17,0.1,0.2,0.3,12,-4,2.5,340\r\n29,0.4,0.5,0.6,-1,0,8,300\r\n'

    const report = createStarCcmCflReport({
      jobId: 'directional-cfl-job-17',
      sourceCsv,
      rows,
      cfl: 0.75,
      submittedInput: input,
      result,
    })

    expect(report).toMatchObject({
      format: 'waveworld-star-ccm-cfl-report-v1',
      jobId: 'directional-cfl-job-17',
      module: STAR_CCM_CFL_MODULE,
      method: STAR_CCM_CFL_METHOD,
      sourceFormat: 'WaveWorld app-defined Cartesian cell CFL CSV',
      sourceCsv,
      parsedCellIds: [17, 29],
      parsedRows: rows,
      cfl: 0.75,
      submittedInput: input,
      result,
    })
    expect(report.result).toBe(result)
    expect(report.result).toHaveProperty('hostExtension.traceId', 'future-host-field')
    expect(report.result).toHaveProperty('result.hostExtension.details', ['retained'])
    expect(report.limitations.join(' ')).toContain('Cartesian estimate only')
    expect(report.limitations.join(' ')).toContain('Viscous and thermal stability limits are not computed')
    expect(report.limitations.join(' ')).toContain('not a full solver timestep')
    expect(report.limitations.join(' ')).toContain('not a native STAR-CCM+ file importer')
    expect(report.limitations.join(' ')).toContain('No vendor numerical validation')
  })
})

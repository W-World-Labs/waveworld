import { describe, expect, it } from 'vitest'
import {
  buildStarCcmSurfaceLoadsInput,
  createStarCcmSurfaceLoadsReport,
  createStarCcmSurfaceLoadsSummaryCsv,
  type StarCcmSurfaceLoadsSettings,
} from './star-ccm-surface-loads'
import type { StarCcmSurfaceLoadRow } from './star-ccm-surface-loads-csv'
import type { ModuleComputeOutput } from './sim/module-compute'

const settings: StarCcmSurfaceLoadsSettings = {
  pressureReferencePa: 100_000,
  rhoFreestream: 1.2,
  velocityFreestream: 50,
  refArea: 2.5,
  refLength: 0.75,
  dimension: 3,
  refOriginMoment: [1, 2, 3],
  aoa: 4,
  sideslip: -2,
}

const rows: StarCcmSurfaceLoadRow[] = [{
  faceId: 7,
  areaX_m2: 2,
  areaY_m2: -3,
  areaZ_m2: 4,
  pressure_Pa: 100_125,
  shearForceX_N: 5.5,
  shearForceY_N: -6.5,
  shearForceZ_N: 7.5,
  centroidX_m: 10,
  centroidY_m: 20,
  centroidZ_m: 30,
}]

describe('STAR-CCM+ mapped surface-load helpers', () => {
  it('subtracts the pressure reference once and passes integrated shear through unchanged', () => {
    const input = buildStarCcmSurfaceLoadsInput(rows, settings)

    expect(input.faces).toEqual([{
      areaX: 2,
      areaY: -3,
      areaZ: 4,
      pressure: 125,
      tauX: 5.5,
      tauY: -6.5,
      tauZ: 7.5,
      x: 10,
      y: 20,
      z: 30,
    }])
    expect(input.faces[0]?.pressure).toBe(rows[0]!.pressure_Pa - settings.pressureReferencePa)
    expect(input.faces[0]?.tauX).toBe(rows[0]!.shearForceX_N)
  })

  it('preserves moment origin and coefficient reference settings on the submitted input', () => {
    const input = buildStarCcmSurfaceLoadsInput(rows, settings)

    expect(input).toMatchObject({
      dimension: 3,
      rhoFreestream: 1.2,
      velocityFreestream: 50,
      refArea: 2.5,
      refLength: 0.75,
      refOriginMoment: [1, 2, 3],
      aoa: 4,
      sideslip: -2,
    })
    expect(input.refOriginMoment).toBe(settings.refOriginMoment)
  })

  it('keeps imported source, settings, submitted input, result, and provenance together', () => {
    const input = buildStarCcmSurfaceLoadsInput(rows, settings)
    const result = { module: input.module, result: { pressureForce: { x: -250 }, faceCount: 1 } } as ModuleComputeOutput
    const report = createStarCcmSurfaceLoadsReport({
      jobId: 'surface-load-job-12',
      sourceCsv: 'faceId,areaX_m2,...\r\n7,2,...\r\n',
      rows,
      settings,
      submittedInput: input,
      result,
    })

    expect(report).toMatchObject({
      format: 'waveworld-star-ccm-surface-loads-v1',
      jobId: 'surface-load-job-12',
      sourceFormat: 'WaveWorld app-defined surface-sample CSV',
      sourceCsv: 'faceId,areaX_m2,...\r\n7,2,...\r\n',
      sourceRows: rows,
      settings,
      submittedInput: input,
      result,
    })
    expect(report.limitations.join(' ')).toContain('no STAR-CCM+ execution')
    expect(report.limitations.join(' ')).toContain('not multiplied by area')
  })

  it('exports finite result summary values in stable field order and omits nonnumeric entries', () => {
    const result = {
      module: 'sw-su2-force-coeffs-b',
      result: {
        pressureForce: { x: 1, y: -2 },
        viscousForce: { x: 3 },
        force: { z: 4 },
        moment: { x: 5 },
        coefficients: { CD: 0.2 },
        freestream: { speed: 50 },
        CL: 0.3,
        faceCount: 1,
        invalid: 'skip',
        nonFinite: Number.POSITIVE_INFINITY,
      },
    } as unknown as ModuleComputeOutput

    expect(createStarCcmSurfaceLoadsSummaryCsv(result)).toBe(
      'quantity,value\r\n' +
      'pressureForce.x,1\r\n' +
      'pressureForce.y,-2\r\n' +
      'viscousForce.x,3\r\n' +
      'force.z,4\r\n' +
      'moment.x,5\r\n' +
      'coefficients.CD,0.2\r\n' +
      'freestream.speed,50\r\n' +
      'CL,0.3\r\n' +
      'faceCount,1\r\n',
    )
  })
})

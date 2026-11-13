import { describe, expect, it } from 'vitest'
import {
  createStarCcmTurboStudyCsv,
  createStarCcmTurboStudyReport,
  starCcmTurboStudyRows,
  type StarCcmTurboInput,
  type StarCcmTurboStudyPoint,
} from './StarCcmTurboStudy'

const input: StarCcmTurboInput = {
  module: 'sw-su2-turbo-metrics',
  backend: 'host',
  kind: 'compressor',
  p_t1: 50000,
  T_t1: 400,
  p_t2: 100000,
  T_t2: 480,
  rpm: 10000,
}

const completedPoint: StarCcmTurboStudyPoint = {
  id: 'point-1',
  input,
  jobId: 'job-123',
  status: 'complete',
  output: {
    module: 'sw-su2-turbo-metrics',
    result: {
      kind: 'compressor',
      pressureRatioTT: 2,
      correctedMassFlow: 1.75,
      correctedShaftSpeed: 9500,
      isentropicEfficiency: 0.82,
      polytropicEfficiency: 0.84,
    },
  } as unknown as NonNullable<StarCcmTurboStudyPoint['output']>,
}

describe('STAR-CCM+ turbomachinery study exports', () => {
  it('builds a JSON report from completed native results and excludes drafts', () => {
    const draft: StarCcmTurboStudyPoint = { id: 'point-2', input, status: 'draft' }
    const report = createStarCcmTurboStudyReport([completedPoint, draft])

    expect(report).toMatchObject({
      schema: 'waveworld.starccm-turbomachinery-study.v1',
      module: 'sw-su2-turbo-metrics',
      points: [{
        pointId: 'point-1',
        jobId: 'job-123',
        submittedInput: input,
        result: completedPoint.output,
      }],
    })
    expect(report.points).toHaveLength(1)
  })

  it('builds CSV rows only from complete outputs and escapes CSV cells', () => {
    const pending: StarCcmTurboStudyPoint = { id: 'point-2', input, status: 'draft' }
    const rows = starCcmTurboStudyRows([completedPoint, pending])
    expect(rows).toEqual([{
      id: 'point-1',
      jobId: 'job-123',
      kind: 'compressor',
      pressureRatio: 2,
      correctedMassFlow: 1.75,
      correctedShaftSpeed: 9500,
      isentropicEfficiency: 0.82,
      polytropicEfficiency: 0.84,
    }])

    expect(createStarCcmTurboStudyCsv([{ ...rows[0]!, jobId: 'job,"123' }])).toBe(
      'id,jobId,kind,pressureRatio,correctedMassFlow,correctedShaftSpeed,isentropicEfficiency,polytropicEfficiency\r\n' +
      'point-1,"job,""123",compressor,2,1.75,9500,0.82,0.84\r\n',
    )
  })
})

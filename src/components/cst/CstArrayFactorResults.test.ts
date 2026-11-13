import { describe, expect, it } from 'vitest'
import {
  cstArrayFactorCsv,
  cstArrayFactorJson,
  CST_ARRAY_FACTOR_EXPORT_MAX_ROWS,
  type CstArrayFactorResult,
} from './CstArrayFactorResults'

function fixture(count = 2): CstArrayFactorResult {
  return {
    frequencyHz: 1e9,
    backend: 'host-f64',
    elementCount: 4,
    directionCount: count,
    normalization: 'sum of excitation magnitudes; isotropic uncoupled elements',
    samples: Array.from({ length: count }, (_, index) => ({
      thetaRad: index * 0.1,
      phiRad: 0.25,
      fieldRealNormalized: 0.8,
      fieldImagNormalized: -0.6,
      normalizedPower: 1,
      powerDb: 0,
    })),
  }
}

describe('CST array-factor result exports', () => {
  it('exports the returned complex field and power rows and explicit modeling limits', () => {
    const csv = cstArrayFactorCsv(fixture(), 'pin-sha')
    expect(csv).toContain('# backendId,host-f64')
    expect(csv).toContain('# nativePin,pin-sha')
    expect(csv).toContain('thetaRad,phiRad,fieldRealNormalized,fieldImagNormalized,normalizedPower,powerDb')
    expect(csv).toContain('0,0.25,0.8,-0.6,1,0')
    expect(csv).toContain('not a full-wave CST solve')

    const json = JSON.parse(cstArrayFactorJson(fixture(), { frequencyHz: 1e9 }, { id: 'host-f64', kind: 'host-f64' }, 'job-1', 'pin-sha'))
    expect(json.result.samples).toHaveLength(2)
    expect(json.result.samples[0]).toMatchObject({ fieldRealNormalized: 0.8, fieldImagNormalized: -0.6, normalizedPower: 1 })
    expect(json.backend).toEqual({ id: 'host-f64', kind: 'host-f64' })
    expect(json.nativePin).toBe('pin-sha')
    expect(json.jobId).toBe('job-1')
    expect(json.limitations).toContain('element coupling')
  })

  it('refuses unbounded exports above the direction cap', () => {
    expect(() => cstArrayFactorCsv(fixture(CST_ARRAY_FACTOR_EXPORT_MAX_ROWS + 1))).toThrow(/limited to/)
    expect(() => cstArrayFactorJson(fixture(CST_ARRAY_FACTOR_EXPORT_MAX_ROWS + 1), {}, {})).toThrow(/limited to/)
  })
})

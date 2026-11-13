import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import { readCstArrayFactorResult, type CstArrayFactorInput } from './cst-array-factor-result'

const input: CstArrayFactorInput = {
  module: 'antenna-l2', backend: 'host', operation: 'cst-array-factor', freqHz: 300e6,
  positionsM: [[0, 0, 0], [0, 0, 0.5]], weights: [[1, 0], [1, 0]],
  directionsRad: [[0, 0], [Math.PI / 2, 0]],
}

function job(overrides: Record<string, unknown> = {}): JobResultV1 {
  return {
    schemaVersion: 1,
    summary: { steps: 1, wallTimeMs: 0.4 },
    backend: { id: 'w-sim-cuda' },
    moduleResult: {
      module: 'antenna-l2', operation: 'cst-array-factor', backend: { id: 'host-f64' },
      result: {
        frequencyHz: input.freqHz, elementCount: 2, directionCount: 2,
        normalization: 'sum of excitation magnitudes; isotropic uncoupled elements',
        samples: [
          { thetaRad: 0, phiRad: 0, fieldRealNormalized: 1, fieldImagNormalized: 0, normalizedPower: 1, powerDb: 0 },
          { thetaRad: Math.PI / 2, phiRad: 0, fieldRealNormalized: 0, fieldImagNormalized: 0, normalizedPower: 0, powerDb: -300 },
        ],
      },
      ...overrides,
    },
  } as unknown as JobResultV1
}

describe('readCstArrayFactorResult', () => {
  it('accepts a finite host-f64 complex report with matching ordered directions', () => {
    const parsed = readCstArrayFactorResult(job(), input)
    expect(parsed.backend).toBe('host-f64')
    expect(parsed.elementCount).toBe(2)
    expect(parsed.samples.map(sample => sample.normalizedPower)).toEqual([1, 0])
  })

  it('rejects a mismatched backend, operation, report count, or direction order', () => {
    expect(() => readCstArrayFactorResult(job({ backend: { id: 'cuda' } }), input)).toThrow(/host backend/)
    expect(() => readCstArrayFactorResult(job({ operation: 'other' }), input)).toThrow(/identity/)
    const wrongDirection = job()
    ;((wrongDirection as any).moduleResult.result.samples as any[])[0].thetaRad = 0.2
    expect(() => readCstArrayFactorResult(wrongDirection, input)).toThrow(/direction echo/)
    const wrongCount = job()
    ;((wrongCount as any).moduleResult.result).directionCount = 3
    expect(() => readCstArrayFactorResult(wrongCount, input)).toThrow(/counts/)
  })

  it('rejects nonfinite fields, inconsistent power or dB, and invalid settlement envelope', () => {
    const nonfinite = job()
    ;((nonfinite as any).moduleResult.result.samples as any[])[0].fieldImagNormalized = Number.NaN
    expect(() => readCstArrayFactorResult(nonfinite, input)).toThrow(/finite/)
    const inconsistent = job()
    ;((inconsistent as any).moduleResult.result.samples as any[])[0].normalizedPower = 0.5
    expect(() => readCstArrayFactorResult(inconsistent, input)).toThrow(/normalized power/)
    const unnormalized = job()
    ;((unnormalized as any).moduleResult.result.samples as any[])[0] = {
      thetaRad: 0, phiRad: 0, fieldRealNormalized: 1.01, fieldImagNormalized: 0,
      normalizedPower: 1.0201, powerDb: 0.087,
    }
    expect(() => readCstArrayFactorResult(unnormalized, input)).toThrow(/normalized power/)
    const badDb = job()
    ;((badDb as any).moduleResult.result.samples as any[])[0].powerDb = -1
    expect(() => readCstArrayFactorResult(badDb, input)).toThrow(/powerDb/)
    const unsettled = job()
    ;(unsettled as any).summary.steps = 2
    expect(() => readCstArrayFactorResult(unsettled, input)).toThrow(/settlement envelope/)
    expect(() => readCstArrayFactorResult({ ...job(), error: 'failed' }, input)).toThrow(/error message/)
  })

  it('enforces input bounds and retains the isotropic uncoupled scope in the parsed result', () => {
    expect(() => readCstArrayFactorResult(job(), { ...input, positionsM: [] })).toThrow(/bounds/)
    expect(() => readCstArrayFactorResult(job(), { ...input, directionsRad: [[Math.PI + 0.01, 0]] })).toThrow(/\[0, pi\]/)
    expect(readCstArrayFactorResult(job(), input).normalization).toMatch(/isotropic uncoupled/)
  })
})

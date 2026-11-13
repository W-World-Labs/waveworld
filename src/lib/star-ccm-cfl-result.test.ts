import { describe, expect, it } from 'vitest'
import {
  formatStarCcmCflResultCsv,
  validateStarCcmCflResult,
} from './star-ccm-cfl-result'

const sourceShapedResponse = () => ({
  module: 'sw-su2-cfl',
  methodId: 'method-algo-su2-cfl-directional-local',
  result: {
    dtRef: 0.0004,
    cells: [
      { dt: 0.0004, directionalSpectralRate: 2500, localRatio: 1 },
      { dt: 0.0002, directionalSpectralRate: 5000, localRatio: 0.5 },
    ],
    hostExtension: { retained: true },
  },
  hostExtension: { traceId: 'kept-in-original-response' },
})

describe('directional CFL result integrity', () => {
  it('accepts source-shaped output and retains the complete original response', () => {
    const response = sourceShapedResponse()
    const validated = validateStarCcmCflResult(response, 2)
    expect(validated.response).toBe(response)
    expect(validated.dtRef).toBe(0.0004)
    expect(validated.cells).toEqual(response.result.cells)
    expect(validated.response).toHaveProperty('hostExtension.traceId', 'kept-in-original-response')
    expect(validated.response).toHaveProperty('result.hostExtension.retained', true)
  })

  it.each([
    ['wrong module', (value: ReturnType<typeof sourceShapedResponse>) => { value.module = 'other' }],
    ['wrong method', (value: ReturnType<typeof sourceShapedResponse>) => { value.methodId = 'other' }],
    ['missing result', (value: ReturnType<typeof sourceShapedResponse>) => { delete (value as { result?: unknown }).result }],
    ['missing cells', (value: ReturnType<typeof sourceShapedResponse>) => { delete (value.result as { cells?: unknown }).cells }],
  ])('rejects %s', (_label, mutate) => {
    const value = sourceShapedResponse()
    mutate(value)
    expect(() => validateStarCcmCflResult(value, 2)).toThrow(/Invalid directional CFL Host result/)
  })

  it.each([1, 3])('rejects a cell array with %i rows when two were requested', count => {
    const value = sourceShapedResponse()
    value.result.cells = Array.from({ length: count }, () => ({
      dt: 0.0004, directionalSpectralRate: 2500, localRatio: 1,
    }))
    expect(() => validateStarCcmCflResult(value, 2)).toThrow(/exactly 2 rows/)
  })

  it.each([
    ['non-object row', null],
    ['nonfinite dt', { dt: Number.NaN, directionalSpectralRate: 2500, localRatio: 1 }],
    ['nonpositive dt', { dt: 0, directionalSpectralRate: 2500, localRatio: 0 }],
    ['nonfinite spectral rate', { dt: 0.0004, directionalSpectralRate: Infinity, localRatio: 1 }],
    ['nonpositive spectral rate', { dt: 0.0004, directionalSpectralRate: 0, localRatio: 1 }],
    ['nonfinite ratio', { dt: 0.0004, directionalSpectralRate: 2500, localRatio: Infinity }],
    ['nonpositive ratio', { dt: 0.0004, directionalSpectralRate: 2500, localRatio: 0 }],
    ['ratio above one', { dt: 0.0004, directionalSpectralRate: 2500, localRatio: 1.01 }],
  ])('rejects a %s', (_label, row) => {
    const value = sourceShapedResponse()
    value.result.cells[0] = row as typeof value.result.cells[number]
    expect(() => validateStarCcmCflResult(value, 2)).toThrow(/Invalid directional CFL Host result/)
  })

  it.each([0, -1, Number.NaN, Infinity, '0.0004'])('rejects invalid dtRef %s', dtRef => {
    const value = sourceShapedResponse()
    ;(value.result as { dtRef: unknown }).dtRef = dtRef
    expect(() => validateStarCcmCflResult(value, 2)).toThrow(/dtRef must be a finite positive number/)
  })

  it('rejects a ratio inconsistent with dt / dtRef', () => {
    const value = sourceShapedResponse()
    value.result.cells[1].localRatio = 0.50001
    expect(() => validateStarCcmCflResult(value, 2)).toThrow(/inconsistent with dt \/ dtRef/)
  })

  it('formats every cell only from validated output and rejects mismatched or duplicate source IDs', () => {
    const validated = validateStarCcmCflResult(sourceShapedResponse(), 2)
    expect(formatStarCcmCflResultCsv(validated, [17, 29])).toBe(
      'cellId,dt,directionalSpectralRate,localRatio\n' +
      '17,0.0004,2500,1\n' +
      '29,0.0002,5000,0.5',
    )
    expect(() => formatStarCcmCflResultCsv(validated, [17])).toThrow(/exactly 2 entries/)
    expect(() => formatStarCcmCflResultCsv(validated, [17, 17])).toThrow(/repeated/)
  })
})

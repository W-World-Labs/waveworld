import { describe, expect, it } from 'vitest'
import { parseStarCcmTurboPoint, type StarCcmTurboInput } from './StarCcmTurboStudy'

const basePoint: StarCcmTurboInput = {
  module: 'sw-su2-turbo-metrics',
  backend: 'host',
  kind: 'compressor',
  p_t1: 50000,
  T_t1: 400,
  p_t2: 100000,
  T_t2: 480,
}

function rawPoint(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...basePoint, ...overrides })
}

describe('parseStarCcmTurboPoint', () => {
  it.each(['compressor', 'turbine'] as const)('accepts a valid Host %s input', kind => {
    const input = { ...basePoint, kind, rpm: 12000, T_ref: 288.15, mdot: 2 }

    expect(parseStarCcmTurboPoint(JSON.stringify(input))).toEqual(input)
  })

  it('requires all four positive finite total inlet and outlet conditions', () => {
    for (const key of ['p_t1', 'T_t1', 'p_t2', 'T_t2']) {
      expect(parseStarCcmTurboPoint(rawPoint({ [key]: undefined }))).toBeNull()
      expect(parseStarCcmTurboPoint(rawPoint({ [key]: 0 }))).toBeNull()
      expect(parseStarCcmTurboPoint(rawPoint({ [key]: -1 }))).toBeNull()
      expect(parseStarCcmTurboPoint(rawPoint({ [key]: 1e400 }))).toBeNull()
    }
  })

  it('rejects wrong module, backend, and kind values', () => {
    expect(parseStarCcmTurboPoint(rawPoint({ module: 'sw-su2-other' }))).toBeNull()
    expect(parseStarCcmTurboPoint(rawPoint({ backend: 'browser' }))).toBeNull()
    expect(parseStarCcmTurboPoint(rawPoint({ kind: 'nozzle' }))).toBeNull()
  })

  it('rejects malformed JSON and payloads larger than 64 KiB', () => {
    expect(parseStarCcmTurboPoint('{"module":')).toBeNull()
    expect(parseStarCcmTurboPoint(`${rawPoint()}${' '.repeat(64 * 1024)}`)).toBeNull()
  })

  it('rejects unknown fields', () => {
    expect(parseStarCcmTurboPoint(rawPoint({ unsupported: 1 }))).toBeNull()
  })

  it('rejects incomplete or conflicting optional input groups', () => {
    const invalidGroups: Record<string, unknown>[] = [
      { rpm: 12000, omega: 1000 },
      { U: 250, r_mean: 0.3 },
      { mach: 0.8 },
      { Q: 10 },
      { r_mean: 0.3 },
      { V_m: 100 },
      { V_m: 100, r_mean: 0.3 },
      { V_m: 100, omega: 1000 },
    ]

    for (const group of invalidGroups) expect(parseStarCcmTurboPoint(rawPoint(group))).toBeNull()
  })

  it('rejects negative, NaN, and infinite numeric inputs', () => {
    const strictlyPositive = ['gamma', 'R', 'p_1', 'p_2', 'p_ref', 'T_ref', 'mdot', 'A', 'rpm', 'omega', 'Q', 'r_mean', 'U']
    for (const key of strictlyPositive) {
      expect(parseStarCcmTurboPoint(rawPoint({ [key]: -1 }))).toBeNull()
      expect(parseStarCcmTurboPoint(rawPoint({ [key]: 0 }))).toBeNull()
    }

    expect(parseStarCcmTurboPoint(rawPoint({ mach: -0.1, A: 1 }))).toBeNull()
    expect(parseStarCcmTurboPoint(rawPoint({ V_m: -0.1, U: 1 }))).toBeNull()
    expect(parseStarCcmTurboPoint(rawPoint({ mdot: 1e400 }))).toBeNull()
    expect(parseStarCcmTurboPoint('{"module":"sw-su2-turbo-metrics","backend":"host","kind":"compressor","p_t1":NaN,"T_t1":400,"p_t2":100000,"T_t2":480}')).toBeNull()
    expect(parseStarCcmTurboPoint('{"module":"sw-su2-turbo-metrics","backend":"host","kind":"compressor","p_t1":Infinity,"T_t1":400,"p_t2":100000,"T_t2":480}')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import {
  createTouchstoneNetworkExportJob,
  readTouchstoneNetworkExportResult,
  type TouchstoneNetworkExportInput,
} from './touchstone-network-export'
import type { ComplexPair, TouchstoneNetwork } from './touchstone'

const pair = (value: number): ComplexPair => [value, -value]
const nativePair = (value: number) => ({ re: value, im: -value })

function pairValues(value: ComplexPair | { re: number; im: number }): ComplexPair {
  return Array.isArray(value) ? value as ComplexPair : [value.re, value.im]
}

function network(ports: number): TouchstoneNetwork {
  return {
    fileName: `source.s${ports}p`,
    ports,
    frequencyUnit: 'GHz',
    format: 'RI',
    referenceOhms: 50,
    points: [
      { frequencyHz: 1e9, s: Array.from({ length: ports ** 2 }, (_, index) => pair(index + 1)) },
      { frequencyHz: 2e9, s: Array.from({ length: ports ** 2 }, (_, index) => pair(index + 11)) },
    ],
  }
}

const options = { frequencyUnit: 'MHZ' as const, format: 'MA' as const, title: 'Captured sweep' }

function wireText(input: TouchstoneNetworkExportInput): string {
  const unitScale = { HZ: 1, KHZ: 1e3, MHZ: 1e6, GHZ: 1e9 }[input.freqUnit]
  const lines = [`# ${input.freqUnit} S ${input.format} R ${input.ref}`, `! ${input.title ?? 'Touchstone export'}`]
  input.freqs.forEach((frequency, index) => {
    const sample = input.sweep[index]
    if (input.ports === 1) {
      const [real, imag] = pairValues(sample as ComplexPair | { re: number; im: number })
      lines.push(`${frequency / unitScale} ${real} ${imag}`)
      return
    }
    const matrix = sample as Array<Array<{ re: number; im: number }>>
    // Touchstone 1 writes a two-port as S11,S21,S12,S22. The 3/4-port
    // parser accepts one full row-major matrix row per physical line.
    const rows = input.ports === 2
      ? [[matrix[0][0], matrix[1][0], matrix[0][1], matrix[1][1]]]
      : matrix
    rows.forEach((row, rowIndex) => {
      const cells = row.map((value) => pairValues(value).join(' ')).join(' ')
      lines.push(`${rowIndex === 0 ? `${frequency / unitScale} ` : ''}${cells}`)
    })
  })
  return `${lines.join('\n')}\n`
}

type ModuleJobResultFixture = JobResultV1 & { moduleResult: Record<string, unknown> }

function successfulResult(
  input: TouchstoneNetworkExportInput,
  overrides: Record<string, unknown> = {},
  payloadOverrides: Record<string, unknown> = {},
): ModuleJobResultFixture {
  const text = wireText(input)
  const payload = {
    ok: true,
    ports: input.ports,
    param: 'S',
    format: input.format,
    freqUnit: input.freqUnit,
    ref: input.ref,
    nPoints: input.freqs.length,
    freqMinHz: input.freqs[0],
    freqMaxHz: input.freqs[input.freqs.length - 1],
    touchstone: text,
    bytes: new TextEncoder().encode(text).byteLength,
    lines: text.split('\n').length - 1,
    ...payloadOverrides,
  }
  return {
    schemaVersion: 1,
    summary: { steps: 1, wallTimeMs: 1 },
    backend: { id: 'w-sim-cuda' },
    moduleResult: {
      module: 'sw-ansys-touchstone',
      familyId: 'method-ansys-touchstone',
      methodId: 'method-algo-touchstone-export',
      backend: { id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' },
      ...payload,
      ...overrides,
    },
  } as unknown as ModuleJobResultFixture
}

describe('Touchstone complete network export helper', () => {
  it('builds a scalar one-port sample and pins the requested output unit, format, and source reference', () => {
    const { input, spec } = createTouchstoneNetworkExportJob(network(1), options)

    expect(input).toEqual({
      module: 'sw-ansys-touchstone',
      backend: 'host',
      method: 'touchstone',
      ports: 1,
      freqUnit: 'MHZ',
      param: 'S',
      format: 'MA',
      ref: 50,
      freqs: [1e9, 2e9],
      sweep: [nativePair(1), nativePair(11)],
      title: 'Captured sweep',
    })
    expect(spec.model?.inline).toEqual(input)
  })

  it('maps full two-port Touchstone order into the native row/column matrix', () => {
    const { input } = createTouchstoneNetworkExportJob(network(2), options)

    expect(input.sweep).toEqual([
      [[nativePair(1), nativePair(3)], [nativePair(2), nativePair(4)]],
      [[nativePair(11), nativePair(13)], [nativePair(12), nativePair(14)]],
    ])
  })

  it.each([3, 4])('maps every %i-port parameter into a complete row-major matrix', (ports) => {
    const { input } = createTouchstoneNetworkExportJob(network(ports), options)
    const first = input.sweep[0] as Array<Array<{ re: number; im: number }>>

    expect(first).toHaveLength(ports)
    expect(first.every((row) => row.length === ports)).toBe(true)
    expect(first.flat()).toEqual(Array.from({ length: ports ** 2 }, (_, index) => nativePair(index + 1)))
  })

  it('captures a source snapshot and returns the validated native text with explicit provenance', () => {
    const source = network(2)
    const { input } = createTouchstoneNetworkExportJob(source, options)
    const expectedInput = structuredClone(input)
    source.points[0].frequencyHz = 9e9
    source.points[0].s[0][0] = 999

    expect(input).toEqual(expectedInput)
    const output = readTouchstoneNetworkExportResult(successfulResult(input), input)
    expect(output).toMatchObject({
      touchstone: wireText(input),
      ports: 2,
      param: 'S',
      format: 'MA',
      freqUnit: 'MHZ',
      ref: 50,
      nPoints: 2,
      freqMinHz: 1e9,
      freqMaxHz: 2e9,
      ok: true,
      backend: { id: 'host-f64', kind: 'cpu', deviceName: 'w-sim-cuda-host' },
      familyId: 'method-ansys-touchstone',
      methodId: 'method-algo-touchstone-export',
    })
  })

  it('preserves the imported reference and rejects overrides, unsupported ports, or incomplete S11-only data', () => {
    expect(createTouchstoneNetworkExportJob(network(1), { frequencyUnit: 'GHZ', format: 'RI' }).input.ref).toBe(50)
    const overriddenOptions = { ...options, ref: 75 }
    expect(() => createTouchstoneNetworkExportJob(network(1), overriddenOptions)).toThrow(/unsupported field 'ref'/i)
    expect(() => createTouchstoneNetworkExportJob(network(5), options)).toThrow(/4-port/i)
    const incomplete = network(2)
    incomplete.points[0].s = [pair(1)]
    expect(() => createTouchstoneNetworkExportJob(incomplete, options)).toThrow(/full 2×2/i)
  })

  it('admits equal per-port references and rejects a nonuniform reference vector with a clear reason', () => {
    const equalReferences = Object.assign(network(2), { referenceImpedancesOhms: [50, 50] })
    expect(createTouchstoneNetworkExportJob(equalReferences, options).input.ref).toBe(50)

    const unequalReferences = Object.assign(network(2), { referenceImpedancesOhms: [50, 75] })
    expect(() => createTouchstoneNetworkExportJob(unequalReferences, options)).toThrow(/same reference impedance|nonuniform.*reference/i)

    // Older parsed networks may carry only the common scalar reference.
    expect(createTouchstoneNetworkExportJob(network(2), options).input.ref).toBe(50)
  })

  it('admits exactly 8192 matrix cells and rejects a sweep one point over the budget', () => {
    const source = network(4)
    const makePoints = (count: number) => Array.from({ length: count }, (_, index) => ({
      frequencyHz: index + 1,
      s: Array.from({ length: 16 }, (_, cell) => pair(index * 16 + cell)),
    }))

    source.points = makePoints(512)
    const allowed = createTouchstoneNetworkExportJob(source, options)
    expect(allowed.input.freqs).toHaveLength(512)
    expect(allowed.input.sweep).toHaveLength(512)

    source.points = makePoints(513)
    expect(() => createTouchstoneNetworkExportJob(source, options)).toThrow(/8192.*budget/i)
  })

  it('rejects malformed native payloads, metadata mismatches, and wrong module or provenance', () => {
    const { input } = createTouchstoneNetworkExportJob(network(2), options)
    const valid = successfulResult(input)
    const moduleResult = valid.moduleResult as Record<string, unknown>

    expect(() => readTouchstoneNetworkExportResult(null as unknown as JobResultV1, input)).toThrow()
    expect(() => readTouchstoneNetworkExportResult({ ...valid, moduleResult: null } as unknown as JobResultV1, input)).toThrow()
    expect(() => readTouchstoneNetworkExportResult(successfulResult(input, { module: 'other' }), input)).toThrow()
    expect(() => readTouchstoneNetworkExportResult(successfulResult(input, { familyId: 'wrong' }), input)).toThrow()
    expect(() => readTouchstoneNetworkExportResult(successfulResult(input, { methodId: 'wrong' }), input)).toThrow()
    expect(() => readTouchstoneNetworkExportResult(successfulResult(input, { backend: { id: 'native-cuda', kind: 'cuda', deviceName: 'gpu' } }), input)).toThrow()
    expect(() => readTouchstoneNetworkExportResult(successfulResult(input, { ok: false }), input)).toThrow()
    expect(() => readTouchstoneNetworkExportResult(successfulResult(input, { format: 'RI' }), input)).toThrow()
    expect(() => readTouchstoneNetworkExportResult(successfulResult(input, { nPoints: 1 }), input)).toThrow()
    expect(() => readTouchstoneNetworkExportResult(successfulResult(input, { bytes: 1 }), input)).toThrow()
    expect(() => readTouchstoneNetworkExportResult(successfulResult(input, { touchstone: `${moduleResult.touchstone}garbage\n` }), input)).toThrow()
  })
})

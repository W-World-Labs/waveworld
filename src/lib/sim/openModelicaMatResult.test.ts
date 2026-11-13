import { describe, expect, it } from 'vitest'
import { makeMatResultFixture, mutateMatResultFixture, truncateMatResultFixture } from './matV4Fixture'
import { resultToCsv, resultToJson } from './openModelicaMatExport'
import { parseOpenModelicaMatResult } from './openModelicaMatResult'

describe('parseOpenModelicaMatResult', () => {
  it.each([
    ['binTrans', 'little'],
    ['binTrans', 'big'],
    ['binNormal', 'little'],
    ['binNormal', 'big'],
  ] as const)('reads %s layout with %s-endian MAT-v4 data', (layout, endian) => {
    const result = parseOpenModelicaMatResult(makeMatResultFixture({ layout, endian }))

    expect(result.layout).toBe(layout)
    expect(result.sampleCount).toBe(4)
    expect(result.time).toEqual([0, 1, 1, 2])
    expect(result.signals.map(({ name }) => name)).toEqual([
      'Time', 'T', 'temperature', '-temperature', 'gain',
    ])
    expect(result.signals.map(({ description }) => description)).toEqual([
      'Time [s]', 'Temperature [K]', 'Temperature alias [K]',
      'Negated temperature [K]', 'Gain parameter',
    ])
  })

  it.each([
    ['binTrans', 'little'],
    ['binTrans', 'big'],
    ['binNormal', 'little'],
    ['binNormal', 'big'],
  ] as const)('reads float32 result tables in %s layout with %s-endian MAT-v4 data', (layout, endian) => {
    const result = parseOpenModelicaMatResult(makeMatResultFixture({
      layout,
      endian,
      matrices: {
        data_1: {
          rows: 2,
          cols: 2,
          values: layout === 'binTrans' ? [0, 2.5, 2, 2.5] : [0, 2, 2.5, 2.5],
          mopt: 10,
        },
        data_2: {
          rows: layout === 'binTrans' ? 2 : 4,
          cols: layout === 'binTrans' ? 4 : 2,
          values: layout === 'binTrans'
            ? [0, 300, 1, 310, 1, 311, 2, 320]
            : [0, 1, 1, 2, 300, 310, 311, 320],
          mopt: 10,
        },
      },
    }))

    expect(result.time).toEqual([0, 1, 1, 2])
    expect(result.signals.find(({ name }) => name === 'T')?.values).toEqual([300, 310, 311, 320])
    expect(result.signals.find(({ name }) => name === '-temperature')?.values).toEqual([-300, -310, -311, -320])
  })

  it('resolves time, data_2 series, data_1 start/stop values, aliases, and negative aliases', () => {
    const result = parseOpenModelicaMatResult(makeMatResultFixture())
    const byName = new Map(result.signals.map((signal) => [signal.name, signal]))

    expect(byName.get('Time')).toEqual({
      name: 'Time', description: 'Time [s]', kind: 'time', values: [0, 1, 1, 2],
    })
    expect(byName.get('T')).toEqual({
      name: 'T', description: 'Temperature [K]', kind: 'series', values: [300, 310, 311, 320],
    })
    expect(byName.get('temperature')).toEqual({
      name: 'temperature', description: 'Temperature alias [K]', kind: 'series', values: [300, 310, 311, 320],
    })
    expect(byName.get('-temperature')).toEqual({
      name: '-temperature', description: 'Negated temperature [K]', kind: 'series', values: [-300, -310, -311, -320],
    })
    expect(byName.get('gain')).toEqual({
      name: 'gain', description: 'Gain parameter', kind: 'parameter', values: [2.5, 2.5],
    })
  })

  it('preserves duplicate event times and their corresponding samples in input order', () => {
    const result = parseOpenModelicaMatResult(makeMatResultFixture())
    const temperature = result.signals.find((signal) => signal.name === 'T')

    expect(result.time).toEqual([0, 1, 1, 2])
    expect(temperature?.values).toEqual([300, 310, 311, 320])
    expect(result.time[1]).toBe(result.time[2])
    expect(temperature?.values[1]).not.toBe(temperature?.values[2])
  })

  it('rejects truncated MAT data', () => {
    const fixture = makeMatResultFixture()
    expect(() => parseOpenModelicaMatResult(truncateMatResultFixture(fixture))).toThrow()
  })

  it('rejects unsupported MAT-v4 element types', () => {
    const fixture = makeMatResultFixture()
    // Aclass is the first matrix; text MOPT 1 changed to an unsupported text precision.
    const unsupported = mutateMatResultFixture(fixture, 0, 2)
    expect(() => parseOpenModelicaMatResult(unsupported)).toThrow()
  })

  it('rejects out-of-range dataInfo indices', () => {
    const invalid = makeMatResultFixture({
      matrices: {
        dataInfo: { rows: 4, cols: 5, values: [
          0, 1, 0, 0,
          2, 1, 0, 0,
          2, 2, 0, 0,
          2, -2, 0, 0,
          1, 3, 0, 0,
        ] },
      },
    })
    expect(() => parseOpenModelicaMatResult(invalid)).toThrow()
  })

  it('rejects malformed Aclass headers', () => {
    const invalid = makeMatResultFixture({
      matrices: { Aclass: { rows: 4, cols: 1, values: ['X', '1.1', '', 'binTrans'], kind: 'text' } },
    })
    expect(() => parseOpenModelicaMatResult(invalid)).toThrow()
  })

  it('rejects a numeric matrix where a named text matrix is required', () => {
    const invalid = makeMatResultFixture({
      matrices: { name: { rows: 11, cols: 5, values: Array(55).fill(65), kind: 'double', mopt: 0 } },
    })
    expect(() => parseOpenModelicaMatResult(invalid)).toThrow()
  })

  it('exports exact sample order and duplicate event timestamps', () => {
    const result = parseOpenModelicaMatResult(makeMatResultFixture())
    const csv = resultToCsv(result, 'T')
    const json = JSON.parse(resultToJson(result, 'T'))

    expect(csv).toContain('"1","T","Temperature [K]","310"')
    expect(csv).toContain('"1","T","Temperature [K]","311"')
    expect(json.time).toEqual([0, 1, 1, 2])
    expect(json.signals[0].values).toEqual([300, 310, 311, 320])
    expect(json.verification).toContain('not verified')
  })
})

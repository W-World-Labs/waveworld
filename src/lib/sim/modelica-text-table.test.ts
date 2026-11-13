import { describe, expect, it } from 'vitest'
import { listModelicaTextTableNames, parseModelicaTextTable } from './modelica-text-table'

describe('parseModelicaTextTable', () => {
  it('selects a named double matrix and preserves its row-major numbers', () => {
    const result = parseModelicaTextTable([
      '#1',
      'double first(2,2) # optional declaration comment',
      '1 2',
      '3 4',
      'double selected(2,3)',
      '0, 1; 2',
      '3 # values may span lines and comments',
      '4 5',
    ].join('\n'), 'selected')

    expect(result).toEqual({
      name: 'selected',
      rows: 2,
      columns: 3,
      values: [[0, 1, 2], [3, 4, 5]],
    })
  })

  it('lists every declared matrix name after validating the full file', () => {
    expect(listModelicaTextTableNames('#1\ndouble input(1,1)\n0\ndouble output(1,2)\n1 2\n'))
      .toEqual(['input', 'output'])
  })

  it('accepts a BOM, C decimal and exponent forms, and line comments', () => {
    const result = parseModelicaTextTable('\uFEFF#1\n# UTF-8 comment: café\ndouble curve(2,2)\n+2.e4 .25\n-3 4E-2\n', 'curve')
    expect(result.values).toEqual([[20_000, 0.25], [-3, 0.04]])
  })

  it('requires the requested matrix and rejects duplicate matrix names', () => {
    expect(() => parseModelicaTextTable('#1\ndouble other(1,1)\n0\n', 'missing'))
      .toThrow(/does not contain matrix 'missing'/)
    expect(() => parseModelicaTextTable('#1\ndouble chosen(1,1)\n0\ndouble chosen(1,1)\n1\n', 'chosen'))
      .toThrow(/Duplicate Modelica matrix name/)
  })

  it('rejects unsupported declarations, non-finite values, and malformed numbers', () => {
    const invalid = [
      '#2\ndouble t(1,1)\n0\n',
      '#1\nfloat t(1,1)\n0\n',
      '#1\ndouble t(1,1)\nNaN\n',
      '#1\ndouble t(1,1)\n0x1p2\n',
      '#1\ndouble t(1,1)\nInfinity\n',
      '#1\ndouble t(1,1)\n0 extra\n',
      '#1\ndouble t(2,1)\n0\n',
      '#1\ndouble t(1,1)\n0\ndouble broken(1,1)',
    ]
    for (const text of invalid) expect(() => parseModelicaTextTable(text, 't')).toThrow()
  })

  it('rejects dimensions and inputs beyond the parser bounds', () => {
    expect(() => parseModelicaTextTable('#1\ndouble t(0,1)\n', 't')).toThrow(/row count/)
    expect(() => parseModelicaTextTable('#1\ndouble t(20001,1)\n', 't')).toThrow(/row count/)
    expect(() => parseModelicaTextTable(`#1\n${'x'.repeat(1024 * 1024)}`, 't')).toThrow(/byte limit/)
  })
})

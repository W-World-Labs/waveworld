import { describe, expect, it } from 'vitest'
import { selectModelicaTextTable2D } from './modelica-text-table-2d'

describe('selectModelicaTextTable2D', () => {
  it('selects a named surface and separates the Dymola-mapped axes and values', () => {
    const result = selectModelicaTextTable2D([
      '#1',
      'double ignored(3,3)',
      '0 1 2',
      '10 11 12',
      '20 21 22',
      'double surface(3,4)',
      '0 1 2 4',
      '10 101 102 104',
      '20 201 202 204',
    ].join('\n'), 'surface')

    expect(result).toEqual({
      name: 'surface',
      u1: [10, 20],
      u2: [1, 2, 4],
      values: [[101, 102, 104], [201, 202, 204]],
    })
  })

  it('requires at least two knots on each axis', () => {
    expect(() => selectModelicaTextTable2D('#1\ndouble t(2,3)\n0 1 2\n10 11 12\n', 't'))
      .toThrow(/at least two knots on each axis/)
    expect(() => selectModelicaTextTable2D('#1\ndouble t(3,2)\n0 1\n10 11\n20 21\n', 't'))
      .toThrow(/at least two knots on each axis/)
  })

  it('rejects repeated or descending knots on either axis', () => {
    const badU1 = '#1\ndouble t(3,3)\n0 1 2\n10 11 12\n10 21 22\n'
    const badU2 = '#1\ndouble t(3,3)\n0 2 1\n10 11 12\n20 21 22\n'
    expect(() => selectModelicaTextTable2D(badU1, 't')).toThrow(/u1 axis must be strictly increasing/)
    expect(() => selectModelicaTextTable2D(badU2, 't')).toThrow(/u2 axis must be strictly increasing/)
  })

  it('rejects axes and grids beyond their explicit bounds', () => {
    const tooManyU1Knots = 129
    const rows = [`0 1 2`, ...Array.from({ length: tooManyU1Knots }, (_, index) => `${index} 0 0`)]
    expect(() => selectModelicaTextTable2D(`#1\ndouble t(${tooManyU1Knots + 1},3)\n${rows.join('\n')}\n`, 't'))
      .toThrow(/u1 axis limit/)

    // The axis cap makes 128 × 128 the largest allowed interior grid.
    const knotCount = 128
    const top = `0 ${Array.from({ length: knotCount }, (_, index) => index).join(' ')}`
    const grid = Array.from({ length: knotCount }, (_, index) => `${index} ${'0 '.repeat(knotCount - 1)}0`)
    expect(selectModelicaTextTable2D(
      `#1\ndouble t(${knotCount + 1},${knotCount + 1})\n${[top, ...grid].join('\n')}\n`, 't',
    ).values).toHaveLength(knotCount)
  })
})

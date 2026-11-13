import { describe, expect, it } from 'vitest'
import {
  parseStarCcmResidualCsv,
  STAR_CCM_RESIDUAL_CSV_MAX_BYTES,
  STAR_CCM_RESIDUAL_CSV_MAX_ROWS,
  STAR_CCM_RESIDUAL_CSV_MAX_SERIES,
} from './star-ccm-residual-csv'

describe('WaveWorld app-defined residual CSV parser', () => {
  it('parses quoted headers and numeric cells into rows and W-Sim series', () => {
    const parsed = parseStarCcmResidualCsv(
      'iteration,"residual:continuity","monitor:pressure"\r\n1,0.25,"2"\r\n2,0,2.5\r\n',
    )

    expect(parsed).toEqual({
      iterations: [1, 2],
      rows: [
        { iteration: 1, residuals: { continuity: 0.25 }, monitors: { pressure: 2 } },
        { iteration: 2, residuals: { continuity: 0 }, monitors: { pressure: 2.5 } },
      ],
      input: {
        residuals: { continuity: [0.25, 0] },
        monitors: { pressure: [2, 2.5] },
      },
    })
  })

  it('decodes escaped quotes inside a quoted cell before validating its number', () => {
    expect(() => parseStarCcmResidualCsv('iteration,monitor:m\n1,"2""3"')).toThrow(/finite number/)
  })

  it('allows either series family to be absent', () => {
    expect(parseStarCcmResidualCsv('iteration,monitor:lift\n3,-1.5').input).toEqual({
      monitors: { lift: [-1.5] },
    })
  })

  it.each([
    ['missing series column', 'iteration\n1'],
    ['unknown header type', 'iteration,value:x\n1,2'],
    ['duplicate series name', 'iteration,residual:x,monitor:x\n1,1,2'],
    ['reserved property name', 'iteration,monitor:constructor\n1,1'],
    ['wrong width', 'iteration,residual:x\n1,1,2'],
    ['empty cell', 'iteration,residual:x\n1,'],
    ['non-finite value', 'iteration,residual:x\n1,Infinity'],
    ['negative residual', 'iteration,residual:x\n1,-0.1'],
    ['non-integer iteration', 'iteration,monitor:x\n1.5,2'],
    ['non-positive iteration', 'iteration,monitor:x\n0,2'],
    ['non-increasing iterations', 'iteration,monitor:x\n2,2\n2,3'],
    ['unterminated quote', 'iteration,monitor:x\n1,"2'],
    ['text after quote', 'iteration,monitor:x\n1,"2"x'],
    ['quote in unquoted cell', 'iteration,monitor:x\n1,2"3'],
    ['bare carriage return', 'iteration,monitor:x\n1,2\r3,4'],
  ])('rejects %s', (_name, csv) => {
    expect(() => parseStarCcmResidualCsv(csv)).toThrow(/Invalid WaveWorld residual CSV/)
  })

  it('enforces serialized input and series bounds', () => {
    expect(() => parseStarCcmResidualCsv(`iteration,monitor:x\n1,"${'a'.repeat(STAR_CCM_RESIDUAL_CSV_MAX_BYTES)}"`)).toThrow(/exceeds/)
    const tooManySeries = ['iteration', ...Array.from({ length: STAR_CCM_RESIDUAL_CSV_MAX_SERIES + 1 }, (_, i) => `monitor:m${i}`)].join(',')
    expect(() => parseStarCcmResidualCsv(`${tooManySeries}\n1,${Array(STAR_CCM_RESIDUAL_CSV_MAX_SERIES + 1).fill('0').join(',')}`)).toThrow(/series columns/)
  })

  it('enforces row and total value bounds', () => {
    const manyRows = ['iteration,monitor:m', ...Array.from({ length: STAR_CCM_RESIDUAL_CSV_MAX_ROWS + 1 }, (_, i) => `${i + 1},0`)].join('\n')
    expect(() => parseStarCcmResidualCsv(manyRows)).toThrow(/data rows/)

    const columns = ['iteration', ...Array.from({ length: STAR_CCM_RESIDUAL_CSV_MAX_SERIES }, (_, i) => `monitor:m${i}`)].join(',')
    const rows = Array.from({ length: 5_000 }, (_, i) => [i + 1, ...Array(STAR_CCM_RESIDUAL_CSV_MAX_SERIES).fill(0)].join(','))
    expect(() => parseStarCcmResidualCsv([columns, ...rows].join('\n'))).toThrow(/values/)
  })
})

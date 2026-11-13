import { describe, expect, it } from 'vitest'
import {
  parseStarCcmCflCsv,
  STAR_CCM_CFL_CSV_COLUMNS,
  STAR_CCM_CFL_CSV_MAX_BYTES,
  STAR_CCM_CFL_CSV_MAX_ROWS,
  STAR_CCM_CFL_CSV_MAX_VALUES,
} from './star-ccm-cfl-csv'

const header = STAR_CCM_CFL_CSV_COLUMNS.join(',')
const cell = '7,0.01,0.02,0.03,-1.5,2,0,343'

describe('WaveWorld app-defined STAR directional CFL CSV parser', () => {
  it('parses fixed columns, BOM, CRLF, and quoted numeric cells', () => {
    expect(parseStarCcmCflCsv(`\uFEFF${header}\r\n"7","0.01","0.02","0.03","-1.5","2","0","343"\r\n`)).toEqual([
      { cellId: 7, hx_m: 0.01, hy_m: 0.02, hz_m: 0.03, ux_m_s: -1.5, uy_m_s: 2, uz_m_s: 0, soundSpeed_m_s: 343 },
    ])
  })

  it('accepts a zero sound speed and signed finite velocity components', () => {
    expect(parseStarCcmCflCsv(`${header}\n1,1,2,3,-1,-2,-3,0`)).toEqual([
      { cellId: 1, hx_m: 1, hy_m: 2, hz_m: 3, ux_m_s: -1, uy_m_s: -2, uz_m_s: -3, soundSpeed_m_s: 0 },
    ])
  })

  it.each([
    ['missing column', `${STAR_CCM_CFL_CSV_COLUMNS.slice(0, -1).join(',')}\n${cell}`],
    ['reordered columns', `${[...STAR_CCM_CFL_CSV_COLUMNS].reverse().join(',')}\n${cell}`],
    ['unknown column', `${header.replace('soundSpeed_m_s', 'sound_speed')}\n${cell}`],
    ['wrong row width', `${header}\n7,0.01,0.02`],
    ['malformed quoted cell', `${header}\n7,"0.01,0.02,0.03,-1.5,2,0,343`],
    ['text after quoted cell', `${header}\n"7"x,0.01,0.02,0.03,-1.5,2,0,343`],
    ['bare carriage return', `${header}\r${cell}`],
    ['empty data', `${header}\n`],
  ])('rejects %s', (_name, csv) => {
    expect(() => parseStarCcmCflCsv(csv)).toThrow(/Invalid WaveWorld directional CFL CSV/)
  })

  it('rejects duplicate, non-positive, fractional, and unsafe cell IDs', () => {
    expect(() => parseStarCcmCflCsv(`${header}\n${cell}\n${cell}`)).toThrow(/repeated/)
    for (const id of ['0', '-1', '1.5', '9007199254740992']) {
      expect(() => parseStarCcmCflCsv(`${header}\n${cell.replace(/^7,/, `${id},`)}`)).toThrow(/positive safe integer/)
    }
  })

  it.each(['NaN', 'Infinity', '1e999', ''])('rejects non-finite or missing numeric input %s', value => {
    expect(() => parseStarCcmCflCsv(`${header}\n${cell.replace('343', value)}`)).toThrow(/finite number/)
  })

  it.each([
    ['zero hx', '0.01,0.02,0.03', '0,0.02,0.03'],
    ['negative hy', '0.01,0.02,0.03', '0.01,-0.02,0.03'],
    ['zero hz', '0.01,0.02,0.03', '0.01,0.02,0'],
  ])('rejects %s', (_name, original, replacement) => {
    expect(() => parseStarCcmCflCsv(`${header}\n${cell.replace(original, replacement)}`)).toThrow(/extents.*positive/)
  })

  it('rejects negative sound speed', () => {
    expect(() => parseStarCcmCflCsv(`${header}\n${cell.replace(',343', ',-1')}`)).toThrow(/sound speed.*non-negative/)
  })

  it('enforces the data-row, numeric-value, and UTF-8 byte bounds', () => {
    expect(STAR_CCM_CFL_CSV_MAX_BYTES).toBe(512 * 1024)
    expect(STAR_CCM_CFL_CSV_MAX_ROWS).toBe(5_000)
    expect(STAR_CCM_CFL_CSV_MAX_VALUES).toBe(35_000)

    const maxRows = `${header}\n${Array.from({ length: STAR_CCM_CFL_CSV_MAX_ROWS }, (_, index) => cell.replace(/^7,/, `${index + 1},`)).join('\n')}`
    expect(parseStarCcmCflCsv(maxRows)).toHaveLength(STAR_CCM_CFL_CSV_MAX_ROWS)

    const tooManyRows = `${header}\n${Array.from({ length: STAR_CCM_CFL_CSV_MAX_ROWS + 1 }, (_, index) => cell.replace(/^7,/, `${index + 1},`)).join('\n')}`
    expect(() => parseStarCcmCflCsv(tooManyRows)).toThrow(/data rows/)

    const tooManyBytes = `${header}\n${'x'.repeat(STAR_CCM_CFL_CSV_MAX_BYTES)}`
    expect(() => parseStarCcmCflCsv(tooManyBytes)).toThrow(/exceeds.*bytes/)
  })
})

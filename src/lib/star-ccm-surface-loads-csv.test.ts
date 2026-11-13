import { describe, expect, it } from 'vitest'
import {
  parseStarCcmSurfaceLoadsCsv,
  STAR_CCM_SURFACE_LOADS_CSV_COLUMNS,
  STAR_CCM_SURFACE_LOADS_CSV_MAX_BYTES,
  STAR_CCM_SURFACE_LOADS_CSV_MAX_ROWS,
} from './star-ccm-surface-loads-csv'

const header = STAR_CCM_SURFACE_LOADS_CSV_COLUMNS.join(',')
const face = '1,0.5,0,0,-12.5,1,2,3,0.1,0.2,0.3'

describe('WaveWorld app-defined STAR surface-load CSV parser', () => {
  it('parses the exact fixed schema, UTF-8 BOM, quoted numbers, and LF/CRLF records', () => {
    expect(parseStarCcmSurfaceLoadsCsv(`\uFEFF${header}\r\n"1","0.5","0","0","-12.5","1","2","3","0.1","0.2","0.3"\n2,0,1,0,0,0,0,0,1,2,3\r\n`)).toEqual([
      { faceId: 1, areaX_m2: 0.5, areaY_m2: 0, areaZ_m2: 0, pressure_Pa: -12.5, shearForceX_N: 1, shearForceY_N: 2, shearForceZ_N: 3, centroidX_m: 0.1, centroidY_m: 0.2, centroidZ_m: 0.3 },
      { faceId: 2, areaX_m2: 0, areaY_m2: 1, areaZ_m2: 0, pressure_Pa: 0, shearForceX_N: 0, shearForceY_N: 0, shearForceZ_N: 0, centroidX_m: 1, centroidY_m: 2, centroidZ_m: 3 },
    ])
  })

  it.each([
    ['missing column', STAR_CCM_SURFACE_LOADS_CSV_COLUMNS.slice(0, -1).join(',') + `\n${face}`],
    ['reordered columns', [...STAR_CCM_SURFACE_LOADS_CSV_COLUMNS].reverse().join(',') + `\n${face}`],
    ['unknown column', header.replace('pressure_Pa', 'pressure') + `\n${face}`],
    ['wrong row width', `${header}\n1,0.5,0`],
    ['malformed quoted cell', `${header}\n1,"0.5,0,0,-12.5,1,2,3,0.1,0.2,0.3`],
    ['text after quoted cell', `${header}\n"1"x,0.5,0,0,-12.5,1,2,3,0.1,0.2,0.3`],
    ['bare carriage return', `${header}\r${face}`],
    ['empty data', `${header}\n`],
  ])('rejects %s', (_name, csv) => {
    expect(() => parseStarCcmSurfaceLoadsCsv(csv)).toThrow(/Invalid WaveWorld surface-load CSV/)
  })

  it('rejects duplicate, non-positive, and unsafe face IDs', () => {
    expect(() => parseStarCcmSurfaceLoadsCsv(`${header}\n${face}\n${face.replace(/^1,/, '1.0,')}`)).toThrow(/repeated/)
    expect(() => parseStarCcmSurfaceLoadsCsv(`${header}\n${face.replace(/^1,/, '0,')}`)).toThrow(/positive safe integer/)
    expect(() => parseStarCcmSurfaceLoadsCsv(`${header}\n${face.replace(/^1,/, '9007199254740992,')}`)).toThrow(/positive safe integer/)
  })

  it.each(['NaN', 'Infinity', '1e999', ''])('rejects non-finite or missing numeric input %s', value => {
    expect(() => parseStarCcmSurfaceLoadsCsv(`${header}\n${face.replace('-12.5', value)}`)).toThrow(/finite number/)
  })

  it('rejects a zero area vector', () => {
    expect(() => parseStarCcmSurfaceLoadsCsv(`${header}\n${face.replace('0.5,0,0,', '0,0,0,')}`)).toThrow(/area vector.*nonzero/)
  })

  it('enforces the face-row and UTF-8 byte limits', () => {
    const tooManyRows = `${header}\n${Array.from({ length: STAR_CCM_SURFACE_LOADS_CSV_MAX_ROWS + 1 }, (_, index) => face.replace(/^1,/, `${index + 1},`)).join('\n')}`
    expect(() => parseStarCcmSurfaceLoadsCsv(tooManyRows)).toThrow(/face rows/)
    expect(STAR_CCM_SURFACE_LOADS_CSV_MAX_BYTES).toBeGreaterThan(0)
    expect(() => parseStarCcmSurfaceLoadsCsv(`${header}\n"${'x'.repeat(STAR_CCM_SURFACE_LOADS_CSV_MAX_BYTES)}"`)).toThrow(/exceeds/)
  })
})

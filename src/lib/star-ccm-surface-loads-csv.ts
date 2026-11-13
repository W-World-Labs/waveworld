/** WaveWorld's bounded surface-sample input; not a STAR-CCM+ export schema. */

export const STAR_CCM_SURFACE_LOADS_CSV_MAX_BYTES = 512 * 1024
export const STAR_CCM_SURFACE_LOADS_CSV_MAX_ROWS = 5_000
const STAR_CCM_SURFACE_LOADS_CSV_MAX_RECORDS = STAR_CCM_SURFACE_LOADS_CSV_MAX_ROWS + 1
export const STAR_CCM_SURFACE_LOADS_CSV_COLUMNS = [
  'faceId', 'areaX_m2', 'areaY_m2', 'areaZ_m2', 'pressure_Pa',
  'shearForceX_N', 'shearForceY_N', 'shearForceZ_N',
  'centroidX_m', 'centroidY_m', 'centroidZ_m',
] as const

export type StarCcmSurfaceLoadRow = {
  faceId: number
  areaX_m2: number
  areaY_m2: number
  areaZ_m2: number
  pressure_Pa: number
  shearForceX_N: number
  shearForceY_N: number
  shearForceZ_N: number
  centroidX_m: number
  centroidY_m: number
  centroidZ_m: number
}

function fail(message: string): never {
  throw new Error(`Invalid WaveWorld surface-load CSV: ${message}`)
}

function parseRecords(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let cell = ''
  let quoted = false
  let afterQuote = false
  let atRecordStart = true
  const pushRecord = () => {
    records.push(record)
    if (records.length > STAR_CCM_SURFACE_LOADS_CSV_MAX_RECORDS) {
      fail(`input exceeds ${STAR_CCM_SURFACE_LOADS_CSV_MAX_ROWS} face rows`)
    }
    record = []
  }
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1 }
        else { quoted = false; afterQuote = true }
      } else cell += char
      continue
    }
    if (afterQuote && char !== ',' && char !== '\n' && char !== '\r') fail('unexpected character after a quoted cell')
    if (char === '"') {
      if (cell.length > 0 || afterQuote) fail('quote inside a cell')
      quoted = true
      atRecordStart = false
    } else if (char === ',') {
      record.push(cell); cell = ''; afterQuote = false; atRecordStart = true
    } else if (char === '\n' || char === '\r') {
      if (char === '\r') { if (text[i + 1] !== '\n') fail('bare carriage return is unsupported'); i += 1 }
      record.push(cell); pushRecord(); cell = ''; afterQuote = false; atRecordStart = true
    } else {
      if (afterQuote) fail('unexpected character after a quoted cell')
      if (atRecordStart && char === ' ' && cell.length === 0) { cell += char; atRecordStart = false }
      else { cell += char; atRecordStart = false }
    }
  }
  if (quoted) fail('unterminated quoted cell')
  if (cell.length > 0 || record.length > 0 || !atRecordStart) { record.push(cell); pushRecord() }
  return records
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
function numericCell(cell: string, label: string): number {
  const normalized = cell.trim()
  if (!NUMBER.test(normalized)) fail(`${label} must be a finite number`)
  const value = Number(normalized)
  if (!Number.isFinite(value)) fail(`${label} must be a finite number`)
  return value
}

export function parseStarCcmSurfaceLoadsCsv(text: string): StarCcmSurfaceLoadRow[] {
  if (new TextEncoder().encode(text).byteLength > STAR_CCM_SURFACE_LOADS_CSV_MAX_BYTES) fail(`input exceeds ${STAR_CCM_SURFACE_LOADS_CSV_MAX_BYTES} bytes`)
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  if (!normalized) fail('header is required')
  const records = parseRecords(normalized)
  const header = records[0]
  if (!header || header.length !== STAR_CCM_SURFACE_LOADS_CSV_COLUMNS.length || header.some((value, index) => value !== STAR_CCM_SURFACE_LOADS_CSV_COLUMNS[index])) {
    fail(`header must exactly match ${STAR_CCM_SURFACE_LOADS_CSV_COLUMNS.join(',')}`)
  }
  const data = records.slice(1)
  if (data.length === 0) fail('at least one face row is required')
  if (data.length > STAR_CCM_SURFACE_LOADS_CSV_MAX_ROWS) fail(`input exceeds ${STAR_CCM_SURFACE_LOADS_CSV_MAX_ROWS} face rows`)
  const ids = new Set<number>()
  const rows: StarCcmSurfaceLoadRow[] = []
  for (let index = 0; index < data.length; index += 1) {
    const cells = data[index]
    const rowLabel = `row ${index + 2}`
    if (cells.length !== STAR_CCM_SURFACE_LOADS_CSV_COLUMNS.length) fail(`${rowLabel} has the wrong number of cells`)
    const values = cells.map((value, column) => numericCell(value, `${STAR_CCM_SURFACE_LOADS_CSV_COLUMNS[column]} on ${rowLabel}`))
    const [faceId, areaX_m2, areaY_m2, areaZ_m2, pressure_Pa, shearForceX_N, shearForceY_N, shearForceZ_N, centroidX_m, centroidY_m, centroidZ_m] = values
    if (!Number.isSafeInteger(faceId) || faceId <= 0) fail(`faceId on ${rowLabel} must be a positive safe integer`)
    if (ids.has(faceId)) fail(`faceId ${faceId} is repeated`)
    ids.add(faceId)
    if (areaX_m2 === 0 && areaY_m2 === 0 && areaZ_m2 === 0) fail(`area vector on ${rowLabel} must be nonzero`)
    rows.push({ faceId, areaX_m2, areaY_m2, areaZ_m2, pressure_Pa, shearForceX_N, shearForceY_N, shearForceZ_N, centroidX_m, centroidY_m, centroidZ_m })
  }
  return rows
}

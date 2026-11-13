/**
 * Parser for WaveWorld's app-defined directional CFL CSV interchange format.
 * This is not a STAR-CCM+ native export format and does not import .sim files.
 */

export const STAR_CCM_CFL_CSV_MAX_BYTES = 512 * 1024
export const STAR_CCM_CFL_CSV_MAX_ROWS = 5_000
export const STAR_CCM_CFL_CSV_MAX_VALUES = 35_000
export const STAR_CCM_CFL_CSV_COLUMNS = [
  'cellId', 'hx_m', 'hy_m', 'hz_m', 'ux_m_s', 'uy_m_s', 'uz_m_s', 'soundSpeed_m_s',
] as const

export type StarCcmCflRow = {
  cellId: number
  hx_m: number
  hy_m: number
  hz_m: number
  ux_m_s: number
  uy_m_s: number
  uz_m_s: number
  soundSpeed_m_s: number
}

function fail(message: string): never {
  throw new Error(`Invalid WaveWorld directional CFL CSV: ${message}`)
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
    if (records.length > STAR_CCM_CFL_CSV_MAX_ROWS + 1) {
      fail(`input exceeds ${STAR_CCM_CFL_CSV_MAX_ROWS} data rows`)
    }
    record = []
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          quoted = false
          afterQuote = true
        }
      } else {
        cell += char
      }
      continue
    }

    if (afterQuote && char !== ',' && char !== '\n' && char !== '\r') {
      fail('unexpected character after a quoted cell')
    }
    if (char === '"') {
      if (cell.length > 0 || afterQuote) fail('quote inside a cell')
      quoted = true
      atRecordStart = false
    } else if (char === ',') {
      record.push(cell)
      cell = ''
      afterQuote = false
      atRecordStart = true
    } else if (char === '\n' || char === '\r') {
      if (char === '\r') {
        if (text[i + 1] !== '\n') fail('bare carriage return is unsupported')
        i += 1
      }
      record.push(cell)
      pushRecord()
      cell = ''
      afterQuote = false
      atRecordStart = true
    } else {
      if (afterQuote) fail('unexpected character after a quoted cell')
      cell += char
      atRecordStart = false
    }
  }

  if (quoted) fail('unterminated quoted cell')
  // A final record separator terminates the previous record; it adds no row.
  if (cell.length > 0 || record.length > 0 || !atRecordStart) {
    record.push(cell)
    pushRecord()
  }
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

/** Parse app-defined UTF-8 CSV text into cell IDs and [hx, hy, hz, ux, uy, uz, a] rows. */
export function parseStarCcmCflCsv(text: string): StarCcmCflRow[] {
  if (new TextEncoder().encode(text).byteLength > STAR_CCM_CFL_CSV_MAX_BYTES) {
    fail(`input exceeds ${STAR_CCM_CFL_CSV_MAX_BYTES} bytes`)
  }
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  if (normalized.length === 0) fail('header is required')

  const records = parseRecords(normalized)
  const header = records[0]
  if (!header || header.length !== STAR_CCM_CFL_CSV_COLUMNS.length ||
    header.some((value, index) => value !== STAR_CCM_CFL_CSV_COLUMNS[index])) {
    fail(`header must exactly match ${STAR_CCM_CFL_CSV_COLUMNS.join(',')}`)
  }

  const data = records.slice(1)
  if (data.length === 0) fail('at least one cell row is required')
  if (data.length > STAR_CCM_CFL_CSV_MAX_ROWS) {
    fail(`input exceeds ${STAR_CCM_CFL_CSV_MAX_ROWS} data rows`)
  }
  // cellId identifies the row; the bounded directional payload has seven values.
  if (data.length * 7 > STAR_CCM_CFL_CSV_MAX_VALUES) {
    fail(`input exceeds ${STAR_CCM_CFL_CSV_MAX_VALUES} numerical values`)
  }

  const ids = new Set<number>()
  const rows: StarCcmCflRow[] = []
  for (let index = 0; index < data.length; index += 1) {
    const cells = data[index]
    const rowLabel = `row ${index + 2}`
    if (cells.length !== STAR_CCM_CFL_CSV_COLUMNS.length) {
      fail(`${rowLabel} has the wrong number of cells`)
    }
    const cellId = numericCell(cells[0], `cellId on ${rowLabel}`)
    if (!Number.isSafeInteger(cellId) || cellId <= 0) {
      fail(`cellId on ${rowLabel} must be a positive safe integer`)
    }
    if (ids.has(cellId)) fail(`cellId ${cellId} is repeated`)
    ids.add(cellId)

    const values = cells.slice(1).map((cell, column) =>
      numericCell(cell, `${STAR_CCM_CFL_CSV_COLUMNS[column + 1]} on ${rowLabel}`))
    const [hx_m, hy_m, hz_m, ux_m_s, uy_m_s, uz_m_s, soundSpeed_m_s] = values
    if (hx_m <= 0 || hy_m <= 0 || hz_m <= 0) {
      fail(`cell extents on ${rowLabel} must be positive`)
    }
    if (soundSpeed_m_s < 0) fail(`sound speed on ${rowLabel} must be non-negative`)
    rows.push({ cellId, hx_m, hy_m, hz_m, ux_m_s, uy_m_s, uz_m_s, soundSpeed_m_s })
  }

  return rows
}

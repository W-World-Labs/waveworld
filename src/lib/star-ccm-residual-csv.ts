/**
 * Parser for WaveWorld's app-defined residual CSV interchange format.
 * This is not a Siemens STAR-CCM+ export schema or compatibility claim.
 */

export const STAR_CCM_RESIDUAL_CSV_MAX_BYTES = 512 * 1024
export const STAR_CCM_RESIDUAL_CSV_MAX_ROWS = 5_000
export const STAR_CCM_RESIDUAL_CSV_MAX_SERIES = 16
export const STAR_CCM_RESIDUAL_CSV_MAX_VALUES = 80_000

export type StarCcmResidualCsvRow = {
  iteration: number
  residuals?: Record<string, number>
  monitors?: Record<string, number>
}

export type StarCcmResidualCsv = {
  iterations: number[]
  rows: StarCcmResidualCsvRow[]
  input: {
    residuals?: Record<string, number[]>
    monitors?: Record<string, number[]>
  }
}

function fail(message: string): never {
  throw new Error(`Invalid WaveWorld residual CSV: ${message}`)
}

function parseRecords(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let cell = ''
  let quoted = false
  let afterQuote = false
  let atRecordStart = true

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
      if (!atRecordStart && cell.length > 0) fail('quote inside an unquoted cell')
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
      records.push(record)
      record = []
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
  // A final record separator terminates the previous record; it does not add
  // an empty record. Empty input is handled by the caller.
  if (cell.length > 0 || record.length > 0 || !atRecordStart) {
    record.push(cell)
    records.push(record)
  }
  return records
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/

function numericCell(cell: string, label: string): number {
  const normalized = cell.trim()
  if (!NUMBER.test(normalized)) fail(`${label} must be a finite number`)
  const value = Number(normalized)
  if (!Number.isFinite(value)) fail(`${label} must be a finite number`)
  return value
}

/** Parse the app-defined UTF-8 CSV string into rows and W-Sim series arrays. */
export function parseStarCcmResidualCsv(text: string): StarCcmResidualCsv {
  if (new TextEncoder().encode(text).byteLength > STAR_CCM_RESIDUAL_CSV_MAX_BYTES) {
    fail(`input exceeds ${STAR_CCM_RESIDUAL_CSV_MAX_BYTES} bytes`)
  }
  if (text.length === 0) fail('header is required')

  const records = parseRecords(text)
  if (records.length === 0) fail('header is required')
  const header = records[0]
  if (header.length < 2 || header[0] !== 'iteration') {
    fail('header must start with iteration and include at least one series column')
  }

  const columns: Array<{ kind: 'residuals' | 'monitors'; name: string }> = []
  const names = new Set<string>()
  for (const label of header.slice(1)) {
    const separator = label.indexOf(':')
    const kind = label.slice(0, separator)
    const name = label.slice(separator + 1)
    if ((kind !== 'residual' && kind !== 'monitor') || separator < 0 || !NAME.test(name) ||
      name === '__proto__' || name === 'prototype' || name === 'constructor') {
      fail(`unsupported series header ${JSON.stringify(label)}`)
    }
    if (names.has(name)) fail(`duplicate series name ${JSON.stringify(name)}`)
    names.add(name)
    columns.push({ kind: kind === 'residual' ? 'residuals' : 'monitors', name })
  }
  if (columns.length > STAR_CCM_RESIDUAL_CSV_MAX_SERIES) {
    fail(`input exceeds ${STAR_CCM_RESIDUAL_CSV_MAX_SERIES} series columns`)
  }

  const data = records.slice(1)
  if (data.length > STAR_CCM_RESIDUAL_CSV_MAX_ROWS) {
    fail(`input exceeds ${STAR_CCM_RESIDUAL_CSV_MAX_ROWS} data rows`)
  }
    if (data.length * header.length > STAR_CCM_RESIDUAL_CSV_MAX_VALUES) {
    fail(`input exceeds ${STAR_CCM_RESIDUAL_CSV_MAX_VALUES} values`)
  }
  if (data.length === 0) fail('at least one data row is required')

  const iterations: number[] = []
  const rows: StarCcmResidualCsvRow[] = []
  const residuals: Record<string, number[]> = {}
  const monitors: Record<string, number[]> = {}
  for (const column of columns) {
    ;(column.kind === 'residuals' ? residuals : monitors)[column.name] = []
  }

  for (let rowIndex = 0; rowIndex < data.length; rowIndex += 1) {
    const cells = data[rowIndex]
    if (cells.length !== header.length) fail(`row ${rowIndex + 2} has the wrong number of cells`)
    const iterationValue = numericCell(cells[0], `iteration on row ${rowIndex + 2}`)
    if (!Number.isInteger(iterationValue) || iterationValue <= 0) {
      fail(`iteration on row ${rowIndex + 2} must be a positive integer`)
    }
    if (iterations.length > 0 && iterationValue <= iterations[iterations.length - 1]) {
      fail(`iteration on row ${rowIndex + 2} must be strictly increasing`)
    }
    iterations.push(iterationValue)
    const row: StarCcmResidualCsvRow = { iteration: iterationValue }
    for (let i = 0; i < columns.length; i += 1) {
      const column = columns[i]
      const value = numericCell(cells[i + 1], `${column.kind} ${column.name} on row ${rowIndex + 2}`)
      if (column.kind === 'residuals') {
        if (value < 0) fail(`residual ${column.name} on row ${rowIndex + 2} must be non-negative`)
        ;(row.residuals ??= {})[column.name] = value
        residuals[column.name].push(value)
      } else {
        ;(row.monitors ??= {})[column.name] = value
        monitors[column.name].push(value)
      }
    }
    rows.push(row)
  }

  return {
    iterations,
    rows,
    input: {
      ...(Object.keys(residuals).length > 0 ? { residuals } : {}),
      ...(Object.keys(monitors).length > 0 ? { monitors } : {}),
    },
  }
}

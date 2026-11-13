/**
 * Bounded reader for the Modelica #1 text-table format. It decodes matrix
 * numbers only; interpolation and execution belong to the caller.
 */

export const MODELICA_TEXT_TABLE_MAX_BYTES = 1024 * 1024
export const MODELICA_TEXT_TABLE_MAX_LINES = 50_000
export const MODELICA_TEXT_TABLE_MAX_MATRICES = 32
export const MODELICA_TEXT_TABLE_MAX_ROWS = 20_000
export const MODELICA_TEXT_TABLE_MAX_COLUMNS = 256
export const MODELICA_TEXT_TABLE_MAX_CELLS = 1_000_000

export interface ModelicaTextTable {
  name: string
  rows: number
  columns: number
  values: number[][]
}

const DECIMAL = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/
const TABLE_HEADER = /^double\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)\s*$/

function fail(message: string, line?: number): never {
  throw new Error(line === undefined ? message : `${message} (line ${line})`)
}

function parseDimension(token: string, label: string, line: number, max: number): number {
  const value = Number(token)
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    fail(`Modelica table ${label} must be an integer from 1 to ${max}`, line)
  }
  return value
}

function parseNumber(token: string, line: number): number {
  if (!DECIMAL.test(token)) fail('Unsupported Modelica table numeric syntax', line)
  const value = Number(token)
  if (!Number.isFinite(value)) fail('Modelica table values must be finite', line)
  return value
}

function stripComment(line: string): string {
  const marker = line.indexOf('#')
  return (marker < 0 ? line : line.slice(0, marker)).trim()
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false
    }
  }
  return true
}

function parseModelicaTextTables(text: string): ModelicaTextTable[] {
  if (typeof text !== 'string') throw new Error('Modelica table contents must be text')
  if (text.length > MODELICA_TEXT_TABLE_MAX_BYTES) {
    throw new Error(`Modelica table exceeds the ${MODELICA_TEXT_TABLE_MAX_BYTES}-byte limit`)
  }
  if (new TextEncoder().encode(text).byteLength > MODELICA_TEXT_TABLE_MAX_BYTES) {
    throw new Error(`Modelica table exceeds the ${MODELICA_TEXT_TABLE_MAX_BYTES}-byte limit`)
  }
  if (!isWellFormedUnicode(text)) throw new Error('Modelica table text contains malformed Unicode')

  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const lines = normalized.split(/\r\n|\n|\r/)
  if (lines.length > MODELICA_TEXT_TABLE_MAX_LINES) {
    throw new Error(`Modelica table exceeds the ${MODELICA_TEXT_TABLE_MAX_LINES}-line limit`)
  }
  if (lines[0] !== '#1') fail('Modelica text table must start with the exact #1 format marker', 1)

  const matrices: ModelicaTextTable[] = []
  let matrixCount = 0
  let totalCells = 0
  const names = new Set<string>()
  let lineIndex = 1
  while (lineIndex < lines.length) {
    const headerLine = lineIndex + 1
    const header = stripComment(lines[lineIndex])
    lineIndex += 1
    if (!header) continue

    const match = TABLE_HEADER.exec(header)
    if (!match) fail('Unsupported Modelica text table syntax; expected a double matrix header', headerLine)
    matrixCount += 1
    if (matrixCount > MODELICA_TEXT_TABLE_MAX_MATRICES) {
      fail(`Modelica table exceeds the ${MODELICA_TEXT_TABLE_MAX_MATRICES}-matrix limit`, headerLine)
    }
    const [, name, rowToken, columnToken] = match
    if (names.has(name)) fail(`Duplicate Modelica matrix name '${name}'`, headerLine)
    names.add(name)
    const rows = parseDimension(rowToken, 'row count', headerLine, MODELICA_TEXT_TABLE_MAX_ROWS)
    const columns = parseDimension(columnToken, 'column count', headerLine, MODELICA_TEXT_TABLE_MAX_COLUMNS)
    const cells = rows * columns
    if (!Number.isSafeInteger(cells) || cells > MODELICA_TEXT_TABLE_MAX_CELLS - totalCells) {
      fail(`Modelica table exceeds the ${MODELICA_TEXT_TABLE_MAX_CELLS}-cell limit`, headerLine)
    }
    totalCells += cells

    const flat: number[] = []
    while (flat.length < cells && lineIndex < lines.length) {
      const dataLineNumber = lineIndex + 1
      const data = stripComment(lines[lineIndex])
      lineIndex += 1
      if (!data) continue
      // This format has separators, not expressions or locale-specific numbers.
      if (/[^\x09\x0a\x0d\x20-\x7e]/.test(data)) {
        fail('Modelica table data must use ASCII syntax', dataLineNumber)
      }
      const tokens = data.split(/[\s,;]+/).filter(Boolean)
      for (const token of tokens) {
        if (flat.length >= cells) fail('Modelica matrix contains more values than declared', dataLineNumber)
        flat.push(parseNumber(token, dataLineNumber))
      }
    }
    if (flat.length !== cells) {
      fail(`Modelica matrix '${name}' has ${flat.length} values; expected ${cells}`, headerLine)
    }

    const values: number[][] = []
    for (let offset = 0; offset < flat.length; offset += columns) {
      values.push(flat.slice(offset, offset + columns))
    }
    matrices.push({ name, rows, columns, values })
  }

  if (matrices.length === 0) throw new Error('Modelica text table must contain at least one matrix')
  return matrices
}

/** Return declared matrix names after validating the complete Modelica #1 file. */
export function listModelicaTextTableNames(text: string): string[] {
  return parseModelicaTextTables(text).map(({ name }) => name)
}

/** Parse one named matrix from a Modelica #1 text table. */
export function parseModelicaTextTable(text: string, selectedName: string): ModelicaTextTable {
  const selected = parseModelicaTextTables(text).find(({ name }) => name === selectedName)
  if (!selected) throw new Error(`Modelica text table does not contain matrix '${selectedName}'`)
  return selected
}

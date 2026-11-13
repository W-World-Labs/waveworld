/**
 * Small, app-defined CSV format for temperature-dependent COMSOL material data.
 * This is not a general CSV parser and deliberately performs no interpolation.
 */
export type ComsolMaterialProperty = 'conductivity' | 'specificHeat'

export type ComsolMaterialTable = {
  property: ComsolMaterialProperty
  /** Rows are [temperature in K, property value in the header's SI unit]. */
  rows: [number, number][]
}

export const COMSOL_MATERIAL_TABLE_MAX_ROWS = 1_000
export const COMSOL_MATERIAL_TABLE_MAX_BYTES = 128 * 1024

const PROPERTY_HEADERS: Record<ComsolMaterialProperty, string> = {
  conductivity: 'conductivity_W_per_mK',
  specificHeat: 'specific_heat_J_per_kgK',
}
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

function fail(message: string): never { throw new Error(message) }

function checkSize(source: string): void {
  if (new TextEncoder().encode(source).byteLength > COMSOL_MATERIAL_TABLE_MAX_BYTES) {
    fail(`Material table exceeds the ${COMSOL_MATERIAL_TABLE_MAX_BYTES.toLocaleString()}-byte file limit.`)
  }
}

function number(token: string, line: number, field: string): number {
  const trimmed = token.trim()
  const value = Number(trimmed)
  if (!NUMBER.test(trimmed) || !Number.isFinite(value)) {
    fail(`Line ${line}: ${field} must be a finite number.`)
  }
  if (value <= 0) fail(`Line ${line}: ${field} must be positive.`)
  return value
}

/** Read only the two-column CSV format exported for WaveWorld material tables. */
export function readComsolMaterialTable(source: string): ComsolMaterialTable {
  checkSize(source)
  const lines = source.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/)
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop()
  const header = lines[0]?.split(',').map(value => value.trim()) ?? []
  if (header[0] !== 'temperature_K' || header.length !== 2) {
    fail('Line 1: expected exactly two columns: temperature_K and one supported SI property column.')
  }
  const property = (Object.entries(PROPERTY_HEADERS) as [ComsolMaterialProperty, string][])
    .find(([, value]) => value === header[1])?.[0]
  if (!property) {
    fail(`Line 1: property column must be conductivity_W_per_mK (thermal conductivity, W/(m·K)) or specific_heat_J_per_kgK (specific heat capacity, J/(kg·K)).`)
  }
  const dataLines = lines.slice(1)
  if (dataLines.length < 2) fail('Material table must contain at least two data rows.')
  if (dataLines.length > COMSOL_MATERIAL_TABLE_MAX_ROWS) {
    fail(`Material table exceeds the ${COMSOL_MATERIAL_TABLE_MAX_ROWS.toLocaleString()}-row limit.`)
  }
  let previousTemperature = 0
  const rows = dataLines.map((text, index): [number, number] => {
    const line = index + 2
    const cells = text.split(',')
    if (cells.length !== 2 || cells.some(cell => !cell.trim())) {
      fail(`Line ${line}: expected exactly temperature_K and ${header[1]} values separated by one comma.`)
    }
    const temperature = number(cells[0]!, line, 'Temperature (K)')
    const value = number(cells[1]!, line, property === 'conductivity'
      ? 'Thermal conductivity (W/(m·K))'
      : 'Specific heat capacity (J/(kg·K))')
    if (temperature <= previousTemperature) {
      fail(`Line ${line}: temperature_K must be strictly increasing.`)
    }
    previousTemperature = temperature
    return [temperature, value]
  })
  return { property, rows }
}

/** Serialize validated rows using the same explicit header and SI meaning. */
export function serializeComsolMaterialTable(table: ComsolMaterialTable): string {
  if (!table || !['conductivity', 'specificHeat'].includes(table.property)) {
    fail('Material table property must be conductivity or specificHeat.')
  }
  if (!Array.isArray(table.rows) || table.rows.length < 2 || table.rows.length > COMSOL_MATERIAL_TABLE_MAX_ROWS) {
    fail(`Material table must contain 2–${COMSOL_MATERIAL_TABLE_MAX_ROWS.toLocaleString()} rows.`)
  }
  let previousTemperature = 0
  const rows = table.rows.map((row, index) => {
    if (!Array.isArray(row) || row.length !== 2) fail(`Row ${index + 1}: expected temperature_K and one property value.`)
    const [temperature, value] = row
    if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature <= 0) {
      fail(`Row ${index + 1}: Temperature (K) must be finite and positive.`)
    }
    if (temperature <= previousTemperature) fail(`Row ${index + 1}: temperature_K must be strictly increasing.`)
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      fail(`Row ${index + 1}: ${table.property === 'conductivity' ? 'Thermal conductivity (W/(m·K))' : 'Specific heat capacity (J/(kg·K))'} must be finite and positive.`)
    }
    previousTemperature = temperature
    return `${temperature},${value}`
  })
  const csv = `temperature_K,${PROPERTY_HEADERS[table.property]}\n${rows.join('\n')}`
  checkSize(csv)
  return csv
}

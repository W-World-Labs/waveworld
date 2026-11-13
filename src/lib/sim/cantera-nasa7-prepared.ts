const MODULE = 'sw-cantera-nasa-poly'
const MAX_TEXT_BYTES = 64 * 1024

export type CanteraNasaPolyModel = 'nasa7' | 'nasa9'

export type CanteraNasaPolyPreparedRecord = {
  name: string
  model: CanteraNasaPolyModel
  ranges: number[]
  coefficients: number[][]
  sourceFile: string
  sourceSpecies: string
  initialTemperature?: number
}

export type CanteraNasaPolyEvaluation = {
  T: number
  region: number
  rangeName: string
  cpOverR: number
  hOverRT: number
  sOverR: number
  cp: number
  h: number
  s: number
  gOverRT: number
}

export type CanteraNasa7Evaluation = CanteraNasaPolyEvaluation

export type CanteraNasaPolyNativeInput = {
  module: typeof MODULE
  backend: 'host'
  model: CanteraNasaPolyModel
  T: [number]
  species: [{ name: string; 'temperature-ranges': number[]; data: number[][] }]
}

// Kept as type aliases because the NASA7 panel and earlier callers already
// use these exported names.
export type CanteraNasa7PreparedRecord = CanteraNasaPolyPreparedRecord
export type CanteraNasa7NativeInput = CanteraNasaPolyNativeInput

function fail(message: string): never {
  throw new Error(`Cantera NASA prepared input: ${message}`)
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  const allowed = new Set(keys)
  const unknown = Object.keys(value).find(key => !allowed.has(key))
  if (unknown) fail(`${label} contains unsupported field ${unknown}`)
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${label} must be finite`)
  return value
}

function ranges(value: unknown, model: CanteraNasaPolyModel): number[] {
  const maxBounds = model === 'nasa7' ? 3 : 65
  if (!Array.isArray(value) || value.length < 2 || value.length > maxBounds) {
    fail(model === 'nasa7' ? 'NASA7 temperature ranges must contain exactly two or three values' : 'NASA9 temperature ranges must contain 2..65 values')
  }
  const result = value.map((item, index) => finite(item, `temperature range ${index + 1}`))
  const maxTemperature = model === 'nasa7' ? 6000 : 20000
  if (result[0] < 50 || result[result.length - 1] > maxTemperature
    || result.some((value, index) => index > 0 && value <= result[index - 1])) {
    fail(`temperature ranges must increase monotonically within 50..${maxTemperature} K`)
  }
  return result
}

function coefficientRows(value: unknown, model: CanteraNasaPolyModel, rangeCount: number): number[][] {
  const width = model === 'nasa7' ? 7 : 9
  const rowCount = model === 'nasa7' ? Math.max(1, rangeCount - 1) : rangeCount - 1
  if (!Array.isArray(value) || value.length !== rowCount) fail(`${model.toUpperCase()} data must contain exactly ${rowCount} coefficient row${rowCount === 1 ? '' : 's'}`)
  const rows = value.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== width) fail(`coefficient row ${rowIndex + 1} must contain exactly ${width} values`)
    return row.map((item, index) => finite(item, `coefficient ${rowIndex + 1}.${index + 1}`))
  })
  return rows
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty string`)
  return value
}

/** Validate JSON emitted by parseNasa7Yaml or a single-species native case. */
export function parseCanteraNasaPolyPreparedText(text: string, fallbackSourceFile = 'unknown'): CanteraNasaPolyPreparedRecord {
  if (typeof text !== 'string') fail('text must be a string')
  if (new TextEncoder().encode(text).byteLength > MAX_TEXT_BYTES) fail('input exceeds 64 KiB')
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return fail('input must be valid JSON') }
  const root = object(parsed, 'input')
  let name: string
  let rangesValue: unknown
  let dataValue: unknown
  let model: CanteraNasaPolyModel
  let sourceFile = nonEmptyString(fallbackSourceFile, 'fallback source file')
  let sourceSpecies: string
  let initialTemperature: number | undefined

  if ('module' in root) {
    exactKeys(root, ['module', 'backend', 'model', 'T', 'species'], 'native case')
    if (root.module !== MODULE) fail('native module identifier does not match')
    if (root.backend !== undefined && root.backend !== 'host') fail('only the host backend is supported')
    if (root.model !== 'nasa7' && root.model !== 'nasa9') fail('only the exact nasa7 and nasa9 models are supported')
    model = root.model
    if (!Array.isArray(root.species) || root.species.length !== 1) fail('native case must contain exactly one species')
    if (!Array.isArray(root.T) || root.T.length !== 1) fail('native case must contain exactly one temperature')
    initialTemperature = finite(root.T[0], 'initial temperature')
    if (initialTemperature < 50 || initialTemperature > (model === 'nasa7' ? 6000 : 20000)) fail('initial temperature is outside the supported range')
    const species = object(root.species[0], 'species')
    exactKeys(species, ['name', 'temperature-ranges', 'data'], 'species')
    name = nonEmptyString(species.name, 'species name')
    rangesValue = species['temperature-ranges']
    dataValue = species.data
    sourceSpecies = name
  } else {
    exactKeys(root, ['name', 'model', 'temperature-ranges', 'data', 'source'], 'prepared record')
    if (root.model !== 'nasa7' && root.model !== 'nasa9') fail('only the exact nasa7 and nasa9 models are supported')
    model = root.model
    name = nonEmptyString(root.name, 'species name')
    rangesValue = root['temperature-ranges']
    dataValue = root.data
    const source = object(root.source, 'provenance')
    exactKeys(source, ['file', 'species'], 'provenance')
    sourceFile = nonEmptyString(source.file, 'source file')
    sourceSpecies = nonEmptyString(source.species, 'source species')
    if (sourceSpecies !== name) fail('provenance species does not match the record name')
  }

  return {
    name,
    model,
    ranges: ranges(rangesValue, model),
    coefficients: coefficientRows(dataValue, model, (rangesValue as unknown[]).length),
    sourceFile,
    sourceSpecies,
    ...(initialTemperature === undefined ? {} : { initialTemperature }),
  }
}

export function createCanteraNasaPolyNativeInput(record: CanteraNasaPolyPreparedRecord, T: number): CanteraNasaPolyNativeInput {
  const checked = parseCanteraNasaPolyPreparedText(JSON.stringify({
    name: record.name, model: record.model, 'temperature-ranges': record.ranges,
    data: record.coefficients, source: { file: record.sourceFile, species: record.sourceSpecies },
  }))
  const temperature = finite(T, 'temperature')
  if (temperature < checked.ranges[0] || temperature > checked.ranges[checked.ranges.length - 1]) fail('temperature must be inside the species range')
  return {
    module: MODULE,
    backend: 'host',
    model: checked.model,
    T: [temperature],
    species: [{ name: checked.name, 'temperature-ranges': checked.ranges, data: checked.coefficients }],
  }
}

export function validateCanteraNasaPolyNativeOutput(output: unknown, input: CanteraNasaPolyNativeInput): CanteraNasaPolyEvaluation[] {
  const root = object(output, 'native output')
  if (root.module !== MODULE) fail('native output module identifier does not match')
  if (root.method !== input.model) fail('native output method does not match input model')
  if (!Array.isArray(input.species) || input.species.length !== 1 || !Array.isArray(input.T)) fail('input must be a single-species case')
  const expected = input.species[0]
  if (!Array.isArray(root.species) || root.species.length !== 1) fail('native output must contain exactly one species')
  const species = object(root.species[0], 'output species')
  if (species.name !== expected.name || species.model !== input.model) fail('output species name or model does not match input')
  if (species.nRegions !== expected.data.length) fail('output region count does not match input')
  if (!Array.isArray(species.temperatureRanges) || species.temperatureRanges.length !== expected['temperature-ranges'].length
    || species.temperatureRanges.some((v, i) => v !== expected['temperature-ranges'][i])) fail('output temperature ranges do not match input')
  if (!Array.isArray(species.evaluations) || species.evaluations.length !== input.T.length) fail('evaluation count does not match input temperatures')
  if (root.nTemperatures !== input.T.length) fail('reported temperature count does not match input')
  return species.evaluations.map((value, index) => {
    const evaluation = object(value, `evaluation ${index + 1}`)
    const T = finite(evaluation.T, `evaluation ${index + 1} temperature`)
    if (T !== input.T[index]) fail(`evaluation ${index + 1} temperature does not match input`)
    for (const key of ['cpOverR', 'hOverRT', 'sOverR', 'cp', 'h', 's', 'gOverRT'] as const) finite(evaluation[key], `evaluation ${index + 1} ${key}`)
    const regionCount = expected.data.length
    if (!Number.isInteger(evaluation.region) || (evaluation.region as number) < 0 || (evaluation.region as number) >= regionCount) fail(`evaluation ${index + 1} region is invalid`)
    const expectedRangeName = regionCount === 1 ? 'all'
      : regionCount === 2 ? ((evaluation.region as number) === 0 ? 'low' : 'high')
        : `region-${evaluation.region as number}`
    if (evaluation.rangeName !== expectedRangeName) fail(`evaluation ${index + 1} range name is invalid`)
    return evaluation as unknown as CanteraNasaPolyEvaluation
  })
}

// Compatibility aliases for existing NASA7-only callers.
export const parseCanteraNasa7PreparedText = parseCanteraNasaPolyPreparedText
export const createCanteraNasa7NativeInput = createCanteraNasaPolyNativeInput
export const validateCanteraNasa7NativeOutput = validateCanteraNasaPolyNativeOutput

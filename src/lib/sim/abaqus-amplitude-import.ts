import { createModuleJobSpec, type ModuleComputeInput, type SwModuleInput } from './module-compute'

const MODULE_ID = 'sw-calculix-amplitude'
const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_LINES = 100_000
const MAX_CURVES = 4_096
const MAX_PAIRS = 1_048_576
const MAX_NAME_BYTES = 80

type TimeBasis = 'step' | 'total'
type AmplitudeCurveInput = {
  name: string
  time: TimeBasis
  definition: 'tabular'
  pairs: [number, number][]
}

export type AbaqusAmplitudeModuleInput = SwModuleInput & {
  module: typeof MODULE_ID
  curves: AmplitudeCurveInput[]
  queries: { curve: string; t: number }[]
}

export type AbaqusAmplitudeImport =
  | { ok: true; input: AbaqusAmplitudeModuleInput; curves: AmplitudeCurveInput[] }
  | { ok: false; diagnostics: string[] }

type SourceLine = { number: number; raw: string }
type SourceCard = {
  keyword: string
  line: number
  params: Map<string, string>
  data: SourceLine[]
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function parseHeader(raw: string, line: number): SourceCard {
  const body = raw.slice(1).trim()
  const parts = body.split(',')
  const keyword = (parts.shift() ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
  const params = new Map<string, string>()
  for (const rawPart of parts) {
    const part = rawPart.trim()
    if (!part) continue
    const equals = part.indexOf('=')
    if (equals <= 0) {
      params.set(part.toUpperCase(), '')
      continue
    }
    const key = part.slice(0, equals).trim().toUpperCase()
    let value = part.slice(equals + 1).trim()
    if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'"))) {
      value = value.slice(1, -1)
    }
    if (params.has(key)) throw new Error(`line ${line}: duplicate *${keyword} parameter ${key}`)
    params.set(key, value)
  }
  return { keyword, line, params, data: [] }
}

function readCards(text: string): SourceCard[] {
  if (typeof text !== 'string') throw new Error('input must be text')
  if (byteLength(text) > MAX_SOURCE_BYTES) throw new Error(`source exceeds ${MAX_SOURCE_BYTES} bytes`)
  const lines = text.split(/\r?\n/)
  if (lines.length > MAX_LINES) throw new Error(`source exceeds ${MAX_LINES} lines`)

  const cards: SourceCard[] = []
  let current: SourceCard | null = null
  let pending: SourceLine | null = null
  const flush = () => {
    if (pending && current) current.data.push(pending)
    pending = null
  }
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index]!.trim()
    if (!raw || raw.startsWith('**')) continue
    if (raw.startsWith('*')) {
      flush()
      current = parseHeader(raw, index + 1)
      cards.push(current)
      continue
    }
    if (!current) throw new Error(`line ${index + 1}: data before the first *AMPLITUDE card is unsupported`)
    if (pending === null) pending = { number: index + 1, raw }
    else pending.raw += raw
    if (!pending.raw.endsWith(',')) flush()
  }
  flush()
  return cards
}

function validateEmptyFields(text: string): void {
  let amplitudeData = false
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim()
    if (!line || line.startsWith('**')) continue
    if (line.startsWith('*')) {
      amplitudeData = /^\*\s*AMPLITUDE\s*(?:,|$)/i.test(line)
      continue
    }
    if (!amplitudeData) continue
    const fields = line.split(',').map(field => field.trim())
    const trailingContinuation = fields.at(-1) === ''
    const used = trailingContinuation ? fields.slice(0, -1) : fields
    if (used.some(field => field === '')) throw new Error(`line ${index + 1}: blank amplitude data fields are unsupported`)
  }
}

function parseFiniteNumber(raw: string, line: number): number {
  const decimal = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[Ee][+-]?\d+)?$/
  if (!decimal.test(raw)) throw new Error(`line ${line}: amplitude field "${raw}" is not a supported decimal number`)
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`line ${line}: amplitude values must be finite`)
  return value
}

function parseAmplitudeCard(card: SourceCard): AmplitudeCurveInput {
  const allowed = new Set(['NAME', 'TIME', 'DEFINITION'])
  for (const key of card.params.keys()) {
    if (!allowed.has(key)) throw new Error(`line ${card.line}: *AMPLITUDE option ${key} is unsupported`)
  }
  const rawName = card.params.get('NAME')
  if (!rawName?.trim()) throw new Error(`line ${card.line}: *AMPLITUDE requires a non-empty NAME`)
  const name = rawName.trim()
  if (byteLength(name) > MAX_NAME_BYTES) throw new Error(`line ${card.line}: amplitude NAME exceeds ${MAX_NAME_BYTES} bytes`)
  const definition = card.params.get('DEFINITION')?.trim().toUpperCase()
  if (definition !== undefined && definition !== 'TABULAR') {
    throw new Error(`line ${card.line}: only *AMPLITUDE DEFINITION=TABULAR is supported`)
  }
  const timeValue = card.params.get('TIME')?.trim().toUpperCase()
  let time: TimeBasis
  if (timeValue === undefined || timeValue === 'STEP TIME') time = 'step'
  else if (timeValue === 'TOTAL TIME') time = 'total'
  else throw new Error(`line ${card.line}: only TIME=STEP TIME or TIME=TOTAL TIME is supported`)

  const pairs: [number, number][] = []
  for (const row of card.data) {
    const fields = row.raw.split(',').map(field => field.trim())
    if (fields.some(field => field === '') || fields.length % 2 !== 0) {
      throw new Error(`line ${row.number}: tabular amplitude rows require complete time/value pairs`)
    }
    for (let offset = 0; offset < fields.length; offset += 2) {
      const t = parseFiniteNumber(fields[offset]!, row.number)
      const value = parseFiniteNumber(fields[offset + 1]!, row.number)
      if (t < 0) throw new Error(`line ${row.number}: amplitude reference times must be non-negative`)
      if (pairs.length > 0 && t <= pairs[pairs.length - 1]![0]) {
        throw new Error(`line ${row.number}: amplitude reference times must be strictly increasing`)
      }
      pairs.push([t, value])
      if (pairs.length > MAX_PAIRS) throw new Error(`amplitude exceeds ${MAX_PAIRS} tabular pairs`)
    }
  }
  if (pairs.length < 2) throw new Error(`line ${card.line}: a tabular amplitude requires at least two time/value pairs`)
  return { name, time, definition: 'tabular', pairs }
}

/**
 * Read literal named TABULAR amplitude cards into the existing native
 * sw-calculix-amplitude operation. Queries are placed at the source knots so
 * the native operation reports the imported table without applying it to any
 * *BOUNDARY or load record.
 */
export function importAbaqusAmplitudeSource(text: string): AbaqusAmplitudeImport {
  try {
    validateEmptyFields(text)
    const cards = readCards(text)
    const unrelated = cards.find(card => card.keyword !== 'AMPLITUDE')
    if (unrelated) {
      throw new Error(`line ${unrelated.line}: *${unrelated.keyword} is outside this standalone *AMPLITUDE source reader`)
    }
    const definitions = cards
    if (definitions.length === 0) throw new Error('source contains no *AMPLITUDE card')
    if (definitions.length > MAX_CURVES) throw new Error(`source exceeds ${MAX_CURVES} amplitude curves`)

    const curves = definitions.map(parseAmplitudeCard)
    const names = new Set<string>()
    for (const curve of curves) {
      const key = curve.name.toLocaleUpperCase('en-US')
      if (names.has(key)) throw new Error(`duplicate amplitude NAME "${curve.name}"`)
      names.add(key)
    }
    const input: AbaqusAmplitudeModuleInput = {
      module: MODULE_ID,
      backend: 'host',
      curves,
      queries: curves.flatMap(curve => curve.pairs.map(([t]) => ({ curve: curve.name, t }))),
    }
    // Reuse the shared module JobSpec builder so this source path retains the
    // same 1 MiB inline model cap and backend envelope rules as every module.
    createModuleJobSpec(input as ModuleComputeInput)
    return { ok: true, input, curves }
  } catch (cause) {
    return { ok: false, diagnostics: [cause instanceof Error ? cause.message : String(cause)] }
  }
}

export type AbaqusAmplitudeResultCheck = { ok: true } | { ok: false; diagnostic: string }

/** Validate the saved native result against the exact imported table and query order. */
export function validateAbaqusAmplitudeResult(result: unknown, input: AbaqusAmplitudeModuleInput): AbaqusAmplitudeResultCheck {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return { ok: false, diagnostic: 'native result must be an object' }
  const value = result as Record<string, unknown>
  if (value.module !== MODULE_ID) return { ok: false, diagnostic: 'native result module does not match the imported amplitude operation' }
  if (!value.backend || typeof value.backend !== 'object' || Array.isArray(value.backend)) return { ok: false, diagnostic: 'native result is missing backend provenance' }
  const backendId = (value.backend as Record<string, unknown>).id
  if (backendId !== 'host-f64-sw-calculix-amplitude') return { ok: false, diagnostic: 'native result backend does not match the pinned host amplitude evaluator' }
  if (!Array.isArray(value.curves) || value.curves.length !== input.curves.length) return { ok: false, diagnostic: 'native result curve count does not match the imported source' }
  for (let index = 0; index < input.curves.length; index += 1) {
    const expected = input.curves[index]!
    const actual = value.curves[index]
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return { ok: false, diagnostic: `native result curve ${index} must be an object` }
    const summary = actual as Record<string, unknown>
    if (summary.name !== expected.name || summary.time !== expected.time || summary.nPairs !== expected.pairs.length || summary.definition !== 'tabular') {
      return { ok: false, diagnostic: `native result curve ${index} does not match the imported amplitude definition` }
    }
    if (summary.tMin !== expected.pairs[0]![0] || summary.tMax !== expected.pairs[expected.pairs.length - 1]![0]) {
      return { ok: false, diagnostic: `native result curve ${index} time span does not match the imported source` }
    }
  }
  if (!Array.isArray(value.eval) || value.eval.length !== input.queries.length) return { ok: false, diagnostic: 'native result query count does not match the imported source' }
  let queryIndex = 0
  for (const curve of input.curves) {
    for (const [t, expectedAmplitude] of curve.pairs) {
      const raw = value.eval[queryIndex]
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, diagnostic: `native result query ${queryIndex} must be an object` }
      const item = raw as Record<string, unknown>
      const amplitude = item.amplitude
      const tolerance = Number.EPSILON * Math.max(1, Math.abs(expectedAmplitude)) * 8
      if (item.curve !== curve.name || item.t !== t || typeof amplitude !== 'number' || !Number.isFinite(amplitude) || Math.abs(amplitude - expectedAmplitude) > tolerance) {
        return { ok: false, diagnostic: `native result query ${queryIndex} does not match its imported tabular knot` }
      }
      queryIndex += 1
    }
  }
  return { ok: true }
}

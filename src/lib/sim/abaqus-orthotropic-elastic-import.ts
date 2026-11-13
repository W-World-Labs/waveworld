/** Strict standalone reader for one literal Abaqus/CalculiX orthotropic *ELASTIC card. */

const MODULE_ID = 'sw-calculix-orthotropic-elastic'
const METHOD_ID = 'method-algo-calculix-elastic-card'
const MAX_SOURCE_BYTES = 2 * 1024 * 1024
const MAX_LINES = 100_000

export type AbaqusOrthotropicElasticInput = {
  module: typeof MODULE_ID
  method: typeof METHOD_ID
  type: 'engineering'
  lines: [{
    temperature?: number
    E1: number
    E2: number
    E3: number
    nu12: number
    nu23: number
    nu13: number
    G12: number
    G13: number
    G23: number
  }]
}

export type AbaqusOrthotropicElasticImport =
  | {
      ok: true
      input: AbaqusOrthotropicElasticInput
      source: { bytes: number; lines: number; cardLine: number; keyword: '*ELASTIC' }
    }
  | { ok: false; diagnostics: string[] }

const DECIMAL = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[EeDd][+-]?\d+)?$/

function parseFiniteNumber(raw: string, line: number, index: number): number {
  if (!DECIMAL.test(raw)) throw new Error(`line ${line}: engineering constant ${index + 1} is not a supported decimal literal`)
  const value = Number(raw.replace(/[Dd]/, 'e'))
  if (!Number.isFinite(value)) throw new Error(`line ${line}: engineering constant ${index + 1} must be finite`)
  return value
}

/** Read exactly one TYPE=ENGINEERING CONSTANTS card; no model/solver input is accepted. */
export function importAbaqusOrthotropicElasticSource(text: string): AbaqusOrthotropicElasticImport {
  try {
    if (typeof text !== 'string') throw new Error('input must be text')
    const bytes = new TextEncoder().encode(text).length
    if (bytes > MAX_SOURCE_BYTES) throw new Error(`source exceeds ${MAX_SOURCE_BYTES} bytes`)
    const lines = text.split(/\r?\n/)
    if (lines.length > MAX_LINES) throw new Error(`source exceeds ${MAX_LINES} lines`)

    let cardLine = 0
    let headerSeen = false
    let data = ''
    let dataLine = 0
    for (let index = 0; index < lines.length; index += 1) {
      const raw = lines[index]!.trim()
      if (!raw || raw.startsWith('**')) continue
      if (raw.startsWith('*')) {
        const header = raw.slice(1).split(',').map(part => part.trim())
        const keyword = (header.shift() ?? '').replace(/\s+/g, ' ').toUpperCase()
        if (keyword !== 'ELASTIC') throw new Error(`line ${index + 1}: *${keyword} is outside this standalone *ELASTIC source reader`)
        if (headerSeen) throw new Error(`line ${index + 1}: only one standalone *ELASTIC card is supported`)
        const params = new Map<string, string>()
        for (const part of header) {
          const equals = part.indexOf('=')
          if (equals <= 0) throw new Error(`line ${index + 1}: unsupported *ELASTIC option "${part}"`)
          const key = part.slice(0, equals).trim().toUpperCase()
          const value = part.slice(equals + 1).trim().replace(/^(['"])(.*)\1$/, '$2').toUpperCase()
          if (params.has(key)) throw new Error(`line ${index + 1}: duplicate *ELASTIC parameter ${key}`)
          params.set(key, value)
        }
        for (const key of params.keys()) if (key !== 'TYPE') throw new Error(`line ${index + 1}: *ELASTIC option ${key} is unsupported`)
        if (params.get('TYPE') !== 'ENGINEERING CONSTANTS') {
          throw new Error(`line ${index + 1}: *ELASTIC requires TYPE=ENGINEERING CONSTANTS`)
        }
        headerSeen = true
        cardLine = index + 1
        continue
      }
      if (!headerSeen) throw new Error(`line ${index + 1}: data before the first *ELASTIC card is unsupported`)
      if (!dataLine) dataLine = index + 1
      data += raw
      if (!raw.endsWith(',')) data += '\n'
    }
    if (!headerSeen) throw new Error('source contains no *ELASTIC card')
    const fields = data.trimEnd().split(/[\n,]/).map(field => field.trim())
    // Empty fields, including a dangling continuation, must fail closed.
    if (fields.some(field => field === '')) {
      throw new Error(`line ${dataLine || cardLine}: blank engineering constant fields are unsupported`)
    }
    if (fields.length !== 9 && fields.length !== 10) throw new Error(`line ${dataLine || cardLine}: TYPE=ENGINEERING CONSTANTS requires nine constants and an optional trailing temperature`)
    const parsed = fields.map((field, index) => parseFiniteNumber(field, dataLine || cardLine, index))
    const values = parsed.slice(0, 9)
    const input: AbaqusOrthotropicElasticInput = {
      module: MODULE_ID,
      method: METHOD_ID,
      type: 'engineering',
      lines: [{
        ...(parsed[9] === undefined ? {} : { temperature: parsed[9] }),
        E1: values[0]!, E2: values[1]!, E3: values[2]!,
        nu12: values[3]!, nu23: values[5]!, nu13: values[4]!,
        G12: values[6]!, G13: values[7]!, G23: values[8]!,
      }],
    }
    return { ok: true, input, source: { bytes, lines: lines.length, cardLine, keyword: '*ELASTIC' } }
  } catch (cause) {
    return { ok: false, diagnostics: [cause instanceof Error ? cause.message : String(cause)] }
  }
}

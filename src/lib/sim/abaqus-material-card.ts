/**
 * A deliberately small reader for a standalone Abaqus isotropic material card.
 * It accepts only one named *MATERIAL, one isotropic *ELASTIC row, and a
 * nondecreasing isotropic *PLASTIC table beginning at zero plastic strain.
 * This is not an input-deck parser.
 */
export type AbaqusMaterialCard = {
  name: string
  E: number
  nu: number
  /** Rows are [yield stress, equivalent plastic strain], as required by Abaqus. */
  hardeningCurve: [number, number][]
}

const MAX_SOURCE_CHARS = 256_000
const MAX_PLASTIC_POINTS = 10_000
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/

type CardBlock = { keyword: string; options: Map<string, string>; rows: { line: number; text: string }[]; line: number }

function number(text: string, line: number, field: string): number {
  const token = text.trim()
  const value = Number(token.replace(/[dD]/g, 'e'))
  if (!NUMBER.test(token) || !Number.isFinite(value)) {
    throw new Error(`Line ${line}: expected a finite number for ${field}.`)
  }
  return value
}

function parseHeader(text: string, line: number): { keyword: string; options: Map<string, string> } {
  const [rawKeyword, ...rawOptions] = text.slice(1).split(',')
  const keyword = (rawKeyword ?? '').trim().toUpperCase()
  if (!keyword) throw new Error(`Line ${line}: empty keyword.`)
  const options = new Map<string, string>()
  for (const raw of rawOptions) {
    const separator = raw.indexOf('=')
    if (separator < 0) throw new Error(`Line ${line}: unsupported option '${raw.trim()}' on *${keyword}.`)
    const key = raw.slice(0, separator).trim().toUpperCase()
    const value = raw.slice(separator + 1).trim()
    if (!key || !value || options.has(key)) throw new Error(`Line ${line}: invalid or repeated option on *${keyword}.`)
    options.set(key, value)
  }
  return { keyword, options }
}

/** Parse the supported standalone material-card subset; all other keywords fail closed. */
export function parseAbaqusMaterialCard(source: string): AbaqusMaterialCard {
  if (source.length > MAX_SOURCE_CHARS) throw new Error(`Material card exceeds the ${MAX_SOURCE_CHARS}-character limit.`)
  const blocks: CardBlock[] = []
  const lines = source.split(/\r\n?|\n/)
  let current: CardBlock | null = null
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index]!.trim()
    const line = index + 1
    if (!text || text.startsWith('**')) continue
    if (text.startsWith('*')) {
      const parsed = parseHeader(text, line)
      current = { ...parsed, rows: [], line }
      blocks.push(current)
    } else {
      if (!current) throw new Error(`Line ${line}: data appears before a supported keyword.`)
      current.rows.push({ line, text })
    }
  }

  const keywords = blocks.map(block => block.keyword)
  if (keywords.some(keyword => !['MATERIAL', 'ELASTIC', 'PLASTIC'].includes(keyword))) {
    const unsupported = blocks.find(block => !['MATERIAL', 'ELASTIC', 'PLASTIC'].includes(block.keyword))!
    throw new Error(`Line ${unsupported.line}: unsupported keyword *${unsupported.keyword}; provide only a standalone material card.`)
  }
  const material = blocks.filter(block => block.keyword === 'MATERIAL')
  const elastic = blocks.filter(block => block.keyword === 'ELASTIC')
  const plastic = blocks.filter(block => block.keyword === 'PLASTIC')
  if (material.length !== 1 || elastic.length !== 1 || plastic.length !== 1) {
    throw new Error('Provide exactly one *MATERIAL, one *ELASTIC, and one *PLASTIC card.')
  }
  const [materialBlock] = material
  const [elasticBlock] = elastic
  const [plasticBlock] = plastic
  if (materialBlock!.options.size !== 1 || !materialBlock!.options.has('NAME')) {
    throw new Error(`Line ${materialBlock!.line}: *MATERIAL requires only one NAME option.`)
  }
  const name = materialBlock!.options.get('NAME')!.trim()
  if (!name || /[,\r\n]/.test(name) || /^\d/.test(name)) {
    throw new Error(`Line ${materialBlock!.line}: *MATERIAL NAME must be nonempty and cannot start with a number.`)
  }
  if (materialBlock!.rows.length) throw new Error(`Line ${materialBlock!.line}: *MATERIAL does not accept data rows.`)
  if (elasticBlock!.options.size && !(elasticBlock!.options.size === 1 && elasticBlock!.options.get('TYPE')?.toUpperCase() === 'ISOTROPIC')) {
    throw new Error(`Line ${elasticBlock!.line}: only TYPE=ISOTROPIC is supported on *ELASTIC.`)
  }
  if (plasticBlock!.options.size) throw new Error(`Line ${plasticBlock!.line}: options on *PLASTIC are outside this material-card subset.`)
  if (elasticBlock!.rows.length !== 1) throw new Error(`Line ${elasticBlock!.line}: *ELASTIC requires exactly one E, nu row.`)
  const elasticValues = elasticBlock!.rows[0]!.text.split(',').map(value => value.trim())
  if (elasticValues.length !== 2 || elasticValues.some(value => !value)) {
    throw new Error(`Line ${elasticBlock!.rows[0]!.line}: *ELASTIC row must contain exactly E, nu.`)
  }
  const E = number(elasticValues[0]!, elasticBlock!.rows[0]!.line, 'Young\'s modulus')
  const nu = number(elasticValues[1]!, elasticBlock!.rows[0]!.line, 'Poisson ratio')
  if (!(E > 0)) throw new Error(`Line ${elasticBlock!.rows[0]!.line}: E must be positive.`)
  if (!(nu > -1 && nu < 0.5)) throw new Error(`Line ${elasticBlock!.rows[0]!.line}: nu must satisfy -1 < nu < 0.5.`)
  if (!plasticBlock!.rows.length || plasticBlock!.rows.length > MAX_PLASTIC_POINTS) {
    throw new Error(`Line ${plasticBlock!.line}: *PLASTIC requires 1–${MAX_PLASTIC_POINTS} rows.`)
  }
  const hardeningCurve: [number, number][] = plasticBlock!.rows.map(({ line: rowLine, text }): [number, number] => {
    const values = text.split(',').map(value => value.trim())
    if (values.length !== 2 || values.some(value => !value)) {
      throw new Error(`Line ${rowLine}: *PLASTIC row must contain exactly yield stress, plastic strain.`)
    }
    const yieldStress = number(values[0]!, rowLine, 'yield stress')
    const plasticStrain = number(values[1]!, rowLine, 'equivalent plastic strain')
    if (!(yieldStress > 0)) throw new Error(`Line ${rowLine}: yield stress must be positive.`)
    if (plasticStrain < 0) throw new Error(`Line ${rowLine}: equivalent plastic strain must be nonnegative.`)
    return [yieldStress, plasticStrain]
  })
  if (hardeningCurve[0]![1] !== 0) throw new Error(`Line ${plasticBlock!.rows[0]!.line}: first *PLASTIC row must start at zero plastic strain.`)
  for (let index = 1; index < hardeningCurve.length; index++) {
    if (hardeningCurve[index]![0] < hardeningCurve[index - 1]![0]) {
      throw new Error(`Line ${plasticBlock!.rows[index]!.line}: yield stress must be nondecreasing.`)
    }
    if (hardeningCurve[index]![1] <= hardeningCurve[index - 1]![1]) {
      throw new Error(`Line ${plasticBlock!.rows[index]!.line}: plastic strain must be strictly increasing.`)
    }
  }
  return { name, E, nu, hardeningCurve }
}

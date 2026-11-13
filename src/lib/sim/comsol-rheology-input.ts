import type { SwModuleInput } from './module-compute'

export type ComsolRheologyModel = 'newtonian' | 'power-law' | 'carreau' | 'bingham' | 'herschel-bulkley'

/** App form state. Parameters for inactive models are retained by the form but omitted from native input. */
export type ComsolRheologyDraft = {
  model: ComsolRheologyModel
  viscosity: number
  K: number
  n: number
  mu0: number
  muInf: number
  lambda: number
  muP: number
  tauY: number
  regularizationM: number
  shearRates: number[]
  csv: string
}

export type ComsolRheologyInput = SwModuleInput & {
  module: 'sw-comsol-nonnewtonian-b'
  backend: 'host'
  method: 'method-algo-rheology-viscosity'
  model: ComsolRheologyModel
  shearRates: number[]
  viscosity?: number
  K?: number
  n?: number
  mu0?: number
  muInf?: number
  lambda?: number
  muP?: number
  tauY?: number
  regularizationM?: number
}

export type ComsolRheologySample = {
  shearRate: number
  effectiveViscosity: number | null
  shearStress: number | null
  singular: boolean
}

export const COMSOL_RHEOLOGY_CSV_HEADER = 'shearRate'
export const COMSOL_RHEOLOGY_MAX_CSV_BYTES = 1024 * 1024
export const COMSOL_RHEOLOGY_MAX_SHEAR_RATES = 256

const DRAFT_KEYS = [
  'model', 'viscosity', 'K', 'n', 'mu0', 'muInf', 'lambda', 'muP', 'tauY', 'regularizationM', 'shearRates', 'csv',
] as const

function fail(message: string): never { throw new Error(message) }

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${name} has unsupported field ${key}`)
  for (const key of allowed) if (!(key in value)) fail(`${name}.${key} is required`)
}

function finite(value: unknown, name: string, min: number, max = Number.MAX_VALUE): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${name} must be finite and in [${min}, ${max}]`)
  }
  return value
}

function validateDraft(value: unknown): ComsolRheologyDraft {
  const draft = record(value, 'COMSOL rheology draft')
  exactKeys(draft, DRAFT_KEYS, 'COMSOL rheology draft')
  if (!['newtonian', 'power-law', 'carreau', 'bingham', 'herschel-bulkley'].includes(String(draft.model))) {
    fail('model must be newtonian, power-law, carreau, bingham, or herschel-bulkley')
  }
  if (!Array.isArray(draft.shearRates) || draft.shearRates.length < 1 || draft.shearRates.length > COMSOL_RHEOLOGY_MAX_SHEAR_RATES) {
    fail(`shearRates must contain 1..=${COMSOL_RHEOLOGY_MAX_SHEAR_RATES} entries`)
  }
  const shearRates = draft.shearRates.map((rate, index) => finite(rate, `shearRates[${index}] (1/s)`, 0))
  const model = draft.model as ComsolRheologyModel
  const common = {
    model,
    viscosity: draft.viscosity,
    K: draft.K,
    n: draft.n,
    mu0: draft.mu0,
    muInf: draft.muInf,
    lambda: draft.lambda,
    muP: draft.muP,
    tauY: draft.tauY,
    regularizationM: draft.regularizationM,
    shearRates,
    csv: draft.csv,
  }
  if (typeof draft.csv !== 'string') fail('csv must be a string')

  switch (model) {
    case 'newtonian':
      finite(draft.viscosity, 'viscosity (Pa·s)', Number.MIN_VALUE)
      break
    case 'power-law':
      finite(draft.K, 'K (Pa·sⁿ)', Number.MIN_VALUE)
      finite(draft.n, 'n', Number.MIN_VALUE)
      break
    case 'carreau': {
      const mu0 = finite(draft.mu0, 'mu0 (Pa·s)', Number.MIN_VALUE)
      const muInf = finite(draft.muInf, 'muInf (Pa·s)', 0)
      if (mu0 <= muInf) fail('mu0 must be greater than muInf')
      finite(draft.lambda, 'lambda (s)', Number.MIN_VALUE)
      finite(draft.n, 'n', Number.MIN_VALUE, 1)
      break
    }
    case 'bingham':
      finite(draft.muP, 'muP (Pa·s)', Number.MIN_VALUE)
      finite(draft.tauY, 'tauY (Pa)', Number.MIN_VALUE)
      finite(draft.regularizationM, 'regularizationM (s)', Number.MIN_VALUE)
      break
    case 'herschel-bulkley':
      finite(draft.K, 'K (Pa·sⁿ)', Number.MIN_VALUE)
      finite(draft.n, 'n', Number.MIN_VALUE)
      finite(draft.tauY, 'tauY (Pa)', Number.MIN_VALUE)
      finite(draft.regularizationM, 'regularizationM (s)', Number.MIN_VALUE)
      break
  }
  return common as ComsolRheologyDraft
}

export function createDefaultComsolRheologyDraft(): ComsolRheologyDraft {
  return {
    model: 'power-law', viscosity: 1, K: 1, n: 0.5, mu0: 0.1, muInf: 0.001, lambda: 1,
    muP: 0.01, tauY: 1, regularizationM: 1000, shearRates: [0, 0.1, 1, 10, 100], csv: '',
  }
}

/** Build the app-bounded native operation input; inactive model controls stay out of the wire payload. */
export function createComsolRheologyInput(draftValue: ComsolRheologyDraft): ComsolRheologyInput {
  const draft = validateDraft(draftValue)
  const base = {
    module: 'sw-comsol-nonnewtonian-b' as const,
    backend: 'host' as const,
    method: 'method-algo-rheology-viscosity' as const,
    model: draft.model,
    shearRates: [...draft.shearRates],
  }
  switch (draft.model) {
    case 'newtonian': return { ...base, viscosity: draft.viscosity }
    case 'power-law': return { ...base, K: draft.K, n: draft.n }
    case 'carreau': return { ...base, mu0: draft.mu0, muInf: draft.muInf, lambda: draft.lambda, n: draft.n }
    case 'bingham': return { ...base, muP: draft.muP, tauY: draft.tauY, regularizationM: draft.regularizationM }
    case 'herschel-bulkley': return { ...base, K: draft.K, n: draft.n, tauY: draft.tauY, regularizationM: draft.regularizationM }
  }
}

const NUMBER_CELL = /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/

/** Parse one numeric shear-rate column, optionally preceded by the exact `shearRate` header. */
export function parseComsolRheologyCsv(raw: string): number[] {
  if (typeof raw !== 'string') fail('Shear-rate CSV must be text')
  if (new TextEncoder().encode(raw).byteLength > COMSOL_RHEOLOGY_MAX_CSV_BYTES) {
    fail(`Shear-rate CSV exceeds the ${COMSOL_RHEOLOGY_MAX_CSV_BYTES}-byte limit`)
  }
  const source = raw.replace(/^\uFEFF/, '')
  const rows = source.split(/\r\n|\n|\r/)
  // A single empty split cell is the normal result of a final line ending.
  if (/(?:\r\n|\n|\r)$/.test(source)) rows.pop()
  if (rows.length === 0 || rows.every(row => row.trim() === '')) fail('Shear-rate CSV must contain 1..=256 values')

  let firstValueRow = 0
  if (rows[0].trim() === COMSOL_RHEOLOGY_CSV_HEADER) firstValueRow = 1
  const values: number[] = []
  for (let rowIndex = firstValueRow; rowIndex < rows.length; rowIndex += 1) {
    const cell = rows[rowIndex].trim()
    if (!cell) fail(`Shear-rate CSV row ${rowIndex + 1} is blank`)
    if (/[,;\t]/.test(cell)) fail(`Shear-rate CSV row ${rowIndex + 1} must contain exactly one ${COMSOL_RHEOLOGY_CSV_HEADER} column`)
    if (!NUMBER_CELL.test(cell)) fail(`Shear-rate CSV row ${rowIndex + 1} must be a numeric shear rate`)
    const value = Number(cell)
    if (!Number.isFinite(value) || value < 0) fail(`Shear-rate CSV row ${rowIndex + 1} must be finite and >= 0`)
    values.push(value)
    if (values.length > COMSOL_RHEOLOGY_MAX_SHEAR_RATES) {
      fail(`Shear-rate CSV must contain 1..=${COMSOL_RHEOLOGY_MAX_SHEAR_RATES} values`)
    }
  }
  if (values.length === 0) fail('Shear-rate CSV must contain 1..=256 values')
  return values
}

/** Read the viscosity samples from the native result envelope while tolerating future extra fields. */
export function readComsolRheologySamples(resultValue: unknown): ComsolRheologySample[] {
  const envelope = record(resultValue, 'COMSOL rheology result')
  const result = record(envelope.result, 'COMSOL rheology result.result')
  if (result.methodId !== 'method-algo-rheology-viscosity') fail('COMSOL rheology result has an unexpected methodId')
  if (!Array.isArray(result.samples) || result.samples.length < 1 || result.samples.length > COMSOL_RHEOLOGY_MAX_SHEAR_RATES) {
    fail(`COMSOL rheology result samples must contain 1..=${COMSOL_RHEOLOGY_MAX_SHEAR_RATES} entries`)
  }
  if (result.nSamples !== result.samples.length) fail('COMSOL rheology result nSamples does not match samples')
  return result.samples.map((value, index) => {
    const sample = record(value, `samples[${index}]`)
    const shearRate = finite(sample.shearRate, `samples[${index}].shearRate`, 0)
    if (typeof sample.singular !== 'boolean') fail(`samples[${index}].singular must be a boolean`)
    if (sample.singular) {
      if (sample.effectiveViscosity !== null || sample.shearStress !== null) fail(`samples[${index}] singular values must be null`)
      return { shearRate, effectiveViscosity: null, shearStress: null, singular: true }
    }
    return {
      shearRate,
      effectiveViscosity: finite(sample.effectiveViscosity, `samples[${index}].effectiveViscosity`, 0),
      shearStress: finite(sample.shearStress, `samples[${index}].shearStress`, 0),
      singular: false,
    }
  })
}

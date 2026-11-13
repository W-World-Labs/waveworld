import { OPTICSTUDIO_WAVEFRONT_NATIVE_PIN_SHA } from './opticstudio-wavefront-input'

const MAX_TERMS = 10
const MAX_SAMPLES = 4096
const MAX_SAMPLE_MAGNITUDE = 1e12

const INDEXING = 'OSA/ANSI j=0 based; negative m sine, m=0, positive m cosine'
const NORMALIZATION = 'unit-disk orthonormal'
const METHOD_ID = 'method-algo-zernike-weighted-fit-osa-j0'

const REPORT_LIMITATIONS = [
  'This is a sampled WaveWorld host-f64 fit; it does not claim OpticStudio execution or vendor parity.',
  'It does not read or write native OpticStudio lens files, trace rays, sample a pupil, apply chief-ray referencing, transform subapertures, or fit annular pupils.',
  'Coefficients use zero-based OSA/ANSI ordering (negative m sine, m=0, positive m cosine), not OpticStudio Noll numbering.',
] as const

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = Record<string, unknown>

export type OpticStudioWavefrontValidation =
  | {
      valid: true
      terms: number
      coefficients: number[]
      weightedRmsResidual: number
    }
  | {
      valid: false
      errors: string[]
    }

export type OpticStudioWavefrontReport = {
  format: 'waveworld-opticstudio-wavefront-result-v1'
  sourceWorkflow: 'opticstudio-zernike-weighted-fit'
  targetSoftware: 'OpticStudio'
  nativePinSha: typeof OPTICSTUDIO_WAVEFRONT_NATIVE_PIN_SHA
  jobId?: string
  submittedInput: JsonValue
  result: JsonValue
  limitations: readonly string[]
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function finiteNumberArray(values: unknown[]): values is number[] {
  for (let index = 0; index < values.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(values, index) || !finiteNumber(values[index])) return false
  }
  return true
}

function jsonValue(value: unknown, path: string, seen = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only finite JSON numbers`)
    return value
  }
  if (typeof value !== 'object') throw new TypeError(`${path} must contain only JSON values`)
  if (seen.has(value)) throw new TypeError(`${path} must not contain circular references`)
  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain only plain JSON objects`)
  }
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length || Reflect.ownKeys(value).some((key) => typeof key === 'symbol')) {
        throw new TypeError(`${path} must be a dense JSON array without extra properties`)
      }
      const result: JsonValue[] = []
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor?.enumerable || !('value' in descriptor)) {
          throw new TypeError(`${path}[${index}] must be an enumerable data property`)
        }
        result.push(jsonValue(descriptor.value, `${path}[${index}]`, seen))
      }
      return result
    }
    const result: Record<string, JsonValue> = {}
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new TypeError(`${path} must not contain symbol keys`)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new TypeError(`${path}.${key} must be an enumerable data property`)
      }
      result[key] = jsonValue(descriptor.value, `${path}.${key}`, seen)
    }
    return result
  } finally {
    seen.delete(value)
  }
}

/** Checks that a weighted-fit result belongs to the submitted OSA/ANSI request shape. */
export function validateOpticStudioWavefrontResult(input: unknown, output: unknown): OpticStudioWavefrontValidation {
  const errors: string[] = []
  if (!isObject(input)) return { valid: false, errors: ['Submitted input must be an object.'] }
  if (!isObject(output)) return { valid: false, errors: ['Result must be an object.'] }

  if (input.module !== 'zernike') errors.push('Submitted input module must be zernike.')
  if (input.operation !== 'weighted-fit') errors.push('Submitted input operation must be weighted-fit.')
  if (input.backend !== 'host') errors.push('Submitted input backend must be host.')

  const terms = input.terms
  if (!Number.isInteger(terms) || (terms as number) < 1 || (terms as number) > MAX_TERMS) {
    errors.push(`Submitted input terms must be an integer from 1 through ${MAX_TERMS}.`)
  }

  const samples = input.samples
  if (!Array.isArray(samples)) {
    errors.push('Submitted input samples must be an array.')
  } else {
    if (Number.isInteger(terms) && (samples.length < (terms as number) || samples.length > MAX_SAMPLES)) {
      errors.push(`Submitted input samples must contain from terms through ${MAX_SAMPLES} rows.`)
    }
    for (let index = 0; index < samples.length; index += 1) {
      const row = samples[index]
      if (!Array.isArray(row) || row.length !== 4 || !finiteNumberArray(row)) {
        errors.push(`Submitted input sample ${index + 1} must be [rho, theta, value, weight] with finite numbers.`)
        continue
      }
      const [rho, theta, value, weight] = row
      if (rho < 0 || rho > 1) errors.push(`Submitted input sample ${index + 1} rho must be in [0, 1].`)
      if (theta < -Math.PI * 2 || theta > Math.PI * 2) errors.push(`Submitted input sample ${index + 1} theta must be in [-2pi, 2pi].`)
      if (Math.abs(value) > MAX_SAMPLE_MAGNITUDE) errors.push(`Submitted input sample ${index + 1} value magnitude must be at most 1e12.`)
      if (weight <= 0 || weight > MAX_SAMPLE_MAGNITUDE) errors.push(`Submitted input sample ${index + 1} weight must be in (0, 1e12].`)
    }
  }

  if (output.module !== 'zernike') errors.push('Result module must be zernike.')
  if (output.operation !== 'weighted-fit') errors.push('Result operation must be weighted-fit.')
  if (output.indexing !== INDEXING) errors.push('Result indexing metadata must identify zero-based OSA/ANSI ordering.')
  if (output.normalization !== NORMALIZATION) errors.push('Result normalization metadata must identify unit-disk orthonormal modes.')
  if (output.methodId !== METHOD_ID) errors.push('Result methodId is not the weighted-fit OSA/ANSI method.')
  if (!isObject(output.backend) || output.backend.id !== 'host-f64') errors.push('Result backend metadata must identify host-f64.')

  if (Number.isInteger(terms) && output.terms !== terms) errors.push('Result terms must match the submitted input terms.')
  const coefficients = output.coefficients
  if (!Array.isArray(coefficients)) {
    errors.push('Result coefficients must be an array.')
  } else {
    if (Number.isInteger(terms) && coefficients.length !== terms) {
      errors.push('Result coefficient count must match the submitted input terms.')
    }
    if (!finiteNumberArray(coefficients)) errors.push('Result coefficients must all be finite numbers.')
  }

  const residual = output.weightedRmsResidual
  if (!finiteNumber(residual) || residual < 0) errors.push('Result weightedRmsResidual must be a finite non-negative number.')

  if (errors.length > 0 || !Number.isInteger(terms) || !Array.isArray(coefficients) || !finiteNumberArray(coefficients) || !finiteNumber(residual)) {
    return { valid: false, errors }
  }
  return {
    valid: true,
    terms: terms as number,
    coefficients: [...coefficients],
    weightedRmsResidual: residual,
  }
}

/** Builds a portable report containing the exact submitted request and returned result. */
export function createOpticStudioWavefrontReport(
  input: unknown,
  output: unknown,
  jobId?: string,
): OpticStudioWavefrontReport {
  const validation = validateOpticStudioWavefrontResult(input, output)
  if (!validation.valid) throw new TypeError(`Cannot export invalid Zernike weighted-fit result: ${validation.errors.join(' ')}`)
  if (jobId !== undefined && (typeof jobId !== 'string' || jobId.trim().length === 0)) {
    throw new TypeError('jobId must be a non-empty string when provided.')
  }

  const report: OpticStudioWavefrontReport = {
    format: 'waveworld-opticstudio-wavefront-result-v1',
    sourceWorkflow: 'opticstudio-zernike-weighted-fit',
    targetSoftware: 'OpticStudio',
    nativePinSha: OPTICSTUDIO_WAVEFRONT_NATIVE_PIN_SHA,
    submittedInput: jsonValue(input, 'submittedInput'),
    result: jsonValue(output, 'result'),
    limitations: REPORT_LIMITATIONS,
  }
  if (jobId !== undefined) report.jobId = jobId
  return report
}

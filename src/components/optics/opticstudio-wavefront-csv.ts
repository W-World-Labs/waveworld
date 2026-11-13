/**
 * WaveWorld's app-defined CSV interchange for normalized pupil wavefront samples.
 * This is not a reader for an OpticStudio native or proprietary export format.
 *
 * The only accepted header is `rho,thetaRadians,wavefront,weight`. Values map
 * directly to the native weighted-fit tuple `[rho, theta, value, weight]`.
 */
export const OPTICSTUDIO_WAVEFRONT_CSV_MAX_BYTES = 512 * 1024
export const OPTICSTUDIO_WAVEFRONT_CSV_MAX_SAMPLES = 4096

export type WavefrontSample = {
  rho: number
  thetaRadians: number
  wavefront: number
  weight: number
}

const HEADER = 'rho,thetaRadians,wavefront,weight'
const TAU = 2 * Math.PI
const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/

/** Parse the documented WaveWorld CSV subset into bounded weighted-fit samples. */
export function parseOpticStudioWavefrontCsv(text: string): WavefrontSample[] {
  if (typeof text !== 'string') throw new Error('Wavefront CSV input must be text.')
  if (text.length > OPTICSTUDIO_WAVEFRONT_CSV_MAX_BYTES
    || new TextEncoder().encode(text).byteLength > OPTICSTUDIO_WAVEFRONT_CSV_MAX_BYTES) {
    throw new Error(`Wavefront CSV exceeds the ${OPTICSTUDIO_WAVEFRONT_CSV_MAX_BYTES}-byte limit.`)
  }

  const source = text.startsWith('\uFEFF') ? text.slice(1) : text
  if (source.includes('\r') && /\r(?!\n)/.test(source)) {
    throw new Error('Wavefront CSV supports LF or CRLF line endings only.')
  }
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  if (lines[0] !== HEADER) {
    throw new Error(`Wavefront CSV header must be exactly: ${HEADER}`)
  }
  if (lines.length < 2) throw new Error('Wavefront CSV must contain at least one sample row.')
  if (lines.length - 1 > OPTICSTUDIO_WAVEFRONT_CSV_MAX_SAMPLES) {
    throw new Error(`Wavefront CSV may contain at most ${OPTICSTUDIO_WAVEFRONT_CSV_MAX_SAMPLES} sample rows.`)
  }

  return lines.slice(1).map((line, index) => {
    const lineNumber = index + 2
    const fields = line.split(',')
    if (fields.length !== 4) {
      throw new Error(`Wavefront CSV line ${lineNumber} must contain exactly four unquoted numeric fields.`)
    }
    const values = fields.map((field, fieldIndex) => {
      const value = field.trim()
      if (!DECIMAL_NUMBER.test(value)) {
        const fieldName = ['rho', 'thetaRadians', 'wavefront', 'weight'][fieldIndex]
        throw new Error(`Wavefront CSV line ${lineNumber}: ${fieldName} must be a decimal number.`)
      }
      const number = Number(value)
      if (!Number.isFinite(number)) {
        const fieldName = ['rho', 'thetaRadians', 'wavefront', 'weight'][fieldIndex]
        throw new Error(`Wavefront CSV line ${lineNumber}: ${fieldName} must be finite.`)
      }
      return number
    })

    const [rho, thetaRadians, wavefront, weight] = values
    if (rho < 0 || rho > 1) {
      throw new Error(`Wavefront CSV line ${lineNumber}: rho must be in [0,1].`)
    }
    if (thetaRadians < -TAU || thetaRadians > TAU) {
      throw new Error(`Wavefront CSV line ${lineNumber}: thetaRadians must be in [-2π,2π].`)
    }
    if (Math.abs(wavefront) > 1e12) {
      throw new Error(`Wavefront CSV line ${lineNumber}: wavefront magnitude must be at most 1e12.`)
    }
    if (weight <= 0 || weight > 1e12) {
      throw new Error(`Wavefront CSV line ${lineNumber}: weight must be in (0,1e12].`)
    }
    return { rho, thetaRadians, wavefront, weight }
  })
}

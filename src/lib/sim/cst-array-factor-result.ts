import type { JobResultV1 } from '@w-sim/contracts'
import { readModuleResult, type ModuleComputeInput } from './module-compute'

export type CstArrayFactorInput = {
  module: 'antenna-l2'
  backend: 'host'
  operation: 'cst-array-factor'
  freqHz: number
  positionsM: number[][]
  weights: number[][]
  directionsRad: number[][]
}

export type CstArrayFactorSample = {
  thetaRad: number
  phiRad: number
  fieldRealNormalized: number
  fieldImagNormalized: number
  normalizedPower: number
  powerDb: number
}

export type CstArrayFactorResult = {
  backend: 'host-f64'
  frequencyHz: number
  elementCount: number
  directionCount: number
  normalization: 'sum of excitation magnitudes; isotropic uncoupled elements'
  samples: CstArrayFactorSample[]
}

type Obj = Record<string, unknown>
const MAX_ELEMENTS = 256
const MAX_DIRECTIONS = 4096
const MAX_EVALUATIONS = 1_048_576

function object(value: unknown, label: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Obj
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`)
  return value
}

function boundedArray(value: unknown, label: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${label} count is out of bounds`)
  return value
}

/** Validate a settled Host job report against the exact submitted CST array-factor samples. */
export function readCstArrayFactorResult(remote: JobResultV1, input: CstArrayFactorInput): CstArrayFactorResult {
  if (input.module !== 'antenna-l2' || input.backend !== 'host' || input.operation !== 'cst-array-factor') {
    throw new Error('submitted CST array-factor selector is invalid')
  }
  const elements = boundedArray(input.positionsM, 'submitted positionsM', 1, MAX_ELEMENTS)
  const weights = boundedArray(input.weights, 'submitted weights', 1, MAX_ELEMENTS)
  const directions = boundedArray(input.directionsRad, 'submitted directionsRad', 1, MAX_DIRECTIONS)
  if (elements.length !== weights.length || elements.length * directions.length > MAX_EVALUATIONS) {
    throw new Error('submitted array-factor work bounds are invalid')
  }
  const frequency = finite(input.freqHz, 'submitted freqHz')
  if (frequency <= 0) throw new Error('submitted freqHz must be positive')
  elements.forEach((entry, i) => {
    if (!Array.isArray(entry) || entry.length !== 3) throw new Error(`submitted position ${i} must have three coordinates`)
    entry.forEach((value, j) => {
      const n = finite(value, `submitted position ${i}[${j}]`)
      if (Math.abs(n) > 1e6) throw new Error(`submitted position ${i}[${j}] exceeds ±1e6 m`)
    })
  })
  let norm = 0
  weights.forEach((entry, i) => {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error(`submitted weight ${i} must be [real, imag]`)
    const re = finite(entry[0], `submitted weight ${i}.real`)
    const im = finite(entry[1], `submitted weight ${i}.imag`)
    norm += Math.hypot(re, im)
  })
  if (!Number.isFinite(norm) || norm <= 0) throw new Error('submitted weights must have nonzero finite total magnitude')
  const parsedDirections = directions.map((entry, i) => {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error(`submitted direction ${i} must be [theta, phi]`)
    const theta = finite(entry[0], `submitted direction ${i}.theta`)
    const phi = finite(entry[1], `submitted direction ${i}.phi`)
    if (theta < 0 || theta > Math.PI) throw new Error(`submitted direction ${i}.theta must be in [0, pi]`)
    return [theta, phi]
  })
  if (!Number.isSafeInteger(remote.summary?.steps) || remote.summary.steps !== 1 ||
      !Number.isFinite(remote.summary.wallTimeMs) || remote.summary.wallTimeMs < 0) {
    throw new Error('CST array-factor settlement envelope must report one step and finite nonnegative wall time')
  }
  const moduleResult = object(readModuleResult(remote, input as unknown as ModuleComputeInput), 'CST array-factor module result')
  if (moduleResult.module !== 'antenna-l2' || moduleResult.operation !== 'cst-array-factor') {
    throw new Error('CST array-factor module identity does not match the submitted operation')
  }
  const backend = object(moduleResult.backend, 'CST array-factor backend')
  if (backend.id !== 'host-f64') throw new Error('CST array-factor result backend provenance must be host-f64')
  const report = object(moduleResult.result, 'CST array-factor report')
  if (finite(report.frequencyHz, 'CST array-factor frequencyHz') !== frequency) throw new Error('CST array-factor frequency echo does not match the submitted input')
  if (report.elementCount !== elements.length || report.directionCount !== directions.length) throw new Error('CST array-factor report counts do not match the submitted input')
  if (report.normalization !== 'sum of excitation magnitudes; isotropic uncoupled elements') throw new Error('CST array-factor normalization or isotropic uncoupled limitation is missing')
  if (!Array.isArray(report.samples) || report.samples.length !== directions.length) throw new Error('CST array-factor sample count does not match the submitted directions')
  const samples = report.samples.map((sampleValue, i) => {
    const sample = object(sampleValue, `CST array-factor sample ${i}`)
    const [theta, phi] = parsedDirections[i]
    if (finite(sample.thetaRad, `sample ${i}.thetaRad`) !== theta || finite(sample.phiRad, `sample ${i}.phiRad`) !== phi) {
      throw new Error(`CST array-factor sample ${i} direction echo does not match the submitted order`)
    }
    const re = finite(sample.fieldRealNormalized, `sample ${i}.fieldRealNormalized`)
    const im = finite(sample.fieldImagNormalized, `sample ${i}.fieldImagNormalized`)
    const power = finite(sample.normalizedPower, `sample ${i}.normalizedPower`)
    const db = finite(sample.powerDb, `sample ${i}.powerDb`)
    const expectedPower = re * re + im * im
    if (!Number.isFinite(expectedPower) || power < 0 || power > 1 + 1e-12 ||
        Math.abs(power - expectedPower) > 1e-10 * Math.max(1, expectedPower)) {
      throw new Error(`CST array-factor sample ${i} normalized power is inconsistent with its complex field`)
    }
    const expectedDb = power === 0 ? -300 : Math.max(-300, 10 * Math.log10(power))
    if (Math.abs(db - expectedDb) > 1e-9 * Math.max(1, Math.abs(expectedDb))) throw new Error(`CST array-factor sample ${i} powerDb is inconsistent`)
    return { thetaRad: theta, phiRad: phi, fieldRealNormalized: re, fieldImagNormalized: im, normalizedPower: power, powerDb: db }
  })
  return { backend: 'host-f64', frequencyHz: frequency, elementCount: elements.length, directionCount: directions.length,
    normalization: 'sum of excitation magnitudes; isotropic uncoupled elements', samples }
}

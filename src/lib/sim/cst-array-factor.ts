import type { JobSpecV1 } from '@w-sim/contracts'
import { createModuleJobSpec, type ModuleComputeInput } from './module-compute'

export const CST_ARRAY_FACTOR_OPERATION = 'cst-array-factor'
export const CST_ARRAY_FACTOR_NATIVE_PIN_SHA = 'dda2f6f1e1def3d9a49bea48c8766d222b2d8a14'
export const CST_ARRAY_FACTOR_MAX_ELEMENTS = 256
export const CST_ARRAY_FACTOR_MAX_DIRECTIONS = 4096
export const CST_ARRAY_FACTOR_MAX_EVALUATIONS = 1_048_576
export const CST_ARRAY_FACTOR_MAX_INPUT_BYTES = 1024 * 1024

export type CstArrayFactorInput = {
  module: 'antenna-l2'
  operation: typeof CST_ARRAY_FACTOR_OPERATION
  backend: 'host'
  freqHz: number
  positionsM: Array<[number, number, number]>
  weights: Array<[number, number]>
  directionsRad: Array<[number, number]>
}

export type CstArrayFactorDraft = Omit<CstArrayFactorInput, 'module' | 'operation' | 'backend'>

const C0 = 299_792_458
const PI = Math.PI

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function finite(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`)
}

function validateDraft(raw: unknown): CstArrayFactorDraft {
  const draft = object(raw, 'CST array-factor input')
  const keys = ['freqHz', 'positionsM', 'weights', 'directionsRad']
  for (const key of Object.keys(draft)) if (!keys.includes(key)) throw new Error(`CST array-factor input has unsupported field ${key}`)
  for (const key of keys) if (!(key in draft)) throw new Error(`CST array-factor input.${key} is required`)

  finite(draft.freqHz, 'Frequency (Hz)')
  if (draft.freqHz <= 0) throw new Error('Frequency (Hz) must be greater than zero')
  if (!Array.isArray(draft.positionsM) || draft.positionsM.length < 1 || draft.positionsM.length > CST_ARRAY_FACTOR_MAX_ELEMENTS) {
    throw new Error(`Element positions must contain 1 to ${CST_ARRAY_FACTOR_MAX_ELEMENTS} rows`)
  }
  if (!Array.isArray(draft.weights) || draft.weights.length !== draft.positionsM.length) {
    throw new Error('Complex weights must match the element position count')
  }
  if (!Array.isArray(draft.directionsRad) || draft.directionsRad.length < 1 || draft.directionsRad.length > CST_ARRAY_FACTOR_MAX_DIRECTIONS || draft.positionsM.length * draft.directionsRad.length > CST_ARRAY_FACTOR_MAX_EVALUATIONS) {
    throw new Error(`Observation directions exceed the ${CST_ARRAY_FACTOR_MAX_EVALUATIONS} evaluation bound`)
  }

  const positionsM = draft.positionsM.map((rawPoint, index) => {
    if (!Array.isArray(rawPoint) || rawPoint.length !== 3) throw new Error(`Position ${index} must contain three coordinates`)
    const point = rawPoint.map((coordinate, axis) => {
      finite(coordinate, `Position ${index} coordinate ${axis}`)
      if (Math.abs(coordinate) > 1e6) throw new Error(`Position ${index} coordinates must be within ±1e6 m`)
      return coordinate
    })
    return point as [number, number, number]
  })

  let norm = 0
  const weights = draft.weights.map((rawWeight, index) => {
    if (!Array.isArray(rawWeight) || rawWeight.length !== 2) throw new Error(`Weight ${index} must be [real, imag]`)
    finite(rawWeight[0], `Weight ${index} real part`)
    finite(rawWeight[1], `Weight ${index} imaginary part`)
    norm += Math.hypot(rawWeight[0], rawWeight[1])
    return [rawWeight[0], rawWeight[1]] as [number, number]
  })
  if (!Number.isFinite(norm) || norm <= 0) throw new Error('Complex weights must have nonzero finite total magnitude')

  const directionsRad = draft.directionsRad.map((rawDirection, index) => {
    if (!Array.isArray(rawDirection) || rawDirection.length !== 2) throw new Error(`Direction ${index} must be [theta, phi]`)
    const [theta, phi] = rawDirection
    finite(theta, `Direction ${index} theta`)
    finite(phi, `Direction ${index} phi`)
    if (theta < 0 || theta > PI) throw new Error(`Direction ${index} theta must be in [0, pi] radians`)
    return [theta, phi] as [number, number]
  })

  const k = 2 * PI * draft.freqHz / C0
  if (!Number.isFinite(k) || k <= 0) throw new Error('Frequency produces an invalid wavenumber')
  for (const [theta, phi] of directionsRad) {
    const u = [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), Math.cos(theta)]
    for (const point of positionsM) {
      const phase = k * (point[0] * u[0] + point[1] * u[1] + point[2] * u[2])
      if (!Number.isFinite(phase) || Math.abs(phase) > 1e12) throw new Error('Position phase exceeds reliable f64 range (±1e12 rad)')
    }
  }
  return { freqHz: draft.freqHz, positionsM, weights, directionsRad }
}

export function createDefaultCstArrayFactorDraft(): CstArrayFactorDraft {
  return {
    freqHz: 300_000_000,
    positionsM: [[0, 0, 0], [0, 0, 0.5]],
    weights: [[1, 0], [1, 0]],
    directionsRad: [[0, 0], [PI / 2, 0]],
  }
}

export function createCstArrayFactorJob(draft: CstArrayFactorDraft): { input: CstArrayFactorInput; spec: JobSpecV1 } {
  const value = validateDraft(draft)
  const input: CstArrayFactorInput = {
    module: 'antenna-l2', operation: CST_ARRAY_FACTOR_OPERATION, backend: 'host',
    freqHz: value.freqHz,
    positionsM: value.positionsM.map(point => [...point] as [number, number, number]),
    weights: value.weights.map(weight => [...weight] as [number, number]),
    directionsRad: value.directionsRad.map(direction => [...direction] as [number, number]),
  }
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > CST_ARRAY_FACTOR_MAX_INPUT_BYTES) {
    throw new Error(`CST array-factor job input exceeds ${CST_ARRAY_FACTOR_MAX_INPUT_BYTES} bytes`)
  }
  return { input, spec: createModuleJobSpec(input as unknown as ModuleComputeInput) }
}

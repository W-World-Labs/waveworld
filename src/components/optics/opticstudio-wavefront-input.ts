import type { NativeAlgorithmInput } from '../../lib/sim/module-compute'
import type { WavefrontSample } from './opticstudio-wavefront-csv'

/** Existing W-Sim source dependency pin containing the host-f64 Zernike weighted fit. */
export const OPTICSTUDIO_WAVEFRONT_NATIVE_PIN_SHA = 'dda2f6f1e1def3d9a49bea48c8766d222b2d8a14'

type ZernikeWeightedFitSelector = Extract<NativeAlgorithmInput, {
  module: 'zernike'
  operation: 'weighted-fit'
}>

export type OpticStudioWavefrontInput = ZernikeWeightedFitSelector & {
  terms: number
  samples: Array<[number, number, number, number]>
}

const MAX_TERMS = 10
const MAX_SAMPLES = 4096
const MAX_SAMPLE_MAGNITUDE = 1e12
const MAX_ANGLE_RADIANS = 2 * Math.PI

function fail(message: string): never {
  throw new Error(message)
}

function finite(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return fail(`${name} must be finite and in [${min}, ${max}]`)
  }
  return value
}

function normalizeSample(value: unknown, index: number): [number, number, number, number] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail(`Wavefront sample ${index + 1} must be an object`)
  }
  const sample = value as WavefrontSample
  const rho = finite(sample.rho, `Wavefront sample ${index + 1} rho`, 0, 1)
  const thetaRadians = finite(sample.thetaRadians, `Wavefront sample ${index + 1} thetaRadians`, -MAX_ANGLE_RADIANS, MAX_ANGLE_RADIANS)
  const wavefront = finite(sample.wavefront, `Wavefront sample ${index + 1} wavefront`, -MAX_SAMPLE_MAGNITUDE, MAX_SAMPLE_MAGNITUDE)
  const weight = finite(sample.weight, `Wavefront sample ${index + 1} weight`, Number.MIN_VALUE, MAX_SAMPLE_MAGNITUDE)
  return [rho, thetaRadians, wavefront, weight]
}

/**
 * Build the exact existing W-Sim host-f64 input for a sampled unit-disk fit.
 * Samples map to [rho, theta radians, wavefront value, positive weight].
 */
export function buildOpticStudioWavefrontInput(
  samples: WavefrontSample[],
  terms: number,
): OpticStudioWavefrontInput {
  if (!Number.isInteger(terms) || terms < 1 || terms > MAX_TERMS) {
    return fail(`Zernike term count must be an integer in [1, ${MAX_TERMS}]`)
  }
  if (!Array.isArray(samples) || samples.length < terms || samples.length > MAX_SAMPLES) {
    return fail(`Wavefront sample count must be between terms and ${MAX_SAMPLES}`)
  }

  return {
    module: 'zernike',
    backend: 'host',
    operation: 'weighted-fit',
    terms,
    samples: samples.map(normalizeSample),
  }
}

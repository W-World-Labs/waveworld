import { describe, expect, it } from 'vitest'
import type { WavefrontSample } from './opticstudio-wavefront-csv'
import {
  buildOpticStudioWavefrontInput,
  OPTICSTUDIO_WAVEFRONT_NATIVE_PIN_SHA,
} from './opticstudio-wavefront-input'

const samples: WavefrontSample[] = [
  { rho: 0.2, thetaRadians: 0, wavefront: 0.1, weight: 1 },
  { rho: 0.5, thetaRadians: Math.PI / 2, wavefront: 0.3, weight: 2 },
  { rho: 0.8, thetaRadians: Math.PI, wavefront: -0.1, weight: 1 },
  { rho: 0.6, thetaRadians: -Math.PI / 2, wavefront: -0.3, weight: 0.5 },
]

describe('OpticStudio wavefront input builder', () => {
  it('builds the exact released host weighted-fit payload and exposes its pin provenance', () => {
    expect(OPTICSTUDIO_WAVEFRONT_NATIVE_PIN_SHA).toBe('dda2f6f1e1def3d9a49bea48c8766d222b2d8a14')
    expect(buildOpticStudioWavefrontInput(samples, 2)).toEqual({
      module: 'zernike',
      backend: 'host',
      operation: 'weighted-fit',
      terms: 2,
      samples: [
        [0.2, 0, 0.1, 1],
        [0.5, Math.PI / 2, 0.3, 2],
        [0.8, Math.PI, -0.1, 1],
        [0.6, -Math.PI / 2, -0.3, 0.5],
      ],
    })
  })

  it('bounds the fit term count and sample count to the existing native operation', () => {
    for (const terms of [0, 1.5, 11, Number.NaN]) {
      expect(() => buildOpticStudioWavefrontInput(samples, terms)).toThrow(/term count/)
    }
    expect(() => buildOpticStudioWavefrontInput(samples.slice(0, 1), 2)).toThrow(/sample count/)
    expect(() => buildOpticStudioWavefrontInput(
      Array.from({ length: 4097 }, () => samples[0]), 1,
    )).toThrow(/sample count/)
  })

  it('rejects samples outside the native unit-disk and finite weighted-fit bounds', () => {
    const invalidSamples = [
      { ...samples[0], rho: -0.01 },
      { ...samples[0], rho: 1.01 },
      { ...samples[0], thetaRadians: 2 * Math.PI + 0.01 },
      { ...samples[0], wavefront: Number.POSITIVE_INFINITY },
      { ...samples[0], wavefront: 1e12 + 1 },
      { ...samples[0], weight: 0 },
      { ...samples[0], weight: 1e12 + 1 },
    ]

    for (const sample of invalidSamples) {
      expect(() => buildOpticStudioWavefrontInput(
        [sample, ...samples.slice(1)], 2,
      )).toThrow(/Wavefront sample 1/)
    }
  })

  it('copies normalized pupil samples into native tuples without mutating the source', () => {
    const source = samples.map(sample => ({ ...sample }))
    const input = buildOpticStudioWavefrontInput(source, 2)
    source[0].wavefront = 99

    expect(input.samples[0]).toEqual([0.2, 0, 0.1, 1])
  })
})

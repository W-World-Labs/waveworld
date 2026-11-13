import { describe, expect, it } from 'vitest'
import { OPTICSTUDIO_WAVEFRONT_NATIVE_PIN_SHA } from './opticstudio-wavefront-input'
import {
  createOpticStudioWavefrontReport,
  validateOpticStudioWavefrontResult,
} from './opticstudio-wavefront-result'

const input = {
  module: 'zernike',
  backend: 'host',
  operation: 'weighted-fit',
  terms: 2,
  samples: [
    [0.2, 0, 0.1, 1],
    [0.5, Math.PI / 2, 0.3, 2],
    [0.8, Math.PI, -0.1, 1],
    [0.6, (Math.PI * 3) / 2, -0.3, 0.5],
  ],
}

const output = {
  module: 'zernike',
  operation: 'weighted-fit',
  indexing: 'OSA/ANSI j=0 based; negative m sine, m=0, positive m cosine',
  normalization: 'unit-disk orthonormal',
  terms: 2,
  coefficients: [0.12, -0.04],
  weightedRmsResidual: 0.003,
  methodId: 'method-algo-zernike-weighted-fit-osa-j0',
  backend: { id: 'host-f64' },
  futureNativeField: { retained: true },
}

describe('OpticStudio wavefront weighted-fit result helper', () => {
  it('accepts a finite result whose indexing and metadata match the submitted input', () => {
    expect(validateOpticStudioWavefrontResult(input, output)).toEqual({
      valid: true,
      terms: 2,
      coefficients: [0.12, -0.04],
      weightedRmsResidual: 0.003,
    })
  })

  it('rejects coefficient count, coefficient finiteness, and input term mismatches', () => {
    expect(validateOpticStudioWavefrontResult(input, { ...output, coefficients: [0.12] })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(['Result coefficient count must match the submitted input terms.']),
    })
    expect(validateOpticStudioWavefrontResult(input, { ...output, coefficients: [0.12, Number.NaN] })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(['Result coefficients must all be finite numbers.']),
    })
    expect(validateOpticStudioWavefrontResult(input, { ...output, terms: 3 })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(['Result terms must match the submitted input terms.']),
    })
  })

  it('rejects unrecognized indexing or backend metadata and invalid residuals', () => {
    expect(validateOpticStudioWavefrontResult(input, { ...output, indexing: 'Noll numbering' })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(['Result indexing metadata must identify zero-based OSA/ANSI ordering.']),
    })
    expect(validateOpticStudioWavefrontResult(input, { ...output, backend: { id: 'gpu' } })).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(['Result backend metadata must identify host-f64.']),
    })
    for (const weightedRmsResidual of [-0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateOpticStudioWavefrontResult(input, { ...output, weightedRmsResidual })).toMatchObject({
        valid: false,
        errors: expect.arrayContaining(['Result weightedRmsResidual must be a finite non-negative number.']),
      })
    }
  })

  it('requires a supported submitted weighted-fit request', () => {
    expect(validateOpticStudioWavefrontResult({ ...input, operation: 'sample' }, output)).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(['Submitted input operation must be weighted-fit.']),
    })
    expect(validateOpticStudioWavefrontResult({ ...input, samples: [[2, 0, 0, 1]] }, output)).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(['Submitted input sample 1 rho must be in [0, 1].']),
    })
  })

  it('exports the exact submitted input and result with portable provenance and explicit limits', () => {
    const report = createOpticStudioWavefrontReport(input, output, 'job-123')
    expect(report).toMatchObject({
      format: 'waveworld-opticstudio-wavefront-result-v1',
      sourceWorkflow: 'opticstudio-zernike-weighted-fit',
      targetSoftware: 'OpticStudio',
      nativePinSha: OPTICSTUDIO_WAVEFRONT_NATIVE_PIN_SHA,
      jobId: 'job-123',
      submittedInput: input,
      result: output,
      limitations: expect.arrayContaining([
        expect.stringContaining('does not claim OpticStudio execution or vendor parity'),
      ]),
    })
    expect(report.submittedInput).not.toBe(input)
    expect(report.result).not.toBe(output)
    expect(JSON.parse(JSON.stringify(report))).toEqual(report)
  })

  it('refuses to export an invalid result', () => {
    expect(() => createOpticStudioWavefrontReport(input, { ...output, weightedRmsResidual: -1 })).toThrow(
      'Cannot export invalid Zernike weighted-fit result',
    )
  })
})

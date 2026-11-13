import { describe, expect, it } from 'vitest'
import type { JobResultV1 } from '@w-sim/contracts'
import { createCoatingStudyJob, createDefaultCoatingStudyDraft } from './coating-study-input'
import { readCoatingStudyResult } from './coating-study-result'

const input = createCoatingStudyJob({
  ...createDefaultCoatingStudyDraft(),
  startWavelength: 400,
  stopWavelength: 700,
  samples: 3,
}).input

const methodId = 'method-algo-thinfilm-rt'
const familyId = 'method-sw-optics-thinfilm'

// Synthetic native-shaped fixture. The reader must validate and preserve the
// native spectrum rows; it must not derive optical values from the submitted
// coating or replace the wavelengths with a locally generated sweep.
const spectrum = [
  { lambda: 400, Rs: 0.04, Ts: 0.96, As: 0, Rp: 0.04, Tp: 0.96, Ap: 0, R: 0.04, T: 0.96, A: 0, energyResidual: 0 },
  { lambda: 550, Rs: 0.16, Ts: 0.80, As: 0.04, Rp: 0.16, Tp: 0.80, Ap: 0.04, R: 0.16, T: 0.80, A: 0.04, energyResidual: 0 },
  { lambda: 700, Rs: 0.25, Ts: 0.70, As: 0.05, Rp: 0.25, Tp: 0.70, Ap: 0.05, R: 0.25, T: 0.70, A: 0.05, energyResidual: 0 },
]

const nativeResult = (
  rows: unknown[] = spectrum,
  payloadOverrides: Record<string, unknown> = {},
  wrapperOverrides: Record<string, unknown> = {},
) => ({
  schemaVersion: 1,
  status: 'succeeded',
  summary: { steps: 1, wallTimeMs: 1 },
  backend: { id: 'w-sim-cuda' },
  moduleResult: {
    ok: true,
    module: 'sw-optics-thinfilm',
    backend: { id: 'w-sim-cuda-host', deviceName: 'w-sim-cuda-host' },
    result: {
      ok: true,
      methodId,
      familyId,
      polarization: input.polarization,
      spectrum: rows,
      ...payloadOverrides,
    },
    ...wrapperOverrides,
  },
})

const read = (value: unknown = nativeResult(), submitted = input) =>
  readCoatingStudyResult(value as JobResultV1, submitted)

describe('coating study result reader', () => {
  it('reads the native result.spectrum[] in submitted wavelength order', () => {
    const result = read()

    expect(result.spectrum).toEqual(spectrum)
    expect(result.backend).toEqual({ id: 'w-sim-cuda-host', deviceName: 'w-sim-cuda-host' })
    expect(result.spectrum.map(row => row.lambda)).toEqual(input.wavelengths)
    expect(result.spectrum[1]).toEqual(spectrum[1])
  })

  it('requires the pinned host-f64 native provenance and exact method and family', () => {
    expect(() => read(nativeResult(spectrum, {}, { backend: { id: 'host-f64', deviceName: 'CPU' } }))).toThrow(/backend/i)
    expect(() => read(nativeResult(spectrum, {}, { backend: { id: 'w-sim-cuda-host', deviceName: 'CPU' } }))).toThrow(/backend/i)
    expect(() => read(nativeResult(spectrum, {}, { backend: { id: 'w-sim-cuda-host', deviceName: 'w-sim-cuda-host', kind: 'cuda-f64' } }))).toThrow(/backend/i)
    expect(() => read(nativeResult(spectrum, { methodId: 'method-algo-thinfilm-polarization' }))).toThrow(/method/i)
    expect(() => read(nativeResult(spectrum, { familyId: 'method-other' }))).toThrow(/family/i)
  })

  it('rejects missing spectra, changed wavelength bindings, and wrong sample counts', () => {
    expect(() => read(nativeResult(spectrum, { spectrum: undefined }))).toThrow(/spectrum/i)
    expect(() => read(nativeResult(spectrum.slice(0, 2)))).toThrow(/count|length|spectrum/i)
    expect(() => read(nativeResult([...spectrum, spectrum[2]]))).toThrow(/count|length|spectrum/i)
    expect(() => read(nativeResult([
      spectrum[0]!,
      { ...spectrum[1]!, lambda: 551 },
      spectrum[2]!,
    ]))).toThrow(/wavelength|lambda/i)
    expect(() => read(nativeResult([spectrum[1]!, spectrum[0]!, spectrum[2]!]))).toThrow(/wavelength|lambda|order/i)
  })

  it('rejects malformed rows, non-finite fields, and reflectance/transmittance/absorptance outside [0, 1]', () => {
    expect(() => read(nativeResult([null, ...spectrum.slice(1)]))).toThrow(/row|object|spectrum/i)
    expect(() => read(nativeResult([{ ...spectrum[0]!, T: undefined }, ...spectrum.slice(1)]))).toThrow(/T|finite/i)
    expect(() => read(nativeResult([{ ...spectrum[0]!, R: Number.NaN }, ...spectrum.slice(1)]))).toThrow(/finite/i)
    expect(() => read(nativeResult([{ ...spectrum[0]!, T: Number.POSITIVE_INFINITY }, ...spectrum.slice(1)]))).toThrow(/finite/i)
    expect(() => read(nativeResult([{ ...spectrum[0]!, R: -0.01 }, ...spectrum.slice(1)]))).toThrow(/range|\[0, 1\]|reflectance/i)
    expect(() => read(nativeResult([{ ...spectrum[0]!, T: 1.01 }, ...spectrum.slice(1)]))).toThrow(/range|\[0, 1\]|transmittance/i)
    expect(() => read(nativeResult([{ ...spectrum[0]!, A: -0.01 }, ...spectrum.slice(1)]))).toThrow(/range|\[0, 1\]|absorptance/i)
    expect(() => read(nativeResult([{ ...spectrum[0]!, energyResidual: Number.NaN }, ...spectrum.slice(1)]))).toThrow(/finite/i)
  })

  it('enforces the native energy residual tolerance', () => {
    expect(() => read(nativeResult([{ ...spectrum[0]!, energyResidual: 1e-4 }, ...spectrum.slice(1)]))).toThrow(/residual|energy/i)
    expect(() => read(nativeResult([{ ...spectrum[0]!, energyResidual: 1e-12 }, ...spectrum.slice(1)]))).not.toThrow()
  })
})

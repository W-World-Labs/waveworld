import { describe, expect, it } from 'vitest'
import { importAbaqusAmplitudeSource, validateAbaqusAmplitudeResult } from './abaqus-amplitude-import'

describe('Abaqus amplitude source import', () => {
  it('maps literal tabular curves and preserves TOTAL TIME in the existing native module shape', () => {
    const imported = importAbaqusAmplitudeSource([
      '*AMPLITUDE, NAME="Druckkurve1820mm von DDT", TIME=TOTAL TIME',
      '0.0,140.,0.000125,80.',
    ].join('\n'))

    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.input).toEqual({
      module: 'sw-calculix-amplitude',
      backend: 'host',
      curves: [{
        name: 'Druckkurve1820mm von DDT',
        time: 'total',
        definition: 'tabular',
        pairs: [[0, 140], [0.000125, 80]],
      }],
      queries: [
        { curve: 'Druckkurve1820mm von DDT', t: 0 },
        { curve: 'Druckkurve1820mm von DDT', t: 0.000125 },
      ],
    })
  })

  it('keeps default STEP TIME and reads multiple literal pairs per data row', () => {
    const imported = importAbaqusAmplitudeSource([
      '*AMPLITUDE, NAME=RAMP, DEFINITION=TABULAR',
      '0., 0., 1., 1., 2., 1.',
    ].join('\n'))

    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.curves[0]).toEqual({ name: 'RAMP', time: 'step', definition: 'tabular', pairs: [[0, 0], [1, 1], [2, 1]] })
    expect(imported.input.queries).toHaveLength(3)
  })

  it('rejects unsupported curve definitions, non-amplitude cards, malformed rows and non-increasing times', () => {
    const unsupported = importAbaqusAmplitudeSource('*AMPLITUDE, NAME=A, DEFINITION=SMOOTH STEP\n0,0,1,1')
    const otherCard = importAbaqusAmplitudeSource('*AMPLITUDE, NAME=A\n0,0,1,1\n*BOUNDARY\nN1,1,3,0')
    const blankField = importAbaqusAmplitudeSource('*AMPLITUDE, NAME=A\n0,,1,1,2,2')
    const unordered = importAbaqusAmplitudeSource('*AMPLITUDE, NAME=A\n0,0,2,2,1,1')

    expect(unsupported).toMatchObject({ ok: false, diagnostics: [expect.stringMatching(/only .*TABULAR/i)] })
    expect(otherCard).toMatchObject({ ok: false, diagnostics: [expect.stringMatching(/outside this standalone/i)] })
    expect(blankField).toMatchObject({ ok: false, diagnostics: [expect.stringMatching(/blank amplitude data fields/i)] })
    expect(unordered).toMatchObject({ ok: false, diagnostics: [expect.stringMatching(/strictly increasing/i)] })
  })

  it('accepts only a native result bound to the imported curve and exact knot queries', () => {
    const imported = importAbaqusAmplitudeSource('*AMPLITUDE, NAME=A, TIME=STEP TIME\n0,2,1,4')
    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    const valid = {
      module: 'sw-calculix-amplitude',
      backend: { id: 'host-f64-sw-calculix-amplitude' },
      curves: [{ name: 'A', time: 'step', nPairs: 2, tMin: 0, tMax: 1, definition: 'tabular' }],
      eval: [{ curve: 'A', t: 0, amplitude: 2 }, { curve: 'A', t: 1, amplitude: 4 }],
    }
    expect(validateAbaqusAmplitudeResult(valid, imported.input)).toEqual({ ok: true })
    expect(validateAbaqusAmplitudeResult({ ...valid, eval: [{ curve: 'A', t: 0, amplitude: 3 }] }, imported.input).ok).toBe(false)
    expect(validateAbaqusAmplitudeResult({ ...valid, backend: { id: 'native-cuda-sw-calculix-amplitude' } }, imported.input).ok).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  OPTICSTUDIO_WAVEFRONT_CSV_MAX_BYTES,
  OPTICSTUDIO_WAVEFRONT_CSV_MAX_SAMPLES,
  parseOpticStudioWavefrontCsv,
} from './opticstudio-wavefront-csv'

const HEADER = 'rho,thetaRadians,wavefront,weight'

describe('WaveWorld normalized pupil wavefront CSV', () => {
  it('maps the app-defined header and rows to named weighted-fit samples', () => {
    expect(parseOpticStudioWavefrontCsv([
      HEADER,
      '0.2,0,0.1,1',
      '0.5,1.5707963267948966,-0.3,2e0',
    ].join('\r\n'))).toEqual([
      { rho: 0.2, thetaRadians: 0, wavefront: 0.1, weight: 1 },
      { rho: 0.5, thetaRadians: Math.PI / 2, wavefront: -0.3, weight: 2 },
    ])
  })

  it('accepts a UTF-8 BOM but rejects vendor or undocumented headers', () => {
    expect(parseOpticStudioWavefrontCsv(`\uFEFF${HEADER}\n0,0,1,1`)).toHaveLength(1)
    expect(() => parseOpticStudioWavefrontCsv('OpticStudio Zernike Standard Coefficients\n0,0,1,1')).toThrow(/header/)
    expect(() => parseOpticStudioWavefrontCsv('rho,theta_rad,wavefront,weight\n0,0,1,1')).toThrow(/header/)
  })

  it('rejects malformed rows, blank rows, and non-decimal or non-finite values', () => {
    for (const row of ['', '0,0,1', '0,0,1,1,extra', '0,0,NaN,1', '0,0,Infinity,1', '0x1,0,1,1', '"0",0,1,1']) {
      expect(() => parseOpticStudioWavefrontCsv(`${HEADER}\n${row}`)).toThrow()
    }
    expect(() => parseOpticStudioWavefrontCsv(`${HEADER}\n0,0,1e999,1`)).toThrow(/finite/)
    expect(() => parseOpticStudioWavefrontCsv(`${HEADER}\n0,0,1,1\n\n0.5,1,2,1`)).toThrow(/line 3/)
  })

  it('enforces normalized pupil, angle, wavefront, and positive weight bounds', () => {
    for (const row of [
      '-0.01,0,0,1', '1.01,0,0,1',
      '0,-6.283185307179587,0,1', '0,6.283185307179587,0,1',
      '0,0,1000000000001,1', '0,0,-1000000000001,1',
      '0,0,0,0', '0,0,0,-1', '0,0,0,1000000000001',
    ]) {
      expect(() => parseOpticStudioWavefrontCsv(`${HEADER}\n${row}`)).toThrow()
    }
    expect(parseOpticStudioWavefrontCsv(`${HEADER}\n1,6.283185307179586,-1e12,1e12`)).toHaveLength(1)
  })

  it('caps text size and sample count', () => {
    expect(() => parseOpticStudioWavefrontCsv('x'.repeat(OPTICSTUDIO_WAVEFRONT_CSV_MAX_BYTES + 1))).toThrow(/byte limit/)
    const tooManyRows = Array.from({ length: OPTICSTUDIO_WAVEFRONT_CSV_MAX_SAMPLES + 1 }, () => '0,0,0,1')
    expect(() => parseOpticStudioWavefrontCsv([HEADER, ...tooManyRows].join('\n'))).toThrow(/at most/)
  })

  it('requires at least one data row and rejects bare carriage returns', () => {
    expect(() => parseOpticStudioWavefrontCsv(HEADER)).toThrow(/at least one/)
    expect(() => parseOpticStudioWavefrontCsv(`${HEADER}\r0,0,0,1`)).toThrow(/line endings/)
  })
})

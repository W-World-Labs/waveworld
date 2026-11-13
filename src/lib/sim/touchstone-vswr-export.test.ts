import { describe, expect, it } from 'vitest'
import { buildTouchstoneVswrCsv } from './touchstone-vswr-export'
import type { TouchstoneNetwork } from './touchstone'
import type { TouchstoneVswrResult } from './touchstone-vswr'

const network: TouchstoneNetwork = {
  fileName: 'measured.s2p',
  ports: 2,
  frequencyUnit: 'GHz',
  format: 'RI',
  referenceOhms: 50,
  points: [],
}

const result: TouchstoneVswrResult = {
  points: [
    {
      frequencyHz: 1e9,
      s11: [0, 0],
      magnitude: 0,
      vswr: 1,
      returnLossDb: null,
      reflectedPowerFraction: 0,
    },
    {
      frequencyHz: 2e9,
      s11: [0.2, 0],
      magnitude: 0.2,
      vswr: 1.5,
      returnLossDb: 13.979400086720375,
      reflectedPowerFraction: 0.04,
    },
  ],
  maxVswr: 1.5,
  meanReflectedPowerFraction: 0.02,
  backend: { id: 'w-sim-cuda-host', kind: 'host-f64' },
}

describe('buildTouchstoneVswrCsv', () => {
  it('exports every returned metric in the stable schema and marks ideal-match return loss as Infinity', () => {
    expect(buildTouchstoneVswrCsv(network, result)).toBe([
      '"frequency_hz","s11_real","s11_imag","magnitude","vswr","return_loss_db","reflected_power_fraction","reference_ohms"',
      '"1000000000","0","0","0","1","Infinity","0","50"',
      '"2000000000","0.2","0","0.2","1.5","13.979400086720375","0.04","50"',
      '',
    ].join('\r\n'))
  })

  it('uses CRLF line endings and retains full numeric precision', () => {
    const csv = buildTouchstoneVswrCsv(network, result)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n')
    expect(csv).toContain('"13.979400086720375"')
  })
})

import { describe, expect, it } from 'vitest'
import { pemfcStudyCsv, pemfcStudyReport } from './pemfc-study-export'
import { createDefaultPemfcStudy, validatePemfcPolarizationInput } from './pemfc-study-input'
import type { PemfcStudyResult } from './pemfc-study-result'

const draft = createDefaultPemfcStudy()
const input = validatePemfcPolarizationInput({
  module: 'sw-comsol-pemfc', method: 'polarization', backend: 'host', n: 2, E0: 1.229,
  ...draft,
})
const result: PemfcStudyResult = {
  backend: { id: 'w-sim-cuda-host', kind: 'host-f64', deviceName: 'w-sim-cuda-host' },
  result: {
    T: draft.T, pH2: draft.pH2, pO2: draft.pO2, pH2O: draft.pH2O,
    E0: 1.229, E0T: 1.18225, j: draft.j, j0: draft.j0, alpha: draft.alpha,
    n: 2, R: draft.R, jLim: draft.jLim, thermalVoltage: 0.0304,
    E_nernst: 1.1703765480706372, eta_act: 0.25919618067260647,
    eta_ohm: 0.025, eta_conc: 0.004377386584504772,
    V: 0.8818029808135259, powerDensity: 0.44090149040676295,
    voltageEfficiency: 0.753,
    curve: {
      current: [0, 0.5, 1],
      voltage: [1.1703765480706372, 0.8818029808135259, 0],
      power: [0, 0.44090149040676295, 0],
    },
    units: 'V; current density A/cm^2; R ohm cm^2; power density W/cm^2',
    method: 'polarization', ok: true,
    methodId: 'method-algo-pemfc-polarization', familyId: 'method-pemfc',
    scopeNote: 'Bounded zero-dimensional algebraic polarization model.',
  },
}

describe('PEMFC study exports', () => {
  it('writes every native sample in order and retains zero-voltage samples', () => {
    expect(pemfcStudyCsv(result)).toBe([
      '"current_density_A_cm2","cell_voltage_V","power_density_W_cm2"',
      '"0","1.1703765480706372","0"',
      '"0.5","0.8818029808135259","0.44090149040676296"',
      '"1","0","0"',
      '',
    ].join('\r\n'))
  })

  it('captures the study snapshot, units, provenance, floor, scope, and sampled maximum', () => {
    const report = pemfcStudyReport({ draft, input, result, jobId: 'job-pemfc-1' })
    const parsed = JSON.parse(report)

    expect(parsed).toMatchObject({ schemaVersion: 1, jobId: 'job-pemfc-1', draft, input, result })
    expect(parsed.units).toMatchObject({ temperature: 'K', pressure: 'atm', currentDensity: 'A/cm^2', resistance: 'ohm cm^2', voltage: 'V', powerDensity: 'W/cm^2' })
    expect(parsed.sampledMaximumPower).toEqual({
      currentDensity: 0.5,
      voltage: 0.8818029808135259,
      powerDensity: 0.44090149040676295,
      sampleIndex: 1,
      interpretation: 'Maximum among returned native samples only; not optimized or a continuous maximum.',
    })
    expect(parsed.boundaries.voltageFloor).toMatch(/truncated at 0 V.*retained/i)
    expect(parsed.boundaries.sampledMaximum).toMatch(/not an optimized or continuous maximum/i)
    expect(parsed.boundaries.efficiency).toMatch(/not system or fuel efficiency/i)
    expect(parsed.boundaries.export).toMatch(/not a \.mph file or COMSOL interchange format/i)
    expect(report.endsWith('\n')).toBe(true)
  })

  it('handles a null job id and does not mutate captured export data', () => {
    const before = structuredClone({ draft, input, result })
    const parsed = JSON.parse(pemfcStudyReport({ draft, input, result, jobId: null }))

    pemfcStudyCsv(result)
    expect(parsed.jobId).toBeNull()
    expect({ draft, input, result }).toEqual(before)
  })
})

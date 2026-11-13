import { describe, expect, it } from 'vitest'
import { exchangerStudyCsv, exchangerStudyReport } from './exchanger-study-export'
import { createDefaultExchangerStudy, type ExchangerSweepInput } from './exchanger-study-input'
import type { ExchangerStudyCase, ExchangerStudyResult } from './exchanger-study-result'

const draft = createDefaultExchangerStudy()
const input: ExchangerSweepInput = {
  module: 'sw-openmodelica-heat-exchanger',
  backend: 'host',
  dynamic: false,
  arrangement: 'counterflow',
  Chot: 100,
  Ccold: 100,
  T_hot_in: 363.15,
  T_cold_in: 293.15,
  sweep_UA: [100, 200, 300],
}

const methodId = 'method-algo-sw-openmodelica-heat-exchanger' as const
const familyId = 'method-sw-openmodelica-heat-exchanger' as const
const cases: ExchangerStudyCase[] = [
  { model: 'steady-effectiveness-NTU', arrangement: 'counterflow', Chot: 100, Ccold: 100, UA: 100, Cmin: 100, Cmax: 100, Cr: 1, NTU: 1, effectiveness: 0.5, T_hot_in: 363.15, T_cold_in: 293.15, Q: 3500, T_hot_out: 328.15, T_cold_out: 328.15, hotLoss: 3500, coldGain: 3500, energyBalance: 'hotLoss == coldGain == Q', methodId, familyId },
  { model: 'steady-effectiveness-NTU', arrangement: 'counterflow', Chot: 100, Ccold: 100, UA: 200, Cmin: 100, Cmax: 100, Cr: 1, NTU: 2, effectiveness: 2 / 3, T_hot_in: 363.15, T_cold_in: 293.15, Q: 14000 / 3, T_hot_out: 363.15 - 140 / 3, T_cold_out: 293.15 + 140 / 3, hotLoss: 14000 / 3, coldGain: 14000 / 3, energyBalance: 'hotLoss == coldGain == Q', methodId, familyId },
  { model: 'steady-effectiveness-NTU', arrangement: 'counterflow', Chot: 100, Ccold: 100, UA: 300, Cmin: 100, Cmax: 100, Cr: 1, NTU: 3, effectiveness: 0.75, T_hot_in: 363.15, T_cold_in: 293.15, Q: 5250, T_hot_out: 310.65, T_cold_out: 345.65, hotLoss: 5250, coldGain: 5250, energyBalance: 'hotLoss == coldGain == Q', methodId, familyId },
]
const result: ExchangerStudyResult = { backend: 'w-sim-cuda-host', cases }

describe('exchanger study exports', () => {
  it('writes the exact unit-bearing CSV header and one row per native UA in order, retaining native zero values', () => {
    const zeroResult: ExchangerStudyResult = {
      backend: 'w-sim-cuda-host',
      cases: [{ ...cases[0], UA: 100, NTU: 1, effectiveness: 0, Q: 0, T_hot_out: 363.15, T_cold_out: 293.15, hotLoss: 0, coldGain: 0 }],
    }
    expect(exchangerStudyCsv(zeroResult)).toBe([
      '"model","arrangement","Chot_W_per_K","Ccold_W_per_K","UA_W_per_K","Cmin_W_per_K","Cmax_W_per_K","Cr_dimensionless","NTU_dimensionless","effectiveness_dimensionless","T_hot_in_K","T_cold_in_K","Q_W","T_hot_out_K","T_cold_out_K","hotLoss_W","coldGain_W","energyBalance","methodId","familyId"',
      '"steady-effectiveness-NTU","counterflow","100","100","100","100","100","1","1","0","363.15","293.15","0","363.15","293.15","0","0","hotLoss == coldGain == Q","method-algo-sw-openmodelica-heat-exchanger","method-sw-openmodelica-heat-exchanger"',
      '',
    ].join('\r\n'))

    const csv = exchangerStudyCsv(result)
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[0]).toBe('"model","arrangement","Chot_W_per_K","Ccold_W_per_K","UA_W_per_K","Cmin_W_per_K","Cmax_W_per_K","Cr_dimensionless","NTU_dimensionless","effectiveness_dimensionless","T_hot_in_K","T_cold_in_K","Q_W","T_hot_out_K","T_cold_out_K","hotLoss_W","coldGain_W","energyBalance","methodId","familyId"')
    expect(lines).toHaveLength(4)
    expect(lines.slice(1).map(line => line.split(',')[4])).toEqual(['"100"', '"200"', '"300"'])
    expect(lines[1]).toContain('"3500"')
    expect(lines[2]).toContain('"4666.666666666667"')
    expect(lines[3]).toContain('"5250"')
  })

  it('captures the supplied draft, exact input, native result, job id, schema, units, and scope boundary in JSON', () => {
    const report = exchangerStudyReport({ draft, input, result, jobId: 'job-123' })
    expect(exchangerStudyReport({ draft, input, result, jobId: 'job-123' })).toBe(report)
    const parsed = JSON.parse(report)
    expect(parsed).toMatchObject({ schemaVersion: 1, jobId: 'job-123', draft, input, result })
    expect(parsed.scope).toMatchObject({
      study: 'steady-effectiveness-NTU-UA-parameter-sweep',
      included: expect.stringMatching(/native host-f64 results/i),
      excluded: expect.stringMatching(/not a Dymola interchange format/i),
    })
    expect(parsed.units).toEqual({ capacityRate: 'W/K', UA: 'W/K', temperature: 'K', heat: 'W', effectiveness: 'dimensionless', NTU: 'dimensionless' })
    expect(report).toMatch(/does not represent general Modelica experiment automation/)
    expect(report.endsWith('\n')).toBe(true)
  })

  it('does not mutate captured study data while exporting', () => {
    const capturedDraft = structuredClone(draft)
    const capturedInput = structuredClone(input)
    const capturedResult = structuredClone(result)
    exchangerStudyCsv(result)
    exchangerStudyReport({ draft, input, result, jobId: null })
    expect(draft).toEqual(capturedDraft)
    expect(input).toEqual(capturedInput)
    expect(result).toEqual(capturedResult)
  })
})

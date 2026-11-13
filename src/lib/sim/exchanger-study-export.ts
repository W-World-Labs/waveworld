import type { ExchangerStudyDraft, ExchangerSweepInput } from './exchanger-study-input'
import type { ExchangerStudyResult } from './exchanger-study-result'

/** Export values returned by the native UA sweep, with units in every column name. */
export function exchangerStudyCsv(result: ExchangerStudyResult): string {
  const header = [
    'model', 'arrangement', 'Chot_W_per_K', 'Ccold_W_per_K', 'UA_W_per_K',
    'Cmin_W_per_K', 'Cmax_W_per_K', 'Cr_dimensionless', 'NTU_dimensionless',
    'effectiveness_dimensionless', 'T_hot_in_K', 'T_cold_in_K', 'Q_W',
    'T_hot_out_K', 'T_cold_out_K', 'hotLoss_W', 'coldGain_W',
    'energyBalance', 'methodId', 'familyId',
  ]
  const rows = result.cases.map(item => [
    item.model,
    item.arrangement,
    item.Chot,
    item.Ccold,
    item.UA,
    item.Cmin,
    item.Cmax,
    item.Cr,
    item.NTU,
    item.effectiveness,
    item.T_hot_in,
    item.T_cold_in,
    item.Q,
    item.T_hot_out,
    item.T_cold_out,
    item.hotLoss,
    item.coldGain,
    item.energyBalance,
    item.methodId,
    item.familyId,
  ])
  return [header, ...rows]
    .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))
    .join('\r\n') + '\r\n'
}

/** Capture the submitted guided study and native output in a standalone JSON report. */
export function exchangerStudyReport(args: {
  draft: ExchangerStudyDraft
  input: ExchangerSweepInput
  result: ExchangerStudyResult
  jobId: string | null
}): string {
  return JSON.stringify({
    schemaVersion: 1,
    jobId: args.jobId,
    scope: {
      study: 'steady-effectiveness-NTU-UA-parameter-sweep',
      included: 'Guided steady-state exchanger UA sweep using native host-f64 results.',
      excluded: 'This report is not a Dymola interchange format and does not represent general Modelica experiment automation.',
    },
    units: {
      capacityRate: 'W/K',
      UA: 'W/K',
      temperature: 'K',
      heat: 'W',
      effectiveness: 'dimensionless',
      NTU: 'dimensionless',
    },
    draft: args.draft,
    input: args.input,
    result: args.result,
  }, null, 2) + '\n'
}

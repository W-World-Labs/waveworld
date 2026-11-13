import type { PidStudyDraft, PidStudyInput } from './dymola-pid-study-input'
import type { PidStudyResult } from './dymola-pid-study-result'

function csvField(value: unknown): string {
  return `"${String(value).replace(/"/g, '""')}"`
}

/** Export the returned W-Sim samples in their original order, with units in each column. */
export function pidStudyCsv(result: PidStudyResult): string {
  const rows: unknown[][] = [
    ['time_s', 'output_dimensionless'],
    ...result.times.map((time, index) => [time, result.output[index]]),
  ]
  return rows.map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}

/** Capture the submitted PI study, native output, and the limits of this small host calculation. */
export function pidStudyReport(args: {
  draft: PidStudyDraft
  input: PidStudyInput
  result: PidStudyResult
  jobId: string | null
}): string {
  return JSON.stringify({
    schemaVersion: 1,
    jobId: args.jobId,
    scope: {
      study: 'bounded-first-order-plant-with-PI-feedback',
      included: 'Native returned times and output from the W-Sim host-f64 state-space operation for the bounded first-order PI study.',
      excluded: 'This is not a Dymola exchange or execution report and makes no test, vendor, or GPU parity claim.',
    },
    units: {
      time: 's',
      output: 'dimensionless',
    },
    provenance: {
      backend: args.result.backend,
      methodId: args.result.methodId,
      operation: 'W-Sim host-f64 state-space operation',
    },
    draft: args.draft,
    input: args.input,
    result: args.result,
  }, null, 2) + '\n'
}

import type { AnsysModalStudyInput } from './ansys-modal-study-input'
import type { AnsysModalStudyResult } from './ansys-modal-study-result'

const MODULE_PIN = 'dda2f6f1e1def3d9a49bea48c8766d222b2d8a14'
const SCOPE_DISCLAIMER = 'W-Sim host modal calculation only. This report does not represent an ANSYS Mechanical project, mesh, vendor execution, or parity result.'

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/** Export the validated native modal modes without recomputing solver quantities. */
export function ansysModalStudyCsv(result: AnsysModalStudyResult): string {
  const header = [
    'mode',
    'eigenvalue',
    'frequency_Hz',
    'angular_frequency_rad_s',
    'period_s',
    'modal_mass',
    'participation_factor',
    'cumulative_effective_mass_ratio',
  ]
  const rows = result.eigenvalues.map((eigenvalue, index) => {
    return [
      String(index + 1),
      String(eigenvalue),
      String(result.frequenciesHz[index]),
      String(result.frequenciesRadS[index]),
      String(result.periodsS[index]),
      String(result.modalMass[index]),
      String(result.participationFactors[index]),
      String(result.effectiveMassRatio[index]),
    ]
  })

  return [header, ...rows].map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}

/** Build a stable, portable snapshot of the submitted input and native result. */
export function ansysModalStudyReport(args: {
  input: AnsysModalStudyInput
  result: AnsysModalStudyResult
  jobId: string | null
}): string {
  return JSON.stringify({
    schemaVersion: 1,
    projectName: 'ANSYS Modal Study',
    jobId: args.jobId,
    modulePin: MODULE_PIN,
    input: args.input,
    result: args.result,
    scopeDisclaimer: SCOPE_DISCLAIMER,
  }, null, 2) + '\n'
}

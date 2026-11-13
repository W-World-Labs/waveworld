import type { AnsysThermalStudyInput } from './ansys-thermal-study-input'
import type { AnsysThermalStudyResult } from './ansys-thermal-study-result'

const MODULE_PIN = 'dda2f6f1e1def3d9a49bea48c8766d222b2d8a14'
const SCOPE_DISCLAIMER = 'W-Sim host-f64 1D bar conduction result only. This report does not represent an ANSYS Mechanical project, vendor execution, or vendor parity.'

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/** Export the validated final nodal temperatures and available native reactions. */
export function ansysThermalStudyCsv(input: AnsysThermalStudyInput, result: AnsysThermalStudyResult, externalNodeLabels?: readonly number[]): string {
  const header = ['node_index', ...(externalNodeLabels ? ['external_node_id'] : []), 'position_m', 'temperature_C', 'reaction_W']
  const rows = result.result.temperatures.map((temperature, nodeIndex) => [
    String(nodeIndex),
    ...(externalNodeLabels ? [String(externalNodeLabels[nodeIndex] ?? '')] : []),
    String(input.mesh.nodes[nodeIndex]?.[0]),
    String(temperature),
    String(result.result.reactions[nodeIndex]),
  ])
  return [header, ...rows].map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}

/** Build a stable portable snapshot of the submitted input and validated native result. */
export function ansysThermalStudyReport(args: {
  input: AnsysThermalStudyInput
  result: AnsysThermalStudyResult
  jobId: string | null
  sourceApdl?: string
  externalNodeLabels?: readonly number[]
}): string {
  return JSON.stringify({
    schemaVersion: 1,
    projectName: 'ANSYS Thermal Study',
    jobId: args.jobId,
    modulePin: MODULE_PIN,
    input: args.input,
    ...(args.sourceApdl === undefined ? {} : {
      sourceApdl: args.sourceApdl,
      externalNodeLabels: args.externalNodeLabels ?? [],
    }),
    nativeResult: args.result,
    scopeDisclaimer: SCOPE_DISCLAIMER,
  }, null, 2) + '\n'
}

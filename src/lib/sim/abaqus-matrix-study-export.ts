import type { AnsysModalStudyResult } from './ansys-modal-study-result'

export type AbaqusMatrixDof = { node: string | number; dof: string }

const SCOPE = 'W-Sim host-f64 assembled-matrix modal analysis using sw-ansys-modal. No Abaqus solve, Ansys solve, or vendor parity is represented.'
const UNIT_ASSUMPTION = 'The .mtx input has no unit metadata. Matrix values are passed unchanged with no conversion or unit inference. The paired stiffness and mass matrices are assumed to use one consistent unit system and a seconds timebase; reported frequencies and periods are interpreted under that assumption. No force, length, mass, or rotational-DOF units are asserted.'

function csvCell(value: unknown): string {
  const text = value === null || value === undefined
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(',')
}

function validateShapeMapping(result: AnsysModalStudyResult, dofMap: readonly AbaqusMatrixDof[]): void {
  if (!Array.isArray(dofMap) || dofMap.length !== result.n) throw new Error(`DOF map must contain exactly ${result.n} entries`)
  dofMap.forEach((entry, index) => {
    if (!entry || (typeof entry.node !== 'string' && typeof entry.node !== 'number') || String(entry.node).trim() === '' || typeof entry.dof !== 'string' || !entry.dof.trim()) {
      throw new Error(`DOF map entry ${index} must contain a node and DOF label`)
    }
  })
  if (!Array.isArray(result.modeShapes) || result.modeShapes.length !== result.numModes || result.modeShapes.some(shape => !Array.isArray(shape) || shape.length !== dofMap.length)) {
    throw new Error('mode shape dimensions do not match the DOF map')
  }
}

/** Map each native mode-vector component to its submitted node/DOF label. This is tabular data, not geometric visualization. */
export function abaqusMatrixStudyCsv(args: {
  result: AnsysModalStudyResult
  dofMap: readonly AbaqusMatrixDof[]
}): string {
  const { result, dofMap } = args
  validateShapeMapping(result, dofMap)
  const header = [
    'mode', 'eigenvalue', 'frequency_Hz', 'angular_frequency_rad_s', 'period_s',
    'participation_factor', 'effective_mass', 'effective_mass_ratio',
    ...dofMap.map(item => `mode_shape_node_${item.node}_dof_${item.dof}`),
  ]
  const rows = result.eigenvalues.map((eigenvalue, mode) => [
    mode + 1,
    eigenvalue,
    result.frequenciesHz[mode],
    result.frequenciesRadS[mode],
    result.periodsS[mode],
    result.participationFactors[mode],
    result.effectiveMass[mode],
    result.effectiveMassRatio[mode],
    ...result.modeShapes[mode],
  ])
  return [
    csvRow(['metadata', 'unit_assumption', UNIT_ASSUMPTION]),
    csvRow(header),
    ...rows.map(csvRow),
  ].join('\r\n') + '\r\n'
}

/** Preserve the submitted matrix/settings and source-file metadata beside the validated native output. */
export function abaqusMatrixStudyReport(args: {
  input: unknown
  dofMap: readonly AbaqusMatrixDof[]
  files: readonly { name: string; sizeBytes: number }[]
  result: AnsysModalStudyResult
  jobId: string | null
}): string {
  validateShapeMapping(args.result, args.dofMap)
  if (!Array.isArray(args.files) || args.files.some(file => !file || typeof file.name !== 'string' || !file.name || !Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0)) {
    throw new Error('input files must include exact names and non-negative byte sizes')
  }
  return JSON.stringify({
    schemaVersion: 1,
    study: 'Abaqus matrix modal study',
    jobId: args.jobId,
    scope: SCOPE,
    unitAssumption: UNIT_ASSUMPTION,
    inputFiles: args.files,
    input: args.input,
    dofMap: args.dofMap,
    result: args.result,
  }, null, 2) + '\n'
}

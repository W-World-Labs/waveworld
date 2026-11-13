/** CSV and standalone JSON reports for the guided Abaqus-mapped B31 study. */

type StudyRecord = Record<string, unknown>

function record(value: unknown): StudyRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as StudyRecord
    : {}
}

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

/** Export readable node, reaction, and element rows while retaining each native record verbatim. */
export function abaqusBeamStudyCsv(args: {
  draft: unknown
  input: unknown
  result: unknown
  jobId: string | null
}): string {
  const result = record(args.result)
  const header = [
    'record_type', 'index', 'job_id', 'backend', 'x_m', 'v_m', 'theta_rad',
    'node', 'force_x_N', 'force_y_N', 'moment_Nm', 'element', 'native_record_json',
  ]
  const rows: unknown[][] = [
    ['study_metadata', '', args.jobId, result.backend, '', '', '', '', '', '', '', '', JSON.stringify({
      study: 'abaqus-mapped-b31-cantilever-beam',
      calculation: 'W-Sim native host-f64',
      scope: 'Guided linear-elastic 2D B31 cantilever study; no Abaqus execution or parity claim.',
      draft: args.draft,
      input: args.input,
      nativeResult: args.result,
    })],
  ]

  const nodes = Array.isArray(result.nodes) ? result.nodes : []
  nodes.forEach((raw, index) => {
    const node = record(raw)
    rows.push(['node', index, args.jobId, result.backend, node.x, node.v, node.theta, node.node, '', '', '', '', raw])
  })

  const reactions = Array.isArray(result.reactions) ? result.reactions : []
  reactions.forEach((raw, index) => {
    const item = record(raw)
    rows.push(['reaction', index, args.jobId, result.backend, '', '', '', item.node, item.forceX ?? item.fx, item.forceY ?? item.fy, item.moment ?? item.mz, '', raw])
  })

  const elements = Array.isArray(result.elements) ? result.elements : []
  elements.forEach((raw, index) => {
    const item = record(raw)
    rows.push(['element', index, args.jobId, result.backend, '', '', '', '', '', '', '', item.element ?? item.index, raw])
  })

  if (result.closedForm !== null && result.closedForm !== undefined) {
    rows.push(['textbook_comparison', '', args.jobId, result.backend, '', '', '', '', '', '', '', '', result.closedForm])
  }

  return [header, ...rows].map(csvRow).join('\r\n') + '\r\n'
}

/** Capture the immutable submitted draft, exact native input, provenance, and parsed native output. */
export function abaqusBeamStudyReport(args: {
  draft: unknown
  input: unknown
  result: unknown
  jobId: string | null
}): string {
  return JSON.stringify({
    schemaVersion: 1,
    jobId: args.jobId,
    scope: {
      study: 'abaqus-mapped-b31-cantilever-beam',
      calculation: 'W-Sim native host-f64 calculation using the pinned sw-calculix-timoshenko-beam module.',
      included: 'A guided 2D, 2-node linear Timoshenko B31 cantilever with uniform linear-elastic section and one transverse tip point load or uniform distributed load.',
      excluded: 'This report does not represent Abaqus execution, general Abaqus input-file import, full B31/CalculiX/Abaqus parity, certified design, nonlinear or dynamic analysis, or unsupported boundary/load cases.',
      closedForm: 'If present, closedForm is the native-reported textbook comparison for its supported canonical load case; it is not an Abaqus oracle.',
    },
    units: {
      length: 'm',
      elasticModulus: 'Pa',
      area: 'm^2',
      secondMomentOfArea: 'm^4',
      pointLoad: 'N',
      distributedLoad: 'N/m',
      displacement: 'm',
      rotation: 'rad',
      force: 'N',
      moment: 'N m',
    },
    provenance: {
      solver: 'W-Sim native host-f64',
      module: 'sw-calculix-timoshenko-beam',
      modulePin: 'dda2f6f1',
      jobId: args.jobId,
    },
    draft: args.draft,
    input: args.input,
    result: args.result,
  }, null, 2) + '\n'
}

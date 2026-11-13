/**
 * App-defined exports for imported STAR-CCM+ convergence history and the
 * independent native convergence diagnostic. These contents are not a
 * STAR-CCM+ native report, CSV, or solver export.
 */

export interface StarCcmConvergenceHistorySeries {
  name: string
  values: readonly (number | null)[]
}

export interface StarCcmConvergenceExportInput {
  /** Caller-provided input that accompanied the imported history. */
  importedInput: unknown
  /** Labels are preserved verbatim (for example, imported iteration numbers). */
  iterationLabels: readonly (string | number)[]
  /** Imported history values, indexed to iterationLabels. */
  series: readonly StarCcmConvergenceHistorySeries[]
  /** Result from the independent sw-ansys-report method=convergence diagnostic. */
  nativeDiagnosticResult: unknown
}

export interface StarCcmConvergenceExportContents {
  report: Record<string, unknown>
  json: string
  csv: string
}

// Long-form rows repeat series names and iteration labels, so the export cap
// is larger than the bounded import file while still limiting local output.
const MAX_CSV_BYTES = 8 * 1024 * 1024
const MAX_ITERATIONS = 5_000
const MAX_SERIES = 16
const MAX_HISTORY_CELLS = 80_000

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function assertInput(input: StarCcmConvergenceExportInput): void {
  if (input.iterationLabels.length > MAX_ITERATIONS) {
    throw new RangeError(`Convergence export supports at most ${MAX_ITERATIONS} imported iterations`)
  }
  if (input.series.length > MAX_SERIES) {
    throw new RangeError(`Convergence export supports at most ${MAX_SERIES} history series`)
  }
  if (input.iterationLabels.length * input.series.length > MAX_HISTORY_CELLS) {
    throw new RangeError(`Convergence export supports at most ${MAX_HISTORY_CELLS} history cells`)
  }
  if (input.series.some(series => series.values.length !== input.iterationLabels.length)) {
    throw new RangeError('Each history series must have one value per imported iteration label')
  }
}

/**
 * Package imported history and the native diagnostic into JSON plus an
 * app-defined long-form CSV. The output records provenance and does not claim
 * STAR-CCM+ native CSV/export compatibility or vendor solver equivalence.
 */
export function createStarCcmConvergenceExportContents(
  input: StarCcmConvergenceExportInput,
): StarCcmConvergenceExportContents {
  assertInput(input)

  const report: Record<string, unknown> = {
    schema: 'waveworld.starccm-convergence-report.v1',
    format: 'WaveWorld app-defined convergence report; JSON/CSV are not STAR-CCM+ native exports.',
    provenance: {
      history: 'User-imported convergence history; iteration labels are preserved as supplied.',
      diagnostic: 'Independent W-Sim native sw-ansys-report method=convergence diagnostic.',
      vendorValidation: 'No STAR-CCM+ execution or numerical-equivalence claim is made.',
    },
    importedInput: input.importedInput,
    iterationLabels: input.iterationLabels,
    series: input.series,
    nativeDiagnosticResult: input.nativeDiagnosticResult,
  }

  const csvRows: unknown[][] = [
    ['record_type', 'iteration', 'series', 'value', 'details_json'],
    ['format', '', '', '', 'WaveWorld app-defined convergence table; not a STAR-CCM+ native CSV/export.'],
    ['imported_input', '', '', '', JSON.stringify(input.importedInput)],
  ]
  for (const series of input.series) {
    for (let iterationIndex = 0; iterationIndex < input.iterationLabels.length; iterationIndex += 1) {
      csvRows.push([
        'history',
        input.iterationLabels[iterationIndex],
        series.name,
        series.values[iterationIndex],
        '',
      ])
    }
  }
  csvRows.push(['native_diagnostic', '', '', '', JSON.stringify(input.nativeDiagnosticResult)])
  const csv = csvRows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
  if (new TextEncoder().encode(csv).byteLength > MAX_CSV_BYTES) {
    throw new RangeError(`Convergence CSV export exceeds ${MAX_CSV_BYTES} bytes`)
  }

  return { report, json: JSON.stringify(report, null, 2), csv }
}

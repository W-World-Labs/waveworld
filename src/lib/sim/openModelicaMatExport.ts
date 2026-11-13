import type { MatResultSignal, ModelicaMatResult } from './openModelicaMatResult'

function csvField(value: unknown): string {
  return `"${String(value).replace(/"/g, '""')}"`
}

function csvRows(rows: unknown[][]): string {
  return rows.map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}

function selectedSignals(result: ModelicaMatResult, signalName?: string): MatResultSignal[] {
  if (signalName === undefined) return result.signals
  const signal = result.signals.find(candidate => candidate.name === signalName)
  if (!signal) throw new Error(`Unknown Modelica MAT signal: ${signalName}`)
  return [signal]
}

/** Export MAT samples as reported, preserving order and duplicate time rows. */
export function resultToCsv(result: ModelicaMatResult, signalName?: string): string {
  const signals = selectedSignals(result, signalName)
  if (signalName !== undefined) {
    const signal = signals[0]
    if (!signal) return csvRows([['time_s', 'signal', 'description', 'value']])
    if (signal.kind === 'parameter') {
      const rows: unknown[][] = [['row', 'signal', 'description', 'value']]
      signal.values.forEach((value, index) => {
        rows.push([index === 0 ? 'initial' : index === signal.values.length - 1 ? 'final' : `value_${index + 1}`, signal.name, signal.description, value])
      })
      return csvRows(rows)
    }
    const rows: unknown[][] = [['time_s', 'signal', 'description', 'value']]
    signal.values.forEach((value, index) => rows.push([result.time[index], signal.name, signal.description, value]))
    return csvRows(rows)
  }

  const rows: unknown[][] = [['signal', 'kind', 'description', 'time_s', 'value']]
  for (const signal of signals) {
    signal.values.forEach((value, index) => {
      if (signal.kind === 'parameter') {
        const label = index === 0 ? 'initial' : index === signal.values.length - 1 ? 'final' : `value_${index + 1}`
        rows.push([signal.name, signal.kind, signal.description, label, value])
      } else {
        rows.push([signal.name, signal.kind, signal.description, result.time[index], value])
      }
    })
  }
  return csvRows(rows)
}

/** Export the parsed MAT snapshot without implying that a solver verified it. */
export function resultToJson(result: ModelicaMatResult, signalName?: string): string {
  const signals = selectedSignals(result, signalName)
  return JSON.stringify({
    source: 'local-mat-v4-result',
    verification: 'Parsed MAT data; solver behavior and numerical correctness are not verified.',
    layout: result.layout,
    sampleCount: result.sampleCount,
    duplicateTimesPreserved: true,
    time: result.time,
    ...(signalName === undefined ? {} : { signalName }),
    signals,
  }, null, 2) + '\n'
}

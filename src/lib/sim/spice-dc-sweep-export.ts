import type { SpiceDcSweepResult } from './spice-import-adapter'

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/** Export every returned node series as CSV, preserving solver values verbatim. */
export function buildSpiceDcSweepCsv(result: SpiceDcSweepResult): string {
  const nodeNames = Object.keys(result.points[0]?.nodeVoltages ?? {}).sort((left, right) => (
    left < right ? -1 : left > right ? 1 : 0
  ))
  const header = [
    'Sweep voltage (V)',
    ...nodeNames.map((name) => `'Node ${name} voltage (V)`),
  ]
  const rows = result.points.map((point) => [
    String(point.value),
    ...nodeNames.map((name) => String(point.nodeVoltages[name])),
  ])

  return [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}

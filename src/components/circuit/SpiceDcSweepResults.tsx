import { useMemo, useState } from 'react'
import type { SpiceDcSweepResult } from '../../lib/sim/spice-import-adapter'
import { buildSpiceDcSweepCsv } from '../../lib/sim/spice-dc-sweep-export'

type Props = { result: SpiceDcSweepResult }

const COLORS = ['#2563eb', '#dc2626', '#059669', '#9333ea', '#d97706', '#0891b2']

/** Plot and inspect the voltages returned by the native MNA DC-sweep solver. */
export function SpiceDcSweepResults({ result }: Props) {
  const nodes = useMemo(() => Object.keys(result.points[0]?.nodeVoltages ?? {}).sort(), [result])
  const [selectedNode, setSelectedNode] = useState('')
  const node = nodes.includes(selectedNode) ? selectedNode : (nodes[0] ?? '')
  const series = result.points.map((point) => ({ x: point.value, y: point.nodeVoltages[node] ?? 0 }))

  const xValues = series.map((point) => point.x)
  const yValues = series.map((point) => point.y)
  const minX = Math.min(...xValues)
  const maxX = Math.max(...xValues)
  const minY = Math.min(0, ...yValues)
  const maxY = Math.max(0, ...yValues)
  const xSpan = maxX - minX || 1
  const ySpan = maxY - minY || 1
  const chart = { left: 58, right: 620, top: 18, bottom: 250 }
  const x = (value: number) => chart.left + ((value - minX) / xSpan) * (chart.right - chart.left)
  const y = (value: number) => chart.bottom - ((value - minY) / ySpan) * (chart.bottom - chart.top)
  const path = series.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.x)} ${y(point.y)}`).join(' ')
  const color = COLORS[Math.max(0, nodes.indexOf(node)) % COLORS.length]

  function exportCsv() {
    const blob = new Blob([buildSpiceDcSweepCsv(result)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'spice-dc-sweep.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section data-testid="spice-dc-sweep-results" aria-label="SPICE DC sweep results" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Selected node
          <select
            data-testid="spice-dc-sweep-node"
            aria-label="Selected node"
            value={node}
            onChange={(event) => setSelectedNode(event.target.value)}
            className="rounded border px-2 py-1"
          >
            {nodes.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <button
          type="button"
          data-testid="spice-dc-sweep-csv"
          onClick={exportCsv}
          className="rounded border px-3 py-1.5 text-sm"
        >
          Export all nodes as CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded border p-2">
        <svg viewBox="0 0 660 300" role="img" aria-label={`Voltage at node ${node} versus swept voltage`} className="h-auto min-w-[520px] w-full">
          <line x1={chart.left} y1={chart.bottom} x2={chart.right} y2={chart.bottom} stroke="currentColor" />
          <line x1={chart.left} y1={chart.top} x2={chart.left} y2={chart.bottom} stroke="currentColor" />
          <path d={path} fill="none" stroke={color} strokeWidth="2.5" />
          {series.map((point, index) => (
            <circle key={`${point.x}-${index}`} cx={x(point.x)} cy={y(point.y)} r="4" fill={color} />
          ))}
          <text x={(chart.left + chart.right) / 2} y="288" textAnchor="middle" fontSize="12">Swept voltage (V)</text>
          <text x="14" y={(chart.top + chart.bottom) / 2} textAnchor="middle" fontSize="12" transform={`rotate(-90 14 ${(chart.top + chart.bottom) / 2})`}>Node voltage (V)</text>
          <text x={chart.left} y="270" textAnchor="middle" fontSize="11">{minX.toPrecision(4)}</text>
          <text x={chart.right} y="270" textAnchor="middle" fontSize="11">{maxX.toPrecision(4)}</text>
          <text x="52" y={chart.bottom} textAnchor="end" fontSize="11">{minY.toPrecision(4)}</text>
          <text x="52" y={chart.top + 4} textAnchor="end" fontSize="11">{maxY.toPrecision(4)}</text>
        </svg>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" aria-label={`Sweep values and voltage at node ${node}`}>
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="px-2 py-1">Swept voltage (V)</th>
              <th scope="col" className="px-2 py-1">Node {node} voltage (V)</th>
            </tr>
          </thead>
          <tbody>
            {result.points.map((point, index) => (
              <tr key={`${point.value}-${index}`} className="border-b">
                <td className="px-2 py-1">{point.value}</td>
                <td className="px-2 py-1">{point.nodeVoltages[node]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details>
        <summary className="cursor-pointer text-sm">Solver provenance</summary>
        <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="font-medium">Method</dt><dd>{result.methodId}</dd>
          <dt className="font-medium">Family</dt><dd>{result.familyId}</dd>
          <dt className="font-medium">Swept source index</dt><dd>{result.sweepSource}</dd>
          <dt className="font-medium">Backend report</dt><dd><code className="break-all">{JSON.stringify(result.backend)}</code></dd>
        </dl>
      </details>
    </section>
  )
}

import type { PemfcStudyResult } from '../../lib/sim/pemfc-study-result'

export type PemfcPlotMetric = 'voltage' | 'power'

type Props = { result: PemfcStudyResult; metric: PemfcPlotMetric }

function format(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(4)).toString() : '—'
}

/** Plot only the voltage or power samples returned by the native study. */
export function PemfcStudyPlot({ result, metric }: Props) {
  const { current, voltage, power } = result.result.curve
  const width = 720
  const height = 300
  const left = 64
  const right = 18
  const top = 18
  const bottom = 58
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const values = metric === 'voltage' ? voltage : power
  const finiteCurrent = current.filter((value) => Number.isFinite(value) && value >= 0)
  const finiteValues = values.filter((value) => Number.isFinite(value) && value >= 0)
  const maxCurrent = Math.max(0, ...finiteCurrent)
  const maxValue = Math.max(0, ...finiteValues)
  // A positive range keeps a flat zero curve drawable while both axes still start at zero.
  const xMax = maxCurrent > 0 ? maxCurrent : 1
  const yMax = maxValue > 0 ? maxValue * 1.08 : 1
  const x = (value: number) => left + value / xMax * plotWidth
  const y = (value: number) => top + plotHeight - value / yMax * plotHeight
  const points = current.flatMap((density, index) => {
    const value = values[index]
    if (!Number.isFinite(density) || density < 0 || !Number.isFinite(value) || value < 0) return []
    return [`${x(density).toFixed(2)},${y(value).toFixed(2)}`]
  })
  const metricLabel = metric === 'voltage' ? 'Cell voltage' : 'Power density'
  const unit = metric === 'voltage' ? 'V' : 'W/cm²'
  const desc = `${metricLabel} by current density`

  return (
    <figure id="pemfc-study-plot" className="mt-4" aria-label={desc}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${desc}; current density in A/cm², ${metricLabel.toLowerCase()} in ${unit}`} className="h-64 w-full overflow-visible text-slate-500 dark:text-slate-400">
        <line x1={left} x2={width - right} y1={top + plotHeight} y2={top + plotHeight} stroke="currentColor" opacity="0.45" />
        <line x1={left} x2={left} y1={top} y2={top + plotHeight} stroke="currentColor" opacity="0.45" />
        <text x={left} y={top + 11} fontSize="11" fill="currentColor">{format(yMax)} {unit}</text>
        <text x={left} y={top + plotHeight - 5} fontSize="11" fill="currentColor">0</text>
        <text x={left} y={height - 28} fontSize="11" fill="currentColor">0</text>
        <text x={width - right} y={height - 28} textAnchor="end" fontSize="11" fill="currentColor">{format(xMax)}</text>
        {points.length > 0 && <polyline points={points.join(' ')} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        <text x={left + plotWidth / 2} y={height - 5} textAnchor="middle" fontSize="12" fill="currentColor">Current density (A/cm²)</text>
        <text x="14" y={top + plotHeight / 2} textAnchor="middle" fontSize="12" fill="currentColor" transform={`rotate(-90 14 ${top + plotHeight / 2})`}>{metricLabel} ({unit})</text>
      </svg>
    </figure>
  )
}

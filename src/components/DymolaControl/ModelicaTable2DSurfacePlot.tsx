import { useId } from 'react'

/**
 * A discrete view of supplied Modelica table data. Matrix rows correspond to
 * yAxis entries and columns correspond to xAxis entries; no values are sampled
 * or interpolated by this component.
 */
export type ModelicaTable2DSurfacePlotProps = {
  xAxis: readonly number[]
  yAxis: readonly number[]
  values: readonly (readonly number[])[]
  label: string
  xLabel: string
  yLabel: string
  valueLabel: string
}

const MAX_AXIS_SAMPLES = 40
const WIDTH = 820
const HEIGHT = 520
const LEFT = 90
const TOP = 36
const PLOT_WIDTH = 680
const PLOT_HEIGHT = 390

function format(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(4)).toString() : '—'
}

function color(value: number, min: number, max: number): string {
  if (!Number.isFinite(value)) return '#475569'
  const scale = Math.max(Math.abs(min), Math.abs(max), 1)
  const ratio = max === min ? 0.5 : Math.max(0, Math.min(1, (value / scale - min / scale) / (max / scale - min / scale)))
  const low = [30, 64, 175]
  const high = [239, 68, 68]
  const rgb = low.map((channel, index) => Math.round(channel + (high[index] - channel) * ratio))
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`
}

/** Displays a bounded discrete heatmap of provided axes and matrix values. */
export function ModelicaTable2DSurfacePlot({ xAxis, yAxis, values, label, xLabel, yLabel, valueLabel }: ModelicaTable2DSurfacePlotProps) {
  const id = useId()
  const titleId = `modelica-table-2d-title-${id}`
  const descriptionId = `modelica-table-2d-description-${id}`
  const columns = xAxis.slice(0, MAX_AXIS_SAMPLES)
  const rows = yAxis.slice(0, MAX_AXIS_SAMPLES)
  const finiteValues: number[] = []
  for (let row = 0; row < rows.length; row += 1) {
    for (let column = 0; column < columns.length; column += 1) {
      const value = values[row]?.[column]
      if (Number.isFinite(value)) finiteValues.push(value)
    }
  }
  const min = finiteValues.length ? Math.min(...finiteValues) : 0
  const max = finiteValues.length ? Math.max(...finiteValues) : 0
  const cellWidth = columns.length ? PLOT_WIDTH / columns.length : PLOT_WIDTH
  const cellHeight = rows.length ? PLOT_HEIGHT / rows.length : PLOT_HEIGHT
  const truncated = xAxis.length > columns.length || yAxis.length > rows.length

  return <div className="overflow-x-auto rounded border border-edge p-2">
    <svg
      data-testid="modelica-table-2d-surface-plot"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="h-auto min-w-[560px] w-full text-slate-400"
    >
      <title id={titleId}>{label}</title>
      <desc id={descriptionId}>{`${valueLabel} shown for ${rows.length} supplied ${yLabel} samples by ${columns.length} supplied ${xLabel} samples. Each cell is a provided matrix entry; no values are interpolated.${truncated ? ' Display limited to the first 40 samples on each axis.' : ''}`}</desc>
      {rows.map((yValue, row) => columns.map((xValue, column) => {
        const value = values[row]?.[column]
        const x = LEFT + column * cellWidth
        const y = TOP + (rows.length - 1 - row) * cellHeight
        return <rect
          key={`${row}-${column}`}
          data-testid="modelica-table-2d-cell"
          x={x}
          y={y}
          width={cellWidth}
          height={cellHeight}
          fill={color(value, min, max)}
          stroke="#cbd5e1"
          strokeOpacity="0.35"
          strokeWidth="0.6"
        >
          <title>{`${xLabel}: ${format(xValue)}; ${yLabel}: ${format(yValue)}; ${valueLabel}: ${format(value)}`}</title>
        </rect>
      }))}
      <rect x={LEFT} y={TOP} width={columns.length * cellWidth} height={rows.length * cellHeight} fill="none" stroke="currentColor" />
      {columns.length > 0 && <>
        <text x={LEFT} y={TOP + rows.length * cellHeight + 17} textAnchor="start" fontSize="11" fill="currentColor">{format(columns[0])}</text>
        {columns.length > 1 && <text x={LEFT + (columns.length - 1) * cellWidth + cellWidth} y={TOP + rows.length * cellHeight + 17} textAnchor="end" fontSize="11" fill="currentColor">{format(columns[columns.length - 1])}</text>}
      </>}
      {rows.length > 0 && <>
        <text x={LEFT - 8} y={TOP + rows.length * cellHeight - cellHeight / 2 + 4} textAnchor="end" fontSize="11" fill="currentColor">{format(rows[0])}</text>
        {rows.length > 1 && <text x={LEFT - 8} y={TOP + cellHeight / 2 + 4} textAnchor="end" fontSize="11" fill="currentColor">{format(rows[rows.length - 1])}</text>}
      </>}
      <text x={LEFT + PLOT_WIDTH / 2} y={TOP + PLOT_HEIGHT + 40} textAnchor="middle" fontSize="12" fill="currentColor">{xLabel}</text>
      <text x="18" y={TOP + PLOT_HEIGHT / 2} textAnchor="middle" fontSize="12" fill="currentColor" transform={`rotate(-90 18 ${TOP + PLOT_HEIGHT / 2})`}>{yLabel}</text>
      <text x={LEFT + PLOT_WIDTH + 24} y={TOP + 8} fontSize="10" fill="currentColor">{valueLabel}</text>
      <defs>
        <linearGradient id={`modelica-table-2d-gradient-${id}`} x1="0" x2="0" y1="1" y2="0">
          <stop offset="0%" stopColor="#1e40af" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <rect x={LEFT + PLOT_WIDTH + 24} y={TOP + 16} width="14" height="100" fill={`url(#modelica-table-2d-gradient-${id})`} />
      <text x={LEFT + PLOT_WIDTH + 44} y={TOP + 24} fontSize="10" fill="currentColor">{format(max)}</text>
      <text x={LEFT + PLOT_WIDTH + 44} y={TOP + 116} fontSize="10" fill="currentColor">{format(min)}</text>
      {finiteValues.length === 0 && <text x={LEFT + PLOT_WIDTH / 2} y={TOP + PLOT_HEIGHT / 2} textAnchor="middle" fontSize="13" fill="currentColor">No finite matrix values</text>}
      {truncated && <text x={LEFT} y={HEIGHT - 4} fontSize="10" fill="currentColor">Showing first 40 samples per axis</text>}
    </svg>
  </div>
}

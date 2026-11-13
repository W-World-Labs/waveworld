import type { ExchangerStudyCase } from '../../lib/sim/exchanger-study-result'

export type ExchangerPlotMetric = 'Q' | 'effectiveness' | 'T_hot_out' | 'T_cold_out'

type Props = {
  cases: ExchangerStudyCase[]
  metric: ExchangerPlotMetric
}

const METRICS: Record<ExchangerPlotMetric, { label: string; unit: string }> = {
  Q: { label: 'Heat transfer rate', unit: 'W' },
  effectiveness: { label: 'Effectiveness', unit: '1' },
  T_hot_out: { label: 'Hot outlet temperature', unit: 'K' },
  T_cold_out: { label: 'Cold outlet temperature', unit: 'K' },
}

const WIDTH = 720
const HEIGHT = 360
const CHART = { left: 76, right: 694, top: 24, bottom: 294 }

function paddedBounds(min: number, max: number, nonnegative: boolean): [number, number] {
  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.05, 1)
    return nonnegative ? [Math.max(0, min - padding), max + padding] : [min - padding, max + padding]
  }
  const padding = (max - min) * 0.05
  return [nonnegative ? Math.max(0, min - padding) : min - padding, max + padding]
}

function format(value: number): string {
  return Number(value.toPrecision(4)).toString()
}

export function ExchangerStudyPlot({ cases, metric }: Props) {
  const descriptor = METRICS[metric]
  const points = cases.map(item => ({ x: item.UA, y: item[metric] }))
  const nonnegative = metric === 'Q'
  const rawMinX = Math.min(...points.map(point => point.x))
  const rawMaxX = Math.max(...points.map(point => point.x))
  const rawMinY = Math.min(...points.map(point => point.y))
  const rawMaxY = Math.max(...points.map(point => point.y))
  const [minX, maxX] = points.length ? paddedBounds(rawMinX, rawMaxX, false) : [0, 1]
  const [minY, maxY] = points.length ? paddedBounds(rawMinY, rawMaxY, nonnegative) : [0, 1]
  const x = (value: number) => points.length === 1
    ? (CHART.left + CHART.right) / 2
    : CHART.left + ((value - minX) / (maxX - minX)) * (CHART.right - CHART.left)
  const y = (value: number) => CHART.bottom - ((value - minY) / (maxY - minY)) * (CHART.bottom - CHART.top)
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.x)} ${y(point.y)}`).join(' ')
  const titleId = 'exchanger-study-plot-title'

  return (
    <div className="overflow-x-auto rounded border border-edge p-2">
      <svg
        data-testid="exchanger-study-plot"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby={titleId}
        className="h-auto min-w-[520px] w-full text-slate-400"
      >
        <title id={titleId}>{descriptor.label} ({descriptor.unit}) versus UA (W/K)</title>
        {[0, 1, 2, 3, 4].map(index => {
          const ratio = index / 4
          const axisY = CHART.bottom - ratio * (CHART.bottom - CHART.top)
          const axisX = CHART.left + ratio * (CHART.right - CHART.left)
          return <g key={index}>
            <line x1={CHART.left} y1={axisY} x2={CHART.right} y2={axisY} stroke="currentColor" strokeOpacity="0.16" />
            <text x={CHART.left - 8} y={axisY + 4} textAnchor="end" fontSize="11" fill="currentColor">{format(minY + ratio * (maxY - minY))}</text>
            <text x={axisX} y={CHART.bottom + 20} textAnchor="middle" fontSize="11" fill="currentColor">{format(minX + ratio * (maxX - minX))}</text>
          </g>
        })}
        <line x1={CHART.left} y1={CHART.top} x2={CHART.left} y2={CHART.bottom} stroke="currentColor" />
        <line x1={CHART.left} y1={CHART.bottom} x2={CHART.right} y2={CHART.bottom} stroke="currentColor" />
        {points.length > 1 && <path d={path} fill="none" stroke="#0891b2" strokeWidth="2.5" />}
        {points.map((point, index) => <circle key={`${point.x}-${index}`} cx={x(point.x)} cy={y(point.y)} r="4" fill="#0891b2">
          <title>UA {format(point.x)} W/K; {descriptor.label} {format(point.y)} {descriptor.unit}</title>
        </circle>)}
        <text x={(CHART.left + CHART.right) / 2} y="348" textAnchor="middle" fontSize="12" fill="currentColor">UA (W/K)</text>
        <text x="16" y={(CHART.top + CHART.bottom) / 2} textAnchor="middle" fontSize="12" fill="currentColor" transform={`rotate(-90 16 ${(CHART.top + CHART.bottom) / 2})`}>{descriptor.label} ({descriptor.unit})</text>
        {points.length === 0 && <text x={(CHART.left + CHART.right) / 2} y={(CHART.top + CHART.bottom) / 2} textAnchor="middle" fontSize="13" fill="currentColor">No study cases</text>}
      </svg>
    </div>
  )
}

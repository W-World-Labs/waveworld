import { useId } from 'react'

type Props = {
  xSamples: readonly number[]
  ySamples: readonly number[]
  /** Accessible name for the plot. */
  label: string
  xLabel: string
  yLabel: string
}

const WIDTH = 720
const HEIGHT = 340
const CHART = { left: 76, right: 698, top: 22, bottom: 276 }
const TICKS = 4

type Point = { x: number; y: number; index: number }

function finiteRange(values: readonly number[]): { min: number; max: number; scale: number } | null {
  let min = Infinity
  let max = -Infinity
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  if (min === Infinity) return null
  // Normalize before subtracting so even ranges near Number.MAX_VALUE stay finite.
  return { min, max, scale: Math.max(Math.abs(min), Math.abs(max), 1) }
}

function fraction(value: number, range: NonNullable<ReturnType<typeof finiteRange>>): number {
  if (range.min === range.max) return 0.5
  const min = range.min / range.scale
  const max = range.max / range.scale
  return (value / range.scale - min) / (max - min)
}

function tickValue(range: NonNullable<ReturnType<typeof finiteRange>>, ratio: number): number {
  const min = range.min / range.scale
  const max = range.max / range.scale
  return (min + (max - min) * ratio) * range.scale
}

function format(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return Number(value.toPrecision(4)).toString()
}

/** Displays supplied Modelica table samples without generating or solving data. */
export function ModelicaTablePlot({ xSamples, ySamples, label, xLabel, yLabel }: Props) {
  const id = useId()
  const titleId = `modelica-table-plot-title-${id}`
  const descriptionId = `modelica-table-plot-description-${id}`
  const points: Point[] = []
  const count = Math.min(xSamples.length, ySamples.length)
  for (let index = 0; index < count; index += 1) {
    const x = xSamples[index]
    const y = ySamples[index]
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y, index })
  }

  const xRange = finiteRange(points.map(point => point.x))
  const yRange = finiteRange(points.map(point => point.y))
  const x = (value: number) => CHART.left + (xRange ? fraction(value, xRange) : 0.5) * (CHART.right - CHART.left)
  const y = (value: number) => CHART.bottom - (yRange ? fraction(value, yRange) : 0.5) * (CHART.bottom - CHART.top)

  // Draw only direct segments between adjacent finite input rows; invalid rows
  // create gaps instead of implying values that were not supplied.
  const paths: string[] = []
  let segment: Point[] = []
  for (let index = 0; index < count; index += 1) {
    const px = xSamples[index]
    const py = ySamples[index]
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      if (segment.length > 1) paths.push(segment.map((point, i) => `${i === 0 ? 'M' : 'L'} ${x(point.x)} ${y(point.y)}`).join(' '))
      segment = []
    } else {
      segment.push({ x: px, y: py, index })
    }
  }
  if (segment.length > 1) paths.push(segment.map((point, i) => `${i === 0 ? 'M' : 'L'} ${x(point.x)} ${y(point.y)}`).join(' '))

  return (
    <div className="overflow-x-auto rounded border border-edge p-2">
      <svg
        data-testid="modelica-table-plot"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="h-auto min-w-[520px] w-full text-slate-400"
      >
        <title id={titleId}>{label}</title>
        <desc id={descriptionId}>{`${yLabel} plotted against ${xLabel} from ${points.length} finite supplied sample${points.length === 1 ? '' : 's'}.`}</desc>
        {[0, 1, 2, 3, 4].map(index => {
          const ratio = index / TICKS
          const axisY = CHART.bottom - ratio * (CHART.bottom - CHART.top)
          const axisX = CHART.left + ratio * (CHART.right - CHART.left)
          return <g key={index}>
            <line x1={CHART.left} y1={axisY} x2={CHART.right} y2={axisY} stroke="currentColor" strokeOpacity="0.16" />
            <text x={CHART.left - 8} y={axisY + 4} textAnchor="end" fontSize="11" fill="currentColor">
              {yRange ? format(tickValue(yRange, ratio)) : '—'}
            </text>
            <text x={axisX} y={CHART.bottom + 20} textAnchor="middle" fontSize="11" fill="currentColor">
              {xRange ? format(tickValue(xRange, ratio)) : '—'}
            </text>
          </g>
        })}
        <line x1={CHART.left} y1={CHART.top} x2={CHART.left} y2={CHART.bottom} stroke="currentColor" />
        <line x1={CHART.left} y1={CHART.bottom} x2={CHART.right} y2={CHART.bottom} stroke="currentColor" />
        {paths.map((path, index) => <path key={index} d={path} fill="none" stroke="#2563eb" strokeWidth="2.5" />)}
        {points.map(point => <circle key={`${point.index}-${point.x}-${point.y}`} cx={x(point.x)} cy={y(point.y)} r="3.5" fill="#2563eb">
          <title>{`${xLabel} ${format(point.x)}; ${yLabel} ${format(point.y)}`}</title>
        </circle>)}
        <text x={(CHART.left + CHART.right) / 2} y="330" textAnchor="middle" fontSize="12" fill="currentColor">{xLabel}</text>
        <text x="16" y={(CHART.top + CHART.bottom) / 2} textAnchor="middle" fontSize="12" fill="currentColor" transform={`rotate(-90 16 ${(CHART.top + CHART.bottom) / 2})`}>{yLabel}</text>
        {points.length === 0 && <text x={(CHART.left + CHART.right) / 2} y={(CHART.top + CHART.bottom) / 2} textAnchor="middle" fontSize="13" fill="currentColor">No finite samples</text>}
      </svg>
    </div>
  )
}

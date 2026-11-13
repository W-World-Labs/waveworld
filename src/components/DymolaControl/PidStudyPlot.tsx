import { useId } from 'react'

type Props = { times: number[]; output: number[] }

const WIDTH = 720
const HEIGHT = 340
const CHART = { left: 76, right: 698, top: 22, bottom: 276 }

function bounds(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1]
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.05, 1)
    return [min - padding, max + padding]
  }
  const padding = (max - min) * 0.05
  return [min - padding, max + padding]
}

function format(value: number): string {
  return Number(value.toPrecision(4)).toString()
}

/** Plots the native PID study output samples against their native times. */
export function PidStudyPlot({ times, output }: Props) {
  const id = useId()
  const titleId = `pid-study-plot-title-${id}`
  const descriptionId = `pid-study-plot-description-${id}`
  const points = times.flatMap((time, index) => {
    const value = output[index]
    return Number.isFinite(time) && Number.isFinite(value) ? [{ x: time, y: value }] : []
  })
  const [minX, maxX] = bounds(points.map(point => point.x))
  const [minY, maxY] = bounds(points.map(point => point.y))
  const x = (value: number) => CHART.left + ((value - minX) / (maxX - minX)) * (CHART.right - CHART.left)
  const y = (value: number) => CHART.bottom - ((value - minY) / (maxY - minY)) * (CHART.bottom - CHART.top)
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(point.x)} ${y(point.y)}`).join(' ')

  return (
    <div className="overflow-x-auto rounded border border-edge p-2">
      <svg
        data-testid="pid-study-plot"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="h-auto min-w-[520px] w-full text-slate-400"
      >
        <title id={titleId}>PID study output versus time</title>
        <desc id={descriptionId}>Native output samples plotted against their native time values.</desc>
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
        {points.length > 1 && <path d={path} fill="none" stroke="#2563eb" strokeWidth="2.5" />}
        {points.map((point, index) => <circle key={`${index}-${point.x}`} cx={x(point.x)} cy={y(point.y)} r="3.5" fill="#2563eb">
          <title>Time {format(point.x)}; output {format(point.y)}</title>
        </circle>)}
        <text x={(CHART.left + CHART.right) / 2} y="330" textAnchor="middle" fontSize="12" fill="currentColor">Time</text>
        <text x="16" y={(CHART.top + CHART.bottom) / 2} textAnchor="middle" fontSize="12" fill="currentColor" transform={`rotate(-90 16 ${(CHART.top + CHART.bottom) / 2})`}>Output</text>
        {points.length === 0 && <text x={(CHART.left + CHART.right) / 2} y={(CHART.top + CHART.bottom) / 2} textAnchor="middle" fontSize="13" fill="currentColor">No finite study samples</text>}
      </svg>
    </div>
  )
}

import { useId } from 'react'

export interface AnsysModalFrequencyPlotProps {
  frequenciesHz: readonly number[]
}

const HEIGHT = 250
const LEFT = 54
const RIGHT = 18
const TOP = 34
const BOTTOM = 48

function formatHz(value: number) {
  return Number(value.toPrecision(3)).toString()
}

export function AnsysModalFrequencyPlot({ frequenciesHz }: AnsysModalFrequencyPlotProps) {
  const id = useId()
  const titleId = `${id}-title`
  const descriptionId = `${id}-description`
  const values = frequenciesHz.flatMap((value, index) => Number.isFinite(value) ? [{ value, index }] : [])
  const count = values.length
  const width = Math.max(420, count * 42 + LEFT + RIGHT)
  const plotWidth = width - LEFT - RIGHT
  const plotHeight = HEIGHT - TOP - BOTTOM
  const minValue = values.reduce((min, item) => Math.min(min, item.value), 0)
  const maxValue = values.reduce((max, item) => Math.max(max, item.value), 0)
  // Give an all-zero result a useful axis while keeping every bar anchored at zero.
  const axisMin = minValue === maxValue ? 0 : minValue
  const axisMax = minValue === maxValue ? 1 : maxValue
  const y = (value: number) => TOP + ((axisMax - value) / (axisMax - axisMin)) * plotHeight
  const zeroY = y(0)
  const slotWidth = count ? plotWidth / count : plotWidth
  const barWidth = Math.min(26, slotWidth * 0.62)
  const ticks = Array.from({ length: 5 }, (_, index) => axisMin + (axisMax - axisMin) * index / 4)

  return <div className="overflow-x-auto" aria-label="Modal frequency plot">
    <svg
      role="img"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      viewBox={`0 0 ${width} ${HEIGHT}`}
      className="h-auto w-full min-w-[420px]"
    >
      <title id={titleId}>Returned modal frequencies</title>
      <desc id={descriptionId}>
        {count === 0
          ? 'No finite returned eigenfrequencies are available to plot.'
          : `${count} finite returned eigenfrequency${count === 1 ? '' : 'ies'} in hertz by mode number. Values are shown exactly as supplied.`}
      </desc>
      <text x={LEFT} y={19} className="fill-slate-200 text-sm">Modal frequencies</text>

      {ticks.map((tick, index) => {
        const tickY = y(tick)
        return <g key={index}>
          <line x1={LEFT} x2={width - RIGHT} y1={tickY} y2={tickY} className="stroke-slate-700" />
          <text x={LEFT - 8} y={tickY + 4} textAnchor="end" className="fill-slate-400 text-[10px]">{formatHz(tick)}</text>
        </g>
      })}

      <line x1={LEFT} x2={width - RIGHT} y1={zeroY} y2={zeroY} className="stroke-slate-400" />
      <line x1={LEFT} x2={LEFT} y1={TOP} y2={HEIGHT - BOTTOM} className="stroke-slate-400" />
      <text x={15} y={TOP + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 15 ${TOP + plotHeight / 2})`} className="fill-slate-300 text-[11px]">Frequency (Hz)</text>

      {values.map(({ value, index }, plottedIndex) => {
        const centerX = LEFT + slotWidth * (plottedIndex + 0.5)
        const valueY = y(value)
        const barY = Math.min(zeroY, valueY)
        const barHeight = Math.abs(zeroY - valueY)
        return <g key={index}>
          <rect
            x={centerX - barWidth / 2}
            y={barY}
            width={barWidth}
            height={barHeight}
            rx={3}
            className="fill-cyan-400/80"
          />
          {barHeight === 0 && <circle cx={centerX} cy={zeroY} r={4} className="fill-cyan-300" />}
          <text x={centerX} y={HEIGHT - BOTTOM + 17} textAnchor="middle" className="fill-slate-300 text-[10px]">{`Mode ${index + 1}`}</text>
        </g>
      })}

      <text x={LEFT + plotWidth / 2} y={HEIGHT - 5} textAnchor="middle" className="fill-slate-400 text-[10px]">Mode</text>
    </svg>
  </div>
}

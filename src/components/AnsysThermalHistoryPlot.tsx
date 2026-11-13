import { useId } from 'react'
import { useLocale } from '../lib/i18n'
import type { AnsysThermalSample } from '../lib/sim/ansys-thermal-study-result'

const WIDTH = 640
const HEIGHT = 280
const LEFT = 62
const RIGHT = 20
const TOP = 30
const BOTTOM = 52

function format(value: number, locale: string): string {
  return Number.isFinite(value)
    ? new Intl.NumberFormat(locale, { maximumSignificantDigits: 4 }).format(value)
    : '—'
}

export function AnsysThermalHistoryPlot({ samples }: { samples: readonly AnsysThermalSample[] }) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const id = useId()
  const titleId = `${id}-title`
  const descriptionId = `${id}-description`
  const points = samples.filter(sample => [sample.time, sample.minTemperature, sample.meanTemperature, sample.maxTemperature].every(Number.isFinite))
  const plotWidth = WIDTH - LEFT - RIGHT
  const plotHeight = HEIGHT - TOP - BOTTOM
  const times = points.map(point => point.time)
  const temperatures = points.flatMap(point => [point.minTemperature, point.meanTemperature, point.maxTemperature])
  const minTime = Math.min(...times, 0)
  const maxTime = Math.max(...times, minTime + 1)
  const minTemperature = Math.min(...temperatures, 0)
  const maxTemperature = Math.max(...temperatures, minTemperature + 1)
  const y = (temperature: number) => TOP + ((maxTemperature - temperature) / (maxTemperature - minTemperature)) * plotHeight
  const x = (time: number) => LEFT + (time - minTime) / (maxTime - minTime) * plotWidth
  const band = points.length > 1
    ? [...points.map(point => `${x(point.time)},${y(point.maxTemperature)}`), ...points.slice().reverse().map(point => `${x(point.time)},${y(point.minTemperature)}`)].join(' ')
    : ''
  const meanLine = points.map(point => `${x(point.time)},${y(point.meanTemperature)}`).join(' ')
  const title = zh ? 'ANSYS 热历史汇总图' : 'ANSYS aggregate thermal history'
  const empty = zh ? '没有可绘制的有限热历史汇总样本。' : 'No finite aggregate thermal history samples are available to plot.'

  return <figure className="space-y-2" aria-label={title}>
    <figcaption className="text-xs text-muted-foreground">
      {zh
        ? '显示每个原生样本时间的温度最小值、平均值和最大值；阴影表示汇总范围，不代表节点温度历史。时间单位为秒，温度单位为 °C。'
        : 'Shows minimum, mean, and maximum temperature at each native sample time. The shaded area is an aggregate range, not nodal temperature histories. Time is in seconds and temperature is in °C.'}
    </figcaption>
    {points.length === 0
      ? <p className="rounded border border-edge p-3 text-sm text-muted-foreground">{empty}</p>
      : <div className="overflow-x-auto">
        <svg role="img" aria-labelledby={titleId} aria-describedby={descriptionId} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full min-w-[420px]">
          <title id={titleId}>{title}</title>
          <desc id={descriptionId}>{zh
            ? `绘制 ${points.length} 个原生时间样本的汇总温度范围与平均值；不包含节点历史。`
            : `Plots aggregate temperature range and mean for ${points.length} native time samples; no nodal histories are shown.`}</desc>
          {[0, 1, 2, 3, 4].map(index => {
            const value = minTemperature + (maxTemperature - minTemperature) * index / 4
            const tickY = y(value)
            return <g key={index}>
              <line x1={LEFT} x2={WIDTH - RIGHT} y1={tickY} y2={tickY} className="stroke-slate-700" />
              <text x={LEFT - 8} y={tickY + 4} textAnchor="end" className="fill-slate-400 text-[10px]">{format(value, locale)}</text>
            </g>
          })}
          <line x1={LEFT} x2={LEFT} y1={TOP} y2={HEIGHT - BOTTOM} className="stroke-slate-400" />
          <line x1={LEFT} x2={WIDTH - RIGHT} y1={HEIGHT - BOTTOM} y2={HEIGHT - BOTTOM} className="stroke-slate-400" />
          {band && <polygon points={band} fill="#38bdf8" fillOpacity="0.2" stroke="none" />}
          {points.length > 1 && <polyline points={meanLine} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
          {points.map(point => <g key={`${point.step}-${point.time}`}>
            <line x1={x(point.time)} x2={x(point.time)} y1={y(point.minTemperature)} y2={y(point.maxTemperature)} stroke="#38bdf8" strokeWidth="2" />
            <circle cx={x(point.time)} cy={y(point.meanTemperature)} r="3.5" fill="#f8fafc" stroke="#0284c7" strokeWidth="2" />
          </g>)}
          <text x={LEFT} y={HEIGHT - BOTTOM + 17} textAnchor="start" className="fill-slate-400 text-[10px]">{format(points[0].time, locale)}</text>
          <text x={WIDTH - RIGHT} y={HEIGHT - BOTTOM + 17} textAnchor="end" className="fill-slate-400 text-[10px]">{format(points[points.length - 1].time, locale)}</text>
          <text x={LEFT + plotWidth / 2} y={HEIGHT - 5} textAnchor="middle" className="fill-slate-300 text-[11px]">{zh ? '时间 (s)' : 'Time (s)'}</text>
          <text x="15" y={TOP + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 15 ${TOP + plotHeight / 2})`} className="fill-slate-300 text-[11px]">{zh ? '温度 (°C)' : 'Temperature (°C)'}</text>
        </svg>
        <ul className="flex flex-wrap gap-x-4 text-xs text-muted-foreground" aria-label={zh ? '图例' : 'Plot legend'}>
          <li><span aria-hidden="true" className="mr-1 inline-block h-2 w-3 bg-sky-400/30" />{zh ? '最小值至最大值范围' : 'Minimum to maximum range'}</li>
          <li><span aria-hidden="true" className="mr-1 inline-block h-0.5 w-3 bg-sky-400" />{zh ? '平均温度' : 'Mean temperature'}</li>
        </ul>
      </div>}
  </figure>
}

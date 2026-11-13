type NamedSeries = Record<string, number[]>

export type StarCcmConvergenceHistoryProps = {
  /** Iteration numbers supplied by the caller. */
  iterations: number[]
  /** Residual histories keyed by their caller-provided names. */
  residuals: NamedSeries
  /** Monitor histories keyed by their caller-provided names. */
  monitors: NamedSeries
  /** Optional residual tolerance shown as a reference line and in the table. */
  tolerance?: number
}

type PlotSeries = { name: string; values: number[]; color: string }

const COLORS = ['#2563eb', '#dc2626', '#059669', '#9333ea', '#d97706', '#0891b2', '#db2777', '#4d7c0f']
const WIDTH = 640
const HEIGHT = 250
const PLOT = { left: 58, right: 624, top: 18, bottom: 204 }

function format(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(4)).toString() : '—'
}

function pointsFor(values: number[], iterations: number[], y: (value: number) => number, positiveOnly = false): string {
  const pairs = values.flatMap((value, index) => Number.isFinite(value) && (!positiveOnly || value > 0) && Number.isFinite(iterations[index])
    ? [{ iteration: iterations[index], value }]
    : [])
  const first = iterations[0] ?? 0
  const last = iterations[iterations.length - 1] ?? first
  return pairs.map(({ iteration, value }) => {
    const x = PLOT.left + (last === first ? 0.5 : (iteration - first) / (last - first)) * (PLOT.right - PLOT.left)
    return `${x},${y(value)}`
  }).join(' ')
}

function HistoryPlot({ title, series, iterations, logarithmic, tolerance }: {
  title: string
  series: PlotSeries[]
  iterations: number[]
  logarithmic: boolean
  tolerance?: number
}) {
  const finiteValues = series.flatMap(item => item.values.filter(Number.isFinite))
  if (logarithmic) finiteValues.push(...series.flatMap(item => item.values.filter(value => Number.isFinite(value) && value > 0)))
  const positiveValues = logarithmic
    ? series.flatMap(item => item.values.filter(value => Number.isFinite(value) && value > 0))
    : finiteValues
  const toleranceIsVisible = logarithmic && Number.isFinite(tolerance) && (tolerance as number) > 0
  const domainValues = toleranceIsVisible ? [...positiveValues, tolerance as number] : positiveValues
  const min = domainValues.length ? Math.min(...domainValues) : 0
  const max = domainValues.length ? Math.max(...domainValues) : 1
  const yMin = logarithmic ? Math.log10(min > 0 ? min : 1) : min
  const yMax = logarithmic ? Math.log10(max > min ? max : min * 10) : max
  const y = (value: number) => {
    const transformed = logarithmic ? Math.log10(value) : value
    return yMax === yMin ? (PLOT.top + PLOT.bottom) / 2
      : PLOT.bottom - ((transformed - yMin) / (yMax - yMin)) * (PLOT.bottom - PLOT.top)
  }
  const ticks = [0, 1, 2, 3, 4].map(index => {
    const ratio = index / 4
    const transformed = yMin + ratio * (yMax - yMin)
    return logarithmic ? 10 ** transformed : transformed
  })
  const firstIteration = iterations[0]
  const lastIteration = iterations[iterations.length - 1]

  return <section className="min-w-0 rounded border border-edge p-3" aria-label={`${title} plot; caller-provided data`}>
    <h3 className="mb-2 text-sm font-medium text-slate-800 dark:text-slate-100">{title}</h3>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" className="h-auto w-full text-slate-500 dark:text-slate-400">
      <title>{title} from caller-provided data</title>
      <desc>{`${title} plotted against iteration numbers supplied by the caller. Values are displayed as provided; the chart does not calculate simulation results.`}</desc>
      {ticks.map((tick, index) => {
        const gy = PLOT.bottom - (index / 4) * (PLOT.bottom - PLOT.top)
        return <g key={index}>
          <line x1={PLOT.left} x2={PLOT.right} y1={gy} y2={gy} stroke="currentColor" opacity="0.14" />
          <text x={PLOT.left - 7} y={gy + 3} textAnchor="end" fontSize="10" fill="currentColor">{format(tick)}</text>
        </g>
      })}
      <line x1={PLOT.left} x2={PLOT.left} y1={PLOT.top} y2={PLOT.bottom} stroke="currentColor" opacity="0.65" />
      <line x1={PLOT.left} x2={PLOT.right} y1={PLOT.bottom} y2={PLOT.bottom} stroke="currentColor" opacity="0.65" />
      {toleranceIsVisible && <g>
        <line x1={PLOT.left} x2={PLOT.right} y1={y(tolerance as number)} y2={y(tolerance as number)} stroke="#64748b" strokeDasharray="5 4" />
        <text x={PLOT.right - 2} y={y(tolerance as number) - 4} textAnchor="end" fontSize="9" fill="currentColor">Tolerance {format(tolerance as number)}</text>
      </g>}
      {series.map(item => <polyline
        key={item.name}
        points={pointsFor(item.values, iterations, y, logarithmic)}
        fill="none"
        stroke={item.color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />)}
      <text x={PLOT.left} y={PLOT.bottom + 17} textAnchor="start" fontSize="10" fill="currentColor">{format(firstIteration)}</text>
      <text x={PLOT.right} y={PLOT.bottom + 17} textAnchor="end" fontSize="10" fill="currentColor">{format(lastIteration)}</text>
      <text x={(PLOT.left + PLOT.right) / 2} y={HEIGHT - 5} textAnchor="middle" fontSize="11" fill="currentColor">Iteration (caller data)</text>
      <text x="13" y={(PLOT.top + PLOT.bottom) / 2} textAnchor="middle" fontSize="11" fill="currentColor" transform={`rotate(-90 13 ${(PLOT.top + PLOT.bottom) / 2})`}>
        {logarithmic ? 'Residual (log scale; caller data)' : 'Monitor value (caller data)'}
      </text>
    </svg>
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={`${title} series legend`}>
      {series.map(item => <li key={item.name} className="flex items-center gap-1.5">
        <span aria-hidden="true" className="inline-block h-0.5 w-4" style={{ backgroundColor: item.color }} />
        {item.name} <span>(caller data)</span>
      </li>)}
      {toleranceIsVisible && <li className="text-slate-500">Tolerance (caller data)</li>}
    </ul>
  </section>
}

/** Visualizes imported residual and monitor histories supplied by the caller. */
export function StarCcmConvergenceHistory({ iterations, residuals, monitors, tolerance }: StarCcmConvergenceHistoryProps) {
  const validIterations = Array.isArray(iterations) ? iterations.filter(Number.isFinite) : []
  let colorIndex = 0
  const makeSeries = (source: NamedSeries, prefix: string): PlotSeries[] => Object.entries(source ?? {}).map(([name, values]) => ({
    name: `${prefix}: ${name}`,
    values: Array.isArray(values) ? values : [],
    color: COLORS[colorIndex++ % COLORS.length],
  }))
  const residualSeries = makeSeries(residuals, 'Residual')
  const monitorSeries = makeSeries(monitors, 'Monitor')
  const rows = [
    ...residualSeries.map(item => ({ ...item, kind: 'Residual' })),
    ...monitorSeries.map(item => ({ ...item, kind: 'Monitor' })),
  ]
  const lastValue = (values: number[]) => {
    for (let index = Math.min(values.length, validIterations.length) - 1; index >= 0; index -= 1) {
      if (Number.isFinite(values[index])) return values[index]
    }
    return null
  }

  return <figure className="space-y-3" aria-label="STAR-CCM+ convergence history from caller-provided data">
    <figcaption className="text-xs text-muted-foreground">
      Imported residual and monitor values supplied by the caller, shown against supplied iteration numbers. This display does not calculate or validate solver results.
    </figcaption>
    {validIterations.length === 0
      ? <p className="rounded border border-edge p-3 text-sm text-muted-foreground">No finite caller-provided iteration values to display.</p>
      : <div className="grid gap-3">
        {residualSeries.length > 0 && <HistoryPlot title="Residual history" series={residualSeries} iterations={validIterations} logarithmic tolerance={tolerance} />}
        {monitorSeries.length > 0 && <HistoryPlot title="Monitor history" series={monitorSeries} iterations={validIterations} logarithmic={false} />}
      </div>}
    {rows.length > 0 && <div className="overflow-x-auto rounded border border-edge">
      <table className="w-full text-left text-xs" aria-label="Latest caller-provided convergence values">
        <thead className="bg-panel text-slate-300"><tr>
          <th scope="col" className="px-3 py-2 font-medium">Series (caller data)</th>
          <th scope="col" className="px-3 py-2 font-medium">Type</th>
          <th scope="col" className="px-3 py-2 text-right font-medium">Latest value</th>
        </tr></thead>
        <tbody className="text-slate-300">{rows.map(item => {
          const latest = lastValue(item.values)
          return <tr key={item.name} className="border-t border-edge">
            <th scope="row" className="px-3 py-2 font-normal">{item.name}</th>
            <td className="px-3 py-2">{item.kind}</td>
            <td className="px-3 py-2 text-right font-mono">{latest === null ? '—' : format(latest)}</td>
          </tr>
        })}
        {Number.isFinite(tolerance) && <tr className="border-t border-edge">
          <th scope="row" className="px-3 py-2 font-normal">Residual tolerance (caller data)</th>
          <td className="px-3 py-2">Reference</td>
          <td className="px-3 py-2 text-right font-mono">{format(tolerance as number)}</td>
        </tr>}</tbody>
      </table>
    </div>}
  </figure>
}

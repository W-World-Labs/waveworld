export type CstWaveguideFieldSample = {
  x: number
  y: number
  exMagnitude: number
  eyMagnitude: number
  ezMagnitude: number
}

export type CstWaveguideModeFamily = 'TE' | 'TM'

type Props = {
  samples: CstWaveguideFieldSample[]
  family: CstWaveguideModeFamily
}

type FieldKey = 'exMagnitude' | 'eyMagnitude' | 'ezMagnitude'

const FIELDS: { key: FieldKey; label: string }[] = [
  { key: 'exMagnitude', label: '|Ex|' },
  { key: 'eyMagnitude', label: '|Ey|' },
  { key: 'ezMagnitude', label: '|Ez|' },
]

const WIDTH = 360
const HEIGHT = 248
const PLOT = { left: 38, right: 348, top: 12, bottom: 208 }

function format(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(4)).toString() : '—'
}

function colorFor(value: number, min: number, max: number): string {
  const ratio = max > min ? (value - min) / (max - min) : 0.5
  const hue = 240 - Math.max(0, Math.min(1, ratio)) * 240
  return `hsl(${hue} 85% 52%)`
}

function FieldMap({ samples, field, family }: {
  samples: CstWaveguideFieldSample[]
  field: typeof FIELDS[number]
  family: CstWaveguideModeFamily
}) {
  const minX = Math.min(...samples.map(sample => sample.x))
  const maxX = Math.max(...samples.map(sample => sample.x))
  const minY = Math.min(...samples.map(sample => sample.y))
  const maxY = Math.max(...samples.map(sample => sample.y))
  const values = samples.map(sample => sample[field.key])
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const px = (value: number) => maxX === minX
    ? (PLOT.left + PLOT.right) / 2
    : PLOT.left + ((value - minX) / (maxX - minX)) * (PLOT.right - PLOT.left)
  const py = (value: number) => maxY === minY
    ? (PLOT.top + PLOT.bottom) / 2
    : PLOT.bottom - ((value - minY) / (maxY - minY)) * (PLOT.bottom - PLOT.top)

  return (
    <section className="min-w-0 rounded border border-edge p-2">
      <h3 className="mb-1 text-sm font-medium text-slate-800 dark:text-slate-100">{field.label} magnitude</h3>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${family} waveguide native returned ${field.label} electric-field magnitudes over x and y`}
        className="h-auto w-full text-slate-500 dark:text-slate-400"
      >
        {[0, 1, 2, 3, 4].map(index => {
          const ratio = index / 4
          const gx = PLOT.left + ratio * (PLOT.right - PLOT.left)
          const gy = PLOT.bottom - ratio * (PLOT.bottom - PLOT.top)
          return <g key={index}>
            <line x1={gx} x2={gx} y1={PLOT.top} y2={PLOT.bottom} stroke="currentColor" opacity="0.12" />
            <line x1={PLOT.left} x2={PLOT.right} y1={gy} y2={gy} stroke="currentColor" opacity="0.12" />
          </g>
        })}
        <line x1={PLOT.left} x2={PLOT.left} y1={PLOT.top} y2={PLOT.bottom} stroke="currentColor" opacity="0.6" />
        <line x1={PLOT.left} x2={PLOT.right} y1={PLOT.bottom} y2={PLOT.bottom} stroke="currentColor" opacity="0.6" />
        {samples.map((sample, index) => <circle
          key={`${sample.x}-${sample.y}-${index}`}
          cx={px(sample.x)}
          cy={py(sample.y)}
          r="5"
          fill={colorFor(sample[field.key], minValue, maxValue)}
        >
          <title>x={format(sample.x)}, y={format(sample.y)}, {field.label}={format(sample[field.key])}</title>
        </circle>)}
        <text x={(PLOT.left + PLOT.right) / 2} y="236" textAnchor="middle" fontSize="11" fill="currentColor">x (returned sample coordinate)</text>
        <text x="12" y={(PLOT.top + PLOT.bottom) / 2} textAnchor="middle" fontSize="11" fill="currentColor" transform={`rotate(-90 12 ${(PLOT.top + PLOT.bottom) / 2})`}>y (returned sample coordinate)</text>
        <text x={PLOT.left} y={PLOT.bottom + 15} textAnchor="start" fontSize="9" fill="currentColor">{format(minX)}</text>
        <text x={PLOT.right} y={PLOT.bottom + 15} textAnchor="end" fontSize="9" fill="currentColor">{format(maxX)}</text>
        <text x={PLOT.left - 4} y={PLOT.bottom} textAnchor="end" fontSize="9" fill="currentColor">{format(minY)}</text>
        <text x={PLOT.left - 4} y={PLOT.top + 4} textAnchor="end" fontSize="9" fill="currentColor">{format(maxY)}</text>
      </svg>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground" aria-label={`${field.label} display color range`}>
        <span>{format(minValue)}</span>
        <span className="mx-2 h-2 flex-1 rounded" style={{ background: 'linear-gradient(to right, hsl(240 85% 52%), hsl(180 85% 52%), hsl(60 85% 52%), hsl(0 85% 52%))' }} aria-hidden="true" />
        <span>{format(maxValue)}</span>
      </div>
    </section>
  )
}

/** Displays the native returned electric-field magnitude samples without deriving field values. */
export function CstWaveguideFieldPlot({ samples, family }: Props) {
  const finiteSamples = Array.isArray(samples)
    ? samples.filter(sample => sample
      && Number.isFinite(sample.x)
      && Number.isFinite(sample.y)
      && Number.isFinite(sample.exMagnitude)
      && Number.isFinite(sample.eyMagnitude)
      && Number.isFinite(sample.ezMagnitude))
    : []

  return (
    <figure className="mt-4" aria-label={`${family} waveguide electric-field sample visualization`}>
      <figcaption className="mb-2 text-sm text-muted-foreground">
        Native returned {family} electric-field magnitude samples. Color is a display-only relative scale within each component; no field values are calculated here.
      </figcaption>
      {finiteSamples.length === 0
        ? <p className="rounded border border-edge p-4 text-sm text-muted-foreground">No finite electric-field samples to display.</p>
        : <div className="grid gap-3 md:grid-cols-3">
          {FIELDS.map(field => <FieldMap key={field.key} samples={finiteSamples} field={field} family={family} />)}
        </div>}
    </figure>
  )
}

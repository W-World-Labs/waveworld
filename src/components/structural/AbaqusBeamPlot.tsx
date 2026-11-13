type BeamNode = { x: number; v: number }

type Props = {
  nodes: BeamNode[]
}

const WIDTH = 720
const HEIGHT = 320
const CHART = { left: 74, right: 698, top: 18, bottom: 252 }

function format(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(4)).toString() : '—'
}

function bounds(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1]
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.08, 1e-9)
    return [min - padding, max + padding]
  }
  const padding = (max - min) * 0.08
  return [min - padding, max + padding]
}

/** Plot only the transverse nodal displacements returned by the native B31 result. */
export function AbaqusBeamPlot({ nodes }: Props) {
  const samples = Array.isArray(nodes)
    ? nodes.filter((node) => Number.isFinite(node?.x) && Number.isFinite(node?.v))
    : []
  const [minX, maxX] = bounds(samples.map((node) => node.x))
  const [minV, maxV] = bounds(samples.map((node) => node.v))
  const plotWidth = CHART.right - CHART.left
  const plotHeight = CHART.bottom - CHART.top
  const x = (value: number) => samples.length === 1
    ? CHART.left + plotWidth / 2
    : CHART.left + ((value - minX) / (maxX - minX)) * plotWidth
  const y = (value: number) => CHART.bottom - ((value - minV) / (maxV - minV)) * plotHeight
  const polyline = samples.map((node) => `${x(node.x).toFixed(2)},${y(node.v).toFixed(2)}`).join(' ')
  const zeroVisible = minV <= 0 && maxV >= 0
  const zeroY = zeroVisible ? y(0) : null

  return (
    <figure className="mt-4" aria-label="B31 transverse nodal deflection plot">
      <svg
        data-testid="abaqus-beam-plot"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Native W-Sim B31 transverse nodal displacement v versus x; x in metres, v in metres"
        className="h-64 w-full min-w-[520px] text-slate-500 dark:text-slate-400"
      >
        {[0, 1, 2, 3, 4].map((index) => {
          const ratio = index / 4
          const gridY = CHART.bottom - ratio * plotHeight
          const gridX = CHART.left + ratio * plotWidth
          return <g key={index}>
            <line x1={CHART.left} x2={CHART.right} y1={gridY} y2={gridY} stroke="currentColor" opacity="0.16" />
            <line x1={gridX} x2={gridX} y1={CHART.top} y2={CHART.bottom} stroke="currentColor" opacity="0.1" />
            <text x={CHART.left - 8} y={gridY + 4} textAnchor="end" fontSize="11" fill="currentColor">{format(minV + ratio * (maxV - minV))}</text>
            <text x={gridX} y={CHART.bottom + 18} textAnchor="middle" fontSize="11" fill="currentColor">{format(minX + ratio * (maxX - minX))}</text>
          </g>
        })}
        <line x1={CHART.left} x2={CHART.left} y1={CHART.top} y2={CHART.bottom} stroke="currentColor" opacity="0.6" />
        <line x1={CHART.left} x2={CHART.right} y1={CHART.bottom} y2={CHART.bottom} stroke="currentColor" opacity="0.6" />
        {zeroY !== null && <line x1={CHART.left} x2={CHART.right} y1={zeroY} y2={zeroY} stroke="currentColor" strokeDasharray="4 4" opacity="0.55" />}
        {samples.length > 1 && <polyline points={polyline} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {samples.map((node, index) => <circle key={`${node.x}-${index}`} cx={x(node.x)} cy={y(node.v)} r="3.5" fill="#2563eb">
          <title>x = {format(node.x)} m; v = {format(node.v)} m</title>
        </circle>)}
        <text x={(CHART.left + CHART.right) / 2} y={HEIGHT - 12} textAnchor="middle" fontSize="12" fill="currentColor">x (m)</text>
        <text x="16" y={(CHART.top + CHART.bottom) / 2} textAnchor="middle" fontSize="12" fill="currentColor" transform={`rotate(-90 16 ${(CHART.top + CHART.bottom) / 2})`}>Transverse displacement v (m)</text>
        {samples.length === 0 && <text x={(CHART.left + CHART.right) / 2} y={(CHART.top + CHART.bottom) / 2} textAnchor="middle" fontSize="13" fill="currentColor">No finite nodal displacement samples</text>}
      </svg>
      <figcaption className="text-xs text-muted-foreground">Points and straight segments show native returned node values only; no smoothing or extrapolation.</figcaption>
    </figure>
  )
}

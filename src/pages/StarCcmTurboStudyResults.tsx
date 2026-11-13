import type { StarCcmTurboRow } from './StarCcmTurboStudy'

interface StarCcmTurboStudyResultsProps {
  rows: readonly StarCcmTurboRow[]
  onExportCsv: () => void
  onExportJson: () => void
}

function finiteMetric(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function TurboPerformancePlot({ rows }: { rows: readonly StarCcmTurboRow[] }) {
  const plotted = rows.filter((row): row is StarCcmTurboRow & { correctedMassFlow: number; pressureRatio: number } =>
    finiteMetric(row.correctedMassFlow) && finiteMetric(row.pressureRatio))
  if (!plotted.length) {
    return <p className="text-xs text-slate-500">Submit completed points with corrected mass flow to plot pressure ratio against corrected mass flow.</p>
  }

  const xValues = plotted.map(row => row.correctedMassFlow)
  const yValues = plotted.map(row => row.pressureRatio)
  const minX = Math.min(...xValues)
  const maxX = Math.max(...xValues)
  const minY = Math.min(...yValues)
  const maxY = Math.max(...yValues)
  const x = (value: number) => 32 + (value - minX) / (maxX - minX || 1) * 336
  const y = (value: number) => 168 - (value - minY) / (maxY - minY || 1) * 136

  return <figure aria-label="Turbomachinery pressure ratio versus corrected mass flow plot">
    <svg viewBox="0 0 400 210" role="img" aria-label="Pressure ratio versus corrected mass flow" className="w-full max-w-2xl rounded-lg border border-edge bg-slate-950/70">
      <path d="M32 16V168H368" fill="none" stroke="currentColor" className="text-slate-500" />
      <text x="200" y="198" textAnchor="middle" className="fill-slate-300 text-[10px]">Corrected mass flow</text>
      <text x="12" y="92" transform="rotate(-90 12 92)" textAnchor="middle" className="fill-slate-300 text-[10px]">Total pressure ratio</text>
      {plotted.map(row => <circle key={row.id} cx={x(row.correctedMassFlow)} cy={y(row.pressureRatio)} r="5" fill="#67e8f9">
        <title>{`${row.kind}: PR ${row.pressureRatio}, corrected flow ${row.correctedMassFlow}, job ${row.jobId}`}</title>
      </circle>)}
    </svg>
    <figcaption className="mt-1 text-xs text-slate-500">Points show returned completed native results; this chart does not interpolate a performance map.</figcaption>
  </figure>
}

export function StarCcmTurboStudyResults({ rows, onExportCsv, onExportJson }: StarCcmTurboStudyResultsProps) {
  return <section className="space-y-3 rounded-lg border border-edge bg-slate-950/30 p-3" aria-label="Study results">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-semibold">Saved native results</h2>
        <p className="text-xs text-slate-400">{rows.length} completed points</p>
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn border border-edge" onClick={onExportCsv} disabled={!rows.length}>CSV</button>
        <button type="button" className="btn border border-edge" onClick={onExportJson} disabled={!rows.length}>JSON</button>
      </div>
    </div>
    <TurboPerformancePlot rows={rows} />
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-xs">
        <caption className="sr-only">Submitted W-Sim native turbomachinery results</caption>
        <thead className="text-slate-400"><tr>
          {['Point', 'Job ID', 'Kind', 'Pressure ratio', 'Corrected mass flow', 'Corrected shaft speed', 'Isentropic efficiency', 'Polytropic efficiency'].map(label => <th key={label} scope="col" className="px-2 py-2">{label}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((row, index) => <tr key={row.id} className="border-t border-edge/70">
            <td className="px-2 py-2">{index + 1}</td>
            <td className="px-2 py-2 font-mono">{row.jobId}</td>
            <td className="px-2 py-2">{row.kind}</td>
            <td className="px-2 py-2">{row.pressureRatio ?? '—'}</td>
            <td className="px-2 py-2">{row.correctedMassFlow ?? '—'}</td>
            <td className="px-2 py-2">{row.correctedShaftSpeed ?? '—'}</td>
            <td className="px-2 py-2">{row.isentropicEfficiency ?? '—'}</td>
            <td className="px-2 py-2">{row.polytropicEfficiency ?? '—'}</td>
          </tr>)}
          {!rows.length && <tr><td colSpan={8} className="px-2 py-3 text-slate-500">No completed native results yet.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>
}

export default StarCcmTurboStudyResults

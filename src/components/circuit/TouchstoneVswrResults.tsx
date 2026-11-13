import { useMemo, useState } from 'react'
import type { TouchstoneNetwork } from '../../lib/sim/touchstone'
import type { TouchstoneVswrResult } from '../../lib/sim/touchstone-vswr'
import { buildTouchstoneVswrCsv } from '../../lib/sim/touchstone-vswr-export'

type Props = { network: TouchstoneNetwork; result: TouchstoneVswrResult }
type Metric = 'vswr' | 'returnLossDb'

function number(value: number, digits = 6) {
  return Number.isFinite(value) ? Number(value.toPrecision(digits)).toString() : '—'
}

function downloadCsv(network: TouchstoneNetwork, result: TouchstoneVswrResult) {
  const blob = new Blob([buildTouchstoneVswrCsv(network, result)], { type: 'text/csv;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = 'waveworld-touchstone-s11.csv'
  anchor.click()
  URL.revokeObjectURL(href)
}

/** Display values returned by the authenticated native S11 sweep. */
export function TouchstoneVswrResults({ network, result }: Props) {
  const [metric, setMetric] = useState<Metric>('vswr')
  const samples = result.points
  const plot = useMemo(() => {
    const width = 720
    const height = 250
    const padX = 42
    const padY = 22
    const values = samples.map((point) => metric === 'vswr' ? point.vswr : point.returnLossDb)
    const finite = values.filter((value): value is number => value !== null && Number.isFinite(value))
    if (finite.length === 0) return { width, height, paths: [] as string[], min: 0, max: 1 }
    const low = Math.min(...finite)
    const high = Math.max(...finite)
    const spread = high - low
    const margin = spread === 0 ? Math.max(Math.abs(low) * 0.08, 0.5) : spread * 0.08
    const min = low - margin
    const max = high + margin
    const x = (index: number) => samples.length <= 1 ? width / 2 : padX + index / (samples.length - 1) * (width - padX * 2)
    const y = (value: number) => height - padY - (value - min) / (max - min) * (height - padY * 2)
    const paths: string[] = []
    let active: string[] = []
    values.forEach((value, index) => {
      if (value === null || !Number.isFinite(value)) {
        if (active.length) paths.push(active.join(' '))
        active = []
        return
      }
      active.push(`${active.length ? 'L' : 'M'} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`)
    })
    if (active.length) paths.push(active.join(' '))
    return { width, height, paths, min, max }
  }, [samples, metric])

  const provenance = Object.entries(result.backend).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')
  const metricLabel = metric === 'vswr' ? 'VSWR' : 'Return loss (dB)'
  const portReferences = network.referenceImpedancesOhms
  const hasPortReferences = Array.isArray(portReferences) && portReferences.length > 0
  const referencesAreCommon = hasPortReferences && portReferences.every((value) => value === portReferences[0])
  const referenceLabel = referencesAreCommon
    ? `common reference impedance ${number(portReferences[0])} Ω`
    : hasPortReferences
      ? `per-port reference impedances ${portReferences.map((value, index) => `Port ${index + 1}: ${number(value)} Ω`).join(' · ')}`
      : `common reference impedance ${number(network.referenceOhms)} Ω`

  return (
    <section data-testid="touchstone-results" aria-labelledby="touchstone-results-title" className="mt-6 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="touchstone-results-title" className="text-lg font-semibold">S11 analysis results</h3>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm" htmlFor="touchstone-metric">Plot
            <select id="touchstone-metric" data-testid="touchstone-metric" value={metric} onChange={(event) => setMetric(event.target.value as Metric)} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
              <option value="vswr">VSWR</option>
              <option value="returnLossDb">Return loss (dB)</option>
            </select>
          </label>
          <button type="button" data-testid="touchstone-csv" onClick={() => downloadCsv(network, result)} className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white hover:bg-slate-700">Download CSV</button>
        </div>
      </div>

      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        {network.fileName} · {referenceLabel} · no renormalization applied
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400" aria-label="Native backend provenance">Native backend: {provenance || 'provenance unavailable'}</p>

      <figure className="mt-4" aria-label={`${metricLabel} by frequency`}>
        <svg viewBox={`0 0 ${plot.width} ${plot.height}`} role="img" aria-label={`${metricLabel} plot`} className="h-56 w-full overflow-visible">
          <line x1="42" x2="678" y1="228" y2="228" stroke="currentColor" opacity="0.35" />
          <line x1="42" x2="42" y1="22" y2="228" stroke="currentColor" opacity="0.35" />
          <text x="42" y="16" fontSize="11" fill="currentColor">{number(plot.max)}</text>
          <text x="42" y="245" fontSize="11" fill="currentColor">{number(plot.min)}</text>
          {plot.paths.map((path, index) => <path key={index} d={path} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />)}
          {samples.map((point, index) => {
            const value = metric === 'vswr' ? point.vswr : point.returnLossDb
            if (value === null || !Number.isFinite(value)) return null
            const x = samples.length <= 1 ? plot.width / 2 : 42 + index / (samples.length - 1) * 636
            const y = plot.height - 22 - (value - plot.min) / (plot.max - plot.min) * 206
            return <circle key={`${point.frequencyHz}-${index}`} cx={x} cy={y} r="3.5" fill="#2563eb"><title>{`${number(point.frequencyHz)} Hz: ${number(value)}`}</title></circle>
          })}
          <text x="360" y="249" fontSize="11" textAnchor="middle" fill="currentColor">Frequency (Hz)</text>
        </svg>
        {metric === 'returnLossDb' && samples.some((point) => point.returnLossDb === null) && <figcaption className="text-xs text-slate-500">Ideal matches have infinite return loss and are omitted from this finite scale; gaps are left unconnected.</figcaption>}
      </figure>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Native S11 sweep values for every input frequency</caption>
          <thead><tr className="border-b border-slate-200 dark:border-slate-700">{['Frequency (Hz)', '|S11|', 'VSWR', 'Return loss (dB)', 'Reflected power fraction'].map((heading) => <th key={heading} scope="col" className="px-3 py-2 font-semibold">{heading}</th>)}</tr></thead>
          <tbody>{samples.map((point, index) => <tr key={`${point.frequencyHz}-${index}`} className="border-b border-slate-100 dark:border-slate-800">
            <th scope="row" className="px-3 py-2 font-normal tabular-nums">{number(point.frequencyHz)}</th>
            <td className="px-3 py-2 tabular-nums">{number(point.magnitude)}</td>
            <td className="px-3 py-2 tabular-nums">{number(point.vswr)}</td>
            <td className="px-3 py-2 tabular-nums">{point.returnLossDb === null ? '∞ (ideal match)' : number(point.returnLossDb)}</td>
            <td className="px-3 py-2 tabular-nums">{number(point.reflectedPowerFraction)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  )
}

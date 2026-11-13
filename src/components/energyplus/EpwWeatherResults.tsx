import type { ReactNode } from 'react'

export type EpwWeatherSummary = {
  mean: number
  min: number
  max: number
  series?: number[]
}

/** Shape returned by the native EPW weather-stage parser. */
export type EpwWeatherResult = {
  ok: boolean
  backend: {
    id: string
    kind: string
    deviceName: string
    [key: string]: unknown
  }
  module: string
  method: string
  location: Record<string, unknown>
  leapYear: boolean
  designConditionCount: number
  typicalExtremePeriodCount: number
  groundTemperatures: {
    depths: number[]
    monthly: number[][]
    [key: string]: unknown
  }
  dataPeriods: {
    count: number
    recordsPerHour: number
    periods: unknown[]
    [key: string]: unknown
  }
  rowCount: number
  annualComplete: boolean
  variables: string[]
  summaries: Record<string, EpwWeatherSummary>
  [key: string]: unknown
}

export type EpwWeatherSource = {
  identity: {
    name: string
    sizeBytes: number
    lastModifiedMs: number
    mediaType: string
  }
  provenance: {
    kind: 'local-file-picker'
    relativePath: string | null
  }
  sha256?: string
}

type Props = {
  result: EpwWeatherResult
  source: EpwWeatherSource
}

const EPW_UNITS: Record<string, string> = {
  year: 'calendar year', month: 'month', day: 'day', hour: 'EPW interval hour', minute: 'interval-end minute',
  dryBulb: '°C', dewPoint: '°C', relativeHumidity: '%', atmosphericPressure: 'Pa',
  extraterrestrialHorizontal: 'Wh/m²', extraterrestrialDirectNormal: 'Wh/m²', horizontalInfrared: 'Wh/m²',
  globalHorizontal: 'Wh/m²', directNormal: 'Wh/m²', diffuseHorizontal: 'Wh/m²',
  globalHorizontalIlluminance: 'lux', directNormalIlluminance: 'lux', diffuseHorizontalIlluminance: 'lux',
  zenithLuminance: 'cd/m²', windDirection: 'degrees', windSpeed: 'm/s', totalSkyCover: 'tenths', opaqueSkyCover: 'tenths',
  visibility: 'km', ceilingHeight: 'm', presentWeatherObservation: 'code', presentWeatherCodes: 'code',
  precipitableWater: 'mm', aerosolOpticalDepth: 'thousandths', snowDepth: 'cm', daysSinceLastSnow: 'days',
  albedo: 'unitless', liquidPrecipitationDepth: 'mm', liquidPrecipitationQuantity: 'hours',
}

function display(value: unknown): string {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '—'
  if (typeof value === 'string' || typeof value === 'boolean') return String(value)
  if (value == null) return '—'
  return JSON.stringify(value)
}

function downloadJson(source: EpwWeatherSource, result: EpwWeatherResult) {
  const content = JSON.stringify({
    reportType: 'energyplus-epw-weather-stage',
    scope: 'Native EPW weather-file parsing and summaries only; this report contains no building energy simulation results.',
    source,
    result,
  }, null, 2)
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'energyplus-epw-weather-results.json'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function Item({ label, value }: { label: string; value: ReactNode }) {
  return <div><dt className="text-slate-400">{label}</dt><dd className="break-words text-slate-100">{value}</dd></div>
}

/** Static browser for native EPW parser output; it does not derive weather data. */
export function EpwWeatherResults({ result, source }: Props) {
  const summaries = Object.entries(result.summaries)

  return (
    <section data-testid="epw-weather-results" aria-labelledby="epw-weather-results-title" className="mt-6 space-y-4 rounded-xl border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="epw-weather-results-title" className="text-lg font-semibold">EnergyPlus EPW weather results</h2>
          <p className="mt-1 text-sm text-slate-400">Native parser output for the selected weather file.</p>
        </div>
        <button type="button" data-testid="epw-weather-download-json" className="btn border border-edge" onClick={() => downloadJson(source, result)}>
          Download JSON report
        </button>
      </div>

      <p className="rounded border border-edge p-3 text-sm" aria-label="Weather stage scope">
        Weather-file parsing and reported summaries only. This view does not calculate building loads, energy use, or weather time-series values.
      </p>

      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Item label="Source file" value={source.identity.name} />
        <Item label="Source size" value={`${source.identity.sizeBytes.toLocaleString()} bytes`} />
        <Item label="Source media type" value={source.identity.mediaType || 'Unavailable'} />
        <Item label="Source last modified" value={source.identity.lastModifiedMs ? new Date(source.identity.lastModifiedMs).toISOString() : 'Unavailable'} />
        <Item label="Import provenance" value={`${source.provenance.kind}: ${source.provenance.relativePath || 'path unavailable'}`} />
        <Item label="Source SHA-256" value={source.sha256 ?? 'Unavailable'} />
        <Item label="Native backend" value={`${result.backend.id} (${result.backend.kind})${result.backend.deviceName ? ` · ${result.backend.deviceName}` : ''}`} />
        <Item label="Module / method" value={`${result.module || '—'} / ${result.method || '—'}`} />
        <Item label="Location metadata" value={display(result.location)} />
        <Item label="Calendar" value={result.leapYear ? 'Leap year' : 'Non-leap year'} />
        <Item label="Parsed rows" value={result.rowCount} />
        <Item label="Annual completeness" value={result.annualComplete ? 'Complete' : 'Incomplete'} />
        <Item label="Design conditions" value={result.designConditionCount} />
        <Item label="Typical/extreme periods" value={result.typicalExtremePeriodCount} />
        <Item label="Weather data periods" value={result.dataPeriods.count} />
        <Item label="Records per hour" value={result.dataPeriods.recordsPerHour} />
      </dl>

      <details className="rounded border border-edge p-3">
        <summary className="cursor-pointer text-sm font-medium">Native data periods and ground temperatures</summary>
        <pre className="mt-3 overflow-auto text-xs text-slate-300">{JSON.stringify({ dataPeriods: result.dataPeriods, groundTemperatures: result.groundTemperatures, variables: result.variables }, null, 2)}</pre>
      </details>

      <div className="overflow-x-auto rounded border border-edge">
        <table data-testid="epw-weather-summary-table" className="w-full min-w-[720px] text-right text-sm tabular-nums">
          <caption className="sr-only">Native EPW variable summaries</caption>
          <thead className="bg-slate-900/40 text-xs text-slate-400">
            <tr><th scope="col" className="px-3 py-2 text-left">Variable</th><th scope="col" className="px-3 py-2">EPW unit</th><th scope="col" className="px-3 py-2">Mean</th><th scope="col" className="px-3 py-2">Minimum</th><th scope="col" className="px-3 py-2">Maximum</th><th scope="col" className="px-3 py-2">Rows summarized</th></tr>
          </thead>
          <tbody>
            {summaries.map(([name, summary]) => (
              <tr key={name} className="border-t border-edge/60">
                <th scope="row" className="px-3 py-2 text-left font-medium">{name}</th>
                <td className="px-3 py-2 text-slate-400">{EPW_UNITS[name] ?? 'EPW source unit'}</td>
                <td className="px-3 py-2">{display(summary.mean)}</td>
                <td className="px-3 py-2">{display(summary.min)}</td>
                <td className="px-3 py-2">{display(summary.max)}</td>
                <td className="px-3 py-2">{result.rowCount.toLocaleString()}</td>
              </tr>
            ))}
            {summaries.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">No variable summaries were returned.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

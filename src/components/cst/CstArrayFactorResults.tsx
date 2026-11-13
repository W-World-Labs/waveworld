import type { CstArrayFactorResult } from '../../lib/sim/cst-array-factor-result'
export type { CstArrayFactorResult } from '../../lib/sim/cst-array-factor-result'

export type CstArrayFactorResultsProps = {
  result: CstArrayFactorResult
  submittedInput: object
  backend: Record<string, unknown>
  jobId?: string
  nativePin?: string
}

export const CST_ARRAY_FACTOR_EXPORT_MAX_ROWS = 4096

const modelLimit = 'This is a normalized array-factor model using the submitted element excitation and geometry. It is not a full-wave CST solve and does not include element coupling, feed-network effects, or a validated absolute field or gain.'

function display(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(7)).toString() : '—'
}

function exportRows(result: CstArrayFactorResult) {
  if (result.samples.length > CST_ARRAY_FACTOR_EXPORT_MAX_ROWS) {
    throw new Error(`Array-factor export is limited to ${CST_ARRAY_FACTOR_EXPORT_MAX_ROWS} directions`)
  }
  return result.samples
}

export function cstArrayFactorCsv(result: CstArrayFactorResult, nativePin?: string): string {
  const rows = exportRows(result)
  const lines = [
    `# frequencyHz,${result.frequencyHz}`,
    `# backendId,${result.backend}`,
    ...(nativePin ? [`# nativePin,${nativePin}`] : []),
    `# elementCount,${result.elementCount}`,
    `# directionCount,${result.directionCount}`,
    `# normalization,${result.normalization}`,
    `# modelLimit,${modelLimit}`,
    'thetaRad,phiRad,fieldRealNormalized,fieldImagNormalized,normalizedPower,powerDb',
    ...rows.map(row => [row.thetaRad, row.phiRad, row.fieldRealNormalized, row.fieldImagNormalized, row.normalizedPower, row.powerDb].join(',')),
  ]
  return `\uFEFF${lines.join('\r\n')}`
}

export function cstArrayFactorJson(result: CstArrayFactorResult, submittedInput: object, backend: Record<string, unknown>, jobId?: string, nativePin?: string): string {
  const samples = exportRows(result)
  return JSON.stringify({
    model: 'normalized array factor',
    limitations: modelLimit,
    submittedInput,
    backend: { ...backend, id: result.backend },
    ...(nativePin ? { nativePin } : {}),
    ...(jobId ? { jobId } : {}),
    result: { ...result, samples },
  }, null, 2)
}

function download(filename: string, content: string, type: string) {
  const href = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(href)
}

/** Presents native-returned array-factor rows and bounded, faithful exports. */
export function CstArrayFactorResults({ result, submittedInput, backend, jobId, nativePin }: CstArrayFactorResultsProps) {
  const bounded = result.samples.slice(0, CST_ARRAY_FACTOR_EXPORT_MAX_ROWS)
  return <section className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="cst-array-factor-results-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 id="cst-array-factor-results-title" className="text-sm font-semibold text-slate-100">Array-factor results</h3>
        <p className="mt-1 text-xs text-slate-400">{display(result.frequencyHz)} Hz · {result.elementCount} elements · {result.directionCount} submitted directions · {result.normalization}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" className="rounded border border-edge px-3 py-1.5 text-xs text-slate-200" onClick={() => download('cst-array-factor.csv', cstArrayFactorCsv(result, nativePin), 'text/csv;charset=utf-8')}>Download CSV</button>
        <button type="button" className="rounded border border-edge px-3 py-1.5 text-xs text-slate-200" onClick={() => download('cst-array-factor.json', cstArrayFactorJson(result, submittedInput, backend, jobId, nativePin), 'application/json;charset=utf-8')}>Download JSON</button>
      </div>
    </div>
    <p className="mt-3 rounded bg-amber-950/30 p-3 text-xs leading-relaxed text-amber-100">{modelLimit}</p>
    <p className="mt-2 text-xs text-slate-400">Host: {String(backend.deviceName ?? result.backend)} · {String(backend.kind ?? 'host-f64')}{nativePin ? ` · Native pin ${nativePin}` : ''}{jobId ? ` · Job ${jobId}` : ''}</p>
    <div className="mt-3 max-h-96 overflow-auto" tabIndex={0} role="region" aria-label="Array-factor samples table (scrollable)">
      <table className="w-full whitespace-nowrap text-right text-xs" aria-label="Submitted array-factor direction results">
        <caption className="sr-only">Native-returned normalized complex field and power for every submitted direction</caption>
        <thead className="sticky top-0 bg-panel text-slate-300"><tr>
          <th scope="col" className="px-3 py-2">θ / rad</th><th scope="col" className="px-3 py-2">φ / rad</th>
          <th scope="col" className="px-3 py-2">Re(E normalized)</th><th scope="col" className="px-3 py-2">Im(E normalized)</th>
          <th scope="col" className="px-3 py-2">Normalized power</th><th scope="col" className="px-3 py-2">Power / dB</th>
        </tr></thead>
        <tbody className="font-mono text-slate-300">{bounded.map((sample, index) => <tr key={`${sample.thetaRad}-${sample.phiRad}-${index}`} className="border-t border-edge">
          <td className="px-3 py-2">{display(sample.thetaRad)}</td><td className="px-3 py-2">{display(sample.phiRad)}</td>
          <td className="px-3 py-2">{display(sample.fieldRealNormalized)}</td><td className="px-3 py-2">{display(sample.fieldImagNormalized)}</td>
          <td className="px-3 py-2">{display(sample.normalizedPower)}</td><td className="px-3 py-2">{display(sample.powerDb)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {result.samples.length > bounded.length && <p className="mt-2 text-xs text-amber-200">Showing and exporting the first {CST_ARRAY_FACTOR_EXPORT_MAX_ROWS} directions.</p>}
  </section>
}

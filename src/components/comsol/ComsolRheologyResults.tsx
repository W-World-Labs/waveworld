import { useMemo } from 'react'
import { useLocale } from '../../lib/i18n'
import { readComsolRheologySamples, type ComsolRheologyDraft, type ComsolRheologyInput, type ComsolRheologySample } from '../../lib/sim/comsol-rheology-input'

type Props = {
  draft: ComsolRheologyDraft
  input: ComsolRheologyInput
  result: unknown
  jobId: string | null
}

const EXPORT_MAX_BYTES = 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Keep malformed or mismatched native envelopes out of both the table and exports. */
export function validateComsolRheologyOutput(value: unknown, expectedModule: string): ComsolRheologySample[] | null {
  if (!isRecord(value) || value.module !== expectedModule) return null
  try {
    return readComsolRheologySamples(value)
  } catch {
    return null
  }
}

function format(value: number | null): string {
  if (value === null) return '—'
  return Number.isFinite(value) ? Number(value.toPrecision(8)).toString() : '—'
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function download(name: string, content: string, type: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function serialize(value: unknown): string {
  const encoded = JSON.stringify(value)
  return encoded === undefined ? 'null' : encoded
}

/** Displays and exports the values returned by the native rheology operation. */
export function ComsolRheologyResults({ draft, input, result, jobId }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const samples = validateComsolRheologyOutput(result, input.module)
  const exports = useMemo(() => {
    if (!samples) return null
    try {
      const report = JSON.stringify({ schemaVersion: 1, jobId, input, draft, result, provenance: { module: isRecord(input) ? input.module ?? null : null, operation: isRecord(input) ? input.methodId ?? null : null } }, null, 2)
      const csv = [
        ['# jobId', serialize(jobId)].join(','),
        ['# input', csvCell(serialize(input))].join(','),
        ['# result', csvCell(serialize(result))].join(','),
        ['shearRate (1/s)', 'effectiveViscosity (Pa·s)', 'shearStress (Pa)', 'singular'],
        ...samples.map(row => [row.shearRate, row.effectiveViscosity === null ? 'null' : row.effectiveViscosity, row.shearStress === null ? 'null' : row.shearStress, row.singular].map(csvCell).join(',')),
      ].join('\r\n')
      if (new Blob([report]).size > EXPORT_MAX_BYTES || new Blob([csv]).size > EXPORT_MAX_BYTES) return null
      return { report, csv }
    } catch {
      return null
    }
  }, [draft, input, jobId, result, samples])

  return (
    <section data-testid="comsol-rheology-results" aria-labelledby="comsol-rheology-results-title" className="mt-6 space-y-4 rounded-xl border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="comsol-rheology-results-title" className="text-lg font-semibold text-ink">{zh ? '原生流变结果' : 'Native rheology results'}</h2>
          <p className="mt-1 break-all text-sm text-muted">{zh ? '作业：' : 'Job: '}{jobId || (zh ? '不可用' : 'unavailable')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="comsol-rheology-download-csv" disabled={!exports} className="rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface disabled:opacity-50" onClick={() => exports && download('comsol-rheology-results.csv', exports.csv, 'text/csv;charset=utf-8')}>{zh ? '下载 CSV' : 'Download CSV'}</button>
          <button type="button" data-testid="comsol-rheology-download-json" disabled={!exports} className="rounded-lg border border-edge px-3 py-2 text-sm text-ink hover:bg-surface disabled:opacity-50" onClick={() => exports && download('comsol-rheology-results.json', exports.report, 'application/json;charset=utf-8')}>{zh ? '下载 JSON' : 'Download JSON'}</button>
        </div>
      </div>

      {!samples ? (
        <p role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-ink">{zh ? '原生输出格式无效或不受支持；未显示结果样本。' : 'Invalid or unsupported native output; no result samples are displayed.'}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-edge">
          <table data-testid="comsol-rheology-samples" className="w-full text-left text-sm">
            <caption className="px-3 py-2 text-left font-medium text-ink">{zh ? '原生返回的剪切样本' : 'Native returned shear samples'}</caption>
            <thead className="bg-surface text-muted"><tr>
              <th scope="col" className="px-3 py-2 font-medium">{zh ? '剪切速率 (1/s)' : 'Shear rate (1/s)'}</th>
              <th scope="col" className="px-3 py-2 font-medium">{zh ? '有效黏度 (Pa·s)' : 'Effective viscosity (Pa·s)'}</th>
              <th scope="col" className="px-3 py-2 font-medium">{zh ? '剪切应力 (Pa)' : 'Shear stress (Pa)'}</th>
              <th scope="col" className="px-3 py-2 font-medium">{zh ? '状态' : 'Status'}</th>
            </tr></thead>
            <tbody>{samples.map((row, index) => <tr key={`${row.shearRate}-${index}`} className="border-t border-edge">
              <td className="px-3 py-2 font-mono text-ink">{format(row.shearRate)}</td>
              <td className="px-3 py-2 font-mono text-ink">{row.singular && row.effectiveViscosity === null ? (zh ? '奇异（无值）' : 'Singular (no value)') : format(row.effectiveViscosity)}</td>
              <td className="px-3 py-2 font-mono text-ink">{row.singular && row.shearStress === null ? (zh ? '奇异（无值）' : 'Singular (no value)') : format(row.shearStress)}</td>
              <td className="px-3 py-2 text-ink">{row.singular ? (zh ? '奇异' : 'Singular') : (zh ? '有效' : 'Valid')}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {samples && !exports && <p role="status" className="text-sm text-amber-300">{zh ? '输入或结果超过 1 MiB 导出上限，无法生成下载文件。' : 'Input or result exceeds the 1 MiB export limit; downloads are unavailable.'}</p>}
      <p className="text-xs text-muted">{zh ? '表格只展示原生返回的样本；不表示与 COMSOL 求解器的数值一致。' : 'The table shows native returned samples only; it does not claim numerical parity with COMSOL.'}</p>
    </section>
  )
}

export default ComsolRheologyResults

import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ModuleComputeContext, useModuleCompute } from '../../lib/hooks/useModuleCompute'
import { useLocale } from '../../lib/i18n'
import type { ModuleComputeOutput } from '../../lib/sim/module-compute'
import { buildStarCcmCflInput, createStarCcmCflReport, STAR_CCM_CFL_MAX, type StarCcmCflInput } from '../../lib/star-ccm-cfl'
import { parseStarCcmCflCsv, STAR_CCM_CFL_CSV_COLUMNS, STAR_CCM_CFL_CSV_MAX_BYTES, STAR_CCM_CFL_CSV_MAX_ROWS, type StarCcmCflRow } from '../../lib/star-ccm-cfl-csv'
import { formatStarCcmCflResultCsv, validateStarCcmCflResult, type ValidatedStarCcmCflResult } from '../../lib/star-ccm-cfl-result'

const MAX_CFL = STAR_CCM_CFL_MAX
const FALLBACK_INPUT: StarCcmCflInput = {
  module: 'sw-su2-cfl', backend: 'host', method: 'method-algo-su2-cfl-directional-local', cfl: 1,
  cells: [[0.01, 0.01, 0.01, 1, 0, 0, 340]],
}

type SavedReport = { input: StarCcmCflInput; sourceCsv: string; rows: StarCcmCflRow[]; cfl: number; output: ModuleComputeOutput; validatedResult: ValidatedStarCcmCflResult; jobId: string }

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function StarCcmCflPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const execution = useContext(ModuleComputeContext)
  const [csv, setCsv] = useState('')
  const [rows, setRows] = useState<StarCcmCflRow[] | null>(null)
  const [cflText, setCflText] = useState('1')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saved, setSaved] = useState<SavedReport | null>(null)
  const pending = useRef<{ input: string; sourceCsv: string; rows: StarCcmCflRow[]; cfl: number } | null>(null)
  const cfl = useMemo(() => {
    const text = cflText.trim()
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null
    const value = Number(text)
    return Number.isFinite(value) && value > 0 && value <= MAX_CFL ? value : null
  }, [cflText])
  const parsedInput = useMemo(() => {
    if (!rows || cfl === null) return null
    try { return buildStarCcmCflInput(rows, cfl) } catch { return null }
  }, [rows, cfl])
  const compute = useModuleCompute(parsedInput ?? FALLBACK_INPUT, () => parsedInput ?? FALLBACK_INPUT)

  useEffect(() => {
    if (execution?.target === 'browser') void execution.setTarget('backend')
  }, [execution?.target])

  useEffect(() => {
    const submission = pending.current
    if (execution?.status === 'succeeded' && compute.result && compute.submittedInput && execution.jobId && submission) {
      if (JSON.stringify(compute.submittedInput) !== submission.input) return
      let validatedResult: ValidatedStarCcmCflResult
      try {
        validatedResult = validateStarCcmCflResult(compute.result, submission.rows.length)
      } catch (cause) {
        setSaved(null)
        setNotice('')
        setError(cause instanceof Error ? cause.message : (zh ? 'Host CFL 响应无效。' : 'The Host CFL response is invalid.'))
        pending.current = null
        return
      }
      setSaved({
        input: compute.submittedInput as StarCcmCflInput,
        sourceCsv: submission.sourceCsv,
        rows: submission.rows,
        cfl: submission.cfl,
        output: compute.result as ModuleComputeOutput,
        validatedResult,
        jobId: execution.jobId,
      })
      setError('')
      setNotice(zh ? `已保存 Host 任务 ${execution.jobId} 的 CFL 估算报告。` : `Saved CFL estimate from Host job ${execution.jobId}.`)
      pending.current = null
    }
    if (execution?.status === 'failed' || execution?.status === 'cancelled') pending.current = null
  }, [compute.result, compute.submittedInput, execution?.jobId, execution?.status, zh])

  const parseCsv = (value: string) => {
    setCsv(value)
    setRows(null)
    setError('')
    setNotice('')
    setSaved(null)
    try {
      const parsed = parseStarCcmCflCsv(value)
      setRows(parsed)
      setNotice(zh ? `已读取 ${parsed.length} 个单元。` : `Loaded ${parsed.length} cells.`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const onFile = async (file?: File) => {
    if (!file) return
    if (file.size > STAR_CCM_CFL_CSV_MAX_BYTES) {
      parseCsv('')
      setError(zh ? 'CSV 超过 512 KiB 限制。' : 'CSV exceeds the 512 KiB limit.')
      return
    }
    parseCsv(await file.text())
  }

  const submit = () => {
    if (!parsedInput || !rows || cfl === null || !execution || execution.target !== 'backend' || !execution.connected || execution.busy || execution.cancelPending) return
    pending.current = { input: JSON.stringify(parsedInput), sourceCsv: csv, rows, cfl }
    setSaved(null)
    setNotice('')
    void execution.start(true)
  }

  return <section className="space-y-4 rounded-xl border border-cyan-400/20 bg-cyan-950/10 p-4" aria-label={zh ? 'STAR-CCM+ CFL 估算' : 'STAR-CCM+ CFL estimate'}>
    <div>
      <h2 className="font-semibold">{zh ? '方向性 CFL 估算' : 'Directional CFL estimate'}</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-300">{zh
        ? '导入有界的 WaveWorld 自定义单元 CSV，使用已发布的 W-Sim sw-su2-cfl / method-algo-su2-cfl-directional-local Host 操作估算方向性 CFL。'
        : 'Import a bounded WaveWorld-defined cell CSV and estimate directional CFL with the released W-Sim sw-su2-cfl / method-algo-su2-cfl-directional-local Host operation.'}</p>
    </div>
    <p className="rounded border border-amber-300/20 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-100">{zh
      ? '这只是基于输入笛卡尔单元尺寸、速度和声速的估算，不是完整求解器时间步。此功能不提供 STAR-CCM+ 厂商文件/API/宏互操作，也不保证数值等价、稳定性或厂商验证结果。'
      : 'This is an estimate from supplied Cartesian cell extents, velocity, and sound speed, not a full solver timestep. It provides no STAR-CCM+ vendor file, API, or macro interoperability and makes no numerical-equivalence, stability, or vendor-validation guarantee.'}</p>
    <div className="space-y-2 rounded border border-edge p-3 text-xs text-slate-300">
      <p className="font-medium">{zh ? '固定列格式' : 'Fixed column format'}</p>
      <code className="block break-all font-mono">{STAR_CCM_CFL_CSV_COLUMNS.join(',')}</code>
      <p>{zh ? '严格 UTF-8 CSV，列顺序必须完全一致；限制为 512 KiB 和 5,000 个单元。单元 ID 必须唯一且为正安全整数；尺寸必须为正值，声速不得为负。' : 'Strict UTF-8 CSV with exact column order; limited to 512 KiB and 5,000 cells. Cell IDs must be unique positive safe integers, extents positive, and sound speed non-negative.'}</p>
      <a className="underline" href="/datasets/star-ccm/directional-cfl-example.csv" download>{zh ? '下载说明性 CSV 样例' : 'Download illustrative CSV sample'}</a>
    </div>
    <label className="block text-sm text-slate-300">{zh ? '选择 CSV 文件' : 'Choose CSV file'}
      <input type="file" accept=".csv,text/csv" disabled={execution?.busy} onChange={event => { void onFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} className="mt-1 block w-full text-sm file:mr-3 file:rounded file:border file:border-edge file:bg-surface file:px-3 file:py-2" />
    </label>
    <label className="block text-sm text-slate-300">{zh ? '或粘贴 CSV 文本' : 'Or paste CSV text'}
      <textarea aria-label={zh ? '粘贴 CFL CSV' : 'Paste CFL CSV'} value={csv} disabled={execution?.busy} onChange={event => parseCsv(event.currentTarget.value)} spellCheck={false} rows={6} className="mt-1 block w-full rounded-lg border border-edge bg-slate-950 p-3 font-mono text-xs text-slate-100" />
    </label>
    <label className="block max-w-xs text-sm text-slate-300">{zh ? `CFL 倍数（0 < CFL ≤ ${MAX_CFL}）` : `CFL factor (0 < CFL ≤ ${MAX_CFL})`}
      <input type="number" min="0" max={MAX_CFL} step="any" value={cflText} disabled={execution?.busy} onChange={event => setCflText(event.currentTarget.value)} className="mt-1 w-full rounded border border-edge bg-slate-950 p-2 text-sm" />
    </label>
    {cfl === null && <p role="alert" className="text-sm text-amber-200">{zh ? `CFL 必须是大于 0 且不超过 ${MAX_CFL} 的有限数值。` : `CFL must be a finite value greater than 0 and at most ${MAX_CFL}.`}</p>}
    {rows && <div className="space-y-2">
      <p className="text-xs text-emerald-300">{zh ? `已解析 ${rows.length}/${STAR_CCM_CFL_CSV_MAX_ROWS} 个单元。` : `Parsed ${rows.length}/${STAR_CCM_CFL_CSV_MAX_ROWS} cells.`}</p>
      <div className="max-h-64 overflow-auto rounded border border-edge"><table className="min-w-full text-left text-xs"><caption className="sr-only">Imported cells for directional CFL estimate</caption><thead className="sticky top-0 bg-slate-900 text-slate-300"><tr>{['Cell ID', 'Cell extents (m)', 'Velocity (m/s)', 'Sound speed (m/s)'].map(label => <th key={label} scope="col" className="px-2 py-2">{label}</th>)}</tr></thead><tbody>{rows.slice(0, 100).map(row => <tr key={row.cellId} className="border-t border-edge/70"><td className="px-2 py-1">{row.cellId}</td><td className="px-2 py-1">{`${row.hx_m}, ${row.hy_m}, ${row.hz_m}`}</td><td className="px-2 py-1">{`${row.ux_m_s}, ${row.uy_m_s}, ${row.uz_m_s}`}</td><td className="px-2 py-1">{row.soundSpeed_m_s}</td></tr>)}</tbody></table></div>
      {rows.length > 100 && <p className="text-xs text-slate-400">{zh ? '预览显示前 100 行；JSON 报告包含全部解析行。' : 'Preview shows the first 100 rows; the JSON report contains all parsed rows.'}</p>}
    </div>}
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn bg-cyan-300 text-slate-950 disabled:opacity-50" onClick={submit} disabled={!parsedInput || !execution?.connected || execution.target !== 'backend' || execution.busy || execution.cancelPending}>{execution?.busy ? (zh ? '任务提交中…' : 'Submitting…') : (zh ? '提交 CFL 估算到 Host' : 'Submit CFL estimate to Host')}</button>
      {execution?.busy && <button type="button" className="btn border border-edge" onClick={() => void execution.stop()}>{zh ? '取消任务' : 'Cancel job'}</button>}
      {execution?.jobId && <a className="text-sm text-cyan-300 underline" href={`/batch-jobs?job=${encodeURIComponent(execution.jobId)}`}>{zh ? '查看已保存任务' : 'View saved job'}</a>}
    </div>
    {notice && <p role="status" className="text-sm text-emerald-200">{notice}</p>}
    {execution?.error && <p role="alert" className="text-sm text-rose-300">{execution.error}</p>}
    {saved && <section className="space-y-3 rounded-lg border border-edge bg-slate-950/30 p-3" aria-label={zh ? '已保存 CFL 估算结果' : 'Saved CFL estimate'}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{zh ? '已保存的 Host 估算报告' : 'Saved Host estimate report'}</h3><p className="text-xs text-slate-400">{saved.rows.length} cells · CFL {saved.cfl} · Host job {saved.jobId}</p></div><div className="flex gap-2"><button type="button" className="btn border border-edge" onClick={() => download('waveworld-starccm-cfl-report.json', JSON.stringify(createStarCcmCflReport({ jobId: saved.jobId, sourceCsv: saved.sourceCsv, rows: saved.rows, cfl: saved.cfl, submittedInput: saved.input, result: saved.output }), null, 2), 'application/json;charset=utf-8')}>{zh ? 'JSON 报告' : 'JSON report'}</button><button type="button" className="btn border border-edge" onClick={() => download('waveworld-starccm-cfl-result.csv', formatStarCcmCflResultCsv(saved.validatedResult, saved.rows.map(row => row.cellId)), 'text/csv;charset=utf-8')}>{zh ? '结果 CSV' : 'Result CSV'}</button></div></div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-edge p-3 text-xs text-slate-300">{JSON.stringify(saved.output, null, 2)}</pre>
      <p className="text-xs text-slate-400">{zh ? 'JSON 报告保留原始 CSV、解析行、CFL 倍数、精确提交输入和完整 Host 响应。' : 'The JSON report preserves the source CSV, parsed rows, CFL factor, exact submitted input, and full Host response.'}</p>
    </section>}
  </section>
}

import { useState } from 'react'
import { useLocale } from '../lib/i18n'
import { parseStarCcmResidualCsv, STAR_CCM_RESIDUAL_CSV_MAX_BYTES } from '../lib/star-ccm-residual-csv'

const MAX_SETTING = 1_000_000

export interface StarCcmConvergenceHistories {
  iterations: number[]
  residuals: Record<string, number[]>
  monitors: Record<string, number[]>
}

export interface StarCcmConvergenceStudyInputValue extends StarCcmConvergenceHistories {
  residualTolerance: number
  monitorTolerance: number
  monitorWindow: number
}

type Props = {
  onInputChange: (input: StarCcmConvergenceStudyInputValue | null, error: string | null) => void
  disabled?: boolean
}

/** CSV history input and convergence thresholds; this parses app-defined plain CSV only. */
export function StarCcmConvergenceStudyInput({ onInputChange, disabled = false }: Props) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [csv, setCsv] = useState('')
  const [residualTolerance, setResidualTolerance] = useState('1e-3')
  const [monitorTolerance, setMonitorTolerance] = useState('1e-2')
  const [monitorWindow, setMonitorWindow] = useState('10')
  const [error, setError] = useState<string | null>(null)

  const update = (nextCsv = csv, nextResidual = residualTolerance, nextMonitor = monitorTolerance, nextWindow = monitorWindow) => {
    setCsv(nextCsv)
    setError(null)
    let parsed: StarCcmConvergenceHistories
    try {
      const result = parseStarCcmResidualCsv(nextCsv)
      parsed = { iterations: result.iterations, residuals: result.input.residuals ?? {}, monitors: result.input.monitors ?? {} }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not parse CSV.'
      setError(message)
      onInputChange(null, message)
      return
    }
    const residual = Number(nextResidual)
    const monitor = Number(nextMonitor)
    const window = Number(nextWindow)
    if (!Number.isFinite(residual) || residual <= 0 || residual > MAX_SETTING || !Number.isFinite(monitor) || monitor <= 0 || monitor > MAX_SETTING || !Number.isInteger(window) || window < 1 || window > MAX_SETTING) {
      const message = 'Tolerances must be positive and no greater than 1,000,000; monitor window must be an integer from 1 to 1,000,000.'
      setError(message)
      onInputChange(null, message)
      return
    }
    onInputChange({ ...parsed, residualTolerance: residual, monitorTolerance: monitor, monitorWindow: window }, null)
  }

  const onFile = async (file?: File) => {
    if (!file) return
    if (file.size > STAR_CCM_RESIDUAL_CSV_MAX_BYTES) {
      update('')
      const message = 'CSV exceeds the 512 KiB limit.'
      setError(message)
      onInputChange(null, message)
      return
    }
    update(await file.text())
  }

  return <section className="space-y-4 rounded-lg border border-edge bg-panel p-4">
    <div>
      <h3 className="text-sm font-semibold text-slate-100">{zh ? 'STAR-CCM+ 收敛研究输入' : 'Residual history CSV'}</h3>
      <p className="mt-1 text-xs text-slate-400">{zh ? '选择 CSV 文件或粘贴数据。格式为本应用定义的普通 CSV，不代表 STAR-CCM+ 原生导出格式。限制：512 KiB、5,000 个数据行、16 个序列列、80,000 个数值。' : 'Select a CSV file or paste data. This is app-defined plain CSV, not a claim about a STAR-CCM+ vendor export format. Limits: 512 KiB, 5,000 data rows, 16 series columns, and 80,000 numeric values.'}</p>
    </div>
    <div className="rounded border border-edge bg-slate-950/50 p-3 text-xs text-slate-300">
      <p className="font-medium">{zh ? '格式' : 'Format'}</p>
      <code className="mt-1 block break-all font-mono">iteration,residual:&lt;name&gt;,monitor:&lt;name&gt;</code>
      <code className="mt-1 block font-mono">1,0.1,12.0</code>
      <p className="mt-1 text-slate-400">{zh ? '第一列必须是严格递增的正整数 iteration；其余列为有限数值，且每个序列名称必须唯一。至少需要一个残差或监视器列。容差范围为 (0, 1,000,000]；窗口为 1 至 1,000,000 的整数。' : 'The first column is a strictly increasing positive integer iteration. Remaining columns contain finite numbers with unique series names; include at least one residual or monitor column. Tolerances must be in (0, 1,000,000]; the window is an integer from 1 to 1,000,000.'}</p>
    </div>
    <label className="block text-sm text-slate-300">{zh ? '选择 CSV 文件' : 'Choose CSV file'}
      <input type="file" accept=".csv,text/csv" disabled={disabled} onChange={event => { void onFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} className="mt-1 block w-full text-sm text-slate-300 file:mr-3 file:rounded file:border file:border-edge file:bg-surface file:px-3 file:py-2 file:text-slate-100" />
    </label>
    <label className="block text-sm text-slate-300">{zh ? '或粘贴 CSV 文本' : 'Or paste CSV text'}
      <textarea aria-label={zh ? '粘贴收敛 CSV' : 'Paste convergence CSV'} value={csv} disabled={disabled} onChange={event => update(event.currentTarget.value)} spellCheck={false} rows={7} className="mt-1 block w-full rounded-lg border border-edge bg-slate-950 p-3 font-mono text-xs text-slate-100" />
    </label>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-xs text-slate-300">{zh ? '残差容差' : 'Residual tolerance'}<input type="number" min="0" max={MAX_SETTING} step="any" value={residualTolerance} disabled={disabled} onChange={event => { setResidualTolerance(event.currentTarget.value); update(csv, event.currentTarget.value) }} className="mt-1 w-full rounded border border-edge bg-slate-950 p-2 text-sm" /></label>
      <label className="text-xs text-slate-300">{zh ? '监视器容差' : 'Monitor tolerance'}<input type="number" min="0" max={MAX_SETTING} step="any" value={monitorTolerance} disabled={disabled} onChange={event => { setMonitorTolerance(event.currentTarget.value); update(csv, residualTolerance, event.currentTarget.value) }} className="mt-1 w-full rounded border border-edge bg-slate-950 p-2 text-sm" /></label>
      <label className="text-xs text-slate-300">{zh ? '监视器窗口' : 'Monitor window'}<input type="number" min="1" max={MAX_SETTING} step="1" value={monitorWindow} disabled={disabled} onChange={event => { setMonitorWindow(event.currentTarget.value); update(csv, residualTolerance, monitorTolerance, event.currentTarget.value) }} className="mt-1 w-full rounded border border-edge bg-slate-950 p-2 text-sm" /></label>
    </div>
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    {!error && csv && <p className="text-xs text-emerald-300">{zh ? 'CSV 已解析并可供研究使用。' : 'CSV parsed and ready for the study.'}</p>}
  </section>
}

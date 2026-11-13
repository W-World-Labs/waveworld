import { useContext, useEffect, useMemo, useState } from 'react'
import { ModuleComputeContext, useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useLocale } from '../lib/i18n'
import type { ModuleComputeInput } from '../lib/sim/module-compute'
import { StarCcmConvergenceHistory } from '../components/StarCcmConvergenceHistory'
import { StarCcmConvergenceStudyInput, type StarCcmConvergenceStudyInputValue } from '../components/StarCcmConvergenceStudyInput'
import { createStarCcmConvergenceExportContents } from '../lib/starCcmConvergenceExport'

const CONVERGENCE_MODULE = 'sw-ansys-report'

type ConvergenceInput = ModuleComputeInput & {
  module: typeof CONVERGENCE_MODULE
  backend: 'host'
  method: 'convergence'
  residuals?: Record<string, number[]>
  monitors?: Record<string, number[]>
  tolerance: number
  monitorTolerance: number
  monitorWindow: number
}

const EMPTY_INPUT: ConvergenceInput = {
  module: CONVERGENCE_MODULE,
  backend: 'host',
  method: 'convergence',
  residuals: { pending: [1] },
  tolerance: 1e-3,
  monitorTolerance: 1e-2,
  monitorWindow: 10,
}

function buildNativeInput(value: StarCcmConvergenceStudyInputValue): ConvergenceInput {
  return {
    module: CONVERGENCE_MODULE,
    backend: 'host',
    method: 'convergence',
    ...(Object.keys(value.residuals).length ? { residuals: value.residuals } : {}),
    ...(Object.keys(value.monitors).length ? { monitors: value.monitors } : {}),
    tolerance: value.residualTolerance,
    monitorTolerance: value.monitorTolerance,
    monitorWindow: value.monitorWindow,
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function numberAt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function download(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function StarCcmConvergenceStudy() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const execution = useContext(ModuleComputeContext)
  const [study, setStudy] = useState<StarCcmConvergenceStudyInputValue | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const nativeInput = useMemo(() => study ? buildNativeInput(study) : EMPTY_INPUT, [study])
  const compute = useModuleCompute(nativeInput)

  useEffect(() => {
    if (execution?.target === 'browser') void execution.setTarget('backend')
  }, [execution?.target])

  const submit = () => {
    if (!study || !execution || execution.target !== 'backend' || execution.busy || execution.cancelPending) return
    setExportError(null)
    void execution.start(true)
  }

  const output = compute.result as unknown as Record<string, unknown> | null
  const diagnostic = record(output?.result) ?? output
  const labels = study?.iterations ?? []
  const series = study ? [
    ...Object.entries(study.residuals).map(([name, values]) => ({ name: `residual:${name}`, values })),
    ...Object.entries(study.monitors).map(([name, values]) => ({ name: `monitor:${name}`, values })),
  ] : []
  const exportContents = study && diagnostic ? () => createStarCcmConvergenceExportContents({
    importedInput: {
      module: CONVERGENCE_MODULE,
      method: 'convergence',
      backend: 'host',
      tolerance: study.residualTolerance,
      monitorTolerance: study.monitorTolerance,
      monitorWindow: study.monitorWindow,
    },
    iterationLabels: labels,
    series,
    nativeDiagnosticResult: output,
  }) : null
  const exportJson = () => {
    if (!exportContents) return
    try {
      download('waveworld-starccm-convergence-study.json', exportContents().json, 'application/json;charset=utf-8')
      setExportError(null)
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const exportCsv = () => {
    if (!exportContents) return
    try {
      download('waveworld-starccm-convergence-study.csv', exportContents().csv, 'text/csv;charset=utf-8')
      setExportError(null)
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const firstConvergedIndex = numberAt(diagnostic?.iterationsToConverge)
  const firstConvergedIteration = firstConvergedIndex === null ? null : labels[firstConvergedIndex] ?? null
  const mapPosition = (value: unknown): number | null => {
    const position = numberAt(value)
    return position !== null && Number.isInteger(position) && position >= 0 ? labels[position] ?? null : null
  }
  const residualDiagnostics = Object.entries(record(diagnostic?.residuals) ?? {})
  const monitorDiagnostics = Object.entries(record(diagnostic?.monitors) ?? {})

  return <section className="space-y-4 rounded-xl border border-cyan-400/20 bg-cyan-950/10 p-4" aria-label={zh ? 'STAR-CCM+ 收敛研究' : 'STAR-CCM+ convergence study'}>
    <div>
      <h2 className="text-xl font-semibold text-slate-100">STAR-CCM+ convergence study</h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-300">{zh
        ? '导入残差与监控历史，检查已存在的 Host 原生收敛诊断，并按原始迭代号查看和导出。'
        : 'Import residual and monitor histories, apply the existing Host-native convergence diagnostic, and view or export values against their original iteration labels.'}</p>
    </div>
    <p className="text-xs leading-relaxed text-amber-200/90">{zh
      ? '输入 CSV 是 WaveWorld 定义的普通表格格式，不代表 STAR-CCM+ 专有导出格式。研究只诊断已提供的数据；不会控制或运行 STAR-CCM+ 求解器，也不表示 Siemens 数值等价。'
      : 'The CSV is a WaveWorld-defined plain table format, not a claimed STAR-CCM+ proprietary export format. This study diagnoses supplied data; it does not control or run the STAR-CCM+ solver and does not claim Siemens numerical equivalence.'}</p>
    <StarCcmConvergenceStudyInput onInputChange={(next, error) => { setStudy(next); setInputError(error); setExportError(null) }} disabled={execution?.busy} />
    {inputError && <p role="alert" className="text-sm text-amber-200">{inputError}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn bg-cyan-300 text-slate-950 disabled:opacity-50" disabled={!study || !execution?.connected || execution.target !== 'backend' || execution.busy || execution.cancelPending} onClick={submit}>{execution?.busy ? (zh ? '任务运行中…' : 'Analyzing…') : 'Analyze convergence history'}</button>
      {execution?.busy && <button type="button" className="btn border border-edge" onClick={() => void execution.stop()}>{zh ? '取消任务' : 'Cancel job'}</button>}
      {execution?.status && <span role="status" className="text-xs text-slate-400">{execution.status}</span>}
      {execution?.jobId && <span className="text-xs text-slate-400">{zh ? 'Host 任务' : 'Host job'}: {execution.jobId}</span>}
    </div>
    {execution?.error && <p role="alert" className="text-sm text-rose-300">{execution.error}</p>}
    {study && <StarCcmConvergenceHistory iterations={study.iterations} residuals={study.residuals} monitors={study.monitors} tolerance={study.residualTolerance} />}
    {diagnostic && output && <section className="space-y-3 rounded-lg border border-emerald-400/20 bg-emerald-950/10 p-4" aria-label={zh ? '收敛诊断结果' : 'Convergence diagnostic result'}>
      <div className="flex flex-wrap items-center justify-between gap-2"><div>
        <h3 className="font-semibold text-emerald-100">{zh ? '原生诊断结果' : 'Native diagnostic result'}</h3>
        <p className="text-xs text-slate-400">{zh ? `模块：${CONVERGENCE_MODULE} · 首次全部残差满足阈值：` : `Module: ${CONVERGENCE_MODULE} · First iteration where all residuals meet tolerance: `}{firstConvergedIteration ?? (firstConvergedIndex === null ? (zh ? '未达到' : 'not reached') : (zh ? '标签缺失' : 'label unavailable'))}</p>
      </div><div className="flex gap-2">
        <button type="button" className="btn border border-edge" onClick={exportCsv}>{zh ? '导出 CSV 表格' : 'Export CSV table'}</button>
        <button type="button" className="btn border border-edge" onClick={exportJson}>{zh ? '导出 JSON 报告' : 'Export JSON report'}</button>
      </div></div>
      {exportError && <p role="alert" className="text-sm text-amber-200">{exportError}</p>}
      <p className="text-xs leading-relaxed text-slate-400">{zh ? '收敛索引由原生模块按序列位置报告，页面已映射为导入 CSV 中相应的迭代标签。' : 'The native module reports a series position; this page maps it to the corresponding imported iteration label.'}</p>
      {!!residualDiagnostics.length && <div className="overflow-x-auto"><h4 className="mb-2 text-sm font-medium">{zh ? '残差阈值诊断' : 'Residual tolerance diagnostics'}</h4><table className="w-full min-w-[38rem] text-left text-xs"><thead><tr className="border-b border-edge text-slate-400"><th className="p-2">{zh ? '残差' : 'Residual'}</th><th className="p-2">{zh ? '初值' : 'Initial'}</th><th className="p-2">{zh ? '终值' : 'Final'}</th><th className="p-2">{zh ? '比例' : 'Ratio'}</th><th className="p-2">{zh ? '单调下降' : 'Monotonic decrease'}</th><th className="p-2">{zh ? '首次达标迭代' : 'First iteration at tolerance'}</th></tr></thead><tbody>{residualDiagnostics.map(([name, raw]) => {
        const item = record(raw) ?? {}
        const reachedAt = mapPosition(item.iterationsToTolerance)
        return <tr key={name} className="border-b border-edge/60 text-slate-200"><th scope="row" className="p-2 font-medium">{name}</th><td className="p-2">{String(item.initial ?? '—')}</td><td className="p-2">{String(item.final ?? '—')}</td><td className="p-2">{String(item.ratio ?? '—')}</td><td className="p-2">{String(item.monotonicDecrease ?? '—')}</td><td className="p-2">{reachedAt ?? (item.iterationsToTolerance === null ? (zh ? '未达到' : 'not reached') : '—')}</td></tr>
      })}</tbody></table></div>}
      {!!monitorDiagnostics.length && <div className="overflow-x-auto"><h4 className="mb-2 text-sm font-medium">{zh ? '监视器窗口诊断' : 'Monitor window diagnostics'}</h4><table className="w-full min-w-[32rem] text-left text-xs"><thead><tr className="border-b border-edge text-slate-400"><th className="p-2">{zh ? '监视器' : 'Monitor'}</th><th className="p-2">{zh ? '均值' : 'Mean'}</th><th className="p-2">{zh ? '终值' : 'Final'}</th><th className="p-2">{zh ? '相对窗口波动' : 'Relative window spread'}</th><th className="p-2">{zh ? '窗口收敛' : 'Window converged'}</th></tr></thead><tbody>{monitorDiagnostics.map(([name, raw]) => {
        const item = record(raw) ?? {}
        return <tr key={name} className="border-b border-edge/60 text-slate-200"><th scope="row" className="p-2 font-medium">{name}</th><td className="p-2">{String(item.mean ?? '—')}</td><td className="p-2">{String(item.final ?? '—')}</td><td className="p-2">{String(item.relativeWindowSpread ?? '—')}</td><td className="p-2">{String(item.monitorConverged ?? '—')}</td></tr>
      })}</tbody></table></div>}
      <details className="rounded-lg border border-edge bg-slate-950/60 p-3"><summary className="cursor-pointer py-2 text-sm text-slate-300">{zh ? '查看完整诊断 JSON' : 'Inspect full diagnostic JSON'}</summary><pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300">{JSON.stringify(output, null, 2)}</pre></details>
    </section>}
  </section>
}

import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ModuleComputeContext, useModuleCompute, useModuleExecution } from '../../lib/hooks/useModuleCompute'
import {
  importAbaqusAmplitudeSource,
  validateAbaqusAmplitudeResult,
  type AbaqusAmplitudeImport,
  type AbaqusAmplitudeModuleInput,
} from '../../lib/sim/abaqus-amplitude-import'
import { createModuleJobSpec } from '../../lib/sim/module-compute'
import { useLocale } from '../../lib/i18n'

const EMPTY_INPUT: AbaqusAmplitudeModuleInput = {
  module: 'sw-calculix-amplitude',
  backend: 'host',
  curves: [{ name: 'A1', time: 'step', definition: 'tabular', pairs: [[0, 0], [1, 1]] }],
  queries: [{ curve: 'A1', t: 0 }, { curve: 'A1', t: 1 }],
}

function downloadReport(input: AbaqusAmplitudeModuleInput, result: unknown, jobId: string | null): void {
  const content = JSON.stringify({
    jobId,
    sourceWorkflow: 'abaqus-amplitude-source-import',
    module: input.module,
    submittedInput: input,
    result,
    limitations: [
      'Imports standalone named TABULAR *AMPLITUDE cards only.',
      'Does not resolve or apply amplitudes to *BOUNDARY or load cards.',
      'The W-Sim operation evaluates imported curves at their tabulated knots; it does not run Abaqus or CalculiX.',
    ],
  }, null, 2)
  const href = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = 'waveworld-abaqus-amplitude-result.json'
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 1000)
}

export function AbaqusAmplitudeImportPanel() {
  const execution = useModuleExecution()
  return <ModuleComputeContext.Provider value={execution}><AbaqusAmplitudeImportPanelContent /></ModuleComputeContext.Provider>
}

function AbaqusAmplitudeImportPanelContent() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [filename, setFilename] = useState('')
  const [imported, setImported] = useState<Extract<AbaqusAmplitudeImport, { ok: true }> | null>(null)
  const [diagnostics, setDiagnostics] = useState<string[]>([])
  const importGeneration = useRef(0)
  const input = imported?.input ?? null
  const compute = useModuleCompute(input ?? EMPTY_INPUT)
  const execution = useContext(ModuleComputeContext)

  useEffect(() => {
    if (execution?.target === 'browser') void execution.setTarget('backend')
  }, [execution?.target])

  const checkedResult = useMemo(() => {
    if (!input || !compute.result) return null
    return validateAbaqusAmplitudeResult(compute.result, input)
  }, [input, compute.result])

  const readFile = async (file: File | undefined) => {
    if (!file) return
    const generation = ++importGeneration.current
    setFilename(file.name)
    setImported(null)
    setDiagnostics([])
    if (file.size > 2 * 1024 * 1024) {
      setDiagnostics(['source exceeds 2097152 bytes'])
      return
    }
    try {
      const parsed = importAbaqusAmplitudeSource(await file.text())
      if (generation !== importGeneration.current) return
      if (parsed.ok) setImported(parsed)
      else setDiagnostics(parsed.diagnostics)
    } catch (cause) {
      if (generation !== importGeneration.current) return
      setDiagnostics([cause instanceof Error ? cause.message : String(cause)])
    }
  }

  const submit = () => {
    if (!input || !execution || execution.target !== 'backend' || execution.busy || execution.cancelPending) return
    try {
      createModuleJobSpec(input)
      void execution.start(true)
    } catch (cause) {
      execution.reportLocalError(cause)
    }
  }

  return <section data-testid="abaqus-amplitude-import" className="mt-6 space-y-4 rounded-xl border border-cyan-400/20 bg-cyan-950/10 p-4" aria-labelledby="abaqus-amplitude-import-title">
    <header className="space-y-2">
      <h2 id="abaqus-amplitude-import-title" className="text-lg font-semibold text-slate-100">{zh ? '独立工作流：Abaqus / CalculiX 幅值表导入' : 'Separate workflow: Abaqus / CalculiX amplitude table import'}</h2>
      <p className="max-w-4xl text-sm leading-relaxed text-slate-300">{zh
        ? '读取只含命名 *AMPLITUDE 卡片的 `.inp` 片段，并将表格和 STEP TIME / TOTAL TIME 交给现有 `sw-calculix-amplitude` Host-f64 原生模块。导入器在每个原始时间结点生成查询；它不会解析工程其他卡片，也不会把幅值应用到边界条件或载荷。'
        : 'Read an `.inp` fragment containing named *AMPLITUDE cards and pass each table with its STEP TIME / TOTAL TIME basis to the existing `sw-calculix-amplitude` Host-f64 native module. The importer queries the original knots. It does not parse other deck cards or apply amplitudes to boundary conditions or loads.'}</p>
      <p className="text-xs leading-relaxed text-amber-200/90">{zh
        ? '仅支持默认或 DEFINITION=TABULAR 的直线表格，以及 TIME=STEP TIME / TOTAL TIME。SMOOTH STEP、周期/调制/用户曲线、时间变换、*INCLUDE、载荷引用和其他工程卡片都会明确拒绝。超出原始结点范围的查询规则仍由原生模块按其限制处理。'
        : 'Supports only the default or DEFINITION=TABULAR linear table with TIME=STEP TIME / TOTAL TIME. SMOOTH STEP, periodic/modulated/user curves, time transforms, *INCLUDE, load references, and other deck cards are rejected explicitly. The native module retains its documented query-span limits.'}</p>
    </header>

    <div className="space-y-3 rounded-lg border border-edge bg-panel/40 p-4">
      <label className="block text-sm text-slate-300">
        <span className="mb-2 block font-medium">{zh ? '选择幅值 `.inp` 源文件' : 'Choose an amplitude `.inp` source file'}</span>
        <input aria-label="Abaqus amplitude source file" type="file" accept=".inp,text/plain" className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-cyan-300 file:px-3 file:py-2 file:font-medium file:text-slate-950" onChange={event => { void readFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
      </label>
      {filename && <p className="text-xs text-slate-400">{zh ? '来源文件：' : 'Source file: '}<code>{filename}</code></p>}
      {diagnostics.length > 0 && <ul role="alert" className="space-y-1 text-sm text-red-200">{diagnostics.map((message, index) => <li key={`${index}:${message}`}>{message}</li>)}</ul>}
      {imported && <div className="space-y-2 text-sm text-slate-300" role="status">
        <p>{zh ? `已导入 ${imported.curves.length} 条曲线、${input?.queries.length ?? 0} 个结点查询。` : `Imported ${imported.curves.length} curves and ${input?.queries.length ?? 0} knot queries.`}</p>
        <ul className="space-y-1 font-mono text-xs text-slate-400">{imported.curves.map(curve => <li key={curve.name}>{curve.name} · {curve.time === 'total' ? 'TOTAL TIME' : 'STEP TIME'} · {curve.pairs.length} {zh ? '结点' : 'knots'}</li>)}</ul>
      </div>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" aria-label="Submit imported amplitude to Host" className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50" disabled={!input || !execution?.connected || execution.target !== 'backend' || execution.busy || execution.cancelPending} onClick={submit}>{execution?.busy ? (zh ? '任务提交中…' : 'Submitting job…') : (zh ? '提交导入曲线到 Host' : 'Submit imported curves to Host')}</button>
        {execution?.busy && <button type="button" className="btn border border-edge" onClick={() => void execution.stop()}>{zh ? '停止任务' : 'Stop job'}</button>}
        {execution?.status && <span data-testid="abaqus-amplitude-execution-status" role="status" className="text-sm text-slate-400">{execution.status}</span>}
        {execution?.error && <p role="alert" className="w-full text-sm text-red-200">{execution.error}</p>}
        {execution?.loginRequired && <p data-testid="abaqus-amplitude-login-required" role="status" className="w-full text-sm text-amber-200">{zh ? '需要登录后才能提交此 Host 任务。' : 'Sign in before submitting this Host job.'}</p>}
      </div>
      {imported && <details className="rounded-lg border border-edge bg-slate-950/60 p-3">
        <summary className="min-h-10 cursor-pointer py-2 text-sm text-slate-300">{zh ? '查看生成的原生模块输入' : 'Inspect generated native module input'}</summary>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300">{JSON.stringify(imported.input, null, 2)}</pre>
      </details>}
    </div>

    {checkedResult?.ok && input && compute.result && <section className="space-y-3 rounded-lg border border-emerald-400/20 bg-emerald-950/10 p-4" aria-label={zh ? '导入幅值结果' : 'Imported amplitude result'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-semibold text-emerald-100">{zh ? '已验证的原生曲线结果' : 'Validated native curve result'}</h3><p className="mt-1 text-xs text-slate-400">{zh ? `任务 ${execution?.jobId ?? '—'} · 结果与当前导入输入逐点匹配。` : `Job ${execution?.jobId ?? '—'} · result matches the current imported input knot by knot.`}</p></div>
        <button type="button" aria-label="Download amplitude result" className="btn border border-edge" onClick={() => downloadReport(input, compute.result, execution?.jobId ?? null)}>{zh ? '下载结果报告 JSON' : 'Download result report JSON'}</button>
      </div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-edge bg-slate-950/60 p-3 text-xs text-slate-300">{JSON.stringify(compute.result, null, 2)}</pre>
    </section>}
    {checkedResult && !checkedResult.ok && <p role="alert" className="rounded-lg border border-red-400/20 p-3 text-sm text-red-200">{zh ? `结果校验失败：${checkedResult.diagnostic}` : `Result validation failed: ${checkedResult.diagnostic}`}</p>}
  </section>
}

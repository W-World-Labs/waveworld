import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ModuleComputeContext, useModuleCompute, useModuleExecution } from '../../lib/hooks/useModuleCompute'
import { oidcStartHref } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import { buildOpticStudioWavefrontInput } from './opticstudio-wavefront-input'
import { OPTICSTUDIO_WAVEFRONT_CSV_MAX_BYTES, parseOpticStudioWavefrontCsv, type WavefrontSample } from './opticstudio-wavefront-csv'
import { createOpticStudioWavefrontReport, validateOpticStudioWavefrontResult } from './opticstudio-wavefront-result'

const EMPTY_INPUT: ReturnType<typeof buildOpticStudioWavefrontInput> = {
  module: 'zernike',
  backend: 'host',
  operation: 'weighted-fit',
  terms: 1,
  samples: [[0, 0, 0, 1]],
}

const MAX_TERMS = 10
const SAMPLE_PREVIEW_COUNT = 8

function frozenCopy<T>(value: T): T {
  const copy = structuredClone(value)
  const freeze = (item: unknown): void => {
    if (item && typeof item === 'object' && !Object.isFrozen(item)) {
      Object.freeze(item)
      for (const child of Object.values(item)) freeze(child)
    }
  }
  freeze(copy)
  return copy
}

function displayNumber(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(8)).toString() : '—'
}

function saveReport(input: unknown, output: unknown, jobId?: string): void {
  const report = createOpticStudioWavefrontReport(input, output, jobId)
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'waveworld-opticstudio-wavefront-result.json'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Sampled WaveWorld CSV → exact host-f64 Zernike weighted-fit workflow. */
export function OpticStudioWavefrontPanel() {
  const execution = useModuleExecution()
  return <ModuleComputeContext.Provider value={execution}>
    <OpticStudioWavefrontPanelContent />
  </ModuleComputeContext.Provider>
}

function OpticStudioWavefrontPanelContent() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const execution = useContext(ModuleComputeContext)
  const [filename, setFilename] = useState('')
  const [samples, setSamples] = useState<WavefrontSample[] | null>(null)
  const [terms, setTerms] = useState(6)
  const [importError, setImportError] = useState<string | null>(null)
  const importGeneration = useRef(0)
  const submittedInputRef = useRef<ReturnType<typeof buildOpticStudioWavefrontInput> | null>(null)

  useEffect(() => () => { importGeneration.current += 1 }, [])

  const built = useMemo(() => {
    if (!samples) return { input: null, error: null }
    try {
      return { input: buildOpticStudioWavefrontInput(samples, terms), error: null }
    } catch (cause) {
      return { input: null, error: cause instanceof Error ? cause.message : String(cause) }
    }
  }, [samples, terms])
  const input = built.input ?? EMPTY_INPUT
  const compute = useModuleCompute(input, () => submittedInputRef.current ?? input)

  useEffect(() => {
    if (execution?.target === 'browser') void execution.setTarget('backend')
  }, [execution?.target])

  const clearRun = () => {
    submittedInputRef.current = null
    execution?.clear()
  }

  const readCsv = async (file: File | undefined) => {
    const generation = ++importGeneration.current
    setFilename(file?.name ?? '')
    setSamples(null)
    setImportError(null)
    clearRun()
    if (!file) return
    if (file.size <= 0 || file.size > OPTICSTUDIO_WAVEFRONT_CSV_MAX_BYTES) {
      setImportError(zh
        ? `CSV 文件必须为 1 字节至 ${OPTICSTUDIO_WAVEFRONT_CSV_MAX_BYTES} 字节。`
        : `CSV file must be between 1 and ${OPTICSTUDIO_WAVEFRONT_CSV_MAX_BYTES} bytes.`)
      return
    }
    try {
      const text = await file.text()
      if (generation !== importGeneration.current) return
      setSamples(parseOpticStudioWavefrontCsv(text))
    } catch (cause) {
      if (generation !== importGeneration.current) return
      setImportError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const submit = () => {
    if (!built.input || !execution || execution.target !== 'backend' || execution.busy || execution.cancelPending) return
    try {
      submittedInputRef.current = frozenCopy(built.input)
      void execution.start(true)
    } catch (cause) {
      execution.reportLocalError(cause)
    }
  }

  const checked = useMemo(() => {
    if (!compute.result || !compute.submittedInput) return null
    return validateOpticStudioWavefrontResult(compute.submittedInput, compute.result)
  }, [compute.result, compute.submittedInput])

  const canSubmit = !!built.input
    && Number.isInteger(terms) && terms >= 1 && terms <= MAX_TERMS
    && !!execution?.connected && execution.target === 'backend'
    && !execution.busy && !execution.cancelPending

  return <section data-testid="opticstudio-wavefront" className="mt-6 space-y-4 rounded-xl border border-cyan-400/20 bg-cyan-950/10 p-4" aria-labelledby="opticstudio-wavefront-title">
    <header className="space-y-2">
      <h2 id="opticstudio-wavefront-title" aria-label="Sampled wavefront Zernike fit" className="text-lg font-semibold text-slate-100">
        {zh ? '采样波前 Zernike 拟合' : 'Sampled wavefront Zernike fit'}
        {zh && <span className="sr-only">Sampled wavefront Zernike fit</span>}
      </h2>
      <p className="max-w-4xl text-sm leading-relaxed text-slate-300">{zh
        ? '导入 WaveWorld 定义的单位圆瞳 CSV，将采样的波前值按正权重拟合到零起始 OSA/ANSI Zernike 模式，并提交现有 Host 作业。系数不是 OpticStudio Noll 编号，不表示商业软件集成或等价。'
        : 'Import a WaveWorld-defined unit-disk CSV, fit sampled wavefront values to zero-based OSA/ANSI Zernike modes with positive weights, and submit through the existing Host job flow. Coefficients are not OpticStudio Noll numbering; this does not claim commercial integration or equivalence.'}</p>
      <p className="text-xs leading-relaxed text-amber-200/90">{zh
        ? '输入仅支持 rho ∈ [0,1]、thetaRadians ∈ [-2π,2π]、有限波前值和正权重；1–10 个模式、至多 4096 个样本。仅限 host-f64；不追迹光线、不采样瞳孔，也不读写 Zemax 镜头文件。'
        : 'Input is limited to rho ∈ [0,1], thetaRadians ∈ [-2π,2π], finite wavefront values, and positive weights; 1–10 modes and at most 4096 samples. Host-f64 only; no ray tracing, pupil sampling, or Zemax lens-file access.'}</p>
    </header>

    <div className="space-y-4 rounded-lg border border-edge bg-panel/40 p-4">
      <label className="block text-sm text-slate-300">
        <span className="mb-2 block font-medium">{zh ? '选择 WaveWorld 波前 CSV' : 'Choose a WaveWorld wavefront CSV'}</span>
        <input data-testid="opticstudio-wavefront-file" aria-label="Sampled wavefront CSV" type="file" accept=".csv,text/csv" className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-cyan-300 file:px-3 file:py-2 file:font-medium file:text-slate-950" onChange={event => { void readCsv(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
      </label>
      <p className="text-xs leading-relaxed text-slate-400">
        {zh ? 'CSV 列标题必须完全匹配：' : 'The CSV header must match exactly: '}
        <code className="rounded bg-slate-950 px-1.5 py-0.5 text-cyan-200">rho,thetaRadians,wavefront,weight</code>
        {zh ? `。仅解析 WaveWorld 定义的四列十进制格式，文件上限 ${OPTICSTUDIO_WAVEFRONT_CSV_MAX_BYTES} 字节；不是 OpticStudio 专有导出格式。` : `. This parses only WaveWorld’s four-column decimal format, up to ${OPTICSTUDIO_WAVEFRONT_CSV_MAX_BYTES} bytes; it is not an OpticStudio proprietary export format.`}
      </p>
      {filename && <p className="text-xs text-slate-400">{zh ? '来源文件：' : 'Source file: '}<code>{filename}</code></p>}
      {importError && <p data-testid="opticstudio-wavefront-import-error" role="alert" className="rounded-lg border border-red-400/30 p-3 text-sm text-red-200">{importError}</p>}

      <label className="block max-w-xs text-sm text-slate-300">
        {zh ? '拟合模式数 (1–10)' : 'Zernike terms (1–10)'}
        <input data-testid="opticstudio-wavefront-terms" type="number" min="1" max={MAX_TERMS} step="1" value={Number.isFinite(terms) ? terms : ''} onChange={event => { setTerms(event.currentTarget.value.trim() ? Number(event.currentTarget.value) : Number.NaN); clearRun() }} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2" />
      </label>

      {samples && <div className="space-y-2 text-sm text-slate-300" role="status">
        <p>{zh ? `已读取 ${samples.length} 个加权波前样本。` : `Read ${samples.length} weighted wavefront samples.`}</p>
        {samples.length < terms && <p className="text-amber-200">{zh ? `样本数至少需要等于模式数 (${terms})。` : `Sample count must be at least the number of terms (${terms}).`}</p>}
        {built.error && <p role="alert" className="text-red-200">{built.error}</p>}
        <div className="overflow-x-auto rounded border border-edge">
          <table data-testid="opticstudio-wavefront-preview" className="w-full min-w-[640px] text-right text-xs tabular-nums">
            <caption className="sr-only">{zh ? '导入的波前样本预览' : 'Imported wavefront sample preview'}</caption>
            <thead className="bg-slate-900/40 text-slate-400"><tr>
              <th className="px-3 py-2 text-left" scope="col">#</th><th className="px-3 py-2" scope="col">rho</th><th className="px-3 py-2" scope="col">thetaRadians</th><th className="px-3 py-2" scope="col">wavefront</th><th className="px-3 py-2" scope="col">weight</th>
            </tr></thead>
            <tbody>{samples.slice(0, SAMPLE_PREVIEW_COUNT).map((sample, index) => <tr key={index} className="border-t border-edge/60">
              <th className="px-3 py-2 text-left font-normal text-slate-500" scope="row">{index + 1}</th><td className="px-3 py-2">{displayNumber(sample.rho)}</td><td className="px-3 py-2">{displayNumber(sample.thetaRadians)}</td><td className="px-3 py-2">{displayNumber(sample.wavefront)}</td><td className="px-3 py-2">{displayNumber(sample.weight)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {samples.length > SAMPLE_PREVIEW_COUNT && <p className="text-xs text-slate-500">{zh ? `预览前 ${SAMPLE_PREVIEW_COUNT} 行；拟合使用全部样本。` : `Showing the first ${SAMPLE_PREVIEW_COUNT} rows; the fit uses all samples.`}</p>}
      </div>}

      {built.input && <details className="rounded-lg border border-edge bg-slate-950/60 p-3">
        <summary className="min-h-10 cursor-pointer py-2 text-sm text-slate-300">{zh ? '查看精确原生模块输入' : 'Inspect exact native module input'}</summary>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300">{JSON.stringify(built.input, null, 2)}</pre>
      </details>}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" data-testid="opticstudio-wavefront-run" aria-label="Submit sampled wavefront fit to Host" className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canSubmit} onClick={submit}>{execution?.busy ? (zh ? '正在提交…' : 'Submitting…') : (zh ? '提交加权拟合到 Host' : 'Run weighted fit on Host')}</button>
        {execution?.busy && <button type="button" data-testid="opticstudio-wavefront-cancel" className="btn border border-edge" onClick={() => void execution.stop()}>{zh ? '取消作业' : 'Cancel job'}</button>}
        {execution?.status && <span data-testid="opticstudio-wavefront-status" role="status" className="text-sm text-slate-400">{execution.status}{execution.jobId ? ` · ${zh ? '任务' : 'Job'} ${execution.jobId}` : ''}</span>}
        {execution?.cancelPending && <span role="status" className="text-xs text-amber-200">{zh ? 'Host 取消确认待完成。' : 'Waiting for Host cancellation confirmation.'}</span>}
        {execution?.error && <p data-testid="opticstudio-wavefront-error" role="alert" className="w-full text-sm text-red-200">{execution.error}{execution.loginRequired && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>{zh ? '登录' : 'Sign in'}</a>}</p>}
      </div>
    </div>

    {checked?.valid && compute.submittedInput && compute.result && <section data-testid="opticstudio-wavefront-results" className="space-y-3 rounded-lg border border-emerald-400/20 bg-emerald-950/10 p-4" aria-label={zh ? '波前拟合结果' : 'Wavefront fit result'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-semibold text-emerald-100">{zh ? '已验证的 OSA/ANSI 系数' : 'Validated OSA/ANSI coefficients'}</h3><p className="mt-1 text-xs text-slate-400">{zh ? `任务 ${execution?.jobId ?? '—'} · host-f64` : `Job ${execution?.jobId ?? '—'} · host-f64`}</p></div>
        <button type="button" data-testid="opticstudio-wavefront-report" className="btn border border-edge" onClick={() => saveReport(compute.submittedInput, compute.result, execution?.jobId ?? undefined)}>{zh ? '下载结果报告 JSON' : 'Download result report JSON'}</button>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <p><span className="text-slate-400">{zh ? '加权 RMS 残差' : 'Weighted RMS residual'}: </span><span className="tabular-nums">{displayNumber(checked.weightedRmsResidual)}</span></p>
        <p><span className="text-slate-400">{zh ? '模式数' : 'Terms'}: </span>{checked.terms}</p>
      </div>
      <div className="overflow-x-auto rounded border border-edge">
        <table className="w-full text-right text-sm tabular-nums">
          <caption className="sr-only">{zh ? '零起始 OSA/ANSI Zernike 系数' : 'Zero-based OSA/ANSI Zernike coefficients'}</caption>
          <thead className="bg-slate-900/40 text-xs text-slate-400"><tr><th className="px-3 py-2 text-left" scope="col">j</th><th className="px-3 py-2" scope="col">{zh ? '系数' : 'Coefficient'}</th></tr></thead>
          <tbody>{checked.coefficients.map((coefficient, index) => <tr key={index} className="border-t border-edge/60"><th className="px-3 py-2 text-left font-normal" scope="row">{index}</th><td className="px-3 py-2">{displayNumber(coefficient)}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">{zh ? '模式索引 j 从 0 开始，按 OSA/ANSI 排序；不是 OpticStudio Noll 编号。结果直接来自原生模块，没有重新计算或补齐。' : 'Mode index j starts at 0 in OSA/ANSI order; it is not OpticStudio Noll numbering. Values come from the native module without recalculation or filling.'}</p>
      <details className="rounded-lg border border-edge bg-slate-950/60 p-3"><summary className="min-h-10 cursor-pointer py-2 text-sm text-slate-300">{zh ? '查看完整原生结果 JSON' : 'Inspect complete native result JSON'}</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300">{JSON.stringify(compute.result, null, 2)}</pre></details>
    </section>}
    {checked && !checked.valid && <p data-testid="opticstudio-wavefront-result-error" role="alert" className="rounded-lg border border-red-400/30 p-3 text-sm text-red-200">{zh ? '原生结果未通过波前拟合校验：' : 'Native result failed wavefront-fit validation: '}{checked.errors.join(' ')}</p>}
  </section>
}

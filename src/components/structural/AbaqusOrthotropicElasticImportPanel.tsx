import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ModuleComputeContext, useModuleCompute, useModuleExecution } from '../../lib/hooks/useModuleCompute'
import {
  importAbaqusOrthotropicElasticSource,
  type AbaqusOrthotropicElasticImport,
} from '../../lib/sim/abaqus-orthotropic-elastic-import'
import { parseAbaqusOrthotropicElasticResult } from '../../lib/sim/abaqus-orthotropic-elastic-result'
import { createModuleJobSpec, type SwModuleInput } from '../../lib/sim/module-compute'
import { useLocale } from '../../lib/i18n'

type MaterialPointInput = SwModuleInput & {
  module: 'sw-calculix-orthotropic-elastic'
  backend: 'host'
  method: 'method-algo-calculix-elastic-card'
  type: 'engineering'
  lines: Array<Record<string, number>>
  eps: [number, number, number, number, number, number]
}

const EMPTY_INPUT: MaterialPointInput = {
  module: 'sw-calculix-orthotropic-elastic',
  backend: 'host',
  method: 'method-algo-calculix-elastic-card',
  type: 'engineering',
  lines: [{ E1: 1, E2: 1, E3: 1, nu12: 0, nu23: 0, nu13: 0, G12: 1, G13: 1, G23: 1 }],
  eps: [0, 0, 0, 0, 0, 0],
}

const STRAIN_LABELS = ['ε11', 'ε22', 'ε33', 'γ12', 'γ13', 'γ23'] as const
const fieldClass = 'mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-ink font-mono text-sm'

function downloadReport(input: MaterialPointInput, source: unknown, result: unknown, jobId: string | null): void {
  const content = JSON.stringify({
    jobId,
    sourceWorkflow: 'abaqus-orthotropic-elastic-source-import',
    source,
    module: input.module,
    submittedInput: input,
    result,
    conventions: {
      units: 'preserved from source; no conversion or unit inference',
      orientation: 'material principal axes; no *ORIENTATION card is read or applied',
      strain: 'CalculiX Voigt order 11,22,33,12,13,23; shear entries are engineering strains gamma=2*epsilon',
    },
    limitations: [
      'Reads one standalone *ELASTIC, TYPE=ENGINEERING CONSTANTS card only.',
      'Evaluates the existing W-Sim host-f64 material-point constitutive operation; it does not run Abaqus or CalculiX.',
      'No element integration, mesh assembly, global equilibrium solve, or deck-level material orientation is included.',
    ],
  }, null, 2)
  const href = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = 'waveworld-abaqus-orthotropic-elastic-result.json'
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 1000)
}

export function AbaqusOrthotropicElasticImportPanel() {
  const execution = useModuleExecution()
  return <ModuleComputeContext.Provider value={execution}><AbaqusOrthotropicElasticImportPanelContent /></ModuleComputeContext.Provider>
}

function AbaqusOrthotropicElasticImportPanelContent() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [filename, setFilename] = useState('')
  const [imported, setImported] = useState<Extract<AbaqusOrthotropicElasticImport, { ok: true }> | null>(null)
  const [diagnostics, setDiagnostics] = useState<string[]>([])
  const [strainText, setStrainText] = useState(['0.001', '0', '0', '0', '0', '0'])
  const importGeneration = useRef(0)
  const execution = useContext(ModuleComputeContext)
  const strainValues = strainText.map(value => value.trim() === '' ? Number.NaN : Number(value))
  const validStrain = strainValues.length === 6 && strainValues.every(value => Number.isFinite(value) && Math.abs(value) <= 0.1)
  const strainKey = strainText.join('\u0000')
  const input = useMemo<MaterialPointInput | null>(() => {
    if (!imported) return null
    const values = strainKey.split('\u0000').map(value => value.trim() === '' ? Number.NaN : Number(value))
    const valid = values.length === 6 && values.every(value => Number.isFinite(value) && Math.abs(value) <= 0.1)
    return { ...imported.input, backend: 'host', eps: (valid ? values : [0, 0, 0, 0, 0, 0]) as MaterialPointInput['eps'] }
  // Strain text is intentionally part of the job identity so edits invalidate a prior result.
  }, [imported, strainKey])
  const compute = useModuleCompute(input ?? EMPTY_INPUT)

  useEffect(() => {
    if (execution?.target === 'browser') void execution.setTarget('backend')
  }, [execution?.target])

  const checkedResult = useMemo(() => {
    if (!input || !compute.result) return null
    try { return { ok: true as const, result: parseAbaqusOrthotropicElasticResult(compute.result, input) } }
    catch (cause) { return { ok: false as const, diagnostic: cause instanceof Error ? cause.message : String(cause) } }
  }, [input, compute.result])

  const readFile = async (file: File | undefined) => {
    if (!file) return
    const generation = ++importGeneration.current
    setFilename(file.name)
    setImported(null)
    setDiagnostics([])
    execution?.clear()
    if (file.size <= 0 || file.size > 2 * 1024 * 1024) {
      setDiagnostics(['source must be between 1 byte and 2097152 bytes'])
      return
    }
    try {
      const parsed = importAbaqusOrthotropicElasticSource(await file.text())
      if (generation !== importGeneration.current) return
      if (parsed.ok) setImported(parsed)
      else setDiagnostics(parsed.diagnostics)
    } catch (cause) {
      if (generation !== importGeneration.current) return
      setDiagnostics([cause instanceof Error ? cause.message : String(cause)])
    }
  }

  const submit = () => {
    if (!input || !validStrain || !execution || execution.target !== 'backend' || execution.busy || execution.cancelPending) return
    try {
      createModuleJobSpec(input)
      void execution.start(true)
    } catch (cause) {
      execution.reportLocalError(cause)
    }
  }

  return <section data-testid="abaqus-orthotropic-elastic-import" className="mt-6 space-y-4 rounded-xl border border-cyan-400/20 bg-cyan-950/10 p-4" aria-labelledby="abaqus-orthotropic-elastic-import-title">
    <header className="space-y-2">
      <h2 id="abaqus-orthotropic-elastic-import-title" className="text-lg font-semibold text-slate-100">{zh ? '独立工作流：正交各向异性弹性材料卡导入' : 'Separate workflow: orthotropic elastic material card import'}</h2>
      <p className="max-w-4xl text-sm leading-relaxed text-slate-300">{zh
        ? '读取仅含一张 `*ELASTIC, TYPE=ENGINEERING CONSTANTS` 的源片段，并映射到现有 W-Sim Host-f64 原生材料点操作，返回材料轴下的刚度 C、柔度 S 和给定小应变下的应力。'
        : 'Read a source fragment containing one `*ELASTIC, TYPE=ENGINEERING CONSTANTS` card and map it to the existing W-Sim Host-f64 material-point operation. It returns material-axis stiffness C, compliance S, and stress for the supplied small strain.'}</p>
      <p className="text-xs leading-relaxed text-amber-200/90">{zh
        ? '源文件单位按原样保留且不推断；不读取或应用 *ORIENTATION。剪切应变使用工程量 γ=2ε，Voigt 顺序为 11,22,33,12,13,23。此操作不组装网格、不积分单元，也不求解全局有限元问题。'
        : 'Source units are preserved without inference; *ORIENTATION is not read or applied. Shear strains use engineering gamma=2 epsilon in Voigt order 11,22,33,12,13,23. This operation does not assemble a mesh, integrate elements, or solve a global finite-element problem.'}</p>
    </header>

    <div className="space-y-4 rounded-lg border border-edge bg-panel/40 p-4">
      <label className="block text-sm text-slate-300">
        <span className="mb-2 block font-medium">{zh ? '选择正交各向异性材料卡源文件' : 'Choose an orthotropic material-card source file'}</span>
        <input aria-label="Abaqus orthotropic elastic source file" type="file" accept=".inp,text/plain" className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-cyan-300 file:px-3 file:py-2 file:font-medium file:text-slate-950" onChange={event => { void readFile(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />
      </label>
      {filename && <p className="text-xs text-slate-400">{zh ? '来源文件：' : 'Source file: '}<code>{filename}</code></p>}
      {diagnostics.length > 0 && <ul role="alert" className="space-y-1 text-sm text-red-200">{diagnostics.map((message, index) => <li key={`${index}:${message}`}>{message}</li>)}</ul>}
      {imported && <p role="status" className="text-sm text-slate-300">{zh ? `已读取单张材料卡（源文件第 ${imported.source.cardLine} 行，${imported.source.bytes} 字节）。` : `Read one material card (source line ${imported.source.cardLine}, ${imported.source.bytes} bytes).`}</p>}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-300">{zh ? '材料轴工程应变（小应变）' : 'Material-axis engineering strain (small strain)'}</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {STRAIN_LABELS.map((label, index) => <label key={label} className="text-xs text-slate-400">
            <span>{label}</span>
            <input aria-label={`Engineering strain ${label}`} inputMode="decimal" className={fieldClass} value={strainText[index]} onChange={event => setStrainText(current => current.map((value, i) => i === index ? event.target.value : value))} />
          </label>)}
        </div>
        {!validStrain && <p role="alert" className="text-xs text-amber-200">{zh ? '每个应变分量须为有限数，绝对值不超过 0.1。' : 'Each strain component must be finite and have magnitude at most 0.1.'}</p>}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" aria-label="Submit imported orthotropic material to Host" className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50" disabled={!input || !validStrain || !execution?.connected || execution.target !== 'backend' || execution.busy || execution.cancelPending} onClick={submit}>{execution?.busy ? (zh ? '任务提交中…' : 'Submitting job…') : (zh ? '提交材料点计算到 Host' : 'Submit material-point calculation to Host')}</button>
        {execution?.busy && <button type="button" className="btn border border-edge" onClick={() => void execution.stop()}>{zh ? '停止任务' : 'Stop job'}</button>}
        {execution?.status && <span role="status" className="text-sm text-slate-400">{execution.status}</span>}
        {execution?.error && <p role="alert" className="w-full text-sm text-red-200">{execution.error}</p>}
        {execution?.loginRequired && <p role="status" className="w-full text-sm text-amber-200">{zh ? '需要登录后才能提交此 Host 任务。' : 'Sign in before submitting this Host job.'}</p>}
      </div>
      {imported && input && <details className="rounded-lg border border-edge bg-slate-950/60 p-3">
        <summary className="min-h-10 cursor-pointer py-2 text-sm text-slate-300">{zh ? '查看映射后的原生模块输入' : 'Inspect mapped native module input'}</summary>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300">{JSON.stringify(input, null, 2)}</pre>
      </details>}
    </div>

    {checkedResult?.ok && input && compute.result && <section className="space-y-3 rounded-lg border border-emerald-400/20 bg-emerald-950/10 p-4" aria-label={zh ? '正交弹性材料点结果' : 'Orthotropic elastic material-point result'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-semibold text-emerald-100">{zh ? '已验证的原生材料点结果' : 'Validated native material-point result'}</h3><p className="mt-1 text-xs text-slate-400">{zh ? `任务 ${execution?.jobId ?? '—'} · C、S 和应力校验通过。` : `Job ${execution?.jobId ?? '—'} · C, S, and stress checks passed.`}</p></div>
        <button type="button" aria-label="Download orthotropic elastic result" className="btn border border-edge" onClick={() => downloadReport(input, imported?.source ?? null, compute.result, execution?.jobId ?? null)}>{zh ? '下载结果报告 JSON' : 'Download result report JSON'}</button>
      </div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-edge bg-slate-950/60 p-3 text-xs text-slate-300">{JSON.stringify(checkedResult.result, null, 2)}</pre>
    </section>}
    {checkedResult && !checkedResult.ok && <p role="alert" className="rounded-lg border border-red-400/20 p-3 text-sm text-red-200">{zh ? `结果校验失败：${checkedResult.diagnostic}` : `Result validation failed: ${checkedResult.diagnostic}`}</p>}
  </section>
}

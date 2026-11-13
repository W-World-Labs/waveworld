import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../lib/hostApi'
import { useLocale } from '../lib/i18n'
import { createModuleJobSpec, type ModuleComputeInput } from '../lib/sim/module-compute'
import {
  createAnsysThermalStudyInput,
  createDefaultAnsysThermalStudy,
  type AnsysThermalStudyDraft,
} from '../lib/sim/ansys-thermal-study-input'
import { parseAnsysThermalStudyResult, type AnsysThermalStudyResult } from '../lib/sim/ansys-thermal-study-result'
import { AnsysThermalSetup } from './AnsysThermalSetup'
import { AnsysApdlImport } from './AnsysApdlImport'
import { AnsysThermalStudyTable } from './AnsysThermalStudyTable'
import { AnsysThermalHistoryPlot } from './AnsysThermalHistoryPlot'
import { ansysThermalStudyCsv, ansysThermalStudyReport } from '../lib/sim/ansys-thermal-study-export'
import type { AnsysApdlThermalImport } from '../lib/sim/ansys-apdl-thermal-input'

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

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function AnsysThermalStudyPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [draft, setDraft] = useState<AnsysThermalStudyDraft>(() => createDefaultAnsysThermalStudy())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submittedDraft, setSubmittedDraft] = useState<AnsysThermalStudyDraft | null>(null)
  const [submittedApdl, setSubmittedApdl] = useState<AnsysApdlThermalImport | null>(null)
  const [importedApdl, setImportedApdl] = useState<AnsysApdlThermalImport | null>(null)
  const [submittedInput, setSubmittedInput] = useState<ReturnType<typeof createAnsysThermalStudyInput> | null>(null)
  const [result, setResult] = useState<AnsysThermalStudyResult | null>(null)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      controllerRef.current?.abort(new DOMException('Thermal study panel unmounted', 'AbortError'))
      controllerRef.current = null
    }
  }, [])

  const current = (generation: number, controller?: AbortController) =>
    mountedRef.current && generation === generationRef.current && (!controller || controllerRef.current === controller)

  const invalidate = (reason: string) => {
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException(reason, 'AbortError'))
    controllerRef.current = null
  }

  let validationMessage = ''
  try {
    const input = createAnsysThermalStudyInput(draft)
    if (input.module !== 'sw-ansys-thermal-fem') throw new Error('Thermal study input module identity is invalid')
  } catch (cause) {
    validationMessage = cause instanceof Error ? cause.message : String(cause)
  }
  const valid = !validationMessage

  const edit = (next: AnsysThermalStudyDraft) => {
    invalidate('Ansys thermal inputs changed')
    setDraft(next)
    setImportedApdl(null)
    setBusy(false)
    setStatus('idle')
    setJobId(null)
    setError(null)
    setSubmittedDraft(null)
    setSubmittedApdl(null)
    setSubmittedInput(null)
    setResult(null)
  }

  const run = async (apdl?: AnsysApdlThermalImport) => {
    if (busy || (!apdl && !valid)) return
    const generation = ++generationRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setStatus('validating')
    setJobId(null)
    setError(null)
    setResult(null)
    setSubmittedDraft(null)
    setSubmittedApdl(null)
    setSubmittedInput(null)
    try {
      const snapshot = apdl ? null : frozenCopy(draft)
      const input = frozenCopy(apdl?.input ?? createAnsysThermalStudyInput(snapshot ?? draft))
      if (input.module !== 'sw-ansys-thermal-fem') throw new Error('Unsupported thermal module identity')
      const spec = createModuleJobSpec(input as ModuleComputeInput)
      setSubmittedDraft(snapshot)
      setSubmittedApdl(apdl ? frozenCopy(apdl) : null)
      setSubmittedInput(input)
      const client = createSettlementClient({
        baseUrl: hostApiBase(),
        fetchImpl: (url, init) => {
          const headers = new Headers(init?.headers)
          const token = getStoredUserToken()
          if (token) headers.set('Authorization', `Bearer ${token}`)
          return fetch(url, { ...init, headers })
        },
      })
      setStatus('authenticating')
      await client.requireUser(controller.signal)
      if (!current(generation, controller)) return
      const remote = await runRemoteJob(client, spec, {
        signal: controller.signal,
        onStatus: (id, next) => {
          if (current(generation, controller)) { setJobId(id); setStatus(next) }
        },
      })
      if (!current(generation, controller)) return
      const parsed = parseAnsysThermalStudyResult(remote as JobResultV1, input)
      if (!current(generation, controller)) return
      setResult(parsed)
      setStatus('succeeded')
    } catch (cause) {
      if (!current(generation, controller) || controller.signal.aborted) return
      setStatus('failed')
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        if (current(generation)) setBusy(false)
      }
    }
  }

  const cancel = () => {
    invalidate('Ansys thermal study cancelled')
    setBusy(false)
    setStatus('cancelled')
    setJobId(null)
    setError(null)
    setSubmittedDraft(null)
    setSubmittedApdl(null)
    setSubmittedInput(null)
    setResult(null)
  }

  const reset = () => {
    invalidate('Ansys thermal study reset')
    setDraft(createDefaultAnsysThermalStudy())
    setImportedApdl(null)
    setBusy(false)
    setStatus('idle')
    setJobId(null)
    setError(null)
    setSubmittedDraft(null)
    setSubmittedApdl(null)
    setSubmittedInput(null)
    setResult(null)
  }

  const clearApdlRun = (reason: string) => {
    invalidate(reason)
    setImportedApdl(null)
    setBusy(false)
    setStatus('idle')
    setJobId(null)
    setError(null)
    setSubmittedDraft(null)
    setSubmittedApdl(null)
    setSubmittedInput(null)
    setResult(null)
  }

  const reportArgs = result && submittedInput ? {
    input: submittedInput, result, jobId,
    ...(submittedApdl ? { sourceApdl: submittedApdl.sourceText, externalNodeLabels: submittedApdl.externalNodeLabels } : {}),
  } : null

  return <section id="ansys-thermal-study" data-testid="ansys-thermal-study" className="rounded-xl border border-orange-400/25 bg-orange-950/10 p-4" aria-labelledby="ansys-thermal-study-title">
    <header className="mb-4">
      <h2 id="ansys-thermal-study-title" className="text-lg font-semibold text-slate-100">{zh ? 'Mechanical · 热研究' : 'Mechanical · Thermal study'}</h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
        {zh
          ? '定义一维杆的材料、长度、边界条件和热载荷，然后提交经认证的 W-Sim Host 原生热有限元作业。范围仅限一维线性导热；不代表 CAD 或三维实体、辐射或接触分析。历史图展示聚合的最小值、平均值和最大值样本。'
          : 'Define a 1D bar, material, boundary conditions, and thermal loads, then submit an authenticated W-Sim Host native thermal FEM job. Scope is limited to 1D linear conduction; this does not claim CAD or solid modeling, radiation, or contact analysis. The history plot shows aggregate minimum, mean, and maximum samples.'}
      </p>
    </header>

    <AnsysThermalSetup draft={draft} onChange={edit} />
    {validationMessage && <p className="mt-3 text-sm text-amber-300" role="status">{validationMessage}</p>}
    <AnsysApdlImport onImport={parsed => {
      invalidate('APDL thermal input selected')
      setImportedApdl(parsed)
      setBusy(false)
      setStatus('ready')
      setJobId(null)
      setError(null)
      setSubmittedDraft(null)
      setSubmittedApdl(null)
      setSubmittedInput(null)
      setResult(null)
    }} onSourceChange={() => clearApdlRun('APDL source changed')} onClear={() => clearApdlRun('APDL thermal input cleared')} />

    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button id="ansys-thermal-study-run" data-testid="ansys-thermal-study-run" type="button" onClick={() => void run()} disabled={!valid || busy} className="btn bg-orange-300 text-slate-950 hover:bg-orange-200 disabled:opacity-50">{zh ? '提交热研究到 Host' : 'Submit thermal study to Host'}</button>
      {importedApdl && <button id="ansys-apdl-run" data-testid="ansys-apdl-run" type="button" onClick={() => void run(importedApdl)} disabled={busy} className="btn border border-cyan-300/50 text-cyan-100 disabled:opacity-50">{zh ? '提交 APDL 导入模型到 Host' : 'Submit imported APDL to Host'}</button>}
      {busy && <button id="ansys-thermal-study-cancel" data-testid="ansys-thermal-study-cancel" type="button" onClick={cancel} className="btn border border-edge text-slate-300">{zh ? '取消研究' : 'Cancel study'}</button>}
      <button id="ansys-thermal-study-reset" data-testid="ansys-thermal-study-reset" type="button" onClick={reset} className="btn border border-edge text-slate-300">{zh ? '重置研究' : 'Reset study'}</button>
      <span id="ansys-thermal-study-status" data-testid="ansys-thermal-study-status" className="text-xs text-slate-400" aria-live="polite">{status}{jobId ? ` · ${zh ? '任务' : 'Job'} ${jobId}` : ''}</span>
    </div>
    {error && <div id="ansys-thermal-study-error" data-testid="ansys-thermal-study-error" role="alert" className="mt-3 rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-300">{error}{error.includes('需要登录') && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>{zh ? '登录' : 'Sign in'}</a>}</div>}
    {result && submittedInput && jobId && <section data-testid="ansys-thermal-study-results" aria-labelledby="ansys-thermal-study-results-title" className="mt-6 space-y-4 rounded-xl border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="ansys-thermal-study-results-title" className="text-lg font-semibold">{zh ? 'W-Sim 原生热分析结果' : 'W-Sim native thermal results'}</h3>
          <p className="mt-1 text-sm text-slate-400">{zh ? '下列数据来自已完成任务并通过结果校验的原生模块。' : 'Values below came from the completed native module job and passed result validation.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="ansys-thermal-study-download-csv" className="btn border border-edge" onClick={() => download('ansys-thermal-study.csv', ansysThermalStudyCsv(submittedInput, result, submittedApdl?.externalNodeLabels), 'text/csv;charset=utf-8')}>{zh ? '下载 CSV' : 'Download CSV'}</button>
          <button type="button" data-testid="ansys-thermal-study-download-json" className="btn border border-edge" onClick={() => reportArgs && download('ansys-thermal-study.json', ansysThermalStudyReport(reportArgs), 'application/json;charset=utf-8')}>{zh ? '下载 JSON 报告' : 'Download JSON report'}</button>
        </div>
      </div>
      <dl className="grid gap-3 rounded border border-edge p-3 text-sm sm:grid-cols-2">
        <div><dt className="text-slate-400">{zh ? '作业' : 'Submitted job'}</dt><dd className="break-all font-medium">{jobId}</dd></div>
        <div><dt className="text-slate-400">{zh ? '原生数值后端' : 'Native numeric backend'}</dt><dd>{result.backend.id} · {result.backend.kind} · {result.backend.deviceName}</dd></div>
        <div><dt className="text-slate-400">{zh ? '方法 / 模块' : 'Method / module'}</dt><dd>{result.method} · {result.module}</dd></div>
        <div><dt className="text-slate-400">{zh ? '网格单元' : 'Bar mesh elements'}</dt><dd>{submittedInput.mesh.elements.length}</dd></div>
      </dl>
      <details className="rounded border border-edge p-3">
        <summary className="cursor-pointer text-sm font-medium">{zh ? '提交时的输入快照' : 'Submitted input snapshot'}</summary>
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300">{JSON.stringify({ draft: submittedDraft, sourceApdl: submittedApdl?.sourceText, externalNodeLabels: submittedApdl?.externalNodeLabels, nativeInput: submittedInput }, null, 2)}</pre>
      </details>
      <AnsysThermalHistoryPlot samples={result.result.transient?.samples ?? [{ step: 0, time: 0, minTemperature: result.result.minTemperature, maxTemperature: result.result.maxTemperature, meanTemperature: result.result.meanTemperature }]} />
      <AnsysThermalStudyTable result={result} nodePositionsM={submittedInput.mesh.nodes.map(node => node[0])} externalNodeLabels={submittedApdl?.externalNodeLabels} />
      <p className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-slate-400">{zh ? '范围：仅限一维线性导热和自动生成或受限 APDL 导入的杆网格。此向导不执行 Mechanical，不包含 CAD 或三维实体、辐射或接触建模；历史图仅显示聚合的最小值、平均值和最大值样本。' : 'Scope: 1D linear conduction with an automatically generated mesh or the documented bounded APDL bar subset. This guide does not execute Mechanical and makes no CAD or 3D solid, radiation, or contact modeling claim. The history plot shows aggregate minimum, mean, and maximum samples only.'}</p>
    </section>}
  </section>
}

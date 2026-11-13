import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../lib/hostApi'
import { useLocale } from '../lib/i18n'
import { createModuleJobSpec, type ModuleComputeInput } from '../lib/sim/module-compute'
import {
  buildAnsysModalStudyInput,
  createDefaultAnsysModalStudy,
  type AnsysModalStudyDraft,
} from '../lib/sim/ansys-modal-study-input'
import { parseAnsysModalStudyResult, type AnsysModalStudyResult } from '../lib/sim/ansys-modal-study-result'
import { AnsysModalSetup } from './AnsysModalSetup'
import { AnsysModalFrequencyPlot } from './AnsysModalFrequencyPlot'
import { AnsysModalStudyTable } from './AnsysModalStudyTable'
import { ansysModalStudyCsv, ansysModalStudyReport } from '../lib/sim/ansys-modal-study-export'

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

export function AnsysModalStudyPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [draft, setDraft] = useState<AnsysModalStudyDraft>(() => createDefaultAnsysModalStudy())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submittedDraft, setSubmittedDraft] = useState<AnsysModalStudyDraft | null>(null)
  const [submittedInput, setSubmittedInput] = useState<ReturnType<typeof buildAnsysModalStudyInput> | null>(null)
  const [result, setResult] = useState<AnsysModalStudyResult | null>(null)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      controllerRef.current?.abort(new DOMException('Modal study panel unmounted', 'AbortError'))
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
  try { buildAnsysModalStudyInput(draft) } catch (cause) {
    validationMessage = cause instanceof Error ? cause.message : String(cause)
  }
  const valid = !validationMessage

  const edit = (next: AnsysModalStudyDraft) => {
    invalidate('Ansys modal inputs changed')
    setDraft(next)
    setBusy(false)
    setStatus('idle')
    setJobId(null)
    setError(null)
    setSubmittedDraft(null)
    setSubmittedInput(null)
    setResult(null)
  }

  const run = async () => {
    if (busy || !valid) return
    const generation = ++generationRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setStatus('validating')
    setJobId(null)
    setError(null)
    setResult(null)
    setSubmittedDraft(null)
    setSubmittedInput(null)
    try {
      const snapshot = frozenCopy(draft)
      const input = frozenCopy(buildAnsysModalStudyInput(snapshot))
      const spec = createModuleJobSpec(input as ModuleComputeInput)
      setSubmittedDraft(snapshot)
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
      const parsed = parseAnsysModalStudyResult(remote as JobResultV1, input)
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
    invalidate('Ansys modal study cancelled')
    setBusy(false)
    setStatus('cancelled')
    setJobId(null)
    setError(null)
    setSubmittedDraft(null)
    setSubmittedInput(null)
    setResult(null)
  }

  const reset = () => {
    invalidate('Ansys modal study reset')
    setDraft(createDefaultAnsysModalStudy())
    setBusy(false)
    setStatus('idle')
    setJobId(null)
    setError(null)
    setSubmittedDraft(null)
    setSubmittedInput(null)
    setResult(null)
  }

  const reportArgs = result && submittedInput ? { input: submittedInput, result, jobId } : null

  return <section id="ansys-modal-study" data-testid="ansys-modal-study" className="rounded-xl border border-cyan-400/25 bg-cyan-950/10 p-4" aria-labelledby="ansys-modal-study-title">
    <header className="mb-4">
      <h2 id="ansys-modal-study-title" className="text-lg font-semibold text-slate-100">{zh ? 'Mechanical · 模态 / 特征频率研究' : 'Mechanical · Modal / eigenfrequency study'}</h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
        {zh
          ? '输入两个自由度的对称刚度和质量矩阵，提交经认证的 W-Sim Host 原生 Block Lanczos 作业。结果包含返回的频率、质量归一化振型和参与质量。此输入代表已组装的小型矩阵，不包含几何、网格或 Mechanical 项目。'
          : 'Enter symmetric stiffness and mass matrices for two degrees of freedom, then submit an authenticated W-Sim Host job using the native Block Lanczos operation. Results include returned frequencies, mass-normalized mode shapes, and participation mass. This is a small assembled matrix input with no geometry, mesh, or Mechanical project.'}
      </p>
    </header>

    <AnsysModalSetup draft={draft} onChange={edit} validationMessage={validationMessage} />

    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button id="ansys-modal-study-run" data-testid="ansys-modal-study-run" type="button" onClick={() => void run()} disabled={!valid || busy} className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:opacity-50">{zh ? '提交模态研究到 Host' : 'Submit modal study to Host'}</button>
      {busy && <button id="ansys-modal-study-cancel" data-testid="ansys-modal-study-cancel" type="button" onClick={cancel} className="btn border border-edge text-slate-300">{zh ? '取消研究' : 'Cancel study'}</button>}
      <button id="ansys-modal-study-reset" data-testid="ansys-modal-study-reset" type="button" onClick={reset} className="btn border border-edge text-slate-300">{zh ? '重置研究' : 'Reset study'}</button>
      <span id="ansys-modal-study-status" data-testid="ansys-modal-study-status" className="text-xs text-slate-400" aria-live="polite">{status}{jobId ? ` · ${zh ? '任务' : 'Job'} ${jobId}` : ''}</span>
    </div>
    {error && <div id="ansys-modal-study-error" data-testid="ansys-modal-study-error" role="alert" className="mt-3 rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-300">{error}{error.includes('需要登录') && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>{zh ? '登录' : 'Sign in'}</a>}</div>}
    {result && submittedInput && submittedDraft && jobId && <section data-testid="ansys-modal-study-results" aria-labelledby="ansys-modal-study-results-title" className="mt-6 space-y-4 rounded-xl border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="ansys-modal-study-results-title" className="text-lg font-semibold">{zh ? 'W-Sim 原生模态结果' : 'W-Sim native modal results'}</h3>
          <p className="mt-1 text-sm text-slate-400">{zh ? '下列数据来自已完成任务的原生模块结果。' : 'Values below are from the completed native module job.'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="ansys-modal-study-download-csv" className="btn border border-edge" onClick={() => download('ansys-modal-study.csv', ansysModalStudyCsv(result), 'text/csv;charset=utf-8')}>{zh ? '下载 CSV' : 'Download CSV'}</button>
          <button type="button" data-testid="ansys-modal-study-download-json" className="btn border border-edge" onClick={() => reportArgs && download('ansys-modal-study.json', ansysModalStudyReport(reportArgs), 'application/json;charset=utf-8')}>{zh ? '下载 JSON 报告' : 'Download JSON report'}</button>
        </div>
      </div>
      <dl className="grid gap-3 rounded border border-edge p-3 text-sm sm:grid-cols-2">
        <div><dt className="text-slate-400">{zh ? '作业' : 'Submitted job'}</dt><dd className="break-all font-medium">{jobId}</dd></div>
        <div><dt className="text-slate-400">{zh ? '原生数值后端' : 'Native numeric backend'}</dt><dd>{result.backend.id} · {result.backend.kind} · {result.backend.deviceName}</dd></div>
        <div><dt className="text-slate-400">{zh ? '方法 / 模块' : 'Method / module'}</dt><dd>{result.methodId} · {result.module}</dd></div>
        <div><dt className="text-slate-400">{zh ? '谱残差' : 'Solver residual'}</dt><dd>{result.solver.residual}</dd></div>
      </dl>
      <details className="rounded border border-edge p-3" open>
        <summary className="cursor-pointer text-sm font-medium">{zh ? '提交时的输入快照' : 'Submitted input snapshot'}</summary>
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-300">{JSON.stringify({ draft: submittedDraft, nativeInput: submittedInput }, null, 2)}</pre>
      </details>
      <AnsysModalFrequencyPlot frequenciesHz={result.frequenciesHz} />
      <AnsysModalStudyTable result={result} />
      <p className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-slate-400">{zh ? '范围：仅限正定的显式 2×2 对称 K/M 矩阵与 W-Sim 原生 Host Block Lanczos。此向导不执行 Ansys Mechanical，不读取项目或网格，不表示完整有限元工作流或厂商数值一致性。' : 'Scope: positive-definite explicit symmetric 2×2 K/M matrices and the W-Sim native Host Block Lanczos operation only. This guide does not execute Ansys Mechanical, read projects or meshes, or represent a complete finite-element workflow or vendor numerical parity.'}</p>
    </section>}
  </section>
}

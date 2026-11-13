import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import {
  createAbaqusBeamStudyJob,
  createDefaultAbaqusBeamStudy,
  type AbaqusBeamStudyDraft,
} from '../../lib/sim/abaqus-beam-study-input'
import { parseAbaqusBeamStudyResult, type AbaqusBeamStudyResult } from '../../lib/sim/abaqus-beam-study-result'
import { AbaqusBeamSectionEditor } from './AbaqusBeamSectionEditor'
import { AbaqusBeamSetupEditor } from './AbaqusBeamSetupEditor'
import { AbaqusBeamResults } from './AbaqusBeamResults'

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

const fieldClass = 'mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-ink'

export function AbaqusBeamStudyPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [draft, setDraft] = useState<AbaqusBeamStudyDraft>(() => createDefaultAbaqusBeamStudy())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submittedDraft, setSubmittedDraft] = useState<AbaqusBeamStudyDraft | null>(null)
  const [submittedInput, setSubmittedInput] = useState<ReturnType<typeof createAbaqusBeamStudyJob>['input'] | null>(null)
  const [result, setResult] = useState<AbaqusBeamStudyResult | null>(null)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      controllerRef.current?.abort(new DOMException('B31 study panel unmounted', 'AbortError'))
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

  const edit = (next: AbaqusBeamStudyDraft) => {
    invalidate('B31 study inputs changed')
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
    if (busy) return
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
      const { input: rawInput, spec } = createAbaqusBeamStudyJob(snapshot)
      const input = frozenCopy(rawInput)
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
      const parsed = parseAbaqusBeamStudyResult(remote as JobResultV1, input)
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
    invalidate('B31 study cancelled')
    setBusy(false)
    setStatus('cancelled')
    setJobId(null)
    setError(null)
    setSubmittedDraft(null)
    setSubmittedInput(null)
    setResult(null)
  }

  const reset = () => {
    invalidate('B31 study reset')
    setDraft(createDefaultAbaqusBeamStudy())
    setBusy(false)
    setStatus('idle')
    setJobId(null)
    setError(null)
    setSubmittedDraft(null)
    setSubmittedInput(null)
    setResult(null)
  }

  return <section id="abaqus-beam-study" data-testid="abaqus-beam-study" className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="abaqus-beam-study-title">
    <header className="mb-4">
      <h2 id="abaqus-beam-study-title" className="text-lg font-semibold text-slate-100">{zh ? 'Abaqus 映射 B31 梁研究' : 'Abaqus-mapped B31 beam study'}</h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
        {zh
          ? '这是 W-Sim 原生 Host-f64 计算，使用 B31 两节点线性 Timoshenko 悬臂梁模型。可选择梁端横向点载荷或均布载荷；不执行 Abaqus，也不声明完整求解器一致性。'
          : 'This is a W-Sim native host-f64 calculation using a two-node linear Timoshenko B31 cantilever model. Choose a transverse tip point load or uniform distributed load. It does not execute Abaqus or claim full solver parity.'}
      </p>
    </header>
    <AbaqusBeamSetupEditor value={draft} onChange={edit} />
    <div className="mt-4"><AbaqusBeamSectionEditor value={draft} onChange={edit} /></div>
    <fieldset className="mt-4 space-y-4" data-testid="abaqus-beam-load-editor">
      <legend className="text-sm font-semibold text-ink">{zh ? '横向载荷' : 'Transverse load'}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <label htmlFor="abaqus-beam-load-type" className="block text-sm text-ink">
          <span>{zh ? '载荷类型' : 'Load type'}</span>
          <select id="abaqus-beam-load-type" data-testid="abaqus-beam-load-type" value={draft.load.type} onChange={event => edit({ ...draft, load: { ...draft.load, type: event.target.value as 'point' | 'udl' } })} className={fieldClass}>
            <option value="point">{zh ? '自由端点载荷' : 'Tip point load'}</option>
            <option value="udl">{zh ? '均布载荷' : 'Uniform distributed load'}</option>
          </select>
        </label>
        <label htmlFor="abaqus-beam-load-value" className="block text-sm text-ink">
          <span>{zh ? `正向载荷 (${draft.load.type === 'point' ? 'N' : 'N/m'})` : `Positive load (${draft.load.type === 'point' ? 'N' : 'N/m'})`}</span>
          <input id="abaqus-beam-load-value" data-testid="abaqus-beam-load-value" type="number" min="0" step="any" value={Number.isFinite(draft.load.value) ? draft.load.value : ''} onChange={event => edit({ ...draft, load: { ...draft.load, value: event.target.value === '' ? Number.NaN : event.currentTarget.valueAsNumber } })} className={fieldClass} />
        </label>
      </div>
      <p className="text-xs text-muted">{zh ? '正值按原生约定指向横向正方向；点载荷始终作用于 x = L。' : 'Positive values follow the native transverse sign convention. A point load is applied at x = L.'}</p>
    </fieldset>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button id="abaqus-beam-study-run" data-testid="abaqus-beam-study-run" type="button" onClick={() => void run()} disabled={busy} className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:opacity-50">{zh ? '运行 B31 研究' : 'Run B31 study'}</button>
      {busy && <button id="abaqus-beam-study-cancel" data-testid="abaqus-beam-study-cancel" type="button" onClick={cancel} className="btn border border-edge text-slate-300">{zh ? '取消研究' : 'Cancel study'}</button>}
      <button id="abaqus-beam-study-reset" data-testid="abaqus-beam-study-reset" type="button" onClick={reset} className="btn border border-edge text-slate-300">{zh ? '重置研究' : 'Reset study'}</button>
      <span id="abaqus-beam-study-status" data-testid="abaqus-beam-study-status" className="text-xs text-slate-400" aria-live="polite">{status}{jobId ? ` · ${zh ? '任务' : 'Job'} ${jobId}` : ''}</span>
    </div>
    {error && <div id="abaqus-beam-study-error" data-testid="abaqus-beam-study-error" role="alert" className="mt-3 rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-300">{error}{error.includes('需要登录') && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>{zh ? '登录' : 'Sign in'}</a>}</div>}
    {result && submittedDraft && submittedInput && <AbaqusBeamResults draft={submittedDraft} input={submittedInput} result={result} jobId={jobId} />}
  </section>
}

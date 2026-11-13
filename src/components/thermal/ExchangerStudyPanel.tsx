import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import { createDefaultExchangerStudy, createExchangerStudyJob, type ExchangerStudyDraft } from '../../lib/sim/exchanger-study-input'
import { readExchangerStudyResult, type ExchangerStudyResult } from '../../lib/sim/exchanger-study-result'
import { ExchangerConditionsEditor } from './ExchangerConditionsEditor'
import { ExchangerStudyResults } from './ExchangerStudyResults'
import { ExchangerSweepEditor } from './ExchangerSweepEditor'

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

export function ExchangerStudyPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [draft, setDraft] = useState<ExchangerStudyDraft>(() => createDefaultExchangerStudy())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedDraft, setSavedDraft] = useState<ExchangerStudyDraft | null>(null)
  const [savedInput, setSavedInput] = useState<ReturnType<typeof createExchangerStudyJob>['input'] | null>(null)
  const [result, setResult] = useState<ExchangerStudyResult | null>(null)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      controllerRef.current?.abort(new DOMException('Exchanger study panel unmounted', 'AbortError'))
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

  const edit = (next: ExchangerStudyDraft) => {
    invalidate('Exchanger study inputs changed')
    setDraft(next)
    setBusy(false)
    setStatus('idle')
    setJobId(null)
    setError(null)
    setSavedDraft(null)
    setSavedInput(null)
    setResult(null)
  }

  const run = async () => {
    if (busy) return
    const generation = ++generationRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setStatus('submitting')
    setJobId(null)
    setError(null)
    setResult(null)
    setSavedDraft(null)
    setSavedInput(null)
    try {
      const capturedDraft = frozenCopy(draft)
      const { input: rawInput, spec } = createExchangerStudyJob(capturedDraft)
      const input = frozenCopy(rawInput)
      setSavedDraft(capturedDraft)
      setSavedInput(input)
      const client = createSettlementClient({
        baseUrl: hostApiBase(),
        fetchImpl: (url, init) => {
          const headers = new Headers(init?.headers)
          const token = getStoredUserToken()
          if (token) headers.set('Authorization', `Bearer ${token}`)
          return fetch(url, { ...init, headers })
        },
      })
      await client.requireUser(controller.signal)
      if (!current(generation, controller)) return
      const remote = await runRemoteJob(client, spec, {
        signal: controller.signal,
        onStatus: (id, next) => {
          if (current(generation, controller)) { setJobId(id); setStatus(next) }
        },
      })
      if (!current(generation, controller)) return
      const parsed = readExchangerStudyResult(remote as JobResultV1, input)
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
    invalidate('Exchanger study cancelled')
    setBusy(false)
    setStatus('cancelled')
    setJobId(null)
    setError(null)
    setSavedDraft(null)
    setSavedInput(null)
    setResult(null)
  }

  const reset = () => {
    invalidate('Exchanger study reset')
    setDraft(createDefaultExchangerStudy())
    setBusy(false)
    setStatus('idle')
    setJobId(null)
    setError(null)
    setSavedDraft(null)
    setSavedInput(null)
    setResult(null)
  }

  return <section className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="exchanger-study-title">
    <header className="mb-4">
      <h2 id="exchanger-study-title" className="text-lg font-semibold text-slate-100">{zh ? '稳态换热器 UA 参数研究' : 'Steady exchanger UA study'}</h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
        {zh
          ? '设置固定入口条件和 UA 范围，再显式提交已认证的 Host 作业。结果来自 W-Sim 的稳态有效度–NTU 计算；不调用 Dymola，也不表示 GPU 求解。'
          : 'Set fixed inlet conditions and a UA range, then explicitly submit an authenticated Host job. Results come from the W-Sim steady effectiveness–NTU calculation; this does not call Dymola or claim GPU solving.'}
      </p>
    </header>
    <ExchangerConditionsEditor value={draft} onChange={edit} />
    <div className="mt-4"><ExchangerSweepEditor value={draft.range} onChange={range => edit({ ...draft, range })} /></div>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button data-testid="exchanger-study-run" type="button" onClick={() => void run()} disabled={busy} className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:opacity-50">{zh ? '运行 UA 研究' : 'Run UA study'}</button>
      {busy && <button data-testid="exchanger-study-cancel" type="button" onClick={cancel} className="btn border border-edge text-slate-300">{zh ? '取消研究' : 'Cancel study'}</button>}
      <button data-testid="exchanger-study-reset" type="button" onClick={reset} className="btn border border-edge text-slate-300">{zh ? '重置研究' : 'Reset study'}</button>
      <span data-testid="exchanger-study-status" className="text-xs text-slate-400" aria-live="polite">{status}{jobId ? ` · ${zh ? '任务' : 'Job'} ${jobId}` : ''}</span>
    </div>
    {error && <div data-testid="exchanger-study-error" role="alert" className="mt-3 rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-300">{error}{error.includes('需要登录') && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>{zh ? '登录' : 'Sign in'}</a>}</div>}
    {result && savedDraft && savedInput && <ExchangerStudyResults draft={savedDraft} input={savedInput} result={result} jobId={jobId} />}
  </section>
}

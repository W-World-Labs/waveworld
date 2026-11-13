import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { createDefaultPidStudy, createPidStudyJob, type PidStudyDraft } from '../../lib/sim/dymola-pid-study-input'
import { readPidStudyResult, type PidStudyResult } from '../../lib/sim/dymola-pid-study-result'
import { PidStudyEditor } from './PidStudyEditor'
import { PidStudyResults } from './PidStudyResults'

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

export function PidStudyPanel() {
  const [draft, setDraft] = useState<PidStudyDraft>(() => createDefaultPidStudy())
  const [busy, setBusy] = useState(false)
  const [draftValid, setDraftValid] = useState(true)
  const [status, setStatus] = useState('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedDraft, setSavedDraft] = useState<PidStudyDraft | null>(null)
  const [savedInput, setSavedInput] = useState<ReturnType<typeof createPidStudyJob>['input'] | null>(null)
  const [result, setResult] = useState<PidStudyResult | null>(null)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      controllerRef.current?.abort(new DOMException('PI study panel unmounted', 'AbortError'))
      controllerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (draftValid) return
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException('PI study inputs are invalid', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('idle')
    setJobId(null)
    setError(null)
    setSavedDraft(null)
    setSavedInput(null)
    setResult(null)
  }, [draftValid])

  const current = (generation: number, controller?: AbortController) =>
    mountedRef.current && generation === generationRef.current && (!controller || controllerRef.current === controller)

  const invalidate = (reason: string) => {
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException(reason, 'AbortError'))
    controllerRef.current = null
  }

  const clearRun = () => {
    setBusy(false)
    setJobId(null)
    setError(null)
    setSavedDraft(null)
    setSavedInput(null)
    setResult(null)
  }

  const edit = (next: PidStudyDraft) => {
    invalidate('PI study inputs changed')
    setDraft(next)
    clearRun()
    setStatus('idle')
  }

  const run = async () => {
    if (busy || !draftValid) return
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
      const { input: rawInput, spec } = createPidStudyJob(capturedDraft)
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
      const parsed = readPidStudyResult(remote as JobResultV1, input)
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
    invalidate('PI study cancelled')
    clearRun()
    setStatus('cancelled')
  }

  const reset = () => {
    invalidate('PI study reset')
    setDraft(createDefaultPidStudy())
    setDraftValid(true)
    clearRun()
    setStatus('idle')
  }

  return <section className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="pid-study-title">
    <header className="mb-4">
      <h2 id="pid-study-title" className="text-lg font-semibold text-slate-100">PI control study</h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
        Configure a first-order plant with a PI controller, then submit an authenticated Host job. Results use a state-space calculation on the host with f64 arithmetic; this study does not call Dymola or claim vendor or GPU execution.
      </p>
    </header>
    <PidStudyEditor value={draft} onChange={edit} onValidityChange={setDraftValid} />
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button data-testid="pid-study-run" type="button" onClick={() => void run()} disabled={busy || !draftValid} className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:opacity-50">Run PI study</button>
      {busy && <button data-testid="pid-study-cancel" type="button" onClick={cancel} className="btn border border-edge text-slate-300">Cancel study</button>}
      <button data-testid="pid-study-reset" type="button" onClick={reset} className="btn border border-edge text-slate-300">Reset study</button>
      <span data-testid="pid-study-status" className="text-xs text-slate-400" aria-live="polite">{status}{jobId ? ` · Job ${jobId}` : ''}</span>
    </div>
    {error && <div data-testid="pid-study-error" role="alert" className="mt-3 rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-300">{error}{error.includes('需要登录') && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>Sign in</a>}</div>}
    {result && savedDraft && savedInput && <PidStudyResults draft={savedDraft} input={savedInput} result={result} jobId={jobId} />}
  </section>
}

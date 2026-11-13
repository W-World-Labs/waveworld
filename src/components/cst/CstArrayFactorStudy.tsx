import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import { CstArrayFactorInput as CstArrayFactorEditor, type CstArrayFactorInputValue } from './CstArrayFactorInput'
import { CstArrayFactorResults } from './CstArrayFactorResults'
import {
  createCstArrayFactorJob,
  createDefaultCstArrayFactorDraft,
  CST_ARRAY_FACTOR_NATIVE_PIN_SHA,
  type CstArrayFactorDraft,
  type CstArrayFactorInput,
} from '../../lib/sim/cst-array-factor'
import { readCstArrayFactorResult, type CstArrayFactorResult } from '../../lib/sim/cst-array-factor-result'

type StudyStatus = 'idle' | 'editing' | 'submitting' | 'succeeded' | 'failed' | 'cancelled'

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

/** Authenticated Host workflow for the bounded CST-mapped array-factor operation. */
export function CstArrayFactorStudy() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [draft, setDraft] = useState<CstArrayFactorDraft>(() => createDefaultCstArrayFactorDraft())
  const [status, setStatus] = useState<StudyStatus>('idle')
  const [busy, setBusy] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attemptedInput, setAttemptedInput] = useState<string | null>(null)
  const [submittedInput, setSubmittedInput] = useState<CstArrayFactorInput | null>(null)
  const [result, setResult] = useState<CstArrayFactorResult | null>(null)
  const [backend, setBackend] = useState<Record<string, unknown> | null>(null)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      controllerRef.current?.abort(new DOMException('CST array-factor study unmounted', 'AbortError'))
      controllerRef.current = null
    }
  }, [])

  const current = (generation: number, controller?: AbortController) =>
    mountedRef.current && generation === generationRef.current && (!controller || controllerRef.current === controller)

  const clearForEdit = () => {
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException('CST array-factor inputs changed', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('editing')
    setJobId(null)
    setError(null)
    setAttemptedInput(null)
    setSubmittedInput(null)
    setResult(null)
    setBackend(null)
  }

  const edit = (value: CstArrayFactorInputValue) => {
    clearForEdit()
    setDraft({ freqHz: value.freqHz, positionsM: value.positionsM, weights: value.weights, directionsRad: value.directionsRad })
  }

  const submit = async () => {
    if (busy) return
    const generation = ++generationRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    setBusy(true)
    setStatus('submitting')
    setJobId(null)
    setError(null)
    setResult(null)
    setBackend(null)
    let latestJobId: string | null = null
    let snapshot: CstArrayFactorInput | null = null
    try {
      const candidate = { module: 'antenna-l2', backend: 'host', operation: 'cst-array-factor', ...draft } as CstArrayFactorInput
      setAttemptedInput(JSON.stringify(candidate, null, 2))
      const { input, spec } = createCstArrayFactorJob(draft)
      snapshot = frozenCopy(input)
      setSubmittedInput(snapshot)
      setAttemptedInput(JSON.stringify(snapshot, null, 2))
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
        onStatus: (id) => {
          latestJobId = id
          if (current(generation, controller)) { setJobId(id); setStatus('submitting') }
        },
      })
      if (!current(generation, controller)) return
      const parsed = readCstArrayFactorResult(remote as JobResultV1, input)
      if (!current(generation, controller)) return
      setResult(parsed)
      setBackend({ id: parsed.backend })
      setJobId(latestJobId)
      setStatus('succeeded')
    } catch (cause) {
      if (!current(generation, controller) || controller.signal.aborted) return
      setStatus('failed')
      setError(cause instanceof Error ? cause.message : String(cause))
      if (snapshot) setSubmittedInput(snapshot)
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        if (current(generation)) setBusy(false)
      }
    }
  }

  const cancel = () => {
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException('CST array-factor study cancelled', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('cancelled')
    setJobId(null)
  }

  const reset = () => {
    clearForEdit()
    setDraft(createDefaultCstArrayFactorDraft())
    setStatus('idle')
  }

  return <section data-testid="cst-array-factor-study" className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="cst-array-factor-title">
    <header className="mb-4">
      <h2 id="cst-array-factor-title" className="text-lg font-semibold text-slate-100">{zh ? '三维天线阵列因子研究' : '3D antenna array-factor study'}</h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">{zh
        ? '编辑复数馈电、三维单元位置和球坐标观察方向，并提交经过认证的 Host 作业。此自由空间各向同性点源阵列因子不包含单元方向图、互耦、材料环境或近场，也不声称 CST 数值等价或 GPU 求解。'
        : 'Edit complex excitations, 3D element positions, and spherical observation directions, then submit an authenticated Host job. This free-space isotropic point-element array factor excludes element patterns, coupling, material environments, and near fields; it makes no CST equivalence or GPU execution claim.'}</p>
    </header>
    <CstArrayFactorEditor
      value={{ module: 'antenna-l2', backend: 'host', operation: 'cst-array-factor', ...draft }}
      onChange={edit}
      disabled={busy}
    />
    <p className="mt-2 text-xs text-slate-500">{zh ? '序列化 Host 输入上限为 1 MiB。' : 'Serialized Host input is limited to 1 MiB.'}</p>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button data-testid="cst-array-factor-submit" type="button" disabled={busy} onClick={() => void submit()} className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:opacity-50">{zh ? '提交 Host 作业' : 'Submit Host job'}</button>
      {busy && <button data-testid="cst-array-factor-cancel" type="button" onClick={cancel} className="btn border border-edge text-slate-300">{zh ? '取消' : 'Cancel'}</button>}
      <button data-testid="cst-array-factor-reset" type="button" disabled={busy} onClick={reset} className="btn border border-edge text-slate-300">{zh ? '重置' : 'Reset'}</button>
      <span data-testid="cst-array-factor-status" aria-live="polite" className="text-xs text-slate-400">{status}{jobId ? ` · ${zh ? '任务' : 'Job'} ${jobId}` : ''}</span>
    </div>
    {error && <div data-testid="cst-array-factor-error" role="alert" className="mt-3 rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-300">{error}{error.includes('需要登录') && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>{zh ? '登录' : 'Sign in'}</a>}</div>}
    {attemptedInput && <details className="mt-3 rounded-lg border border-edge/70 p-3 text-xs text-slate-400" open={status === 'failed'}>
      <summary>{zh ? '提交输入快照' : 'Submitted input snapshot'}{submittedInput ? ' · validated' : ' · rejected before submission'}</summary>
      <pre data-testid="cst-array-factor-provenance" className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{attemptedInput}</pre>
    </details>}
    {status === 'succeeded' && result && submittedInput && <CstArrayFactorResults result={result} submittedInput={submittedInput} backend={backend ?? {}} jobId={jobId ?? undefined} nativePin={CST_ARRAY_FACTOR_NATIVE_PIN_SHA} />}
  </section>
}

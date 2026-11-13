'use client'

import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import { createDefaultComsolRheologyDraft, createComsolRheologyInput, type ComsolRheologyDraft, type ComsolRheologyInput } from '../../lib/sim/comsol-rheology-input'
import { createModuleJobSpec, readModuleResult } from '../../lib/sim/module-compute'
import { ComsolRheologyEditor } from './ComsolRheologyEditor'
import { ComsolRheologyResults } from './ComsolRheologyResults'

type SavedStudy = { draft: ComsolRheologyDraft; input: ComsolRheologyInput; result: unknown; jobId: string | null }

/** Submit one bounded viscosity/stress evaluation through the authenticated native Host path. */
export function ComsolRheologyStudyPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [draft, setDraft] = useState<ComsolRheologyDraft>(createDefaultComsolRheologyDraft)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [study, setStudy] = useState<SavedStudy | null>(null)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      controllerRef.current?.abort(new DOMException('COMSOL rheology panel unmounted', 'AbortError'))
      controllerRef.current = null
    }
  }, [])

  const isCurrent = (generation: number, controller?: AbortController) =>
    mountedRef.current && generation === generationRef.current && (!controller || controllerRef.current === controller)

  const invalidate = () => {
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException('COMSOL rheology inputs changed', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('idle')
    setJobId(null)
    setError(null)
    setStudy(null)
  }

  const updateDraft = (next: ComsolRheologyDraft) => {
    invalidate()
    setDraft(next)
  }

  const reset = () => {
    invalidate()
    setDraft(createDefaultComsolRheologyDraft())
  }

  const runStudy = async () => {
    if (busy) return
    const generation = generationRef.current + 1
    generationRef.current = generation
    const snapshot: ComsolRheologyDraft = { ...draft, shearRates: [...draft.shearRates] }
    setStudy(null)
    setJobId(null)
    setError(null)
    setBusy(true)
    setStatus('submitting')
    const controller = new AbortController()
    controllerRef.current = controller
    let submittedJobId: string | null = null
    try {
      const input = createComsolRheologyInput(snapshot)
      const spec = createModuleJobSpec(input)
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
      if (!isCurrent(generation, controller)) return
      const remote = await runRemoteJob(client, spec, {
        signal: controller.signal,
        onStatus: (id, next) => {
          if (isCurrent(generation, controller)) {
            submittedJobId = id
            setJobId(id)
            setStatus(next)
          }
        },
      })
      if (!isCurrent(generation, controller)) return
      const result = readModuleResult(remote as JobResultV1, input)
      if (!isCurrent(generation, controller)) return
      setStudy({ draft: snapshot, input, result, jobId: submittedJobId })
      setStatus('succeeded')
    } catch (cause) {
      if (!isCurrent(generation, controller) || controller.signal.aborted) return
      setStatus('failed')
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        if (isCurrent(generation)) setBusy(false)
      }
    }
  }

  const cancel = () => {
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException('COMSOL rheology study cancelled', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('cancelled')
    setJobId(null)
    setStudy(null)
  }

  const label = (en: string, cn: string) => zh ? cn : en

  return <section id="comsol-rheology-study" data-testid="comsol-rheology-study" className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="comsol-rheology-title">
    <div className="mb-4">
      <h2 id="comsol-rheology-title" className="text-lg font-semibold text-ink">{label('Generalized-Newtonian rheology', '广义牛顿流变')}</h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-muted">{label(
        'Choose a constitutive model and evaluate apparent viscosity and shear stress at up to 256 shear rates with one existing W-Sim Host operation.',
        '选择本构模型，在最多 256 个剪切速率点上通过现有 W-Sim Host 操作计算表观黏度和剪切应力。',
      )}</p>
      <p className="mt-2 text-xs text-muted">{label(
        'This is a constitutive property evaluation, not a CFD flow solve. It does not read .mph files or establish numerical equivalence with COMSOL. Power-law or Herschel-Bulkley samples at zero shear may be singular and are returned as such by the native operation.',
        '这是本构属性评估，不是 CFD 流场求解。不读取 .mph 文件，也不代表与 COMSOL 数值等效。零剪切下的幂律或 Herschel-Bulkley 样本可能奇异；结果按原生操作返回。',
      )}</p>
    </div>
    <ComsolRheologyEditor value={draft} onChange={updateDraft} onSubmit={() => void runStudy()} disabled={busy} />
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {busy && <button type="button" data-testid="comsol-rheology-cancel" onClick={cancel} className="rounded-lg border border-edge px-4 py-2 text-sm text-ink">{label('Cancel job', '取消任务')}</button>}
      <button type="button" data-testid="comsol-rheology-reset" onClick={reset} disabled={busy} className="rounded-lg border border-edge px-4 py-2 text-sm text-ink disabled:opacity-50">{label('Reset study', '重置研究')}</button>
      {!getStoredUserToken() && <a data-testid="comsol-rheology-login" className="text-sm text-wave underline" href={oidcStartHref(typeof window === 'undefined' ? '/comsol' : `${window.location.pathname}${window.location.search}`)}>{label('Sign in to run a Host job', '登录以运行 Host 任务')}</a>}
    </div>
    <p data-testid="comsol-rheology-status" className="mt-2 text-xs text-muted" aria-live="polite">{label(`Status: ${status}${jobId ? ` · Job ${jobId}` : ''}`, `状态：${status}${jobId ? ` · 作业 ${jobId}` : ''}`)}</p>
    {error && <p role="alert" data-testid="comsol-rheology-error" className="mt-2 text-sm text-red-400">{error}</p>}
    {study && <ComsolRheologyResults {...study} />}
  </section>
}

export default ComsolRheologyStudyPanel

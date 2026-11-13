import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import { createDefaultComsolPipeFlow, createComsolPipeFlowJob, type ComsolPipeFlowDraft, type ComsolPipeFlowInput } from '../../lib/sim/comsol-pipe-flow-input'
import { readComsolPipeFlowResult, type ComsolPipeFlowResult } from '../../lib/sim/comsol-pipe-flow-result'
import { ComsolPipeFlowEditor } from './ComsolPipeFlowEditor'
import { ComsolPipeFlowResults } from './ComsolPipeFlowResults'

type SavedStudy = { draft: ComsolPipeFlowDraft; input: ComsolPipeFlowInput; result: ComsolPipeFlowResult; jobId: string | null }

/** One authenticated native solve per submission; results stay bound to that submitted snapshot. */
export function ComsolPipeFlowStudyPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [draft, setDraft] = useState<ComsolPipeFlowDraft>(createDefaultComsolPipeFlow)
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
      controllerRef.current?.abort(new DOMException('Pipe flow panel unmounted', 'AbortError'))
      controllerRef.current = null
    }
  }, [])

  const isCurrent = (generation: number, controller?: AbortController) =>
    mountedRef.current && generation === generationRef.current && (!controller || controllerRef.current === controller)

  const invalidate = () => {
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException('Pipe flow study input changed', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('idle')
    setJobId(null)
    setError(null)
    setStudy(null)
  }

  const updateDraft = (next: ComsolPipeFlowDraft) => {
    invalidate()
    setDraft(next)
  }

  const reset = () => {
    invalidate()
    setDraft(createDefaultComsolPipeFlow())
  }

  const runStudy = async () => {
    if (busy) return
    const generation = generationRef.current + 1
    generationRef.current = generation
    const snapshot = { ...draft }
    setStudy(null)
    setJobId(null)
    setError(null)
    setBusy(true)
    setStatus('submitting')
    const controller = new AbortController()
    controllerRef.current = controller
    let submittedJobId: string | null = null
    try {
      const { input, spec } = createComsolPipeFlowJob(snapshot)
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
          if (isCurrent(generation, controller)) { submittedJobId = id; setJobId(id); setStatus(next) }
        },
      })
      if (!isCurrent(generation, controller)) return
      const result = readComsolPipeFlowResult(remote as JobResultV1, input)
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
    controllerRef.current?.abort(new DOMException('Pipe flow study cancelled', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('cancelled')
    setJobId(null)
    setStudy(null)
  }

  return (
    <section id="comsol-pipe-flow-study" data-testid="comsol-pipe-flow-study" className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="comsol-pipe-flow-title">
      <div className="mb-4">
        <h2 id="comsol-pipe-flow-title" className="text-lg font-semibold text-ink">{zh ? '单管稳态压降研究' : 'Single-pipe steady pressure-drop study'}</h2>
        <p className="mt-1 max-w-4xl text-sm leading-relaxed text-muted">{zh
          ? '设置一根水平圆管和牛顿流体属性，并给定两端压力；每次只向已登录的 W-Sim Host 提交一个现有的 sw-comsol-pipe-flow 原生任务。表格与端点图仅展示原生返回的结果。'
          : 'Set one horizontal circular pipe, Newtonian fluid properties, and endpoint pressures. Each run submits one existing sw-comsol-pipe-flow native job to the authenticated W-Sim Host. The table and endpoint plot show native-returned results only.'}</p>
        <p className="mt-2 text-xs text-muted">{zh
          ? '范围：稳态、不可压缩、单相、单根固定几何管道；原生模块使用 Churchill Darcy 摩擦因子并报告实际流动区间。不生成空间压力场，不读写 .mph，也不代表 COMSOL 数值对比。'
          : 'Scope: steady, incompressible, single-phase flow through one fixed-geometry pipe. The native module uses the Churchill Darcy friction correlation and reports the resulting flow regime. This does not create a spatial pressure field, read or write .mph files, or establish numerical agreement with COMSOL.'}</p>
      </div>
      <ComsolPipeFlowEditor value={draft} onChange={updateDraft} disabled={busy} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button id="comsol-pipe-flow-run" data-testid="comsol-pipe-flow-run" type="button" onClick={() => void runStudy()} disabled={busy} className="btn bg-wave text-slate-950 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? (zh ? '管流任务运行中…' : 'Pipe flow job running…') : (zh ? '运行管流研究' : 'Run pipe flow study')}
        </button>
        {busy && <button id="comsol-pipe-flow-cancel" data-testid="comsol-pipe-flow-cancel" type="button" onClick={cancel} className="btn border border-edge text-ink">{zh ? '取消研究' : 'Cancel study'}</button>}
        <button id="comsol-pipe-flow-reset" data-testid="comsol-pipe-flow-reset" type="button" onClick={reset} className="btn border border-edge text-ink">{zh ? '重置研究' : 'Reset study'}</button>
        {!getStoredUserToken() && <a className="text-sm text-wave underline" href={oidcStartHref(typeof window === 'undefined' ? '/comsol' : `${window.location.pathname}${window.location.search}`)}>{zh ? '登录以运行 Host 任务' : 'Sign in to run a Host job'}</a>}
      </div>
      <p id="comsol-pipe-flow-status" data-testid="comsol-pipe-flow-status" className="mt-2 text-xs text-muted" aria-live="polite">
        {zh ? `状态：${status}${jobId ? ` · 作业 ${jobId}` : ''}` : `Status: ${status}${jobId ? ` · Job ${jobId}` : ''}`}
      </p>
      {error && <p id="comsol-pipe-flow-error" data-testid="comsol-pipe-flow-error" role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
      {study && <ComsolPipeFlowResults {...study} />}
    </section>
  )
}

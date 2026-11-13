import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import {
  createDefaultPemfcStudy,
  createPemfcStudyJob,
  type PemfcPolarizationInput,
  type PemfcStudyDraft,
} from '../../lib/sim/pemfc-study-input'
import { readPemfcStudyResult, type PemfcStudyResult } from '../../lib/sim/pemfc-study-result'
import { PemfcConditionsEditor } from './PemfcConditionsEditor'
import { PemfcLossesEditor } from './PemfcLossesEditor'
import { PemfcStudyResults } from './PemfcStudyResults'
import { PemfcSweepEditor } from './PemfcSweepEditor'

export function PemfcStudyPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [draft, setDraft] = useState<PemfcStudyDraft>(createDefaultPemfcStudy)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [study, setStudy] = useState<{ draft: PemfcStudyDraft; input: PemfcPolarizationInput; result: PemfcStudyResult; jobId: string | null } | null>(null)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      controllerRef.current?.abort(new DOMException('PEMFC study panel unmounted', 'AbortError'))
      controllerRef.current = null
    }
  }, [])

  const isCurrent = (generation: number, controller?: AbortController) =>
    mountedRef.current && generation === generationRef.current && (!controller || controllerRef.current === controller)

  const invalidate = () => {
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException('PEMFC study input changed', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('idle')
    setJobId(null)
    setError(null)
    setStudy(null)
  }

  const updateDraft = (next: PemfcStudyDraft) => {
    invalidate()
    setDraft(next)
  }

  const reset = () => {
    invalidate()
    setDraft(createDefaultPemfcStudy())
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
      const { input, spec } = createPemfcStudyJob(snapshot)
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
      const result = readPemfcStudyResult(remote as JobResultV1, input)
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
    controllerRef.current?.abort(new DOMException('PEMFC polarization study cancelled', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('cancelled')
    setJobId(null)
    setStudy(null)
  }

  return (
    <section id="pemfc-study" className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="pemfc-study-title">
      <div className="mb-4">
        <h2 id="pemfc-study-title" className="text-lg font-semibold text-ink">{zh ? 'PEM 燃料电池极化研究' : 'PEM fuel cell polarization study'}</h2>
        <p className="mt-1 max-w-4xl text-sm leading-relaxed text-muted">
          {zh
            ? '固定温度与气体分压的零维代数模型：能斯特电势加 Tafel 活化、欧姆和浓差损失。结果来自已登录的 W-Sim Host 原生任务。电压下限 0 V 是模型截断；最高功率仅为返回采样中的最大值，不是连续优化。电压效率为电压与能斯特电势之比，不代表系统或燃料效率。'
            : 'A zero-dimensional algebraic model with fixed temperature and gas partial pressures: Nernst potential with Tafel activation, ohmic, and concentration losses. Results come from an authenticated W-Sim Host native job. Voltage is floored at 0 V by the model; peak power is only the maximum among returned samples, not a continuous optimization. Voltage efficiency is cell voltage divided by Nernst potential, not system or fuel efficiency.'}
        </p>
        <p className="mt-2 text-xs text-muted">
          {zh
            ? '这不是完整 COMSOL 多物理场模型：不求解空间分布、物种/水/热耦合，不计算膜性质、不拟合参数，也不读写 .mph 文件或证明材料性能。正电流点及首个正扫描样本需不低于 j₀；零电流点单独允许。'
            : 'This is not a full COMSOL multiphysics model: it does not solve spatial fields or species/water/thermal coupling, calculate membrane properties, fit parameters, read or write .mph files, or certify materials. Positive operating points and the first positive sweep sample must be at least j₀; zero current is allowed separately.'}
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <fieldset className="rounded-lg border border-edge p-4">
          <legend className="px-1 text-sm font-semibold text-ink">{zh ? '规定条件' : 'Prescribed conditions'}</legend>
          <PemfcConditionsEditor value={draft} onChange={updateDraft} />
        </fieldset>
        <fieldset className="rounded-lg border border-edge p-4">
          <legend className="px-1 text-sm font-semibold text-ink">{zh ? '电压损失参数' : 'Voltage-loss parameters'}</legend>
          <PemfcLossesEditor value={draft} onChange={updateDraft} />
        </fieldset>
        <div className="xl:col-span-2"><PemfcSweepEditor value={draft} onChange={updateDraft} /></div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button id="pemfc-study-run" data-testid="pemfc-study-run" type="button" onClick={() => void runStudy()} disabled={busy} className="btn bg-wave text-slate-950 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? (zh ? '研究任务运行中…' : 'Study running…') : (zh ? '运行极化研究' : 'Run polarization study')}
        </button>
        {busy && <button id="pemfc-study-cancel" data-testid="pemfc-study-cancel" type="button" onClick={cancel} className="btn border border-edge text-ink">{zh ? '取消研究' : 'Cancel study'}</button>}
        <button id="pemfc-study-reset" data-testid="pemfc-study-reset" type="button" onClick={reset} className="btn border border-edge text-ink">{zh ? '重置研究' : 'Reset study'}</button>
        {!getStoredUserToken() && <a className="text-sm text-wave underline" href={oidcStartHref(typeof window === 'undefined' ? '/comsol' : `${window.location.pathname}${window.location.search}`)}>{zh ? '登录以运行 Host 任务' : 'Sign in to run a Host job'}</a>}
      </div>
      <p id="pemfc-study-status" data-testid="pemfc-study-status" className="mt-2 text-xs text-muted" aria-live="polite">
        {zh ? `状态：${status}${jobId ? ` · 作业 ${jobId}` : ''}` : `Status: ${status}${jobId ? ` · job ${jobId}` : ''}`}
      </p>
      {error && <p id="pemfc-study-error" data-testid="pemfc-study-error" role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
      {study && <PemfcStudyResults {...study} />}
    </section>
  )
}

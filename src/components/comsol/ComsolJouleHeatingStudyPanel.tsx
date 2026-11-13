'use client'

import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import { createDefaultComsolJouleHeating, createComsolJouleHeatingJob, type ComsolJouleHeatingDraft, type ComsolJouleHeatingInput } from '../../lib/sim/comsol-joule-heating-input'
import { readComsolJouleHeatingResult, type ComsolJouleHeatingResult } from '../../lib/sim/comsol-joule-heating-result'
import { ComsolJouleHeatingResults } from './ComsolJouleHeatingResults'

type SavedStudy = {
  draft: ComsolJouleHeatingDraft
  input: ComsolJouleHeatingInput
  result: ComsolJouleHeatingResult
  jobId: string | null
}

const fieldClass = 'mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-ink disabled:opacity-60'

function readNumber(raw: string): number {
  return raw.trim() === '' ? Number.NaN : Number(raw)
}

/** One authenticated native solve per submission; results stay bound to that submitted snapshot. */
export function ComsolJouleHeatingStudyPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [draft, setDraft] = useState<ComsolJouleHeatingDraft>(createDefaultComsolJouleHeating)
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
      controllerRef.current?.abort(new DOMException('Joule heating panel unmounted', 'AbortError'))
      controllerRef.current = null
    }
  }, [])

  const isCurrent = (generation: number, controller?: AbortController) =>
    mountedRef.current && generation === generationRef.current && (!controller || controllerRef.current === controller)

  const invalidate = () => {
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException('Joule heating study input changed', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('idle')
    setJobId(null)
    setError(null)
    setStudy(null)
  }

  const updateDraft = (next: ComsolJouleHeatingDraft) => {
    invalidate()
    setDraft(next)
  }

  const reset = () => {
    invalidate()
    setDraft(createDefaultComsolJouleHeating())
  }

  const runStudy = async () => {
    if (busy) return
    const generation = generationRef.current + 1
    generationRef.current = generation
    const snapshot: ComsolJouleHeatingDraft = { ...draft }
    setStudy(null)
    setJobId(null)
    setError(null)
    setBusy(true)
    setStatus('submitting')
    const controller = new AbortController()
    controllerRef.current = controller
    let submittedJobId: string | null = null
    try {
      const { input, spec } = createComsolJouleHeatingJob(snapshot)
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
      const result = readComsolJouleHeatingResult(remote as JobResultV1, input)
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
    controllerRef.current?.abort(new DOMException('Joule heating study cancelled', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('cancelled')
    setJobId(null)
    setStudy(null)
  }

  const base = {
    sigma0: draft.sigma0,
    alpha: draft.alpha,
    T_ref: draft.T_ref,
    k: draft.k,
    L: draft.L,
    area: draft.area,
    T_0: draft.T_0,
    T_L: draft.T_L,
    N: draft.N,
  }
  const updateBase = (key: keyof typeof base, value: number) => updateDraft({ ...draft, [key]: value } as ComsolJouleHeatingDraft)
  const label = (en: string, cn: string) => zh ? cn : en

  const fields: Array<{ key: keyof typeof base; testId: string; en: string; cn: string; unit: string; min: number; max: number; step: string }> = [
    { key: 'L', testId: 'length', en: 'Conductor length', cn: '导体长度', unit: 'm', min: 0, max: 1e4, step: 'any' },
    { key: 'area', testId: 'area', en: 'Cross-sectional area', cn: '横截面积', unit: 'm²', min: 0, max: 100, step: 'any' },
    { key: 'sigma0', testId: 'sigma0', en: 'Reference conductivity σ₀', cn: '参考电导率 σ₀', unit: 'S/m', min: 0, max: 1e9, step: 'any' },
    { key: 'alpha', testId: 'alpha', en: 'Temperature coefficient α', cn: '温度系数 α', unit: '1/K', min: 0, max: 1, step: 'any' },
    { key: 'T_ref', testId: 'tRef', en: 'Reference temperature Tref', cn: '参考温度 Tref', unit: 'K', min: 0, max: 1e5, step: 'any' },
    { key: 'k', testId: 'thermalConductivity', en: 'Thermal conductivity k', cn: '热导率 k', unit: 'W/(m·K)', min: 0, max: 1e6, step: 'any' },
    { key: 'T_0', testId: 'T0', en: 'Left fixed temperature T₀', cn: '左端固定温度 T₀', unit: 'K', min: 0, max: 1e5, step: 'any' },
    { key: 'T_L', testId: 'TL', en: 'Right fixed temperature TL', cn: '右端固定温度 TL', unit: 'K', min: 0, max: 1e5, step: 'any' },
    { key: 'N', testId: 'samples', en: 'Profile samples N', cn: '剖面采样数 N', unit: '', min: 2, max: 4096, step: '1' },
  ]

  return (
    <section id="comsol-joule-study" data-testid="comsol-joule-study" className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="comsol-joule-title">
      <div className="mb-4">
        <h2 id="comsol-joule-title" className="text-lg font-semibold text-ink">{label('DC Joule heating study', '直流焦耳热研究')}</h2>
        <p className="mt-1 max-w-4xl text-sm leading-relaxed text-muted">{label(
          'Configure a uniform-cross-section conductor, electrical drive, material properties, and fixed end temperatures. Each run submits one authenticated native W-Sim Host job.',
          '设置均匀横截面导体、电驱动、材料属性和两端固定温度。每次运行向已认证的 W-Sim Host 提交一个原生任务。',
        )}</p>
        <p className="mt-2 text-xs text-muted">{label(
          'Scope: steady 1D DC Joule heating with current or voltage drive, fixed endpoint temperatures, constant thermal conductivity, and constant or temperature-dependent electrical conductivity. Results show native output only; this does not model transient or 3D/PDE behavior, run a frontend solve, or establish numerical agreement with COMSOL.',
          '范围：稳态一维直流焦耳热，可使用电流或电压驱动、两端固定温度、常数热导率，以及常数或随温度变化的电导率。结果仅展示原生输出；不包含瞬态或三维/PDE 行为，不在前端求解，也不代表与 COMSOL 数值一致。',
        )}</p>
      </div>

      <div className="space-y-4 rounded-xl border border-edge bg-surface p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-ink">
            <span>{label('Electrical drive', '电驱动方式')}</span>
            <select
              id="comsol-joule-drive"
              data-testid="comsol-joule-drive"
              aria-label={label('Electrical drive', '电驱动方式')}
              value={draft.drive}
              disabled={busy}
              onChange={event => updateDraft(event.target.value === 'voltage'
                ? { drive: 'voltage', voltage: 1, ...base }
                : { drive: 'current', current: 1, ...base })}
              className={fieldClass}
            >
              <option value="current">{label('Current', '电流')}</option>
              <option value="voltage">{label('Voltage', '电压')}</option>
            </select>
          </label>
          {draft.drive === 'current' ? (
            <label className="block text-sm text-ink">
              <span>{label('Current', '电流')} (A)</span>
              <input id="comsol-joule-current" data-testid="comsol-joule-current" aria-label={label('Current (A)', '电流 (A)')} type="number" min={0} max={1e6} step="any" value={Number.isFinite(draft.current) ? draft.current : ''} disabled={busy} onChange={event => updateDraft({ ...draft, current: readNumber(event.target.value) })} className={fieldClass} />
            </label>
          ) : (
            <label className="block text-sm text-ink">
              <span>{label('Voltage', '电压')} (V)</span>
              <input id="comsol-joule-voltage" data-testid="comsol-joule-voltage" aria-label={label('Voltage (V)', '电压 (V)')} type="number" min={0} max={1e6} step="any" value={Number.isFinite(draft.voltage) ? draft.voltage : ''} disabled={busy} onChange={event => updateDraft({ ...draft, voltage: readNumber(event.target.value) })} className={fieldClass} />
            </label>
          )}
          {fields.map(({ key, testId, en, cn, unit, min, max, step }) => {
            const title = `${label(en, cn)}${unit ? ` (${unit})` : ''}`
            return <label key={key} className="block text-sm text-ink">
              <span>{title}</span>
              <input
                id={`comsol-joule-${testId}`}
                data-testid={`comsol-joule-${testId}`}
                aria-label={title}
                type="number"
                min={min}
                max={max}
                step={step}
                value={Number.isFinite(draft[key]) ? draft[key] : ''}
                disabled={busy}
                onChange={event => updateBase(key, readNumber(event.target.value))}
                className={fieldClass}
              />
            </label>
          })}
        </div>
        <p className="text-xs text-muted">{label(
          'Input bounds are enforced by the native input builder before submission. α = 0 selects constant electrical conductivity.',
          '输入范围会在提交前由原生输入构造器校验。α = 0 表示电导率为常数。',
        )}</p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button id="comsol-joule-run" data-testid="comsol-joule-run" type="button" onClick={() => void runStudy()} disabled={busy} className="btn bg-wave text-slate-950 hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? label('Joule heating job running…', '焦耳热任务运行中…') : label('Run Joule heating study', '运行焦耳热研究')}
        </button>
        {busy && <button id="comsol-joule-cancel" data-testid="comsol-joule-cancel" type="button" onClick={cancel} className="btn border border-edge text-ink">{label('Cancel study', '取消研究')}</button>}
        <button id="comsol-joule-reset" data-testid="comsol-joule-reset" type="button" onClick={reset} className="btn border border-edge text-ink">{label('Reset study', '重置研究')}</button>
        {!getStoredUserToken() && <a id="comsol-joule-login" data-testid="comsol-joule-login" className="text-sm text-wave underline" href={oidcStartHref(typeof window === 'undefined' ? '/comsol' : `${window.location.pathname}${window.location.search}`)}>{label('Sign in to run a Host job', '登录以运行 Host 任务')}</a>}
      </div>
      <p id="comsol-joule-status" data-testid="comsol-joule-status" className="mt-2 text-xs text-muted" aria-live="polite">
        {label(`Status: ${status}${jobId ? ` · Job ${jobId}` : ''}`, `状态：${status}${jobId ? ` · 作业 ${jobId}` : ''}`)}
      </p>
      {error && <p id="comsol-joule-error" data-testid="comsol-joule-error" role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
      {study && <ComsolJouleHeatingResults {...study} />}
    </section>
  )
}

export default ComsolJouleHeatingStudyPanel

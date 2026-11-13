'use client'

import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import { createModuleJobSpec, readModuleResult, type SwModuleInput } from '../../lib/sim/module-compute'
import { ComsolMaterialTableEditor, type ComsolMaterialTableSnapshot } from './ComsolMaterialTableEditor'
import { ComsolMaterialTableResults, type ComsolMaterialTableSnapshot as ResultsSnapshot } from './ComsolMaterialTableResults'

type SavedStudy = {
  snapshot: ComsolMaterialTableSnapshot
  input: SwModuleInput
  result: unknown
  jobId: string | null
}

function nativeInput(snapshot: ComsolMaterialTableSnapshot): SwModuleInput {
  return {
    module: 'sw-comsol-temp-property',
    backend: 'host',
    method: snapshot.interpolation === 'linear'
      ? 'method-algo-piecewise-linear'
      : 'method-algo-piecewise-cubic',
    temps: snapshot.rows.map(row => row.temperatureK),
    values: snapshot.rows.map(row => row.value),
    temperature: snapshot.evaluationTemperatureK,
    extrapolation: snapshot.extrapolation,
  }
}

/** Submit one imported table through the existing authenticated native module job path. */
export function ComsolMaterialTableStudyPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
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
      controllerRef.current?.abort(new DOMException('Material table panel unmounted', 'AbortError'))
      controllerRef.current = null
    }
  }, [])

  const isCurrent = (generation: number, controller?: AbortController) =>
    mountedRef.current && generation === generationRef.current && (!controller || controllerRef.current === controller)

  const submit = async (snapshot: ComsolMaterialTableSnapshot) => {
    if (busy) return
    const generation = generationRef.current + 1
    generationRef.current = generation
    const submittedSnapshot: ComsolMaterialTableSnapshot = {
      ...snapshot,
      rows: snapshot.rows.map(row => ({ ...row })),
    }
    const input = nativeInput(submittedSnapshot)
    setStudy(null)
    setJobId(null)
    setError(null)
    setBusy(true)
    setStatus('submitting')
    const controller = new AbortController()
    controllerRef.current = controller
    let submittedJobId: string | null = null
    try {
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
      setStudy({ snapshot: submittedSnapshot, input, result, jobId: submittedJobId })
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
    controllerRef.current?.abort(new DOMException('Material table job cancelled', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('cancelled')
    setJobId(null)
    setStudy(null)
  }

  const label = (en: string, cn: string) => zh ? cn : en
  const resultSnapshot: ResultsSnapshot | null = study ? {
    propertyKind: study.snapshot.meaning,
    propertyUnit: study.snapshot.unit,
    rows: study.snapshot.rows,
    temperatureK: study.snapshot.evaluationTemperatureK,
    interpolation: study.snapshot.interpolation,
    extrapolation: study.snapshot.extrapolation,
    sourceCsv: study.snapshot.csv,
    nativeInput: study.input,
    jobId: study.jobId,
  } : null

  return <section id="comsol-material-table-study" data-testid="comsol-material-table-study" className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="comsol-material-table-study-title">
    <div className="mb-4">
      <h2 id="comsol-material-table-study-title" className="text-lg font-semibold text-ink">{label('Temperature-dependent material property', '随温度变化的材料属性')}</h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-muted">{label(
        'Import an app-defined two-column CSV for thermal conductivity or specific heat, choose one evaluation temperature and native interpolation options, then submit a single W-Sim Host task.',
        '导入应用自定义的两列 CSV（导热系数或比热容），选择一个评估温度和原生插值选项，然后提交一个 W-Sim Host 任务。',
      )}</p>
      <p className="mt-2 text-xs text-muted">{label(
        'This workflow does not read COMSOL .mph files, proprietary material exports, or a curated materials database. Interpolation and property derivatives come from the native W-Sim operation; the interface displays submitted knots and returned values.',
        '此工作流不读取 COMSOL .mph 文件、专有材料导出文件或精选材料数据库。插值和属性导数由 W-Sim 原生操作返回；界面显示提交的节点与返回值。',
      )}</p>
    </div>
    <ComsolMaterialTableEditor onSubmit={snapshot => void submit(snapshot)} disabled={busy} />
    <div className="mt-4 flex flex-wrap items-center gap-3">
      {busy && <button type="button" data-testid="comsol-material-table-cancel" onClick={cancel} className="rounded-lg border border-edge px-4 py-2 text-sm text-ink">{label('Cancel job', '取消任务')}</button>}
      {!getStoredUserToken() && <a data-testid="comsol-material-table-login" className="text-sm text-wave underline" href={oidcStartHref(typeof window === 'undefined' ? '/comsol' : `${window.location.pathname}${window.location.search}`)}>{label('Sign in to run a Host job', '登录以运行 Host 任务')}</a>}
    </div>
    <p data-testid="comsol-material-table-status" className="mt-2 text-xs text-muted" aria-live="polite">{label(`Status: ${status}${jobId ? ` · Job ${jobId}` : ''}`, `状态：${status}${jobId ? ` · 作业 ${jobId}` : ''}`)}</p>
    {error && <p role="alert" data-testid="comsol-material-table-error" className="mt-2 text-sm text-red-400">{error}</p>}
    {study && resultSnapshot && <ComsolMaterialTableResults snapshot={resultSnapshot} result={study.result} />}
  </section>
}

export default ComsolMaterialTableStudyPanel

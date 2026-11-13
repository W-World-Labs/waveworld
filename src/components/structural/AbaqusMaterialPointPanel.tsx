import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import { createModuleJobSpec, type SwModuleInput } from '../../lib/sim/module-compute'
import { parseAbaqusMaterialCard } from '../../lib/sim/abaqus-material-card'
import { parseAbaqusMaterialPointResult, type AbaqusMaterialPointResult } from '../../lib/sim/abaqus-material-point-result'
import { AbaqusMaterialPointResults } from './AbaqusMaterialPointResults'

type MaterialPointInput = SwModuleInput & {
  module: 'sw-calculix-plasticity'
  backend: 'host'
  E: number
  nu: number
  yieldStress: number
  hardening?: number
  hardeningCurve?: [number, number][]
  strainIncrements: [number, number, number, number, number, number][]
}

const DEFAULT_CARD = `*MATERIAL, NAME=Steel\n*ELASTIC\n210000, 0.3\n*PLASTIC\n250, 0\n300, 0.02`
const DEFAULT_STRAINS = `[[0.001, 0, 0, 0, 0, 0],\n [0.001, 0, 0, 0, 0, 0]]`
const fieldClass = 'mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2 text-ink font-mono text-sm'

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

function parseStrainIncrements(source: string): MaterialPointInput['strainIncrements'] {
  let parsed: unknown
  try { parsed = JSON.parse(source) } catch { throw new Error('Strain increments must be valid JSON.') }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 200) {
    throw new Error('Provide 1–200 strain increments.')
  }
  return parsed.map((row, index) => {
    if (!Array.isArray(row) || row.length !== 6) {
      throw new Error(`Strain increment ${index + 1} must contain exactly 6 values.`)
    }
    const values = row.map((value, component) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`Strain increment ${index + 1}, component ${component + 1} must be finite.`)
      }
      if (Math.abs(value) > 0.1) {
        throw new Error(`Strain increment ${index + 1}, component ${component + 1} must have magnitude at most 0.1.`)
      }
      return value
    })
    return values as MaterialPointInput['strainIncrements'][number]
  })
}

function parseMaterialPointEnvelope(remote: JobResultV1, expectedSteps: number, expectedJobSteps: number): AbaqusMaterialPointResult {
  const envelope = remote as JobResultV1 & { error?: unknown; summary?: { steps?: unknown }; moduleResult?: unknown }
  if (envelope.schemaVersion !== 1) throw new Error('Material-point job result must report schemaVersion 1.')
  if (envelope.error !== undefined && envelope.error !== null && envelope.error !== '') {
    throw new Error('Material-point job result carries an error and cannot be displayed as success.')
  }
  if (envelope.summary?.steps !== undefined && envelope.summary.steps !== expectedJobSteps) {
    throw new Error('Material-point job summary step count does not match the submitted job spec.')
  }
  if (!envelope.moduleResult || typeof envelope.moduleResult !== 'object' || Array.isArray(envelope.moduleResult)) {
    throw new Error('Material-point job result is missing its native module payload.')
  }
  const moduleResult = envelope.moduleResult as Record<string, unknown>
  if (moduleResult.module !== 'sw-calculix-plasticity') throw new Error('Material-point job result module does not match the requested calculation.')
  if (!moduleResult.backend || typeof moduleResult.backend !== 'object' || Array.isArray(moduleResult.backend)) {
    throw new Error('Material-point result is missing its Host backend identity.')
  }
  const backend = moduleResult.backend as Record<string, unknown>
  if (backend.id !== 'host-f64-sw-calculix-plasticity' || backend.deviceName !== 'w-sim-cuda-host' || backend.precision !== 'float64') {
    throw new Error('Material-point result did not report the pinned host-f64 backend.')
  }
  return parseAbaqusMaterialPointResult(moduleResult, expectedSteps)
}

export function AbaqusMaterialPointPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [card, setCard] = useState(DEFAULT_CARD)
  const [strainText, setStrainText] = useState(DEFAULT_STRAINS)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submittedInput, setSubmittedInput] = useState<MaterialPointInput | null>(null)
  const [result, setResult] = useState<AbaqusMaterialPointResult | null>(null)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      controllerRef.current?.abort(new DOMException('Material-point panel unmounted', 'AbortError'))
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

  const edit = (nextCard: string, nextStrains: string) => {
    invalidate('Material-point inputs changed')
    setCard(nextCard)
    setStrainText(nextStrains)
    setBusy(false)
    setStatus('idle')
    setJobId(null)
    setError(null)
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
    setSubmittedInput(null)
    try {
      const cardSnapshot = frozenCopy(card)
      const incrementsSnapshot = frozenCopy(parseStrainIncrements(strainText))
      const material = parseAbaqusMaterialCard(cardSnapshot)
      const input: MaterialPointInput = frozenCopy({
        module: 'sw-calculix-plasticity',
        backend: 'host',
        E: material.E,
        nu: material.nu,
        yieldStress: material.hardeningCurve[0]![0],
        ...(material.hardeningCurve.length === 1
          ? { hardening: 0 }
          : { hardeningCurve: material.hardeningCurve.map(([yieldStress, plasticStrain]) => [plasticStrain, yieldStress] as [number, number]) }),
        strainIncrements: incrementsSnapshot,
      })
      const spec = createModuleJobSpec(input)
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
      const parsed = parseMaterialPointEnvelope(remote as JobResultV1, incrementsSnapshot.length, spec.run.maxSteps ?? 1)
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
    invalidate('Material-point study cancelled')
    setBusy(false)
    setStatus('cancelled')
    setJobId(null)
    setError(null)
    setSubmittedInput(null)
    setResult(null)
  }

  return <section id="abaqus-material-point" data-testid="abaqus-material-point" className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="abaqus-material-point-title">
    <header className="mb-4">
      <h2 id="abaqus-material-point-title" className="text-lg font-semibold text-slate-100">{zh ? 'Abaqus 材料点响应' : 'Abaqus material-point response'}</h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
        {zh
          ? '输入独立的 *MATERIAL、*ELASTIC 和 *PLASTIC 卡片，以及总应变增量。结果是单个材料点的小应变本构响应；不包含网格平衡，也不运行完整 Abaqus 求解器。剪切分量采用工程剪切应变。应力结果与 E 和屈服应力使用相同的一致单位，不假设或转换为 Pa。'
          : 'Provide a standalone *MATERIAL, *ELASTIC, and *PLASTIC card plus total-strain increments. This returns a small-strain constitutive response at one material point; it does not solve mesh equilibrium or run the full Abaqus solver. Shear entries use engineering shear strain. Stress results use the same consistent units as E and yield stress; no Pa conversion is assumed.'}
      </p>
    </header>
    <div className="grid gap-4 lg:grid-cols-2">
      <label htmlFor="abaqus-material-point-card" className="block text-sm text-ink">
        <span>{zh ? 'Abaqus 材料卡片' : 'Abaqus material card'}</span>
        <textarea id="abaqus-material-point-card" data-testid="abaqus-material-point-card" rows={9} value={card} onChange={event => edit(event.currentTarget.value, strainText)} className={fieldClass} spellCheck={false} />
      </label>
      <label htmlFor="abaqus-material-point-strains" className="block text-sm text-ink">
        <span>{zh ? '总应变增量 JSON' : 'Total-strain increments JSON'}</span>
        <textarea id="abaqus-material-point-strains" data-testid="abaqus-material-point-strains" rows={9} value={strainText} onChange={event => edit(card, event.currentTarget.value)} className={fieldClass} spellCheck={false} aria-describedby="abaqus-material-point-strains-help" />
        <span id="abaqus-material-point-strains-help" className="mt-1 block text-xs text-muted">{zh ? '1–200 行；每行按 [exx, eyy, ezz, γxy, γxz, γyz] 排列，每项必须有限且绝对值 ≤ 0.1。' : 'Use 1–200 rows of [exx, eyy, ezz, gxy, gxz, gyz]. Every value must be finite with magnitude ≤ 0.1.'}</span>
      </label>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button id="abaqus-material-point-run" data-testid="abaqus-material-point-run" type="button" onClick={() => void run()} disabled={busy} className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:opacity-50">{zh ? '运行材料点响应' : 'Run material-point response'}</button>
      {busy && <button type="button" onClick={cancel} className="btn border border-edge text-slate-300">{zh ? '取消计算' : 'Cancel run'}</button>}
      <span data-testid="abaqus-material-point-status" className="text-xs text-slate-400" aria-live="polite">{status}{jobId ? ` · ${zh ? '任务' : 'Job'} ${jobId}` : ''}</span>
    </div>
    {error && <div data-testid="abaqus-material-point-error" role="alert" className="mt-3 rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-300">{error}{error.includes('需要登录') && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>{zh ? '登录' : 'Sign in'}</a>}</div>}
    {result && submittedInput && <AbaqusMaterialPointResults result={result} input={submittedInput} jobId={jobId} />}
  </section>
}

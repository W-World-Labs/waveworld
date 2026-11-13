import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import { createCoatingStudyJob, createDefaultCoatingStudyDraft, type CoatingStudyDraft, type CoatingStudyInput } from '../../lib/sim/coating-study-input'
import { buildCoatingStudyCsv, buildCoatingStudyReport } from '../../lib/sim/coating-study-export'
import { readCoatingStudyResult, type CoatingStudyResult } from '../../lib/sim/coating-study-result'
import { CoatingStudyResults } from './CoatingStudyResults'

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

function numericValue(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value)
}

function saveTextFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

export function CoatingStudyPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [draft, setDraft] = useState<CoatingStudyDraft>(() => createDefaultCoatingStudyDraft())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedDraft, setSavedDraft] = useState<CoatingStudyDraft | null>(null)
  const [savedInput, setSavedInput] = useState<CoatingStudyInput | null>(null)
  const [result, setResult] = useState<CoatingStudyResult | null>(null)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      controllerRef.current?.abort(new DOMException('Coating study panel unmounted', 'AbortError'))
      controllerRef.current = null
    }
  }, [])

  const current = (generation: number, controller?: AbortController) =>
    mountedRef.current && generation === generationRef.current && (!controller || controllerRef.current === controller)

  const edit = (next: CoatingStudyDraft) => {
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException('Coating study inputs changed', 'AbortError'))
    controllerRef.current = null
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
    try {
      const capturedDraft = frozenCopy(draft)
      const { input: rawInput, spec } = createCoatingStudyJob(capturedDraft)
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
      const parsed = readCoatingStudyResult(remote as JobResultV1, input)
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
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException('Coating study cancelled', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('cancelled')
    setJobId(null)
    setSavedDraft(null)
    setSavedInput(null)
    setResult(null)
  }

  const patchDraft = (patch: Partial<CoatingStudyDraft>) => edit({ ...draft, ...patch })
  const patchLayer = (index: number, patch: Partial<CoatingStudyDraft['layers'][number]>) => {
    const layers = draft.layers.map((layer, layerIndex) => layerIndex === index ? { ...layer, ...patch } : layer)
    edit({ ...draft, layers })
  }

  return <section data-testid="coating-study" className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="coating-study-title">
    <header className="mb-4">
      <h2 id="coating-study-title" className="text-lg font-semibold text-slate-100">{zh ? '薄膜涂层光谱研究' : 'Thin-film coating spectrum study'}</h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
        {zh
          ? '编辑有界的薄膜反射率/透射率光谱并提交已认证的原生 Host 作业。波长与层厚单位为 nm，角度单位为度；最多 16 层。此工具不声称与商业 OpticStudio 等价，也不表示使用 GPU。'
          : 'Edit a bounded thin-film reflectance/transmittance spectrum and submit an authenticated native Host job. Wavelength and layer thickness use nm; incidence angle uses degrees; up to 16 layers. This tool makes no commercial OpticStudio equivalence or GPU execution claim.'}
      </p>
    </header>
    <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" disabled={busy}>
      <legend className="sr-only">{zh ? '光谱和入射介质' : 'Spectrum and incident medium'}</legend>
      <label className="text-sm text-slate-300">{zh ? '起始波长 (nm)' : 'Start wavelength (nm)'}
        <input data-testid="coating-study-start-wavelength" type="number" min="100" max="2500" step="any" value={Number.isFinite(draft.startWavelength) ? draft.startWavelength : ''} onChange={e => patchDraft({ startWavelength: numericValue(e.target.value) })} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2" />
      </label>
      <label className="text-sm text-slate-300">{zh ? '终止波长 (nm)' : 'Stop wavelength (nm)'}
        <input data-testid="coating-study-stop-wavelength" type="number" min="100" max="2500" step="any" value={Number.isFinite(draft.stopWavelength) ? draft.stopWavelength : ''} onChange={e => patchDraft({ stopWavelength: numericValue(e.target.value) })} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2" />
      </label>
      <label className="text-sm text-slate-300">{zh ? '波长采样点 (3–401)' : 'Wavelength samples (3–401)'}
        <input data-testid="coating-study-samples" type="number" min="3" max="401" step="1" value={Number.isFinite(draft.samples) ? draft.samples : ''} onChange={e => patchDraft({ samples: numericValue(e.target.value) })} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2" />
      </label>
      <label className="text-sm text-slate-300">{zh ? '入射介质折射率 n₀ (0.1–10)' : 'Incident index n₀ (0.1–10)'}
        <input data-testid="coating-study-n0" type="number" min="0.1" max="10" step="any" value={Number.isFinite(draft.n0) ? draft.n0 : ''} onChange={e => patchDraft({ n0: numericValue(e.target.value) })} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2" />
      </label>
      <label className="text-sm text-slate-300">{zh ? '基底折射率 ns (0.1–10)' : 'Substrate index ns (0.1–10)'}
        <input data-testid="coating-study-ns" type="number" min="0.1" max="10" step="any" value={Number.isFinite(draft.ns) ? draft.ns : ''} onChange={e => patchDraft({ ns: numericValue(e.target.value) })} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2" />
      </label>
      <label className="text-sm text-slate-300">{zh ? '基底消光系数 ks (0–10)' : 'Substrate extinction ks (0–10)'}
        <input data-testid="coating-study-ks" type="number" min="0" max="10" step="any" value={Number.isFinite(draft.ks) ? draft.ks : ''} onChange={e => patchDraft({ ks: numericValue(e.target.value) })} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2" />
      </label>
      <label className="text-sm text-slate-300">{zh ? '入射角 θ (0–89.9°)' : 'Incidence angle θ (0–89.9°)'}
        <input data-testid="coating-study-angle" type="number" min="0" max="89.9" step="any" value={Number.isFinite(draft.theta) ? draft.theta : ''} onChange={e => patchDraft({ theta: numericValue(e.target.value) })} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2" />
      </label>
      <label className="text-sm text-slate-300">{zh ? '偏振' : 'Polarization'}
        <select data-testid="coating-study-polarization" value={draft.polarization} onChange={e => patchDraft({ polarization: e.target.value as CoatingStudyDraft['polarization'] })} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2">
          <option value="unpolarized">{zh ? '非偏振' : 'Unpolarized'}</option><option value="s">s</option><option value="p">p</option>
        </select>
      </label>
    </fieldset>
    <div className="mt-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-200">{zh ? `薄膜层 (${draft.layers.length}/16)` : `Film layers (${draft.layers.length}/16)`}</h3>
        <button data-testid="coating-study-add-layer" type="button" disabled={busy || draft.layers.length >= 16} onClick={() => edit({ ...draft, layers: [...draft.layers, { n: 1.5, k: 0, d: 100 }] })} className="btn border border-edge text-slate-300 disabled:opacity-50">{zh ? '添加层' : 'Add layer'}</button>
      </div>
      {draft.layers.map((layer, index) => <fieldset key={index} disabled={busy} className="grid items-end gap-3 rounded-lg border border-edge/70 p-3 sm:grid-cols-4">
        <legend className="px-1 text-xs text-slate-400">{zh ? `第 ${index + 1} 层` : `Layer ${index + 1}`}</legend>
        <label className="text-sm text-slate-300">{zh ? '折射率 n (0.1–10)' : 'Refractive index n (0.1–10)'}
          <input data-testid={`coating-study-layer-${index}-n`} type="number" min="0.1" max="10" step="any" value={Number.isFinite(layer.n) ? layer.n : ''} onChange={e => patchLayer(index, { n: numericValue(e.target.value) })} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2" />
        </label>
        <label className="text-sm text-slate-300">{zh ? '消光系数 k (0–10)' : 'Extinction coefficient k (0–10)'}
          <input data-testid={`coating-study-layer-${index}-k`} type="number" min="0" max="10" step="any" value={Number.isFinite(layer.k) ? layer.k : ''} onChange={e => patchLayer(index, { k: numericValue(e.target.value) })} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2" />
        </label>
        <label className="text-sm text-slate-300">{zh ? '厚度 d (nm, 0–10000)' : 'Thickness d (nm, 0–10000)'}
          <input data-testid={`coating-study-layer-${index}-d`} type="number" min="0" max="10000" step="any" value={Number.isFinite(layer.d) ? layer.d : ''} onChange={e => patchLayer(index, { d: numericValue(e.target.value) })} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2" />
        </label>
        <button data-testid={`coating-study-remove-layer-${index}`} type="button" disabled={busy} onClick={() => edit({ ...draft, layers: draft.layers.filter((_, layerIndex) => layerIndex !== index) })} className="btn border border-edge text-slate-300 disabled:opacity-50">{zh ? '移除层' : 'Remove layer'}</button>
      </fieldset>)}
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button data-testid="coating-study-run" type="button" onClick={() => void run()} disabled={busy} className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:opacity-50">{zh ? '提交光谱作业' : 'Run coating study'}</button>
      {busy && <button data-testid="coating-study-cancel" type="button" onClick={cancel} className="btn border border-edge text-slate-300">{zh ? '取消作业' : 'Cancel job'}</button>}
      <span data-testid="coating-study-status" className="text-xs text-slate-400" aria-live="polite">{status}{jobId ? ` · ${zh ? '任务' : 'Job'} ${jobId}` : ''}</span>
    </div>
    {error && <div data-testid="coating-study-error" role="alert" className="mt-3 rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-300">{error}{error.includes('需要登录') && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>{zh ? '登录' : 'Sign in'}</a>}</div>}
    {status === 'succeeded' && result && savedDraft && savedInput && jobId && <>
      <CoatingStudyResults
        draft={savedDraft}
        input={savedInput}
        result={result}
        jobId={jobId}
        onDownloadCsv={() => saveTextFile('coating-study.csv', buildCoatingStudyCsv(savedInput, result), 'text/csv;charset=utf-8')}
        onDownloadJson={() => saveTextFile('coating-study-report.json', buildCoatingStudyReport(savedDraft, savedInput, result, jobId), 'application/json;charset=utf-8')}
      />
    </>}
  </section>
}

import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import { createDefaultLensStudy, createLensStudyJob, type LensStudyDraft } from '../../lib/sim/lens-study-input'
import { readLensStudyResult, type LensStudyResult } from '../../lib/sim/lens-study-result'
import { LensBundleEditor } from './LensBundleEditor'
import { AgfReferenceGlassImport } from './AgfReferenceGlassImport'
import { LensStudyResults } from './LensStudyResults'
import { LensSurfaceEditor } from './LensSurfaceEditor'

type AppliedMaterialProvenance = {
  glassName: string
  surfaceIndex: number
  nAfter: number
  wavelengthUm: number
}

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

export function LensStudyPanel() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [draft, setDraft] = useState<LensStudyDraft>(() => createDefaultLensStudy())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedDraft, setSavedDraft] = useState<LensStudyDraft | null>(null)
  const [savedInput, setSavedInput] = useState<ReturnType<typeof createLensStudyJob>['input'] | null>(null)
  const [result, setResult] = useState<LensStudyResult | null>(null)
  const [appliedMaterial, setAppliedMaterial] = useState<AppliedMaterialProvenance | null>(null)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      controllerRef.current?.abort(new DOMException('Lens study panel unmounted', 'AbortError'))
      controllerRef.current = null
    }
  }, [])

  const current = (generation: number, controller?: AbortController) =>
    mountedRef.current && generation === generationRef.current && (!controller || controllerRef.current === controller)

  const edit = (next: LensStudyDraft) => {
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException('Lens study inputs changed', 'AbortError'))
    controllerRef.current = null
    setDraft(next)
    setBusy(false)
    setStatus('idle')
    setJobId(null)
    setError(null)
    setSavedDraft(null)
    setSavedInput(null)
    setResult(null)
    setAppliedMaterial(null)
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
      const { input: rawInput, spec } = createLensStudyJob(capturedDraft)
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
      const parsed = readLensStudyResult(remote as JobResultV1, input)
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
    controllerRef.current?.abort(new DOMException('Lens trace cancelled', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('cancelled')
    setJobId(null)
    setSavedDraft(null)
    setSavedInput(null)
    setResult(null)
  }

  const patchDraft = (patch: Partial<LensStudyDraft>) => edit({ ...draft, ...patch })

  return <section className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="lens-study-title">
    <header className="mb-4">
      <h2 id="lens-study-title" className="text-lg font-semibold text-slate-100">{zh ? '居中处方光线追迹' : 'Centered prescription ray trace'}</h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
        {zh
          ? '配置有界的居中球面/平面几何光学研究并显式提交已认证的 Host 作业。长度单位为 mm；光线按等权中心加环形采样，每个表面使用常数折射率。可将一次 AGF Sellmeier 计算所得 n(λ) 应用为该常数，不会保留波长依赖性；不含衍射或商业软件验证。'
          : 'Configure a bounded centered plane/spherical geometric optics study and explicitly submit an authenticated Host job. Lengths use mm; rays use equal-weight center-plus-ring sampling, and each surface uses a constant index. One AGF Sellmeier n(λ) result can be applied as that constant, without preserving wavelength dependence. No diffraction or commercial software validation is included.'}
      </p>
    </header>
    <div className="mb-4 grid gap-3 sm:grid-cols-2">
      <label className="text-sm text-slate-300">{zh ? '环境折射率' : 'Ambient refractive index'}
        <input data-testid="lens-ambient-index" type="number" step="any" value={Number.isFinite(draft.ambientIndex) ? draft.ambientIndex : ''} onChange={e => patchDraft({ ambientIndex: numericValue(e.target.value) })} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2" />
      </label>
      <label className="text-sm text-slate-300">{zh ? '像面距离 (mm)' : 'Image distance (mm)'}
        <input data-testid="lens-image-distance" type="number" step="any" value={Number.isFinite(draft.imageDistance) ? draft.imageDistance : ''} onChange={e => patchDraft({ imageDistance: numericValue(e.target.value) })} className="mt-1 block w-full rounded-lg border border-edge bg-surface px-3 py-2" />
      </label>
    </div>
    <LensSurfaceEditor surfaces={draft.surfaces} onChange={surfaces => patchDraft({ surfaces })} />
    <AgfReferenceGlassImport
      surfaces={draft.surfaces}
      onApply={(surfaceIndex, glass, nAfter, wavelengthUm) => {
        patchDraft({
          surfaces: draft.surfaces.map((surface, index) => index === surfaceIndex
            ? { ...surface, nAfter: nAfter ?? glass.nd }
            : surface),
        })
        setAppliedMaterial(nAfter === undefined || wavelengthUm === undefined
          ? null
          : { glassName: glass.name, surfaceIndex, nAfter, wavelengthUm })
      }}
    />
    {appliedMaterial && <p data-testid="lens-applied-material-provenance" className="mt-2 text-xs text-muted">
      Surface {appliedMaterial.surfaceIndex + 1} uses constant n = {appliedMaterial.nAfter} copied from {appliedMaterial.glassName} at {appliedMaterial.wavelengthUm} µm. The ray trace keeps this scalar index; this provenance is local to the current study editor. / 表面 {appliedMaterial.surfaceIndex + 1} 使用从 {appliedMaterial.glassName} 在 {appliedMaterial.wavelengthUm} µm 处复制的常数 n = {appliedMaterial.nAfter}。光线追迹仍使用该标量折射率；此来源信息仅保存在当前研究编辑器中。
    </p>}
    <LensBundleEditor value={draft.bundle} onChange={bundle => patchDraft({ bundle })} />
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <button data-testid="lens-study-run" type="button" onClick={() => void run()} disabled={busy} className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:opacity-50">Trace lens</button>
      {busy && <button data-testid="lens-study-cancel" type="button" onClick={cancel} className="btn border border-edge text-slate-300">Cancel trace</button>}
      <span data-testid="lens-study-status" className="text-xs text-slate-400" aria-live="polite">{status}{jobId ? ` · ${zh ? '任务' : 'Job'} ${jobId}` : ''}</span>
    </div>
    {error && <div data-testid="lens-study-error" role="alert" className="mt-3 rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-300">{error}{error.includes('需要登录') && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>{zh ? '登录' : 'Sign in'}</a>}</div>}
    {result && savedDraft && savedInput && <LensStudyResults draft={savedDraft} input={savedInput} result={result} jobId={jobId} />}
  </section>
}

import { useEffect, useRef, useState } from 'react'
import type { JobResultV1 } from '@w-sim/contracts'
import { createSettlementClient, runRemoteJob } from '../../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase, oidcStartHref } from '../../lib/hostApi'
import { useLocale } from '../../lib/i18n'
import {
  createCstWaveguideGrid,
  createCstWaveguideStudyJob,
  createDefaultCstWaveguideStudy,
  parseCstWaveguideStudyResult,
  type CstWaveguideStudyDraft,
  type CstWaveguideStudyInput,
  type CstWaveguideStudyResult,
} from '../../lib/sim/cst-waveguide-study'
import { CstWaveguideFieldPlot } from './CstWaveguideFieldPlot'
import { CstWaveguideFieldTable } from './CstWaveguideFieldTable'

function numberText(value: number): string {
  return Number(value.toPrecision(8)).toString()
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

function downloadCsv(input: CstWaveguideStudyInput, result: CstWaveguideStudyResult['result'], backend: Record<string, unknown>) {
  const metadata: Array<[string, unknown]> = [
    ['module', input.module],
    ['operation', input.operation],
    ['backendId', backend.id],
    ['backendKind', backend.kind],
    ['aM', input.a],
    ['bM', input.b],
    ['family', result.family],
    ['m', result.m],
    ['n', result.n],
    ['frequencyHz', result.frequencyHz],
    ['cutoffHz', result.cutoffHz],
    ['betaRadPerM', result.betaRadPerM],
    ['normalization', result.normalization],
  ]
  const lines = [
    ...metadata.map(([key, value]) => [key, value].map(csvCell).join(',')),
    '',
    ['xM', 'yM', 'exMagnitudeVPerM', 'eyMagnitudeVPerM', 'ezMagnitudeVPerM'].map(csvCell).join(','),
    ...result.fieldSamples.map(sample => [sample.x, sample.y, sample.exMagnitude, sample.eyMagnitude, sample.ezMagnitude].map(csvCell).join(',')),
  ]
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = 'cst-waveguide-electric-field-samples.csv'
  anchor.click()
  URL.revokeObjectURL(href)
}

/** Guided UI for the existing bounded W-Sim rectangular-guide field sampler. */
export function CstWaveguideStudy() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const initial = createDefaultCstWaveguideStudy()
  const [a, setA] = useState(numberText(initial.a))
  const [b, setB] = useState(numberText(initial.b))
  const [family, setFamily] = useState<CstWaveguideStudyDraft['family']>(initial.family)
  const [m, setM] = useState(String(initial.m))
  const [n, setN] = useState(String(initial.n))
  const [frequency, setFrequency] = useState(numberText(initial.frequency))
  const [samplesText, setSamplesText] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('idle')
  const [jobId, setJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submittedInput, setSubmittedInput] = useState<CstWaveguideStudyInput | null>(null)
  const [result, setResult] = useState<CstWaveguideStudyResult['result'] | null>(null)
  const [backend, setBackend] = useState<Record<string, unknown> | null>(null)
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      controllerRef.current?.abort(new DOMException('CST waveguide study unmounted', 'AbortError'))
      controllerRef.current = null
    }
  }, [])

  const current = (generation: number, controller?: AbortController) =>
    mountedRef.current && generation === generationRef.current && (!controller || controllerRef.current === controller)

  const clearResult = () => {
    generationRef.current += 1
    controllerRef.current?.abort(new DOMException('CST waveguide inputs changed', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('idle')
    setJobId(null)
    setError(null)
    setSubmittedInput(null)
    setResult(null)
    setBackend(null)
  }

  const draft = (): CstWaveguideStudyDraft => {
    const width = Number(a)
    const height = Number(b)
    const fieldSamples = samplesText.trim()
      ? samplesText.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
        const coordinates = line.trim().split(/[\s,]+/)
        if (coordinates.length !== 2) throw new Error(`Sample ${index + 1} must contain x and y coordinates in meters`)
        const x = Number(coordinates[0])
        const y = Number(coordinates[1])
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Sample ${index + 1} coordinates must be finite numbers`)
        return { x, y }
      })
      : createCstWaveguideGrid(width, height)
    return {
      a: width,
      b: height,
      family,
      m: Number(m),
      n: Number(n),
      frequency: Number(frequency),
      fieldSamples,
    }
  }

  const submit = async () => {
    if (busy) return
    const generation = generationRef.current + 1
    generationRef.current = generation
    setResult(null)
    setBackend(null)
    setSubmittedInput(null)
    setError(null)
    setJobId(null)
    setStatus('submitting')
    setBusy(true)
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const { input, spec } = createCstWaveguideStudyJob(draft())
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
      await client.requireUser(controller.signal)
      if (!current(generation, controller)) return
      const remote = await runRemoteJob(client, spec, {
        signal: controller.signal,
        onStatus: (id, next) => {
          if (current(generation, controller)) { setJobId(id); setStatus(next) }
        },
      })
      if (!current(generation, controller)) return
      const parsed = parseCstWaveguideStudyResult(remote as JobResultV1, input)
      if (!current(generation, controller)) return
      setResult(parsed.result)
      setSubmittedInput(parsed.input)
      setBackend(parsed.backend)
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
    controllerRef.current?.abort(new DOMException('CST waveguide study cancelled', 'AbortError'))
    controllerRef.current = null
    setBusy(false)
    setStatus('cancelled')
    setJobId(null)
    setSubmittedInput(null)
    setResult(null)
    setBackend(null)
  }

  const edit = <T,>(setter: (value: T) => void, value: T) => {
    clearResult()
    setter(value)
  }

  return <section data-testid="cst-waveguide-study" className="mt-6 rounded-xl border border-edge bg-panel/50 p-4" aria-labelledby="cst-waveguide-study-title">
    <div className="mb-4">
      <h2 id="cst-waveguide-study-title" className="text-lg font-semibold text-slate-100">{zh ? '矩形波导场样本研究' : 'Rectangular waveguide field study'}</h2>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">
        {zh
          ? '输入空气填充理想矩形波导的几何、TE/TM 模式与频率。已登录的 Host 作业使用现有 W-Sim 原生场采样操作，返回所选截面坐标上的 Ex、Ey、Ez 幅值。频率截止条件由原生模块检查。'
          : 'Set the geometry, TE/TM mode, and frequency for an air-filled ideal rectangular guide. An authenticated Host job calls the existing W-Sim native field-sampling operation and returns Ex, Ey, and Ez magnitudes at the selected cross-section coordinates. The native module checks the cutoff condition.'}
      </p>
      <p className="mt-2 text-xs text-slate-500">
        {zh
          ? '这是有界的解析场后处理，不是 CST 集成或全波求解。TE 按峰值 Hz=1 A/m 归一化，TM 按峰值 Ez=1 V/m 归一化。'
          : 'This is bounded analytic field post-processing, not CST integration or a full-wave solve. TE is normalized to peak Hz = 1 A/m; TM is normalized to peak Ez = 1 V/m.'}
      </p>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-sm text-slate-300">
        {zh ? '宽度 a (m)' : 'Width a (m)'}
        <input data-testid="cst-waveguide-a" type="number" min="0.000000001" max="1000" step="any" value={a} onChange={event => edit(setA, event.currentTarget.value)} className="mt-1 block w-full rounded-lg border border-edge bg-surface p-2" />
      </label>
      <label className="text-sm text-slate-300">
        {zh ? '高度 b (m)' : 'Height b (m)'}
        <input data-testid="cst-waveguide-b" type="number" min="0.000000001" max="1000" step="any" value={b} onChange={event => edit(setB, event.currentTarget.value)} className="mt-1 block w-full rounded-lg border border-edge bg-surface p-2" />
      </label>
      <label className="text-sm text-slate-300">
        {zh ? '模族' : 'Mode family'}
        <select data-testid="cst-waveguide-family" value={family} onChange={event => edit(setFamily, event.currentTarget.value as CstWaveguideStudyDraft['family'])} className="mt-1 block w-full rounded-lg border border-edge bg-surface p-2">
          <option value="TE">TE</option><option value="TM">TM</option>
        </select>
      </label>
      <label className="text-sm text-slate-300">
        m
        <input data-testid="cst-waveguide-m" type="number" min="0" max="15" step="1" value={m} onChange={event => edit(setM, event.currentTarget.value)} className="mt-1 block w-full rounded-lg border border-edge bg-surface p-2" />
      </label>
      <label className="text-sm text-slate-300">
        n
        <input data-testid="cst-waveguide-n" type="number" min="0" max="15" step="1" value={n} onChange={event => edit(setN, event.currentTarget.value)} className="mt-1 block w-full rounded-lg border border-edge bg-surface p-2" />
      </label>
      <label className="text-sm text-slate-300">
        {zh ? '频率 (Hz)' : 'Frequency (Hz)'}
        <input data-testid="cst-waveguide-frequency" type="number" min="1" max="1000000000000000" step="any" value={frequency} onChange={event => edit(setFrequency, event.currentTarget.value)} className="mt-1 block w-full rounded-lg border border-edge bg-surface p-2" />
      </label>
    </div>

    <label className="mt-3 block text-sm text-slate-300">
      {zh ? '截面采样坐标 (m)' : 'Cross-section sample coordinates (m)'}
      <textarea data-testid="cst-waveguide-samples" value={samplesText} onChange={event => edit(setSamplesText, event.currentTarget.value)} rows={3} placeholder={zh ? '每行输入 x, y；留空使用 11 × 7 网格' : 'Enter x, y per line; leave blank for the 11 × 7 grid'} className="mt-1 block w-full rounded-lg border border-edge bg-surface p-2 font-mono text-xs" />
      <span className="mt-1 block text-xs text-slate-500">{zh ? '最多 4096 点；坐标必须位于导波截面内。留空将使用覆盖整个截面的 77 点网格。' : 'Up to 4096 points; coordinates must lie inside the guide cross-section. Leave blank to sample a 77-point grid across the section.'}</span>
    </label>

    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button data-testid="cst-waveguide-run" type="button" onClick={() => void submit()} disabled={busy} className="btn bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? (zh ? '原生作业运行中…' : 'Native job running…') : (zh ? '采样原生场' : 'Sample native fields')}
      </button>
      {busy && <button data-testid="cst-waveguide-cancel" type="button" onClick={cancel} className="btn border border-edge text-slate-300">{zh ? '取消' : 'Cancel'}</button>}
      <span data-testid="cst-waveguide-status" className="text-xs text-slate-500" aria-live="polite">
        {zh ? '状态' : 'Status'}: {status}{jobId && ` · ${zh ? '任务' : 'Job'} ${jobId}`}
      </span>
    </div>

    {error && <div data-testid="cst-waveguide-error" role="alert" className="mt-3 rounded-lg border border-red-400/40 bg-red-950/20 p-3 text-sm text-red-300">
      {error}{error.includes('需要登录') && <a className="ml-2 underline" href={oidcStartHref(window.location.pathname + window.location.search)}>{zh ? '登录' : 'Sign in'}</a>}
    </div>}

    {result && submittedInput && backend && <div data-testid="cst-waveguide-results" className="mt-4 rounded-lg border border-edge bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-100">{result.family}{result.m}{result.n} · {zh ? '原生场结果' : 'Native field result'}</h3>
          <p className="mt-1 text-xs text-slate-400">
            a={numberText(submittedInput.a)} m · b={numberText(submittedInput.b)} m · {submittedInput.fieldSamples.length} samples · f={numberText(result.frequencyHz)} Hz · fc={numberText(result.cutoffHz)} Hz · β={numberText(result.betaRadPerM)} rad/m · {String(backend.id)} ({String(backend.kind)})
          </p>
          <p className="mt-1 text-xs text-slate-500">{zh ? '归一化' : 'Normalization'}: {result.normalization}</p>
        </div>
        <button data-testid="cst-waveguide-download-csv" type="button" onClick={() => downloadCsv(submittedInput, result, backend)} className="btn border border-edge text-slate-300">
          {zh ? '下载 CSV' : 'Download CSV'}
        </button>
      </div>
      <div data-testid="cst-waveguide-plot"><CstWaveguideFieldPlot samples={result.fieldSamples} family={result.family} /></div>
      <div data-testid="cst-waveguide-table"><CstWaveguideFieldTable rows={result.fieldSamples} family={result.family} normalization={result.normalization} /></div>
    </div>}
  </section>
}

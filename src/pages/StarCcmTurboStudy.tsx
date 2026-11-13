import { useContext, useEffect, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ModuleComputeContext, useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useLocale } from '../lib/i18n'
import type { ModuleComputeInput, ModuleComputeOutput } from '../lib/sim/module-compute'
import { StarCcmTurboStudyResults } from './StarCcmTurboStudyResults'

const TURBO_MODULE = 'sw-su2-turbo-metrics'
const MAX_POINTS = 12
const MAX_INPUT_BYTES = 64 * 1024
const ALLOWED_FIELDS = new Set([
  'module', 'backend', 'kind', 'gamma', 'R', 'p_t1', 'T_t1', 'p_t2', 'T_t2', 'p_1', 'p_2',
  'p_ref', 'T_ref', 'mdot', 'A', 'mach', 'omega', 'rpm', 'Q', 'r_mean', 'U', 'V_m',
])

export type StarCcmTurboInput = ModuleComputeInput & {
  module: typeof TURBO_MODULE
  backend: 'host'
  kind: 'compressor' | 'turbine'
  p_t1: number
  T_t1: number
  p_t2: number
  T_t2: number
  [key: string]: unknown
}

export interface StarCcmTurboStudyPoint {
  id: string
  input: StarCcmTurboInput
  output?: ModuleComputeOutput
  jobId?: string
  status: 'draft' | 'complete'
}

export interface StarCcmTurboRow {
  id: string
  jobId: string
  kind: string
  pressureRatio: number | null
  correctedMassFlow: number | null
  correctedShaftSpeed: number | null
  isentropicEfficiency: number | null
  polytropicEfficiency: number | null
}

const DEFAULT_INPUT: StarCcmTurboInput = {
  module: TURBO_MODULE,
  backend: 'host',
  kind: 'compressor',
  p_t1: 50000,
  T_t1: 400,
  p_t2: 100000,
  T_t2: 500,
  rpm: 10000,
  T_ref: 288.15,
  mdot: 2,
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Parse a native turbomachinery point and reject unsupported fields before submission. */
export function parseStarCcmTurboPoint(raw: string): StarCcmTurboInput | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_INPUT_BYTES) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const input = value as Record<string, unknown>
    if (input.module !== TURBO_MODULE || input.backend !== 'host') return null
    if (input.kind !== 'compressor' && input.kind !== 'turbine') return null
    if (Object.keys(input).some(key => !ALLOWED_FIELDS.has(key))) return null
    for (const key of ['p_t1', 'T_t1', 'p_t2', 'T_t2']) {
      const field = input[key]
      if (!finiteNumber(field) || field <= 0) return null
    }
    for (const [key, value] of Object.entries(input)) {
      if (key === 'module' || key === 'backend' || key === 'kind') continue
      if (!finiteNumber(value)) return null
    }
    if (input.rpm !== undefined && input.omega !== undefined) return null
    if (input.U !== undefined && input.r_mean !== undefined) return null
    if (input.mach !== undefined && input.A === undefined) return null
    if (input.Q !== undefined && input.rpm === undefined && input.omega === undefined) return null
    if (input.r_mean !== undefined && input.rpm === undefined && input.omega === undefined) return null
    if (input.V_m !== undefined && input.U === undefined && !(input.r_mean !== undefined && (input.rpm !== undefined || input.omega !== undefined))) return null
    for (const key of ['R', 'p_1', 'p_2', 'p_ref', 'T_ref', 'mdot', 'A', 'rpm', 'omega', 'Q', 'r_mean', 'U']) {
      const field = input[key]
      if (field !== undefined && (!finiteNumber(field) || field <= 0)) return null
    }
    const gamma = input.gamma
    const mach = input.mach
    const meridionalVelocity = input.V_m
    if (gamma !== undefined && (!finiteNumber(gamma) || gamma <= 1)) return null
    if (mach !== undefined && (!finiteNumber(mach) || mach < 0)) return null
    if (meridionalVelocity !== undefined && (!finiteNumber(meridionalVelocity) || meridionalVelocity < 0)) return null
    return input as StarCcmTurboInput
  } catch {
    return null
  }
}

function numberAt(record: Record<string, unknown>, key: string): number | null {
  return finiteNumber(record[key]) ? record[key] as number : null
}

/** Read performance quantities only from a completed native module result. */
export function starCcmTurboStudyRows(points: readonly StarCcmTurboStudyPoint[]): StarCcmTurboRow[] {
  return points.flatMap(point => {
    if (point.status !== 'complete' || !point.output || !point.jobId) return []
    const output = point.output as unknown as Record<string, unknown>
    const result = output.result
    if (!result || typeof result !== 'object' || Array.isArray(result)) return []
    const values = result as Record<string, unknown>
    if (output.module !== TURBO_MODULE) return []
    return [{
      id: point.id,
      jobId: point.jobId,
      kind: typeof values.kind === 'string' ? values.kind : point.input.kind,
      pressureRatio: numberAt(values, 'pressureRatioTT') ?? numberAt(values, 'pressureRatio'),
      correctedMassFlow: numberAt(values, 'correctedMassFlow'),
      correctedShaftSpeed: numberAt(values, 'correctedShaftSpeed'),
      isentropicEfficiency: numberAt(values, 'isentropicEfficiency'),
      polytropicEfficiency: numberAt(values, 'polytropicEfficiency'),
    }]
  })
}

export function createStarCcmTurboStudyReport(points: readonly StarCcmTurboStudyPoint[]) {
  return {
    schema: 'waveworld.starccm-turbomachinery-study.v1',
    scope: 'Independent W-Sim native Host-f64 performance metrics; no STAR-CCM+ interoperability or vendor numerical equivalence.',
    module: TURBO_MODULE,
    points: points.filter(point => point.status === 'complete' && point.output && point.jobId).map(point => ({
      pointId: point.id,
      jobId: point.jobId,
      submittedInput: point.input,
      result: point.output,
    })),
  }
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function createStarCcmTurboStudyCsv(rows: readonly StarCcmTurboRow[]): string {
  const columns: (keyof StarCcmTurboRow)[] = ['id', 'jobId', 'kind', 'pressureRatio', 'correctedMassFlow', 'correctedShaftSpeed', 'isentropicEfficiency', 'polytropicEfficiency']
  return [columns.join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\r\n') + '\r\n'
}

function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function StarCcmTurboStudy() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const execution = useContext(ModuleComputeContext)
  const [points, setPoints] = useState<StarCcmTurboStudyPoint[]>([{ id: 'point-1', input: DEFAULT_INPUT, status: 'draft' }])
  const [activeId, setActiveId] = useState('point-1')
  const [raw, setRaw] = useState(JSON.stringify(DEFAULT_INPUT, null, 2))
  const [notice, setNotice] = useState('')
  const idCounter = useRef(1)
  const pending = useRef<{ id: string; input: string } | null>(null)
  const active = points.find(point => point.id === activeId) ?? points[0]!
  const parsed = parseStarCcmTurboPoint(raw)
  const captureInput = () => parsed ?? active.input
  const compute = useModuleCompute(parsed ?? active.input, captureInput)

  useEffect(() => {
    if (execution?.target === 'browser') void execution.setTarget('backend')
  }, [execution?.target])

  useEffect(() => {
    const submission = pending.current
    if (execution?.status === 'succeeded' && compute.result && compute.submittedInput && execution.jobId && submission) {
      if (submission.id !== activeId || JSON.stringify(compute.submittedInput) !== submission.input) return
      setPoints(current => current.map(point => point.id === submission.id
        ? { ...point, input: compute.submittedInput as StarCcmTurboInput, output: compute.result!, jobId: execution.jobId!, status: 'complete' }
        : point))
      pending.current = null
      setNotice(zh ? `已保存原生任务 ${execution.jobId} 的结果。` : `Saved native job ${execution.jobId}.`)
    }
    if (execution?.status === 'cancelled' || execution?.status === 'failed') pending.current = null
  }, [activeId, compute.result, compute.submittedInput, execution?.jobId, execution?.status, zh])

  const saveEditor = () => {
    if (!parsed || active.status === 'complete') return false
    setPoints(current => current.map(point => point.id === activeId ? { ...point, input: parsed } : point))
    return true
  }

  const submit = () => {
    if (!parsed || active.status === 'complete' || !execution || execution.target !== 'backend' || execution.busy || execution.cancelPending) return
    const frozen = JSON.stringify(parsed)
    setPoints(current => current.map(point => point.id === activeId ? { ...point, input: parsed } : point))
    pending.current = { id: activeId, input: frozen }
    setNotice('')
    void execution.start(true)
  }

  const addPoint = () => {
    if (!saveEditor() || points.length >= MAX_POINTS || execution?.busy) return
    idCounter.current += 1
    const next: StarCcmTurboStudyPoint = { id: `point-${idCounter.current}`, input: parsed!, status: 'draft' }
    setPoints(current => [...current, next])
    setActiveId(next.id)
    setRaw(JSON.stringify(next.input, null, 2))
    setNotice('')
  }

  const selectPoint = (id: string) => {
    if (execution?.busy) return
    saveEditor()
    const next = points.find(point => point.id === id)
    if (!next) return
    setActiveId(id)
    setRaw(JSON.stringify(next.input, null, 2))
    setNotice('')
  }

  const rows = starCcmTurboStudyRows(points)
  const report = createStarCcmTurboStudyReport(points)
  const exportJson = () => downloadFile('waveworld-starccm-turbomachinery-study.json', JSON.stringify(report, null, 2), 'application/json')
  const exportCsv = () => downloadFile('waveworld-starccm-turbomachinery-study.csv', createStarCcmTurboStudyCsv(rows), 'text/csv;charset=utf-8')

  return <section className="space-y-4 rounded-xl border border-cyan-400/20 bg-cyan-950/10 p-4" aria-label={zh ? '涡轮机械性能研究' : 'Turbomachinery performance study'}>
    <PageHeader title="涡轮机械性能研究" titleEn="Turbomachinery performance study" subtitle="用已完成的 W-Sim 原生性能指标构建多工况对比。" subtitleEn="Build a multi-point comparison from completed W-Sim native performance metrics." icon="📈" showMethods={false} />
    <p className="text-sm leading-relaxed text-slate-300">{zh
      ? '每个工况单独提交到 Host 上的 sw-su2-turbo-metrics 原生模块。最多 12 个工况，每次只运行一个任务。结果、输入快照与 Host job ID 一同保存；本页面不运行求解器，也不插值性能图谱。'
      : 'Each operating point is submitted as its own Host job to the sw-su2-turbo-metrics native module. The study holds at most 12 points and runs one job at a time. Results stay with the submitted input snapshot and Host job ID; this page does not solve flow or interpolate a performance map.'}</p>
    <p className="text-xs leading-relaxed text-amber-200/90">{zh
      ? '这是独立的 W-Sim Host-f64 后处理，采用理想气体指标；不调用 STAR-CCM+，不读写 .sim，不代表 Siemens 算法或数值等价。'
      : 'This is independent W-Sim Host-f64 post-processing with ideal-gas metrics. It does not invoke STAR-CCM+, read or write .sim files, or claim Siemens algorithm or numerical equivalence.'}</p>
    <div className="grid gap-4 lg:grid-cols-[minmax(13rem,0.7fr)_minmax(0,1.4fr)]">
      <section className="space-y-3" aria-label={zh ? '研究工况' : 'Study points'}>
        <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">{zh ? '工况列表' : 'Operating points'}</h2><span className="text-xs text-slate-400">{points.length}/{MAX_POINTS}</span></div>
        <ol className="space-y-2">{points.map((point, index) => <li key={point.id}>
          <button type="button" className={`w-full rounded-lg border p-3 text-left text-sm ${point.id === activeId ? 'border-cyan-300 bg-cyan-950/40' : 'border-edge bg-slate-950/40'}`} onClick={() => selectPoint(point.id)} disabled={execution?.busy}>
            <span className="block font-medium">{zh ? `工况 ${index + 1}` : `Point ${index + 1}`}</span>
            <span className="block text-xs text-slate-400">{point.status === 'complete' ? `${zh ? '已完成' : 'Complete'} · ${point.jobId}` : zh ? '待提交' : 'Draft'}</span>
          </button>
        </li>)}</ol>
        <button type="button" className="btn border border-edge" onClick={addPoint} disabled={!parsed || points.length >= MAX_POINTS || execution?.busy}>{zh ? '复制当前工况' : 'Copy current point'}</button>
      </section>
      <section className="space-y-3" aria-label={zh ? '原生输入' : 'Native input'}>
        <div><h2 className="font-semibold">{zh ? '编辑原生输入' : 'Edit native input'}</h2><p className="text-xs text-slate-400">{zh ? '模块和 Host backend 固定；提交时由原生模块再次校验。' : 'The module and Host backend are fixed. The native module validates the submitted input again.'}</p></div>
        <textarea aria-label="STAR-CCM+ turbomachinery native input" value={raw} onChange={event => setRaw(event.target.value)} disabled={execution?.busy || active.status === 'complete'} spellCheck={false} rows={15} className="min-h-80 w-full rounded-lg border border-edge bg-slate-950 p-3 font-mono text-xs text-slate-100 disabled:opacity-60" />
        {!parsed && <p role="alert" className="text-sm text-amber-200">{zh ? '输入无效、超出 64 KiB，或包含当前操作不支持的参数。' : 'Input is invalid, exceeds 64 KiB, or contains fields unsupported by this operation.'}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn bg-cyan-300 text-slate-950 disabled:opacity-50" disabled={!parsed || active.status === 'complete' || !execution?.connected || execution.target !== 'backend' || execution.busy || execution.cancelPending} onClick={submit}>{execution?.busy ? (zh ? '任务运行中…' : 'Job running…') : (zh ? '提交此工况' : 'Submit this point')}</button>
          {execution?.busy && <button type="button" className="btn border border-edge" onClick={() => void execution.stop()}>{zh ? '取消任务' : 'Cancel job'}</button>}
          {execution?.status && <span role="status" className="text-xs text-slate-400">{execution.status}</span>}
        </div>
        {notice && <p role="status" className="text-sm text-emerald-200">{notice}</p>}
        {execution?.error && <p role="alert" className="text-sm text-rose-300">{execution.error}</p>}
      </section>
    </div>
    <StarCcmTurboStudyResults rows={rows} onExportCsv={exportCsv} onExportJson={exportJson} />
  </section>
}

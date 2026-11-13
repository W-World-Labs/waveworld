import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { PlayPauseButton } from '../components/PlayPauseButton'
import { ParamSlider } from '../components/ParamSlider'
import { rlcResult, type RlcScene } from '../lib/sim/rlc'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useRafLoop, useRunning, useSyncedParam } from '../lib/hooks'
import { useLocale } from '../lib/i18n'
import { SpiceImportPanel } from '../components/circuit/SpiceImportPanel'
import { PspiceAcEditor } from '../components/circuit/PspiceAcEditor'
import { PspiceAcResults } from '../components/circuit/PspiceAcResults'
import { PspiceAcSweepExport } from '../components/circuit/PspiceAcSweepExport'
import { createSettlementClient, RemoteJobCancelError, runRemoteJob } from '../../apps/lab/src/lib/w-sim/settlement-client'
import { getStoredUserToken, hostApiBase } from '../lib/hostApi'
import { createPspiceAcJob, readPspiceAcResult, type PspiceAcResult, type PspiceAcStudyInput } from '../lib/sim/pspice-ac-adapter'
import { buildPspiceAcSweepPlan, type PspiceAcSweepResultRow, type PspiceAcSweepStudyInput } from '../lib/sim/pspice-ac-sweep'
import type { JobResultV1, JobSpecV1 } from '@w-sim/contracts'

const W = 720, H = 300        // 走纸示波器尺寸
const PW = 300, PH = 300      // 相平面尺寸
const BUF = 720               // 走纸 ring buffer 长度（每像素一个样本）
function freezePspiceCapture<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) freezePspiceCapture(child)
  }
  return value
}
function regimeOf(z: number, zh: boolean): { label: string; color: string } {
  if (z < 0.999) {
    return {
      label: zh ? '欠阻尼（振荡衰减）' : 'Underdamped (ringing decay)',
      color: '#3ad6ff',
    }
  }
  if (z <= 1.001) {
    return {
      label: zh ? '临界阻尼（最快无过冲）' : 'Critical (fastest, no overshoot)',
      color: '#ff8a4c',
    }
  }
  return {
    label: zh ? '过阻尼（缓慢回落）' : 'Overdamped (slow settle)',
    color: '#94a3b8',
  }
}

/**
 * 组装：rlcStep（纯过程）+ 运行开关 + rAF 环 + 阻尼参数端口。
 * 物理只在 lib/sim/rlc；本页只嵌套「何时 step / 如何画」。双画布：走纸 + 相平面。
 */
export function Rlc() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const scopeRef = useRef<HTMLCanvasElement>(null)
  const phaseRef = useRef<HTMLCanvasElement>(null)
  const pageTerms = useMemo(() => termIdsForSimPath('rlc'), [])

  const { running, runningRef, toggle, setRunning } = useRunning(true)
  const zeta = useSyncedParam(0.15)
  const [drive, setDrive] = useState<RlcScene['drive']>('energy')
  const [steps, setSteps] = useState(1200)
  const [scanIndex, setScanIndex] = useState(0)
  const [pspiceAcBusy, setPspiceAcBusy] = useState(false)
  const pspiceAcBusyRef = useRef(false)
  const [pspiceAcError, setPspiceAcError] = useState('')
  const [pspiceAcResult, setPspiceAcResult] = useState<PspiceAcResult | null>(null)
  const [pspiceAcSweepRows, setPspiceAcSweepRows] = useState<Array<PspiceAcSweepResultRow & { jobId: string }>>([])
  const pspiceAcSweepRowsRef = useRef<Array<PspiceAcSweepResultRow & { jobId: string }>>([])
  const [pspiceAcSweepStatus, setPspiceAcSweepStatus] = useState('')
  const [pspiceAcCurrentJobId, setPspiceAcCurrentJobId] = useState<string | null>(null)
  const [pspiceAcExport, setPspiceAcExport] = useState<{ spec: JobSpecV1; nodeMap: Record<string, number>; result: PspiceAcResult } | null>(null)
  const pspiceAcAbortRef = useRef<AbortController | null>(null)
  const pspiceAcGenerationRef = useRef(0)
  useEffect(() => () => { pspiceAcAbortRef.current?.abort() }, [])
  const scanRef = useRef(0)
  const scene = useMemo(() => ({ zeta: zeta.value, drive, steps }), [zeta.value, drive, steps])
  const compute = useModuleCompute({ module: 'rlc', scene })
  const preview = useMemo(() => {
    if (compute.snapshot) return { data: compute.result?.module === 'rlc' ? compute.result.result : null, error: '' }
    try { return { data: rlcResult(scene), error: '' } } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [scene, compute.snapshot, compute.result])
  const data = preview.data
  useEffect(() => { if (compute.snapshot) setRunning(false) }, [compute.snapshot, data])
  useEffect(() => {
    if (running && scanRef.current >= steps) { scanRef.current = 0; setScanIndex(0) }
  }, [running, steps])
  const renderRef = useRef({ data })
  renderRef.current = { data }
  const read = data ? { ...data.states[Math.min(scanIndex, steps)], w0: data.w0, z: data.z, Q: data.Q } : null

  const invalidatePspiceAc = () => {
    pspiceAcGenerationRef.current += 1
    pspiceAcAbortRef.current?.abort(new DOMException('PSpice AC input changed', 'AbortError'))
    setPspiceAcError('')
    setPspiceAcResult(null)
    setPspiceAcSweepRows([])
    pspiceAcSweepRowsRef.current = []
    setPspiceAcSweepStatus('')
    setPspiceAcExport(null)
  }

  const cancelPspiceAc = () => {
    const completed = pspiceAcSweepRowsRef.current.length
    const active = pspiceAcAbortRef.current
    if (!active) return
    active.abort(new DOMException('PSpice AC study canceled', 'AbortError'))
    if (completed > 0) {
      setPspiceAcSweepStatus(zhRef.current
        ? `已取消；保留 ${completed} 个已完成频点。`
        : `Canceled; retained ${completed} completed frequency point${completed === 1 ? '' : 's'}.`)
      setPspiceAcError('')
    } else {
      setPspiceAcSweepStatus(zhRef.current ? '已取消。' : 'Canceled.')
    }
  }

  const runPspiceAc = async (study: PspiceAcStudyInput | PspiceAcSweepStudyInput) => {
    if (pspiceAcBusyRef.current) return
    const generation = ++pspiceAcGenerationRef.current
    setPspiceAcError('')
    setPspiceAcResult(null)
    setPspiceAcSweepRows([])
    pspiceAcSweepRowsRef.current = []
    setPspiceAcSweepStatus('')
    setPspiceAcExport(null)
    pspiceAcBusyRef.current = true
    setPspiceAcBusy(true)
    const abort = new AbortController()
    pspiceAcAbortRef.current = abort
    let completed: Array<PspiceAcSweepResultRow & { jobId: string }> = []
    try {
      const client = createSettlementClient({
        baseUrl: hostApiBase(),
        fetchImpl: (url, init) => {
          const headers = new Headers(init?.headers)
          const token = getStoredUserToken()
          if (token) headers.set('Authorization', `Bearer ${token}`)
          return fetch(url, { ...init, headers })
        },
      })
      await client.requireUser(abort.signal)
      if ('sweep' in study) {
        const plan = buildPspiceAcSweepPlan(study)
        setPspiceAcSweepStatus(zhRef.current ? `正在计算 0/${plan.length} 个频点…` : `Running 0/${plan.length} frequency points…`)
        for (const point of plan) {
          abort.signal.throwIfAborted()
          let jobId = ''
          const result = await runRemoteJob(client, point.spec, {
            signal: abort.signal,
            onStatus: (id) => { jobId = id; if (generation === pspiceAcGenerationRef.current) setPspiceAcCurrentJobId(id) },
          })
          if (generation !== pspiceAcGenerationRef.current) return
          if (!jobId) throw new Error('Remote AC job completed without returning its job ID')
          const parsed = readPspiceAcResult(result as JobResultV1, point.input, point.nodeMap)
          const capture = freezePspiceCapture({
            frequencyHz: point.frequencyHz,
            input: point.input,
            spec: point.spec,
            nodeMap: point.nodeMap,
            result: parsed,
            jobId,
          })
          completed = [...completed, capture]
          pspiceAcSweepRowsRef.current = completed
          setPspiceAcSweepRows(completed)
          setPspiceAcSweepStatus(zhRef.current
            ? `已完成 ${completed.length}/${plan.length} 个频点${jobId ? `；任务 ${jobId}` : ''}`
            : `Completed ${completed.length}/${plan.length} frequency points${jobId ? `; latest job ${jobId}` : ''}`)
          setPspiceAcCurrentJobId(null)
        }
      } else {
        const { input, spec, nodeMap } = createPspiceAcJob(study)
        let jobId = ''
        const result = await runRemoteJob(client, spec, {
          signal: abort.signal,
          onStatus: (id) => { jobId = id; if (generation === pspiceAcGenerationRef.current) setPspiceAcCurrentJobId(id) },
        })
        if (generation !== pspiceAcGenerationRef.current) return
        if (!jobId) throw new Error('Remote AC job completed without returning its job ID')
        const parsed = readPspiceAcResult(result as JobResultV1, input, nodeMap)
        setPspiceAcResult(parsed)
        setPspiceAcExport({ spec, nodeMap, result: parsed })
        setPspiceAcSweepStatus(jobId ? (zhRef.current ? `任务 ${jobId} 已完成` : `Job ${jobId} completed`) : '')
      }
    } catch (cause) {
      if (generation !== pspiceAcGenerationRef.current) return
      if (abort.signal.aborted) {
        if (cause instanceof RemoteJobCancelError) {
          setPspiceAcError(zhRef.current
            ? `无法确认任务 ${cause.jobId} 已取消：${cause.message}`
            : `Could not confirm remote job ${cause.jobId} was canceled: ${cause.message}`)
        }
        setPspiceAcSweepStatus(current => current || (zhRef.current ? '已取消。' : 'Canceled.'))
      } else {
        const message = cause instanceof Error ? cause.message : String(cause)
        setPspiceAcError(completed.length > 0
          ? `${message} ${zhRef.current ? `已保留 ${completed.length} 个已完成频点。` : `Retained ${completed.length} completed frequency points.`}`
          : message)
        if (completed.length > 0) setPspiceAcSweepStatus(zhRef.current
          ? `部分完成：${completed.length} 个频点保留，后续频点未运行。`
          : `Partial sweep: ${completed.length} points retained; remaining points were not run.`)
      }
    } finally {
      if (pspiceAcAbortRef.current === abort) pspiceAcAbortRef.current = null
      setPspiceAcCurrentJobId(null)
      pspiceAcBusyRef.current = false
      setPspiceAcBusy(false)
    }
  }

  const downloadPspiceAcJob = () => {
    if (!pspiceAcExport) return
    const payload = {
      workflow: 'pspice-ac-job',
      nativePin: 'dda2f6f1e1def3d9a49bea48c8766d222b2d8a14',
      frequencyHz: pspiceAcExport.result.frequencyHz,
      nodeMap: pspiceAcExport.nodeMap,
      backend: pspiceAcExport.result.backend,
      spec: pspiceAcExport.spec,
    }
    const href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = 'waveworld-pspice-ac-job.json'
    anchor.click()
    URL.revokeObjectURL(href)
  }

  useRafLoop(() => {
    const { data } = renderRef.current
    if (!data) {
      for (const c of [scopeRef.current, phaseRef.current]) {
        const ctx = c?.getContext('2d'); if (c && ctx) { ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, c.width, c.height) }
      }
      return
    }
    if (runningRef.current) scanRef.current += 4
    const si = Math.min(scanRef.current, data.states.length - 1)
    scanRef.current = si; setScanIndex(si)
    if (si === data.states.length - 1 && runningRef.current) setRunning(false)
    const tr = data.states.slice(0, si + 1)
    const recent = tr.slice(-BUF)
    const padding = BUF - recent.length
    const ib = Array(padding).fill(data.states[0].i).concat(recent.map(s => s.i))
    const vb = Array(padding).fill(data.states[0].q).concat(recent.map(s => s.q))

    // —— 走纸示波器 ——
    const scope = scopeRef.current
    if (scope) {
      const ctx = scope.getContext('2d')!
      ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)

      ctx.strokeStyle = 'rgba(120,140,180,0.10)'; ctx.lineWidth = 1
      for (let gx = 0; gx <= W; gx += 60) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke() }
      for (let gy = 0; gy <= H; gy += 50) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke() }

      let amp = 0.2
      for (let n = 0; n < BUF; n++) { amp = Math.max(amp, Math.abs(ib[n]), Math.abs(vb[n])) }
      const mid = H / 2
      const yOf = (val: number) => mid - (val / (amp * 1.15)) * (H / 2 - 8)

      ctx.strokeStyle = 'rgba(58,214,255,0.30)'; ctx.setLineDash([5, 5])
      ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke(); ctx.setLineDash([])

      ctx.strokeStyle = '#7c5cff'; ctx.lineWidth = 2; ctx.beginPath()
      for (let x = 0; x < BUF; x++) { const y = yOf(vb[x]); x ? ctx.lineTo(x, y) : ctx.moveTo(x, y) }
      ctx.stroke()
      ctx.strokeStyle = '#3ad6ff'; ctx.lineWidth = 2; ctx.beginPath()
      for (let x = 0; x < BUF; x++) { const y = yOf(ib[x]); x ? ctx.lineTo(x, y) : ctx.moveTo(x, y) }
      ctx.stroke()

      ctx.fillStyle = '#7c5cff'; ctx.beginPath(); ctx.arc(W - 1, yOf(vb[BUF - 1]), 3.5, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#3ad6ff'; ctx.beginPath(); ctx.arc(W - 1, yOf(ib[BUF - 1]), 3.5, 0, Math.PI * 2); ctx.fill()

      const en = !zhRef.current
      ctx.font = '11px sans-serif'
      ctx.fillStyle = '#7c5cff'
      ctx.fillText(en ? '● Cap voltage' : '● 电容电压', 10, 18)
      ctx.fillStyle = '#3ad6ff'
      ctx.fillText(en ? '● Loop current' : '● 回路电流', 130, 18)
    }

    // —— 相平面 ——
    const phase = phaseRef.current
    if (phase) {
      const ctx = phase.getContext('2d')!
      ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, PW, PH)
      const cx = PW / 2, cy = PH / 2

      ctx.strokeStyle = 'rgba(120,140,180,0.20)'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(PW, cy); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, PH); ctx.stroke()

      if (tr.length > 1) {
        let amp = 0.3
        for (const s of tr) amp = Math.max(amp, Math.abs(s.q), Math.abs(s.i))
        const scale = (PW / 2 - 14) / (amp * 1.1)
        ctx.lineWidth = 1.5
        for (let n = 1; n < tr.length; n++) {
          const a = tr[n - 1], b = tr[n]
          const alpha = n / tr.length
          ctx.strokeStyle = `rgba(124,92,255,${0.12 + alpha * 0.7})`
          ctx.beginPath()
          ctx.moveTo(cx + a.q * scale, cy - a.i * scale)
          ctx.lineTo(cx + b.q * scale, cy - b.i * scale)
          ctx.stroke()
        }
        const last = tr[tr.length - 1]
        ctx.fillStyle = '#3ad6ff'
        ctx.beginPath(); ctx.arc(cx + last.q * scale, cy - last.i * scale, 4, 0, Math.PI * 2); ctx.fill()
      }
      const en = !zhRef.current
      ctx.fillStyle = '#64748b'; ctx.font = '11px sans-serif'
      ctx.fillText(en ? 'Phase plane (q, i)' : '相平面（电荷, 电流）', 8, 16)
      ctx.fillText(en ? 'q →' : '电荷 →', PW - 44, cy - 6)
      ctx.fillText(en ? '↑ i' : '↑ 电流', cx + 6, 14)
    }

  }, [])

  const reset = () => { scanRef.current = 0; setScanIndex(0) }
  const injectEnergy = () => { setDrive('energy'); reset() }
  const injectStep = () => { setDrive('step'); reset() }
  const reg = regimeOf(scene.zeta, zh)

  return (
    <div>
      <PageHeader
        icon="🌀"
        title="谐振电路 · 阻尼"
        subtitle="串联谐振电路是二阶振荡系统：电感储磁能、电容储电能，二者来回倒腾形成振荡，电阻则把能量耗成热。阻尼比决定相态——小于 1 欠阻尼会振荡衰减，等于 1 临界阻尼最快无过冲回稳，大于 1 过阻尼则缓慢单调回落。每次从所选初态计算有限步数，拖动读图位置查看波形与相平面；更改阻尼比重新计算。"
      />
      {preview.error && <p role="alert" className="note mb-4">{zh ? '本地 WASM 计算不可用。' : 'Local WASM computation unavailable.'} {preview.error}</p>}
      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">
          {zh ? '读电路能量时' : 'When reading circuit energy'}
        </span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <span className="text-slate-600">
          {zh ? '（悬停看一句人话；能量账）' : '(hover for plain language; energy ledger)'}
        </span>
      </p>

      <div className="toolbar mb-5">
        <span className="rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs text-violet-300">
          {zh ? '二阶电路 · 走纸+相平面' : '2nd-order · scope + phase'}
        </span>
        <PlayPauseButton running={running} onToggle={toggle} />
        <button type="button" onClick={injectEnergy} className="btn border border-edge text-slate-300">
          {zh ? '⚡ 初始储能' : '⚡ Initial energy'}
        </button>
        <button type="button" onClick={injectStep} className="btn border border-edge text-slate-300">
          {zh ? '⎍ 直流阶跃' : '⎍ DC step'}
        </button>
        <button type="button" onClick={reset} className="btn border border-edge text-slate-300">
          {zh ? '↺ 复位' : '↺ Reset'}
        </button>
        <ParamSlider
          label={zh ? '阻尼比' : 'Damping ratio'}
          value={zeta.value}
          min={0}
          max={2}
          step={0.01}
          format={(v) => v.toFixed(2)}
          onChange={v => { zeta.set(v); reset() }}
        />
        <span className="text-xs" style={{ color: reg.color }}>{reg.label}</span>
      </div>

      <div className="toolbar mb-3">
        <ParamSlider label={zh ? '计算步数' : 'Compute steps'} value={steps} min={1} max={2000} step={1}
          onChange={v => { setSteps(v); reset() }} />
        <label>{zh ? '读图位置' : 'Read position'}
          <input aria-label="rlc cursor" type="range" min={0} max={steps} step={1} value={scanIndex}
            onChange={e => { const i = Number(e.target.value); scanRef.current = i; setScanIndex(i); setRunning(false) }} />
        </label>
      </div>
      <div className="mx-auto flex max-w-4xl flex-wrap justify-center gap-4">
        <canvas ref={scopeRef} width={W} height={H}
          role="img" aria-label={zh ? '谐振电路走纸模拟画布' : 'RLC strip-chart canvas'}
          className="stage w-full max-w-[720px]" style={{ aspectRatio: '720/300' }} />
        <canvas ref={phaseRef} width={PW} height={PH}
          role="img" aria-label={zh ? '谐振电路相平面模拟画布' : 'RLC phase-plane canvas'}
          className="stage w-full max-w-[300px]" style={{ aspectRatio: '1/1' }} />
      </div>

      {read && <div data-rlc-readout className="mx-auto mt-3 flex max-w-4xl flex-wrap justify-center gap-6 font-mono text-xs text-slate-400">
        <span>t = {((data?.dt ?? 0) * scanIndex).toFixed(4)} s</span>
        <span>
          {zh ? '谐振角频率' : 'ω₀'}{' '}
          <span className="text-[#7c5cff]">{read.w0.toFixed(3)}</span> rad/s
        </span>
        <span>
          {zh ? '阻尼比' : 'ζ'}{' '}
          <span style={{ color: reg.color }}>{read.z.toFixed(3)}</span>
        </span>
        <span>
          {zh ? '品质因数' : 'Q'}{' '}
          <span className="text-[#3ad6ff]">{read.Q === null ? '∞' : read.Q.toFixed(2)}</span>
        </span>
        <span>
          {zh ? '电容电压' : 'Vc'}{' '}
          <span className="text-[#7c5cff]">{read.q.toFixed(3)}</span> V
        </span>
        <span>
          {zh ? '电流' : 'i'}{' '}
          <span className="text-[#3ad6ff]">{read.i.toFixed(3)}</span> A
        </span>
      </div>}

      <p className="note">
        {zh
          ? '模型：串联谐振回路按基尔霍夫电压定律积分电荷与电流，采用四阶龙格–库塔推进。无阻尼谐振角频率由电感与电容决定，阻尼比与品质因数由电阻决定。固定电感、电容后用阻尼比反解电阻。「初始储能」让电容带电后自由放电，「直流阶跃」加阶跃源至稳态电荷。核心算法已测试验证（无阻尼周期、阻尼判据、零电阻能量守恒、欠阻尼包络衰减、阶跃稳态）。'
          : 'Model: series RLC integrates charge and current via KVL with RK4. Undamped ω₀ from L,C; ζ and Q from R (ζ back-solves R with L,C fixed). “Initial energy” free-rings a charged C; “DC step” drives to C·V. Core algorithm is tested (period, damping criteria, energy conservation at R=0, envelope, step steady state).'}
      </p>
      <SpiceImportPanel />
      <div className="mt-6 space-y-4">
        <PspiceAcEditor onRun={runPspiceAc} onInputChange={invalidatePspiceAc} onCancel={cancelPspiceAc} running={pspiceAcBusy} />
        {(pspiceAcSweepStatus || pspiceAcCurrentJobId) && <p role="status" aria-live="polite" className="rounded border border-edge bg-surface p-3 text-sm text-muted">{pspiceAcSweepStatus}{pspiceAcCurrentJobId ? ` · ${zh ? '当前任务' : 'Current job'} ${pspiceAcCurrentJobId}` : ''}</p>}
        {pspiceAcError && <p role="alert" className="rounded border border-red-700 bg-red-950/40 p-3 text-sm text-red-200">{pspiceAcError}</p>}
        {pspiceAcResult && <div className="space-y-3"><PspiceAcResults result={pspiceAcResult} /><button type="button" data-testid="pspice-ac-job-json" onClick={downloadPspiceAcJob} className="rounded-lg border border-edge px-3 py-2 text-sm text-ink">{zh ? '导出 MNA JobSpec JSON' : 'Export MNA JobSpec JSON'}</button></div>}
        {pspiceAcSweepRows.length > 0 && <div className="space-y-3"><PspiceAcResults result={pspiceAcSweepRows[0].result} sweepResults={pspiceAcSweepRows} /><PspiceAcSweepExport rows={pspiceAcSweepRows} /></div>}
      </div>
    </div>
  )
}

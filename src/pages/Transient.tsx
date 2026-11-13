import { useRunning } from '../lib/hooks/useRunning'
import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useEffect, useRef, useState, useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { WasmTransient } from '../lib/sim/wasm-fields'
import { transientResult, TRANSIENT_SAMPLES, type TransientScene } from '../lib/sim/transient'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useLocale } from '../lib/i18n'

const W = 720, H = 420
const PAD_L = 56, PAD_R = 24, PAD_T = 28, PAD_B = 40
const PLOT_W = W - PAD_L - PAD_R
const PLOT_H = H - PAD_T - PAD_B
const SPAN = 5 // 横轴显示 0..5τ
const SWEEP = 6 // 走纸光点扫过 5τ 所用的秒数

type Mode = TransientScene['mode']

const MODES: { key: Mode; label: string; labelEn: string }[] = [
  { key: 'rc-charge', label: '电容充电', labelEn: 'RC charge' },
  { key: 'rc-discharge', label: '电容放电', labelEn: 'RC discharge' },
  { key: 'rl', label: '电感建流', labelEn: 'RL build-up' },
]

export function Transient() {
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('transient'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)

  // 滑块状态（受控）
  const [mode, setMode] = useState<Mode>('rc-charge')
  const [v0, setV0] = useState(5) // 电源电压 V
  const [r, setR] = useState(1000) // 电阻 Ω
  const [c, setC] = useState(100) // 电容 μF
  const [l, setL] = useState(0.5) // 电感 H
  const { running, runningRef: runRef, setRunning } = useRunning()

  const scanRef = useRef(0)
  const [scanIndex, setScanIndex] = useState(0)
  const scene = useMemo(() => ({ mode, v0, r, c: c / 1e6, l }), [mode, v0, r, c, l])
  const compute = useModuleCompute({ module: 'transient', scene })
  const owner = useRef<WasmTransient | null>(null)
  const preview = useMemo(() => {
    if (compute.snapshot) return { data: compute.result?.module === 'transient' ? compute.result.result : null, error: '' }
    try {
      owner.current ??= new WasmTransient()
      return { data: transientResult(scene, owner.current), error: '' }
    } catch (error) { return { data: null, error: error instanceof Error ? error.message : String(error) } }
  }, [scene, compute.snapshot, compute.result])
  const data = preview.data
  const renderRef = useRef({ scene, data, snapshot: compute.snapshot })
  renderRef.current = { scene, data, snapshot: compute.snapshot }
  const read = data ? { ...data, val: data.values[scanIndex] } : null

  useEffect(() => {
    let disposed = false
    let last = performance.now()

    const loop = () => {
      if (disposed) return
      const now = performance.now()
      const elapsed = Math.min(0.05, (now - last) / 1000)
      last = now

      const c2 = canvasRef.current!; const ctx = c2.getContext('2d')!
      ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)
      const { scene: { mode: m }, data, snapshot } = renderRef.current
      if (!data) return
      const isRL = m === 'rl', { steady, yMax, unit, values } = data
      const startVal = values[0]
      if (runRef.current && !snapshot) scanRef.current = (scanRef.current + elapsed / SWEEP * (TRANSIENT_SAMPLES - 1)) % (TRANSIENT_SAMPLES - 1)
      const si = Math.min(TRANSIENT_SAMPLES - 1, Math.floor(scanRef.current))
      const sweep = si / (TRANSIENT_SAMPLES - 1)
      setScanIndex(si)

      const x = (frac: number) => PAD_L + frac * PLOT_W // frac=t/tEnd ∈[0,1]
      const y = (val: number) => PAD_T + PLOT_H * (1 - val / (yMax || 1))

      // —— 网格 + 坐标 ——
      ctx.strokeStyle = 'rgba(120,140,180,0.10)'; ctx.lineWidth = 1
      for (let k = 0; k <= SPAN; k++) {
        const gx = x(k / SPAN)
        ctx.beginPath(); ctx.moveTo(gx, PAD_T); ctx.lineTo(gx, PAD_T + PLOT_H); ctx.stroke()
      }
      for (let g = 0; g <= 4; g++) {
        const gy = PAD_T + (g / 4) * PLOT_H
        ctx.beginPath(); ctx.moveTo(PAD_L, gy); ctx.lineTo(PAD_L + PLOT_W, gy); ctx.stroke()
      }
      // 轴标签
      ctx.fillStyle = '#64748b'; ctx.font = '11px monospace'
      for (let k = 0; k <= SPAN; k++) {
        ctx.fillText(`${k}τ`, x(k / SPAN) - 6, PAD_T + PLOT_H + 16)
      }
      const en = !zhRef.current
      ctx.fillText(en ? 'time →' : '时间 →', PAD_L + PLOT_W - 44, PAD_T + PLOT_H + 30)
      ctx.save()
      ctx.translate(14, PAD_T + PLOT_H / 2); ctx.rotate(-Math.PI / 2)
      ctx.fillText(
        en ? (isRL ? 'current' : 'Vc') : isRL ? '电流' : '电容电压',
        -36,
        0,
      )
      ctx.restore()

      // —— 稳态线（5τ 处趋近）——
      const ySteady = y(steady)
      ctx.strokeStyle = 'rgba(58,214,255,0.35)'; ctx.setLineDash([6, 4])
      ctx.beginPath(); ctx.moveTo(PAD_L, ySteady); ctx.lineTo(PAD_L + PLOT_W, ySteady); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(58,214,255,0.8)'
      ctx.fillText(
        en
          ? `steady ${steady.toExponential(2)} ${unit} (5τ >99%)`
          : `稳态 ${steady.toExponential(2)} ${unit}（5τ >99%）`,
        PAD_L + 8,
        ySteady - 6,
      )

      // —— 63% / 37% 标记线（一个 τ 处）——
      const isDecay = m === 'rc-discharge'
      const markVal = values[48]
      const markFrac = markVal / yMax
      const yMark = y(markVal)
      const xTau = x(1 / SPAN) // t=τ
      ctx.strokeStyle = 'rgba(255,138,76,0.55)'; ctx.setLineDash([3, 4])
      ctx.beginPath(); ctx.moveTo(PAD_L, yMark); ctx.lineTo(xTau, yMark); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(xTau, PAD_T); ctx.lineTo(xTau, PAD_T + PLOT_H); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = 'rgba(255,138,76,0.95)'
      ctx.fillText(
        `t=τ → ${(markFrac * 100).toFixed(1)}%·${isRL ? 'I∞' : 'V0'}`,
        xTau + 6, yMark + (isDecay ? 16 : -6),
      )

      // —— 解析曲线 ——
      ctx.strokeStyle = '#7c5cff'; ctx.lineWidth = 2.5; ctx.beginPath()
      const NP = TRANSIENT_SAMPLES - 1
      for (let i = 0; i <= NP; i++) {
        const frac = i / NP
        const px = x(frac), py = y(values[i])
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
      }
      ctx.stroke()

      // 起点标记
      ctx.fillStyle = 'rgba(148,163,184,0.7)'
      ctx.fillText(
        en
          ? `start ${startVal.toExponential(2)} ${unit}`
          : `起点 ${startVal.toExponential(2)} ${unit}`,
        PAD_L + 6,
        y(startVal) + (startVal === 0 ? -6 : 14),
      )

      // —— 走纸光点：沿曲线扫描 ——
      const sv = values[si]
      const sx = x(sweep), sy = y(sv)
      // 已扫过部分高亮
      ctx.strokeStyle = '#3ad6ff'; ctx.lineWidth = 3
      ctx.shadowColor = '#3ad6ff'; ctx.shadowBlur = 8
      ctx.beginPath()
      const NS = si
      for (let i = 0; i <= NS; i++) {
        const frac = i / NP
        const px = x(frac), py = y(values[i])
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
      }
      ctx.stroke(); ctx.shadowBlur = 0
      ctx.fillStyle = '#ff8a4c'
      ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill()


    }
    const stopLoop = startLoop(loop)
    return () => { disposed = true; stopLoop() }
  }, [])

  const isRL = mode === 'rl'

  return (
    <div>
      <PageHeader
        icon="🔋"
        title="一阶暂态 · 充放电"
        subtitle="单个储能元件（电容或电感）与电阻组成一阶电路，对阶跃激励总是「单指数趋稳」：以时间常数为尺度从初值爬向终值。电容充电约一个时间常数到六成多、约五个时间常数可视为稳态；放电与之互补；电感建流则因「电流惯性」按同样尺度爬向终值。拖动电阻、电容、电感与电源电压，看时间常数如何拉伸或压缩整条曲线。"
      />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">{zh ? '读仿真时' : 'When reading the sim'}</span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <span className="text-slate-600">
          {zh ? '（悬停看一句人话）' : '(hover for plain language)'}
        </span>
      </p>


      <div className="toolbar mb-5">
        <span className="rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs text-violet-300">
          {zh ? '一阶电路 · 时间常数 · 电' : '1st-order · time constant · electric'}
        </span>
        {MODES.map((m) => (
          <button key={m.key} onClick={() => { setMode(m.key); scanRef.current = 0; setScanIndex(0) }}
            className={`btn border ${mode === m.key ? 'border-wave text-wave' : 'border-edge text-slate-300'}`}>
            {zh ? m.label : m.labelEn}
          </button>
        ))}
        <button onClick={() => { const v = !running; setRunning(v) }}
          className="btn border border-edge text-slate-300">
          {running ? (zh ? '⏸ 暂停' : '⏸ Pause') : zh ? '▶ 继续' : '▶ Resume'}
        </button>
        <button onClick={() => { scanRef.current = 0; setScanIndex(0) }}
          className="btn border border-edge text-slate-300">
          {zh ? '↺ 重扫' : '↺ Resweep'}
        </button>
      </div>

      <div className="toolbar mb-5">
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '电源电压' : 'Supply'} {v0.toFixed(1)} V
          <input type="range" min={1} max={12} step={0.5} value={v0}
            onChange={(e) => setV0(Number(e.target.value))} />
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '电阻' : 'R'} {r} Ω
          <input type="range" min={100} max={5000} step={100} value={r}
            onChange={(e) => setR(Number(e.target.value))} />
        </label>
        {isRL ? (
          <label className="flex items-center gap-2 text-slate-400">
            {zh ? '电感' : 'L'} {l.toFixed(2)} H
            <input type="range" min={0.05} max={2} step={0.05} value={l}
              onChange={(e) => setL(Number(e.target.value))} />
          </label>
        ) : (
          <label className="flex items-center gap-2 text-slate-400">
            {zh ? '电容' : 'C'} {c} μF
            <input type="range" min={10} max={500} step={10} value={c}
              onChange={(e) => setC(Number(e.target.value))} />
          </label>
        )}
      </div>

      <label className="toolbar mb-3">
        {zh ? '读图位置' : 'Read position'}
        <input aria-label="transient cursor" type="range" min={0} max={240} step={1} value={scanIndex}
          onChange={e => { const i = Number(e.target.value); scanRef.current = i; setScanIndex(i); setRunning(false) }} />
      </label>
      {preview.error && <p role="alert" className="mb-3 text-rose-300">{preview.error}</p>}
      <canvas ref={canvasRef} width={W} height={H}
        role="img" aria-label={zh ? '一阶充放电暂态模拟画布' : '1st-order transient canvas'}
        className="stage mx-auto w-full max-w-3xl" style={{ aspectRatio: '720/420' }} />

      {read && <div data-transient-readout className="mx-auto mt-3 flex max-w-3xl flex-wrap justify-center gap-6 font-mono text-xs text-slate-400">
        <span>
          {zh ? '时间常数' : 'τ'}{' '}
          <span className="text-[#ff8a4c]">{(read.tau * 1000).toFixed(3)}</span> ms
        </span>
        <span>
          {zh ? '当前光点' : 'Cursor'}{' '}
          <span className="text-[#3ad6ff]">{read.val.toExponential(3)}</span> {read.unit}
        </span>
        <span>
          {zh ? '稳态值' : 'Steady'}{' '}
          <span className="text-[#7c5cff]">{read.steady.toExponential(3)}</span> {read.unit}
        </span>
        <span>
          {zh ? '五个时间常数' : '5τ'}{' '}
          <span className="text-slate-300">{(read.tau * 5 * 1000).toFixed(2)}</span> ms
        </span>
      </div>}

      <p className="note">
        {zh
          ? '一阶电路解析解：阻容充电为指数上升、放电为指数衰减，阻感建流同样指数趋稳；时间常数（阻容为电阻×电容，阻感为电感/电阻）决定整条曲线的「快慢」。橙线标出一个时间常数处的 63.2%/36.8%，青线标出五个时间常数后趋近的稳态。核心算法含数值积分与解析解对拍（容差 <1%），并验证时间常数与 5τ>99% 等标志性事实。'
          : '1st-order analytic solutions: RC charge rises exponentially, discharge decays; RL current builds the same way. τ (RC=R·C, RL=L/R) sets the time scale. Orange marks 63.2%/36.8% at one τ; cyan marks the near-steady at 5τ. Core algorithm matches numeric vs analytic (<1%) and checks 5τ>99% facts.'}
      </p>
    </div>
  )
}

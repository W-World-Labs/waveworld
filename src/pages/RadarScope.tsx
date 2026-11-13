import { WasmRadar } from '../lib/sim/wasm-fields'
import { useRunning } from '../lib/hooks/useRunning'
import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useEffect, useRef, useState, useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { radarResult, radarObstacleMask, RADAR_N as N, RADAR_BUFFER as BUF, RADAR_TX as TX, RADAR_TARGETS as TARGETS, type RadarProbe } from '../lib/sim/radar-algos'
import { useLocale } from '../lib/i18n'

const SCALE = 2.4
const CH_COLORS = ['#ffd43b', '#3ad6ff', '#ff6b6b', '#69db7c']

function fieldColor(v: number, solid: boolean, out: Uint8ClampedArray, o: number) {
  if (solid) { out[o] = 100; out[o + 1] = 106; out[o + 2] = 120; out[o + 3] = 255; return }
  const t = Math.max(-1, Math.min(1, v))
  if (t >= 0) { out[o] = 30 + t * 225; out[o + 1] = 40 + t * 150; out[o + 2] = 60 } // 正：橙红
  else { const k = -t; out[o] = 20; out[o + 1] = 40 + k * 60; out[o + 2] = 80 + k * 160 } // 负：蓝
  out[o + 3] = 255
}

export function RadarScope() {
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('radar'), [])

  const fieldRef = useRef<HTMLCanvasElement>(null)
  const scopeRef = useRef<HTMLCanvasElement>(null)
  const [probes, setProbes] = useState<RadarProbe[]>([{ x: 36, y: N / 2 }, { x: 110, y: N / 2 }, null, null])
  const [channels, setChannels] = useState(2)
  const channelsRef = useRef(channels)
  channelsRef.current = channels
  const [active, setActive] = useState(0)
  const [mode, setMode] = useState<'pulse' | 'cw'>('pulse')
  const [steps, setSteps] = useState(400)
  const [stepsDone, setStepsDone] = useState(0)
  const { running, runningRef, toggle, setRunning } = useRunning()
  const [readout, setReadout] = useState<ReturnType<typeof radarResult>['readout']>([])
  const scene = useMemo(() => ({ mode, steps, probes }), [mode, steps, probes])
  const compute = useModuleCompute({ module: 'radar', scene })
  const remote = compute.result?.module === 'radar' ? compute.result : null
  const displayed = compute.snapshot ? remote?.readout : readout
  const kernelRef = useRef<WasmRadar | null>(null)

  useEffect(() => {
    let owner: WasmRadar | null = null
    try {
      if (!compute.snapshot) {
        if (kernelRef.current) kernelRef.current.reset(scene)
        else kernelRef.current = new WasmRadar(scene)
        owner = kernelRef.current
      }
    } catch (error) { compute.reportLocalError?.(error); setRunning(false) }
    const mask = owner?.mask ?? radarObstacleMask()
    let traces: number[][] = [[], [], [], []]
    setReadout([]); setStepsDone(0)
    if (owner) setRunning(true)

    const off = document.createElement('canvas'); off.width = N; off.height = N
    const octx = off.getContext('2d')!; const img = octx.createImageData(N, N)
    let disposed = false

    const drawField = (field: ArrayLike<number> | null) => {
      if (!field) {
        const c = fieldRef.current!
        c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
        return
      }
      let mx = 1e-6
      for (let i = 0; i < field.length; i++) { const a = Math.abs(field[i]); if (a > mx) mx = a }
      for (let i = 0; i < field.length; i++) fieldColor(field[i] / mx, mask[i] === 1, img.data, i * 4)
      octx.putImageData(img, 0, 0)
      const c = fieldRef.current; if (!c) return
      const ctx = c.getContext('2d')!; ctx.imageSmoothingEnabled = true
      ctx.drawImage(off, 0, 0, c.width, c.height)
      // Tx
      ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.arc(TX.x * SCALE, TX.y * SCALE, 5, 0, 7); ctx.fill()
      const en = !zhRef.current
      ctx.fillStyle = '#cbd5e1'; ctx.font = '11px sans-serif'
      ctx.fillText(en ? 'TX' : '发射', TX.x * SCALE - 12, TX.y * SCALE - 8)
      // 靶标签
      for (const t of TARGETS) {
        const lab = zhRef.current ? t.label : t.labelEn
        ctx.fillText(lab, ((t.x0 + t.x1) / 2) * SCALE - 12, t.y0 * SCALE - 3)
      }
      // 探针
      scene.probes.forEach((p, i) => {
        if (!p || i >= channelsRef.current) return
        ctx.strokeStyle = CH_COLORS[i]; ctx.lineWidth = 2
        ctx.beginPath(); ctx.arc(p.x * SCALE, p.y * SCALE, 6, 0, 7); ctx.stroke()
        ctx.fillStyle = CH_COLORS[i]
        ctx.fillText((en ? 'Ch' : '通') + (i + 1), p.x * SCALE + 7, p.y * SCALE - 4)
      })
    }

    const drawScope = (buffers: number[][]) => {
      const c = scopeRef.current; if (!c) return
      const ctx = c.getContext('2d')!; const W = c.width, H = c.height
      const en = !zhRef.current
      ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)
      // 网格
      ctx.strokeStyle = 'rgba(120,140,180,0.12)'; ctx.lineWidth = 1
      for (let gx = 0; gx <= 10; gx++) { ctx.beginPath(); ctx.moveTo((gx / 10) * W, 0); ctx.lineTo((gx / 10) * W, H); ctx.stroke() }
      const lanes = channelsRef.current
      for (let ch = 0; ch < lanes; ch++) {
        const y0 = (ch / lanes) * H, h = H / lanes, mid = y0 + h / 2
        ctx.strokeStyle = 'rgba(120,140,180,0.18)'; ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke()
        const buf = buffers[ch]
        if (buf.length > 1) {
          let pk = 1e-6; for (const v of buf) if (Math.abs(v) > pk) pk = Math.abs(v)
          ctx.strokeStyle = CH_COLORS[ch]; ctx.lineWidth = 1.5; ctx.beginPath()
          for (let i = 0; i < buf.length; i++) {
            const x = (i / (BUF - 1)) * W
            const y = mid - (buf[i] / pk) * (h * 0.42)
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
          }
          ctx.stroke()
        }
        ctx.fillStyle = CH_COLORS[ch]; ctx.font = '11px monospace'
        ctx.fillText((en ? 'Ch' : '通') + (ch + 1), 6, y0 + 14)
      }
    }

    const loop = () => {
      if (disposed) return
      if (owner && runningRef.current) {
        try {
          if (owner.completed === scene.steps) owner.reset(scene)
          owner.advance(Math.min(2, scene.steps - owner.completed))
          traces = owner.traces
          setStepsDone(owner.completed); setReadout(owner.readout())
          if (owner.completed === scene.steps) setRunning(false)
        } catch (error) { compute.reportLocalError?.(error); setRunning(false) }
      }
      drawField(owner ? owner.field : remote?.field ?? null)
      drawScope(owner ? traces : remote?.traces ?? [[], [], [], []])
    }
    const stopLoop = startLoop(loop)
    return () => { disposed = true; stopLoop() }
  }, [scene, compute.snapshot, remote, setRunning])

  const placeProbe = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = fieldRef.current!; const r = c.getBoundingClientRect()
    const x = Math.max(0, Math.min(N - 1, Math.round(((e.clientX - r.left) / r.width) * N)))
    const y = Math.max(0, Math.min(N - 1, Math.round(((e.clientY - r.top) / r.height) * N)))
    setProbes(previous => previous.map((p, ch) => ch === active ? { x, y } : p))
  }

  return (
    <div>
      <PageHeader
        icon="📶"
        title="雷达回波 · 示波器"
        subtitle="发射源发出电磁脉冲，遇到墙、硅靶、金属电器反射，形成直达波与一次、二次回波（多径）。在左侧点击放置探针（最多四路），右侧示波器实时显示各探针波形——与真实雷达、超声测距同理。"
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
        <div className="flex items-center gap-1">
          {(['pulse', 'cw'] as const).map((m) => (
            <button key={m} onClick={() => { setMode(m) }}
              className={`btn border ${mode === m ? 'border-wave text-wave' : 'border-edge text-slate-300'}`}>
              {m === 'pulse'
                ? (zh ? '脉冲·雷达' : 'Pulse · radar')
                : (zh ? '连续·无线' : 'CW · radio')}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-slate-400">
          {zh ? '通道' : 'Channels'}
          <select value={channels} onChange={(e) => { const v = Number(e.target.value); setChannels(v); setActive(a => Math.min(a, v - 1)) }}
            className="rounded border border-edge bg-edge/40 px-2 py-1 text-slate-200">
            {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <span className="text-slate-500">{zh ? '放置' : 'Place'}</span>
          {Array.from({ length: channels }, (_, i) => (
            <button key={i} onClick={() => { setActive(i) }}
              className={`btn border text-xs ${active === i ? 'border-current' : 'border-edge'}`}
              style={{ color: CH_COLORS[i] }}>
              {zh ? `通${i + 1}` : `Ch${i + 1}`}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-slate-400">
          {zh ? '计算步数' : 'Steps'}
          <input aria-label="Radar steps" type="number" min={1} max={2000} step={1} value={steps}
            onChange={(e) => setSteps(Math.max(1, Math.min(2000, Math.round(Number(e.target.value)))))} />
        </label>
        <span data-radar-step={compute.snapshot ? remote?.steps ?? 0 : stepsDone}>
          {compute.snapshot ? remote?.steps ?? 0 : stepsDone} / {steps}
        </span>
        <button disabled={compute.snapshot} onClick={toggle}
          className="btn border border-edge text-slate-300">{running ? '⏸' : '▶'}</button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(300px,380px)]">
        {/* 左：波场 */}
        <div>
          <canvas
            ref={fieldRef}
            width={N * SCALE} height={N * SCALE}
            onMouseDown={placeProbe}
            role="img"
            aria-label={zh ? '雷达回波模拟画布' : 'Radar echo field canvas'}
            className="stage w-full cursor-crosshair"
            style={{ aspectRatio: '1/1' }}
          />
          <p className="mt-2 text-center text-xs text-slate-500">
            {zh ? '点击波场放置' : 'Click field to place'}{' '}
            <span style={{ color: CH_COLORS[active] }}>
              {zh ? `通${active + 1}` : `Ch${active + 1}`}
            </span>{' '}
            {zh ? '探针' : 'probe'}
          </p>
        </div>
        {/* 右：示波器 */}
        <div className="card flex flex-col p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
            <span>{zh ? '示波器' : 'Scope'}</span>
            <span>
              {channels} {zh ? '通道' : 'ch'} · {mode === 'pulse' ? (zh ? '脉冲' : 'pulse') : zh ? '连续' : 'CW'}
            </span>
          </div>
          <canvas ref={scopeRef} width={380} height={300} className="w-full rounded-lg border border-edge bg-[#05070f]" />
          {/* 数值读数 */}
          <div data-radar-readout className="mt-3 space-y-1">
            {Array.from({ length: channels }, (_, ch) => (
              <div key={ch} className="flex items-center gap-2 text-xs">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CH_COLORS[ch] }} />
                <span className="font-mono text-slate-300">{zh ? `通${ch + 1}` : `Ch${ch + 1}`}</span>
                <span className="ml-auto font-mono text-slate-400">
                  {zh ? '值' : 'v'} {displayed?.[ch]?.v.toFixed(3) ?? '—'}
                </span>
                <span className="font-mono text-slate-500">
                  {zh ? '峰峰值' : 'pp'} {displayed?.[ch]?.pp.toFixed(3) ?? '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="note">
        {zh
          ? '二维 TMz 时域有限差分（Yee-FDTD）求解麦克斯韦方程：墙体/硅板为介质（εr=4/12）、电器为理想导体（PEC），边界为吸收海绵层。回波到达探针的时延正比于往返距离（测距原理：距离 = 波速 × 时延 / 2），介质对比度决定反射强度。近发射源的探针先收到强直达脉冲，随后是各靶的回波串（一次/二次/多径）。前后端均从零场按相同步长推进，每两步采样一次，保留最近 256 点。通道数只控制显示；移动探针或修改源重新计算。'
          : 'A 2D TMz Yee-FDTD solver integrates Maxwell’s equations: walls/silicon are dielectrics (εr=4/12), appliances are PEC, and a sponge layer absorbs at the boundary. Echo delay ∝ round-trip range (R = c·τ/2) and material contrast sets reflection strength. Probes near TX hear a strong direct pulse, then target multipath. Both ends start from zero field, sample every two steps, and retain the last 256 points. Channel count only changes visibility; moving a probe or changing the source restarts the scene.'}
      </p>
    </div>
  )
}

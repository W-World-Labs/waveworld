import { useRunning } from '../lib/hooks/useRunning'
import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useEffect, useRef, useState, useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { useLocale } from '../lib/i18n'
import { mutualResult, K_MAX, type MutualScene } from '../lib/sim/mutual'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { ParamSlider } from '../components/ParamSlider'

const W = 720, H = 440
const BUF = 360
const SCOPE_X0 = 8

export function Mutual() {
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('mutual'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { running, runningRef, toggle, setRunning } = useRunning()
  const [k, setK] = useState(0.6)
  const [n, setN] = useState(1.5)
  const [mode, setMode] = useState<MutualScene['mode']>('sine')
  const [steps, setSteps] = useState(1200)
  const [scanIndex, setScanIndex] = useState(0)
  const scanRef = useRef(0)
  const scene = useMemo(() => ({ k, n, mode, steps }), [k, n, mode, steps])
  const compute = useModuleCompute({ module: 'mutual', scene })
  const preview = useMemo(() => {
    if (compute.snapshot) return { data: compute.result?.module === 'mutual' ? compute.result.result : null, error: '' }
    try { return { data: mutualResult(scene), error: '' } } catch (error) {
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
  const read = data ? { ...data.states[Math.min(scanIndex, steps)], share: data.secondaryShare[Math.min(scanIndex, steps)], k: data.k, n: data.n } : null

  useEffect(() => {
    let disposed = false
    const loop = () => {
      if (disposed) return
      const c = canvasRef.current!; const ctx = c.getContext('2d')!
      ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)
      const { data } = renderRef.current
      if (!data) return
      if (runningRef.current) scanRef.current += 4
      const si = Math.min(scanRef.current, data.states.length - 1)
      scanRef.current = si; setScanIndex(si)
      if (si === data.states.length - 1 && runningRef.current) setRunning(false)
      const sCur = data.states[si]
      const recent = data.states.slice(Math.max(0, si - BUF + 1), si + 1)
      const b1 = Array(Math.max(0, BUF - recent.length)).fill(0).concat(recent.map(s => s.i1))
      const b2 = Array(Math.max(0, BUF - recent.length)).fill(0).concat(recent.map(s => s.i2))

      // 区块：上半两线圈耦合示意，下半双回路走纸
      const coilY = 96
      const leftCx = 180, rightCx = W - 180
      const turns = 6

      // 磁通耦合带（中间）——颜色随 k 增强
      const kNow = data.k
      ctx.save()
      const fluxAlpha = 0.08 + kNow * 0.28
      ctx.strokeStyle = `rgba(58,214,255,${fluxAlpha})`
      ctx.lineWidth = 2
      const arcN = 5
      for (let a = 0; a < arcN; a++) {
        const yy = coilY - 36 + (a / (arcN - 1)) * 72
        ctx.beginPath()
        ctx.moveTo(leftCx + 28, yy)
        ctx.bezierCurveTo((leftCx + rightCx) / 2, yy - 28, (leftCx + rightCx) / 2, yy + 28, rightCx - 28, yy)
        ctx.stroke()
      }
      ctx.restore()

      // 画线圈（一串半圆）
      const drawCoil = (cx: number, color: string, label: string) => {
        ctx.strokeStyle = color; ctx.lineWidth = 3
        const r = 11
        const x0 = cx - (turns - 1) * r
        ctx.beginPath()
        for (let i = 0; i < turns; i++) {
          const x = x0 + i * 2 * r
          ctx.moveTo(x - r, coilY)
          ctx.arc(x, coilY, r, Math.PI, 0, false)
        }
        ctx.stroke()
        ctx.fillStyle = color; ctx.font = 'bold 13px sans-serif'
        ctx.fillText(label, cx - 14, coilY - 30)
      }
      const en = !zhRef.current
      drawCoil(leftCx, '#7c5cff', en ? 'Primary L₁' : '初级 L₁')
      drawCoil(rightCx, '#ff8a4c', en ? 'Secondary L₂' : '次级 L₂')

      // 当前电流强度作为线圈下方光晕条
      const glow = (cx: number, cur: number, color: string) => {
        const w = Math.min(60, Math.abs(cur) * 12)
        ctx.fillStyle = color
        ctx.globalAlpha = 0.5
        ctx.fillRect(cx - w / 2, coilY + 22, w, 6)
        ctx.globalAlpha = 1
      }
      glow(leftCx, sCur.i1, '#7c5cff')
      glow(rightCx, sCur.i2, '#ff8a4c')

      // 标注 k / n / M
      ctx.fillStyle = '#94a3b8'; ctx.font = '12px monospace'
      ctx.fillText(`k = M/√(L₁L₂) = ${kNow.toFixed(2)}`, (leftCx + rightCx) / 2 - 78, coilY + 56)
      ctx.fillText(
        en
          ? `Turns n = √(L₂/L₁) = ${data.n.toFixed(2)}`
          : `匝比 n = √(L₂/L₁) = ${data.n.toFixed(2)}`,
        (leftCx + rightCx) / 2 - 78,
        coilY + 74,
      )

      // —— 双回路走纸示波 ——
      const scopeY0 = 188, scopeH = 210
      const iMax = Math.max(4, ...b1.map(Math.abs), ...b2.map(Math.abs)) // A 量程
      const iy = (v: number) => scopeY0 + scopeH * (0.5 - 0.5 * (v / iMax))

      // 网格
      ctx.strokeStyle = 'rgba(120,140,180,0.10)'; ctx.lineWidth = 1
      for (let gx = 0; gx <= W; gx += 60) { ctx.beginPath(); ctx.moveTo(gx, scopeY0); ctx.lineTo(gx, scopeY0 + scopeH); ctx.stroke() }
      // 零线
      ctx.strokeStyle = 'rgba(148,163,184,0.3)'; ctx.setLineDash([4, 4])
      const yz = iy(0); ctx.beginPath(); ctx.moveTo(0, yz); ctx.lineTo(W, yz); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = 'rgba(148,163,184,0.6)'; ctx.font = '11px monospace'
      ctx.fillText(en ? 'Zero current' : '电流零线', SCOPE_X0, yz - 4)
      ctx.fillText(`±${iMax.toFixed(1)}A`, SCOPE_X0, scopeY0 + 12)

      const drawWave = (buf: number[], color: string) => {
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath()
        for (let i = 0; i < buf.length; i++) {
          const x = (i / (BUF - 1)) * W
          const y = iy(buf[i])
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
        }
        ctx.stroke()
      }
      drawWave(b1, '#7c5cff')
      drawWave(b2, '#ff8a4c')

      // 图例
      ctx.fillStyle = '#7c5cff'
      ctx.fillText(en ? '■ i₁ primary' : '■ i₁ 初级', W - 160, scopeY0 + 14)
      ctx.fillStyle = '#ff8a4c'
      ctx.fillText(en ? '■ i₂ secondary' : '■ i₂ 次级', W - 90, scopeY0 + 14)


    }
    const stopLoop = startLoop(loop)
    return () => { disposed = true; stopLoop() }
  }, [])

  const reset = () => { scanRef.current = 0; setScanIndex(0) }

  return (
    <div>
      <PageHeader
        icon="🔗"
        title="互感 · 变压器"
        subtitle="两个磁耦合的线圈构成变压器：初级电流变化经互感在次级感应出电动势。调耦合系数与匝比，给初级加正弦或阶跃激励，从零电流计算有限步数，观察双回路电流。次级耗散占比表示累计次级电阻耗能占两侧总电阻耗能的比例。"
      />
      {preview.error && <p role="alert" className="note mb-4">{zh ? '本地 WASM 计算不可用。' : 'Local WASM computation unavailable.'} {preview.error}</p>}

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
          {zh ? '耦合电感 · 走纸示波' : 'Coupled inductors · strip chart'}
        </span>
        <button onClick={toggle}
          className="btn border border-edge text-slate-300">
          {running ? (zh ? '⏸ 暂停' : '⏸ Pause') : zh ? '▶ 继续' : '▶ Resume'}
        </button>
        <button onClick={reset}
          className="btn border border-edge text-slate-300">
          {zh ? '↺ 复位' : '↺ Reset'}
        </button>
        <button
          onClick={() => { const m = mode === 'sine' ? 'step' : 'sine'; setMode(m); reset() }}
          className="btn border border-edge text-slate-300"
        >
          {zh
            ? `激励：${mode === 'sine' ? '正弦' : '阶跃'}（点切换）`
            : `Drive: ${mode === 'sine' ? 'sine' : 'step'} (tap to switch)`}
        </button>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '耦合' : 'Coupling'} k={k.toFixed(2)}
          <input type="range" min={0} max={K_MAX.value} step={0.01} value={k}
            onChange={(e) => { const v = Number(e.target.value); setK(v); reset() }} />
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '匝比' : 'Turns'} n={n.toFixed(2)}
          <input type="range" min={0.3} max={3} step={0.05} value={n}
            onChange={(e) => { const v = Number(e.target.value); setN(v); reset() }} />
        </label>
      </div>

      <div className="toolbar mb-3">
        <ParamSlider label={zh ? '计算步数' : 'Compute steps'} value={steps} min={1} max={2000} step={1}
          onChange={v => { setSteps(v); reset() }} />
        <label>{zh ? '读图位置' : 'Read position'}
          <input aria-label="mutual cursor" type="range" min={0} max={steps} step={1} value={scanIndex}
            onChange={e => { const i = Number(e.target.value); scanRef.current = i; setScanIndex(i); setRunning(false) }} />
        </label>
      </div>
      <canvas
        ref={canvasRef}
        width={W} height={H}
        role="img"
        aria-label={zh ? '互感变压器模拟画布' : 'Mutual inductance transformer canvas'}
        className="stage mx-auto w-full max-w-3xl"
        style={{ aspectRatio: '720/440' }}
      />

      {read && <div data-mutual-readout className="mx-auto mt-3 flex max-w-3xl flex-wrap justify-center gap-6 font-mono text-xs text-slate-400">
        <span>t = {((data?.dt ?? 0) * scanIndex).toFixed(4)} s</span>
        <span>
          {zh ? '初级电流' : 'i₁'}{' '}
          <span className="text-[#7c5cff]">{read.i1.toFixed(2)}</span> A
        </span>
        <span>
          {zh ? '次级电流' : 'i₂'}{' '}
          <span className="text-[#ff8a4c]">{read.i2.toFixed(2)}</span> A
        </span>
        <span>
          {zh ? '耦合系数' : 'k'}{' '}
          <span className="text-[#3ad6ff]">{read.k.toFixed(2)}</span>
        </span>
        <span>
          {zh ? '匝比' : 'n'}{' '}
          <span className="text-[#3ad6ff]">{read.n.toFixed(2)}</span>
        </span>
        <span>
          {zh ? '次级耗散占比' : 'Secondary dissipation share'}{' '}
          <span style={{ color: read.share > 0.3 ? '#4ade80' : '#94a3b8' }}>{(read.share * 100).toFixed(0)}%</span>
        </span>
      </div>}

      <p className="note">
        {zh
          ? '模型：L₁=1 H，L₂=n² H，M=k·n H，R₁=2 Ω，R₂=4 Ω；10 V 阶跃或 2 Hz 正弦电压驱动。复用 RK4 积分，按最快衰减尺度细分步长，防止高耦合、小匝比下数值发散。显示两侧电阻累计耗能中的次级占比，不包含磁芯损耗或绕组寄生参数。'
          : 'Model: L₁=1 H, L₂=n² H, M=k·n H, R₁=2 Ω, R₂=4 Ω; 10 V step or 2 Hz sine drive. RK4 subdivides the timestep using the fastest decay scale. The readout is the secondary share of accumulated resistor dissipation. Core loss and winding parasitics are omitted.'}

      </p>
    </div>
  )
}

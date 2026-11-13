import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { stmScanResult, STM_SAMPLES as M } from '../lib/sim/stm'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useRunning } from '../lib/hooks/useRunning'
import { useLocale } from '../lib/i18n'

export function STM() {
  const startLoop = useStartRafLoop()
  const { runningRef, setRunning } = useRunning()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('stm'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tipHeight, setTipHeight] = useState(0.28)
  const [setCurrent, setSetCurrent] = useState(0.02)
  const [mode, setMode] = useState<'height' | 'current'>('current')
  const [scanIndex, setScanIndex] = useState(0)
  const scanRef = useRef(0)
  const scene = useMemo(() => ({ mode, tipHeight, setCurrent }), [mode, tipHeight, setCurrent])
  const compute = useModuleCompute({ module: 'stm', scene })
  const data = useMemo(() => compute.target === 'browser' ? stmScanResult(scene)
    : compute.result?.module === 'stm' ? compute.result.result : null, [scene, compute.target, compute.result])
  const renderRef = useRef({ scene, data, target: compute.target })
  renderRef.current = { scene, data, target: compute.target }
  const read = data ? { d: data.gaps[scanIndex], I: data.currents[scanIndex], z: data.tipHeights[scanIndex] } : null

  useEffect(() => {
    let disposed = false
    const W = 640, H = 380
    const plotX = 44, plotW = W - 70
    const topY = 158 // 侧视基准线
    const imgY0 = 210, imgY1 = 300 // 灰度图像带
    const traceY = 358 // 信号曲线基线

    const sx = (i: number) => plotX + (i / (M - 1)) * plotW
    const hScale = 360 // 高度放大（nm → px）

    const loop = () => {
      if (disposed) return
      const c = canvasRef.current
      if (!c) { return }
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)

      const { scene: { mode: m }, data } = renderRef.current
      if (!data) return
      const { surface, currents, tipHeights: tipTrace } = data
      const signal = m === 'height' ? currents : tipTrace

      // —— 侧视：表面 + 针尖 ——
      ctx.fillStyle = '#141c30'; ctx.beginPath(); ctx.moveTo(plotX, topY)
      for (let i = 0; i < M; i++) ctx.lineTo(sx(i), topY - surface[i] * hScale)
      ctx.lineTo(sx(M - 1), topY); ctx.closePath(); ctx.fill()
      ctx.strokeStyle = '#2a3550'; ctx.lineWidth = 1; ctx.stroke()
      // 原子球点缀
      for (let i = 0; i < M; i += 17) {
        const r = 2 + surface[i] * hScale * 0.18
        ctx.fillStyle = 'rgba(124,92,255,0.5)'
        ctx.beginPath(); ctx.arc(sx(i), topY - surface[i] * hScale - r * 0.4, r, 0, 7); ctx.fill()
      }

      const si = Math.floor(scanRef.current) % M
      const tipX = sx(si)
      const surfY = topY - surface[si] * hScale
      // 针尖绝对高度：恒高=固定 tipH，恒流=跟随轨迹
      const tipAbs = tipTrace[si]
      const tipTopY = topY - tipAbs * hScale
      const Inow = currents[si]
      const gap = data.gaps[si]

      // 针尖（楔形）
      ctx.fillStyle = '#cbd5e1'
      ctx.beginPath(); ctx.moveTo(tipX, surfY - Math.max(1, gap * hScale))
      ctx.lineTo(tipX - 7, tipTopY - 34); ctx.lineTo(tipX + 7, tipTopY - 34); ctx.closePath(); ctx.fill()
      // 隧穿电流辉光（强度∝电流）
      const glow = Math.min(1, Inow / 0.08)
      ctx.fillStyle = `rgba(58,214,255,${0.15 + 0.7 * glow})`
      ctx.beginPath(); ctx.arc(tipX, surfY - 2, 3 + 9 * glow, 0, 7); ctx.fill()
      // 间距标注
      ctx.strokeStyle = 'rgba(255,138,76,0.7)'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(tipX + 11, surfY - 1); ctx.lineTo(tipX + 11, surfY - gap * hScale); ctx.stroke()

      // —— 灰度图像带：逐点电流 → 「原子」明暗 ——
      ctx.fillStyle = '#0a0f1c'; ctx.fillRect(plotX, imgY0, plotW, imgY1 - imgY0)
      // Constant-height images current; constant-current images the returned tip height.
      const imageMin = Math.min(...signal), imageSpan = Math.max(1e-9, Math.max(...signal) - imageMin)
      const colW = plotW / M + 1
      for (let i = 0; i <= si; i++) {
        const lum = Math.pow((signal[i] - imageMin) / imageSpan, 0.45) // gamma 提亮
        const g = Math.round(30 + 200 * lum)
        ctx.fillStyle = `rgb(${Math.round(g * 0.5)},${Math.round(g * 0.85)},${g})`
        ctx.fillRect(sx(i), imgY0, colW, imgY1 - imgY0)
      }

      // —— 底部信号曲线 ——
      let sMin = Infinity, sMax = -Infinity
      for (let i = 0; i <= si; i++) { sMin = Math.min(sMin, signal[i]); sMax = Math.max(sMax, signal[i]) }
      const span = Math.max(1e-9, sMax - sMin)
      ctx.strokeStyle = m === 'height' ? '#3ad6ff' : '#7c5cff'; ctx.lineWidth = 1.6
      ctx.beginPath()
      for (let i = 0; i <= si; i++) {
        const y = traceY - 6 - ((signal[i] - sMin) / span) * 34
        i ? ctx.lineTo(sx(i), y) : ctx.moveTo(sx(i), y)
      }
      ctx.stroke()

      // 扫描竖线
      ctx.strokeStyle = 'rgba(255,224,102,0.35)'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(tipX, 30); ctx.lineTo(tipX, traceY); ctx.stroke()

      // 标签
      const en = !zhRef.current
      ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif'
      ctx.fillText(
        en
          ? `Tip–surface side view (${m === 'height' ? 'constant-height: tip fixed' : 'constant-current: tip tracks surface'})`
          : `针尖-表面侧视（${m === 'height' ? '恒高模式：针固定' : '恒流模式：针随表面起伏'}）`,
        plotX,
        20,
      )
      ctx.fillText(
        en
          ? (m === 'height' ? 'Current grayscale (normalized)' : 'Tip-height grayscale (normalized)')
          : (m === 'height' ? '电流灰度图（归一化）' : '针高灰度图（归一化）'),
        plotX,
        imgY0 - 6,
      )
      ctx.fillText(
        en
          ? m === 'height'
            ? 'Current signal (along scan)'
            : 'Tip height ≈ topography'
          : m === 'height'
            ? '电流信号（沿扫描）'
            : '针高轨迹 ≈ 形貌',
        plotX,
        traceY + 16,
      )

      setScanIndex(si)
      if (renderRef.current.target === 'browser' && runningRef.current) scanRef.current += 0.7
    }
    const stopLoop = startLoop(loop)
    return () => { disposed = true; stopLoop() }
  }, [])

  return (
    <div>
      <PageHeader
        icon="⚛️"
        title="扫描隧道显微"
        subtitle="把原子级锐利的金属针尖逼近导电表面到约一纳米，电子量子隧穿形成电流。间距每变化 0.1 纳米，电流就改变一个数量级——这种指数灵敏度让它能逐点「看见」单个原子的起伏。"
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
        <span className="rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-xs text-cyan-300">
          {zh ? '隧穿电流 · 指数灵敏' : 'Tunneling current · exponential'}
        </span>
        <button
          className="btn border border-edge text-slate-300"
          onClick={() => { const v = mode === 'height' ? 'current' : 'height'; setMode(v) }}
        >
          {zh
            ? `模式：${mode === 'height' ? '恒高 · 针高固定读电流' : '恒流 · 调高钉住电流'}`
            : `Mode: ${mode === 'height' ? 'const-height · fixed z, read I' : 'const-current · servo z'}`}
        </button>
        {mode === 'height' ? (
          <label className="flex items-center gap-2 text-slate-400">
            {zh ? '针高' : 'Tip height'} {tipHeight.toFixed(3)} nm
            <input type="range" min={0.18} max={0.42} step={0.005} value={tipHeight}
              onChange={(e) => { const v = Number(e.target.value); setTipHeight(v) }} />
          </label>
        ) : (
          <label className="flex items-center gap-2 text-slate-400">
            {zh ? '设定电流' : 'Setpoint I'} {setCurrent.toFixed(3)}
            <input type="range" min={0.005} max={0.06} step={0.001} value={setCurrent}
              onChange={(e) => { const v = Number(e.target.value); setSetCurrent(v) }} />
          </label>
        )}
      </div>

      <label className="mb-3 flex items-center justify-center gap-2 text-xs text-slate-400">
        {zh ? '读图位置' : 'Scan position'} {scanIndex + 1} / {M}
        <input aria-label="STM scan position" type="range" min={0} max={M - 1} step={1} value={scanIndex}
          onChange={(e) => { const i = Number(e.target.value); scanRef.current = i; setScanIndex(i); setRunning(false) }} />
      </label>

      <canvas ref={canvasRef} width={640} height={380}
        role="img" aria-label={zh ? '扫描隧道显微模拟画布' : 'STM canvas'}
        className="stage mx-auto w-full max-w-3xl" style={{ aspectRatio: '640/380' }} />

      <div data-stm-readout className="mx-auto mt-3 flex max-w-3xl justify-center gap-6 font-mono text-xs text-slate-400">
        <span>
          {zh ? '间距' : 'Gap'}{' '}
          <span className="text-amber-300">{read?.d.toFixed(3) ?? '—'} nm</span>
        </span>
        <span>
          {zh ? '隧穿电流' : 'Tunnel I'}{' '}
          <span className="text-cyan-300">{read?.I.toExponential(2) ?? '—'}</span>
        </span>
        <span>
          {zh ? '针绝对高度' : 'Tip z'}{' '}
          <span className="text-violet-300">{read?.z.toFixed(3) ?? '—'} nm</span>
        </span>
      </div>

      <p className="note">
        {zh
          ? '恒高模式：针尖高度固定，逐点测电流——电流随表面起伏指数变化，灰度图直接显出原子。恒流模式：用理想静态反解保持电流，灰度图与信号曲线显示针高。这里未积分反馈控制回路，电流为归一化教学数值，不代表仪器标定或实际分辨率。扫描动画和暂停只控制读图位置，前后端计算的是同一整行响应。'
          : 'Constant-height: fixed tip z, read I pointwise—I varies exponentially with topography, so grayscale maps atoms. Constant-current uses an ideal static inverse to hold current; grayscale and trace show tip height. No feedback controller is integrated. Current is normalized teaching data, not instrument calibration or a resolution claim. Animation and pause control the reading position; both targets compute the same full line.'}
      </p>
    </div>
  )
}

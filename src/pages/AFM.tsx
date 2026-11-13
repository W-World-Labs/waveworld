import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { afmScanResult, AFM_SAMPLES as M } from '../lib/sim/afm'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useRunning } from '../lib/hooks/useRunning'
import { useLocale } from '../lib/i18n'

export function AFM() {
  const startLoop = useStartRafLoop()
  const { runningRef, setRunning } = useRunning()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('afm'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [base, setBase] = useState(2.6)
  const [k, setK] = useState(6)
  const [scanIndex, setScanIndex] = useState(0)
  const scanRef = useRef(0)
  const scene = useMemo(() => ({ base, k }), [base, k])
  const compute = useModuleCompute({ module: 'afm', scene })
  const data = useMemo(() => compute.target === 'browser' ? afmScanResult(scene)
    : compute.result?.module === 'afm' ? compute.result.result : null, [scene, compute.target, compute.result])
  const renderRef = useRef({ scene, data, target: compute.target })
  renderRef.current = { scene, data, target: compute.target }
  const pos = data ? { d: data.gaps[scanIndex], F: data.forces[scanIndex], z: data.deflections[scanIndex] } : null

  useEffect(() => {
    let disposed = false
    const W = 640, Hh = 380
    const topY = 150, botY = 360, plotX = 40, plotW = W - 60

    const loop = () => {
      if (disposed) return
      const c = canvasRef.current!; const ctx = c.getContext('2d')!
      ctx.fillStyle = '#070912'; ctx.fillRect(0, 0, W, Hh)
      const { scene: { base }, data } = renderRef.current
      if (!data) return
      const { surface, deflections: defl } = data
      const sx = (i: number) => plotX + (i / (M - 1)) * plotW
      const hScale = 26, dScale = 8

      // —— 侧视：表面 + 针尖/悬臂 ——
      ctx.fillStyle = '#26304a'; ctx.beginPath(); ctx.moveTo(plotX, topY)
      for (let i = 0; i < M; i++) ctx.lineTo(sx(i), topY - surface[i] * hScale)
      ctx.lineTo(sx(M - 1), topY); ctx.closePath(); ctx.fill()
      ctx.strokeStyle = '#3a4663'; ctx.stroke()

      const si = Math.floor(scanRef.current) % M
      const tipX = sx(si)
      const surfY = topY - surface[si] * hScale
      const F = data.forces[si]
      const z = defl[si]
      const tipBaseY = topY - base * hScale - 26 // 悬臂基座高度
      const bend = -Math.max(-30, Math.min(30, z * dScale))
      // 悬臂梁（颜色随力：红排斥/蓝吸引）
      ctx.strokeStyle = F > 0 ? '#ff6b6b' : '#5ab0ff'; ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(tipX - 70, tipBaseY); ctx.lineTo(tipX, tipBaseY + bend); ctx.stroke()
      // 针尖
      ctx.fillStyle = '#cbd5e1'; ctx.beginPath(); ctx.moveTo(tipX, tipBaseY + bend); ctx.lineTo(tipX - 5, surfY - 2); ctx.lineTo(tipX + 5, surfY - 2); ctx.closePath(); ctx.fill()
      // 激光杠杆：从悬臂端反射到光电探测器
      ctx.strokeStyle = 'rgba(255,90,90,0.7)'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(tipX - 120, tipBaseY - 60); ctx.lineTo(tipX, tipBaseY + bend); ctx.lineTo(tipX + 110, tipBaseY - 70 + bend * 2.5); ctx.stroke()
      ctx.fillStyle = '#475569'; ctx.fillRect(tipX + 100, tipBaseY - 100, 6, 60) // 四象限探测器
      ctx.fillStyle = '#ff6b6b'; ctx.beginPath(); ctx.arc(tipX + 103, tipBaseY - 70 + bend * 2.5, 3, 0, 7); ctx.fill()

      // —— 下方：重建形貌（AFM 图像，由偏转还原） ——
      ctx.strokeStyle = 'rgba(120,140,180,0.15)'; ctx.beginPath(); ctx.moveTo(plotX, botY); ctx.lineTo(plotX + plotW, botY); ctx.stroke()
      let dMax = 1e-6; for (let i = 0; i <= si; i++) dMax = Math.max(dMax, Math.abs(defl[i]))
      ctx.strokeStyle = '#69db7c'; ctx.lineWidth = 1.5; ctx.beginPath()
      for (let i = 0; i <= si; i++) { const y = botY - 32 - (defl[i] / dMax) * 24; i ? ctx.lineTo(sx(i), y) : ctx.moveTo(sx(i), y) }
      ctx.stroke()
      const en = !zhRef.current
      ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif'
      ctx.fillText(
        en
          ? 'Tip–surface side view (cantilever deflection, optical lever)'
          : '针尖-表面侧视（悬臂随力偏转，激光杠杆放大读出）',
        plotX,
        20,
      )
      ctx.fillText(
        en
          ? 'Signed deflection F/k (normalized display)'
          : '有符号偏转 F/k（归一化显示）',
        plotX,
        botY - 56,
      )
      // 扫描线
      ctx.strokeStyle = 'rgba(255,224,102,0.4)'; ctx.beginPath(); ctx.moveTo(tipX, 28); ctx.lineTo(tipX, botY); ctx.stroke()

      setScanIndex(si)
      if (renderRef.current.target === 'browser' && runningRef.current) scanRef.current += 0.8
    }
    const stopLoop = startLoop(loop)
    return () => { disposed = true; stopLoop() }
  }, [])

  return (
    <div>
      <PageHeader
        icon="🔬"
        title="原子力显微镜"
        subtitle="纳米针尖逐点扫过样品表面，针尖与原子之间的推拉力使悬臂微微偏转；偏转经激光杠杆放大、由光电探测器读出，本页展示一维表面扫描中的力与悬臂偏转响应。"
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
        <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs text-sky-300">
          {zh ? '原子间作用力 · 悬臂偏转' : 'Interatomic force · cantilever bend'}
        </span>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '基座高度' : 'Base height'} {base.toFixed(2)}
          <input type="range" min={2.1} max={3.2} step={0.05} value={base} onChange={(e) => { const v = Number(e.target.value); setBase(v) }} />
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '悬臂劲度' : 'Stiffness'} {k}
          <input type="range" min={2} max={20} step={1} value={k} onChange={(e) => { const v = Number(e.target.value); setK(v) }} />
        </label>
      </div>

      <label className="mb-3 flex items-center justify-center gap-2 text-xs text-slate-400">
        {zh ? '读图位置' : 'Scan position'} {scanIndex + 1} / {M}
        <input aria-label="AFM scan position" type="range" min={0} max={M - 1} step={1} value={scanIndex}
          onChange={(e) => { const i = Number(e.target.value); scanRef.current = i; setScanIndex(i); setRunning(false) }} />
      </label>

      <canvas ref={canvasRef} width={640} height={380}
        role="img" aria-label={zh ? '原子力显微镜模拟画布' : 'AFM canvas'}
        className="stage mx-auto w-full max-w-3xl" style={{ aspectRatio: '640/380' }} />

      <div data-afm-readout className="mx-auto mt-3 flex max-w-3xl justify-center gap-6 font-mono text-xs text-slate-400">
        <span>
          {zh ? '针尖间距' : 'Gap'}{' '}
          <span className="text-slate-300">{pos?.d.toFixed(2) ?? '—'}</span>
        </span>
        <span>
          {zh ? '作用力' : 'Force'}{' '}
          <span className={(pos?.F ?? 0) > 0 ? 'text-rose-300' : 'text-sky-300'}>{pos?.F.toFixed(2) ?? '—'}</span>
          （{!pos ? '—' : pos.F > 0 ? (zh ? '排斥' : 'repulsive') : zh ? '吸引' : 'attractive'}）
        </span>
        <span>
          {zh ? '悬臂偏转' : 'Deflection'}{' '}
          <span className="text-emerald-300">{pos?.z.toFixed(2) ?? '—'}</span>
        </span>
      </div>

      <p className="note">
        {zh
          ? '针尖与表面原子之间的力随间距变化：压近时强烈排斥（悬臂上弯），远离时弱吸引。悬臂偏转由胡克定律 F/k 给出。本例运行恒力模式：PI 反馈回路逐列调节压电高度，把偏转锁定在设定值，记录的 z(x) 即形貌通道，残余偏转误差为误差信号通道——与真实 AFM 的恒力扫描一致。约化 LJ 单位。'
          : 'Tip–surface force depends on gap: strong repulsion when pressed close (cantilever bends up), weak attraction farther out. Deflection is F/k (Hooke). This runs constant-force mode: a PI feedback loop adjusts the piezo height column by column to lock deflection at the setpoint — the recorded z(x) is the topography channel and the residual deflection is the error channel, matching a real AFM scan. Reduced LJ units.'}
      </p>
    </div>
  )
}

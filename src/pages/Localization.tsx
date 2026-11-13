import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useEffect, useRef, useState, useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { localizationResult, LOCALIZATION_W as W, LOCALIZATION_H as H, LOCALIZATION_ANCHORS as ANCHORS, type Pt } from '../lib/sim/trilateration'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useLocale } from '../lib/i18n'

const ACOL = '#3ad6ff'

export function Localization() {
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('localization'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [target, setTarget] = useState<Pt>({ x: 300, y: 210 })
  const dragRef = useRef(false)
  const [noise, setNoise] = useState(8)
  const [bandwidth, setBandwidth] = useState(30)
  const [seed, setSeed] = useState(7)
  const scene = useMemo(() => ({ target, noise, bandwidth, seed }), [target, noise, bandwidth, seed])
  const compute = useModuleCompute({ module: 'localization', scene })
  const info = useMemo(() => compute.target === 'browser' ? localizationResult(scene)
    : compute.result?.module === 'localization' ? compute.result.result : null, [scene, compute.target, compute.result])
  const renderRef = useRef({ target, info })
  renderRef.current = { target, info }

  useEffect(() => {
    let disposed = false, ping = 0
    const loop = () => {
      if (disposed) return
      const c = canvasRef.current!; const ctx = c.getContext('2d')!
      ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#070912'; ctx.fillRect(0, 0, W, H)
      const { target: t, info } = renderRef.current
      ping += 2.2
      const maxR = Math.hypot(W, H)
      if (ping > maxR) ping = 0 // Animation does not resample the measurement.
      const en = !zhRef.current

      // 目标发出的扩散波前（回波/脉冲）
      ctx.strokeStyle = 'rgba(255,224,102,0.35)'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(t.x, t.y, ping, 0, 7); ctx.stroke()

      // 各锚点测距圆
      const est = info?.est
      ANCHORS.forEach((a, i) => {
        ctx.strokeStyle = 'rgba(58,214,255,0.35)'; ctx.lineWidth = 1
        if (info) { ctx.beginPath(); ctx.arc(a.x, a.y, info.ranges[i], 0, 7); ctx.stroke() }
        ctx.fillStyle = ACOL; ctx.beginPath(); ctx.arc(a.x, a.y, 6, 0, 7); ctx.fill()
        ctx.fillStyle = '#cbd5e1'; ctx.font = '11px sans-serif'
        ctx.fillText((en ? 'A' : '锚') + (i + 1), a.x - 10, a.y - 10)
      })
      if (est) {
        // 估计位置（三边交汇）
        ctx.fillStyle = '#69db7c'; ctx.beginPath(); ctx.arc(est.x, est.y, 7, 0, 7); ctx.fill()
        ctx.strokeStyle = '#69db7c'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(est.x, est.y, 11, 0, 7); ctx.stroke()
      }
      // 真实目标
      ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.arc(t.x, t.y, 6, 0, 7); ctx.fill()
      ctx.fillStyle = '#94a3b8'; ctx.fillText(en ? 'True' : '真目标', t.x + 10, t.y - 8)
      if (est) {
        ctx.fillStyle = '#69db7c'; ctx.fillText(en ? 'Est.' : '估计', est.x + 12, est.y + 16)
        // 误差线
        ctx.strokeStyle = 'rgba(255,107,107,0.8)'; ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(est.x, est.y); ctx.stroke()

      }
    }
    const stopLoop = startLoop(loop)
    return () => { disposed = true; stopLoop() }
  }, [])

  const move = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return
    const c = canvasRef.current!; const r = c.getBoundingClientRect()
    setTarget({ x: Math.max(0, Math.min(W, ((e.clientX - r.left) / r.width) * W)), y: Math.max(0, Math.min(H, ((e.clientY - r.top) / r.height) * H)) })
  }

  return (
    <div>
      <PageHeader
        icon="🎯"
        title="三角/回波定位"
        subtitle="目标发出（或反射）的波前被多个锚点接收，各自测得一个距离；以锚点为圆心画测距圆，多圆交汇即目标位置。这正是卫星导航、声呐、雷达、室内定位的共同原理。拖动黄色「真目标」试试。"
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
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs text-emerald-300">
          {zh ? '最小二乘多边定位' : 'Least-squares multilateration'}
        </span>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '测距噪声' : 'Range noise'} {noise.toFixed(0)}
          <input type="range" min={0} max={25} step={1} value={noise} onChange={(e) => { const v = Number(e.target.value); setNoise(v) }} />
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '带宽（约化单位）' : 'Bandwidth (reduced units)'} {bandwidth}
          <input type="range" min={6} max={120} step={6} value={bandwidth} onChange={(e) => setBandwidth(Number(e.target.value))} />
        </label>
        <button className="btn border border-edge" onClick={() => setSeed(s => (s + 1) >>> 0)}>{zh ? '重新测量' : 'New measurement'}</button>
        <span className="text-xs text-slate-600">
          {zh ? '拖动黄点移动目标' : 'Drag the yellow target'}
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(220px,300px)]">
        <canvas ref={canvasRef} width={W} height={H}
          onMouseDown={(e) => { dragRef.current = true; move(e) }}
          onMouseUp={() => (dragRef.current = false)}
          onMouseLeave={() => (dragRef.current = false)}
          onMouseMove={move}
          role="img" aria-label={zh ? '三角回波定位模拟画布' : 'Trilateration / echo-ranging canvas'}
          className="stage w-full cursor-crosshair" style={{ aspectRatio: `${W}/${H}` }} />
        <div data-localization-readout className="card space-y-2 p-4 text-sm">
          <div className="font-mono text-xs text-slate-400">
            {zh ? '测距读数' : 'Range readouts'}
          </div>
          {ANCHORS.map((_, i) => (
            <div key={i} className="flex justify-between font-mono text-xs">
              <span style={{ color: ACOL }}>{zh ? `锚${i + 1}` : `A${i + 1}`}</span>
              <span className="text-slate-300">
                {info?.ranges[i].toFixed(1) ?? '—'} {zh ? '像素' : 'px'}
              </span>
            </div>
          ))}
          <div className="mt-2 border-t border-edge pt-2 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-emerald-300">{zh ? '估计' : 'Estimate'}</span>
              <span className="text-slate-300">({info?.est.x.toFixed(0) ?? '—'}, {info?.est.y.toFixed(0) ?? '—'})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-rose-300">{zh ? '定位误差' : 'Error'}</span>
              <span className="text-slate-300">
                {info?.err.toFixed(1) ?? '—'} {zh ? '像素' : 'px'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">{zh ? '距离分辨率' : 'Range resolution'}</span>
              <span className="text-slate-400">
                {zh ? '约' : '~'} {info?.resolution.toFixed(1) ?? '—'} {zh ? '像素' : 'px'}
              </span>
            </div>
          </div>
          <p className="pt-1 text-[11px] leading-relaxed text-slate-500">
            {zh
              ? '理论距离分辨率按 c/(2B) 展示，B 为带宽，c=300 为约化波速；带宽不会自动改变本例的测距噪声。重新测量会生成新的可复现噪声样本。'
              : 'Theoretical range resolution uses c/(2B), with bandwidth B and reduced speed c=300. Bandwidth does not change this example’s range noise. New measurement generates another reproducible noise sample.'}
          </p>
        </div>
      </div>

      <p className="note">
        {zh
          ? '测距含噪时单圆不会精确交于一点，最小二乘多边定位在「过定」约束下求最优交汇（锚点越多越稳）。回波定位中，距离 = 回波往返时延 × 波速 / 2。核心算法已测试验证。'
          : 'Noisy ranges never meet at one point; least-squares multilateration finds the best over-determined fix (more anchors, stabler). Echo range = round-trip delay × speed / 2. Core algorithm is tested.'}
      </p>
    </div>
  )
}

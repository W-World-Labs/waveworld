import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useEffect, useRef, useState, useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { tdoaResult, TDOA_W as W, TDOA_H as H, TDOA_ANCHORS as ANCHORS, type Pt } from '../lib/sim/tdoa'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useLocale } from '../lib/i18n'

const A0COL = '#ff8a4c'  // 参考机
const AICOL = '#3ad6ff'  // 其它接收机
const HYCOL = ['rgba(124,92,255,0.7)', 'rgba(58,214,255,0.55)', 'rgba(255,138,76,0.55)']

export function TDOA() {
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('tdoa'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [source, setSource] = useState<Pt>({ x: 360, y: 200 })
  const dragRef = useRef(false)
  const [noise, setNoise] = useState(0)
  const [seed, setSeed] = useState(11)
  const scene = useMemo(() => ({ source, noise, seed }), [source, noise, seed])
  const compute = useModuleCompute({ module: 'tdoa', scene })
  const info = useMemo(() => compute.target === 'browser' ? tdoaResult(scene)
    : compute.result?.module === 'tdoa' ? compute.result.result : null, [scene, compute.target, compute.result])
  const renderRef = useRef({ source, info })
  renderRef.current = { source, info }

  useEffect(() => {
    let disposed = false
    const loop = () => {
      if (disposed) return
      const now = performance.now()
      const c = canvasRef.current!; const ctx = c.getContext('2d')!
      ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)

      // 网格
      ctx.strokeStyle = 'rgba(124,92,255,0.06)'; ctx.lineWidth = 1
      for (let gx = 0; gx <= W; gx += 40) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke() }
      for (let gy = 0; gy <= H; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke() }

      const { source: s, info } = renderRef.current
      const est = info?.est

      // 信号源发出的脉冲波前（视觉提示等时差线）
      const pulse = ((now / 12) % 260)
      ctx.strokeStyle = 'rgba(255,224,102,0.25)'; ctx.lineWidth = 1.4
      ctx.beginPath(); ctx.arc(s.x, s.y, pulse, 0, 7); ctx.stroke()

      // 各对 (a_i, a_0) 的 TDOA 双曲线
      for (let i = 1; i < ANCHORS.length; i++) {
        const pts = info?.curves[i - 1] ?? []
        if (pts.length < 2) continue
        ctx.strokeStyle = HYCOL[(i - 1) % HYCOL.length]; ctx.lineWidth = 1.6
        ctx.beginPath()
        let started = false
        for (const p of pts) {
          if (p.x < -200 || p.x > W + 200 || p.y < -200 || p.y > H + 200) { started = false; continue }
          if (!started) { ctx.moveTo(p.x, p.y); started = true } else ctx.lineTo(p.x, p.y)
        }
        ctx.stroke()
      }

      // 接收机
      const en = !zhRef.current
      ANCHORS.forEach((a, i) => {
        const ref = i === 0
        ctx.fillStyle = ref ? A0COL : AICOL
        ctx.beginPath(); ctx.arc(a.x, a.y, 6, 0, 7); ctx.fill()
        ctx.strokeStyle = ref ? A0COL : AICOL; ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(a.x, a.y, 10, 0, 7); ctx.stroke()
        ctx.fillStyle = '#cbd5e1'; ctx.font = '11px sans-serif'
        ctx.fillText(
          en
            ? ref
              ? 'RX0 (ref)'
              : 'RX' + i
            : ref
              ? '接收0（参考）'
              : '接收' + i,
          a.x + 12,
          a.y - 8,
        )
      })

      if (est) {
        // 估计位置（双曲线交汇）
        ctx.fillStyle = '#69db7c'; ctx.beginPath(); ctx.arc(est.x, est.y, 7, 0, 7); ctx.fill()
        ctx.strokeStyle = '#69db7c'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(est.x, est.y, 12, 0, 7); ctx.stroke()
        ctx.fillStyle = '#69db7c'
        ctx.fillText(en ? 'Est.' : '估计', est.x + 13, est.y + 16)

      }
      // 真实信号源
      ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, 7); ctx.fill()
      ctx.fillStyle = '#94a3b8'
      ctx.fillText(en ? 'True source' : '真信号源', s.x + 12, s.y - 8)

      if (est) {
        // 误差线
        ctx.strokeStyle = 'rgba(255,107,107,0.85)'; ctx.lineWidth = 1.2
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(est.x, est.y); ctx.stroke()

      }
    }
    const stopLoop = startLoop(loop)
    return () => { disposed = true; stopLoop() }
  }, [])

  const move = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return
    const c = canvasRef.current!; const r = c.getBoundingClientRect()
    setSource({
      x: Math.max(0, Math.min(W, ((e.clientX - r.left) / r.width) * W)),
      y: Math.max(0, Math.min(H, ((e.clientY - r.top) / r.height) * H)),
    })
  }

  return (
    <div>
      <PageHeader
        icon="🎯"
        title="时差双曲线定位"
        subtitle="多个接收机记录信号到达时间，时差乘以波速就是距离差。距离差固定的点落在一支双曲线上（焦点为两接收机）；多对双曲线交汇即信号源位置。与「测距圆」三角定位互补——这里无需知道发射时刻，是卫星导航、声源与闪电定位的核心。拖动黄色「真信号源」。"
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
          {zh ? '最小二乘 + 一致性约束' : 'Least squares + consistency'}
        </span>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '距离差噪声（像素）' : 'Range-difference noise (px)'} {noise.toFixed(0)}
          <input
            type="range" min={0} max={20} step={1} value={noise}
            onChange={(e) => { const v = Number(e.target.value); setNoise(v) }}
          />
        </label>
        <button
          className="btn border border-edge text-slate-300"
          onClick={() => { setSource({ x: 360, y: 200 }) }}
        >
          {zh ? '复位信号源' : 'Reset source'}
        </button>
        <button className="btn border border-edge" onClick={() => setSeed(s => (s + 1) >>> 0)}>{zh ? '重新测量' : 'New measurement'}</button>
        <span className="text-xs text-slate-600">
          {zh ? '拖动黄点移动信号源' : 'Drag the yellow source'}
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(220px,300px)]">
        <canvas
          ref={canvasRef} width={W} height={H}
          onMouseDown={(e) => { dragRef.current = true; move(e) }}
          onMouseUp={() => (dragRef.current = false)}
          onMouseLeave={() => (dragRef.current = false)}
          onMouseMove={move}
          role="img"
          aria-label={zh ? '时差双曲线定位模拟画布' : 'TDOA hyperbolic location canvas'}
          className="stage mx-auto w-full max-w-3xl cursor-crosshair"
          style={{ aspectRatio: '640/380' }}
        />
        <div data-tdoa-readout className="card space-y-2 p-4 text-sm">
          <div className="font-mono text-xs text-slate-400">
            {zh ? '到达距离差（相对参考机）' : 'Range differences (vs reference)'}
          </div>
          {ANCHORS.map((_, i) =>
            i === 0 ? null : (
              <div key={i} className="flex justify-between font-mono text-xs">
                <span style={{ color: HYCOL[(i - 1) % HYCOL.length] }}>
                  {zh ? `接收${i}−参考` : `Rx${i}−ref`}
                </span>
                <span className="text-slate-300">
                  {info?.diffs[i].toFixed(1) ?? '—'} {zh ? '像素' : 'px'}
                </span>
              </div>
            ),
          )}
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
              <span className="text-slate-500">{zh ? '接收机数' : 'Receivers'}</span>
              <span className="text-slate-400">{ANCHORS.length}</span>
            </div>
          </div>
          <p className="pt-1 text-[11px] leading-relaxed text-slate-500">
            {zh
              ? '每对（接收机, 参考机）给出一支双曲线（焦点为两机），N 个接收机 → N−1 支；交汇点即源。噪声越大，双曲线越「散」，交汇区越模糊、误差越大。'
              : 'Each (receiver, reference) pair yields a hyperbola (foci at the two mics). N receivers → N−1 branches; their intersection is the source. More noise fans the curves and blurs the fix.'}
          </p>
        </div>
      </div>

      <p className="note">
        {zh
          ? '到达时差定位用「时差」而非「绝对时延」，因此无需信号源与接收机时钟同步、也无需源主动应答；各接收机间精确同步即可。距离差 = 时差 × 波速。本例输入为像素距离差；每次测量采用固定噪声样本，点击重新测量可换样本，切换计算位置保留同一次测量。'
          : 'TDOA uses time differences, not absolute delay—no TX–RX clock sync or active reply needed; receivers only need mutual sync. Range difference = Δt × speed. Inputs here are range differences in pixels. Each measurement uses a fixed noise sample; New measurement changes it, while switching compute location preserves it.'}
      </p>
    </div>
  )
}

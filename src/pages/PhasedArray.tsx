import { WasmAntenna } from '../lib/sim/wasm-fields'
import { useRunning } from '../lib/hooks/useRunning'
import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useEffect, useRef, useState, useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { phasedArrayResult } from '../lib/sim/phasedarray'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useLocale } from '../lib/i18n'

const W = 640
const H = 380
const DEG = Math.PI / 180

export function PhasedArray() {
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('phasedarray'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [n, setN] = useState(12)
  const [dOverLambda, setD] = useState(0.5)
  const [steer, setSteer] = useState(20)

  const params = useMemo(() => ({ n, dOverLambda, steerDeg: steer }), [n, dOverLambda, steer])
  const compute = useModuleCompute({ module: 'phasedarray', params })
  const kernelRef = useRef<WasmAntenna | null>(null)
  const { runningRef } = useRunning()
  const preview = useMemo(() => {
    if (compute.snapshot) return { data: compute.result?.module === 'phasedarray' ? compute.result.result : null, error: '' }
    try {
      kernelRef.current ??= new WasmAntenna('phasedarray')
      return { data: phasedArrayResult(params, kernelRef.current), error: '' }
    } catch (error) { return { data: null, error: error instanceof Error ? error.message : String(error) } }
  }, [params, compute.snapshot, compute.result])
  const data = preview.data
  const renderRef = useRef({ params, data, snapshot: compute.snapshot })
  renderRef.current = { params, data, snapshot: compute.snapshot }

  useEffect(() => {
    let disposed = false
    let t = 0

    const loop = () => {
      if (disposed) return
      const { params: { n: N, dOverLambda: d, steerDeg: s }, data } = renderRef.current
      const c = canvasRef.current
      if (!c) { return }
      const ctx = c.getContext('2d')!

      ctx.fillStyle = '#05070f'
      ctx.fillRect(0, 0, W, H)
      if (!data) return

      // ── 左面板：阵元 + 即时波前（电子扫描相位轮廓） ──
      const px = 150
      const aTop = 40
      const aBot = H - 40
      ctx.strokeStyle = 'rgba(120,140,180,0.12)'
      ctx.lineWidth = 1
      ctx.strokeRect(20, 20, 260, H - 40)
      const en = !zhRef.current
      ctx.fillStyle = '#94a3b8'
      ctx.font = '12px monospace'
      ctx.fillText(
        en
          ? `Linear array ${N} el · d/λ=${d.toFixed(2)}`
          : '线阵 ' + N + ' 元 · 间距/波长=' + d.toFixed(2),
        30,
        36,
      )

      // 阵元位置（竖直排列）
      const elemY = (i: number) => aTop + ((aBot - aTop) * i) / Math.max(1, N - 1)
      // 每元相位 φ_n = -2π(d/λ)·n·sinθ0，激励 cos(ωt+φ)
      for (let i = 0; i < N; i++) {
        const y = elemY(i)
        const phi = data.phases[i]
        const drive = Math.cos(t + phi)
        // 发光强度随激励
        const g = (drive + 1) / 2
        ctx.beginPath()
        ctx.arc(px, y, 5, 0, 7)
        ctx.fillStyle = `rgba(124,92,255,${0.35 + 0.65 * g})`
        ctx.fill()
        ctx.strokeStyle = 'rgba(58,214,255,0.5)'
        ctx.stroke()
      }
      // 指向箭头（从阵中心指向 steer）
      const cy = (aTop + aBot) / 2
      const beamLen = 95
      const bx = px + beamLen * Math.cos(s * DEG)
      const by = cy - beamLen * Math.sin(s * DEG)
      ctx.strokeStyle = '#ff8a4c'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(px, cy)
      ctx.lineTo(bx, by)
      ctx.stroke()
      ctx.fillStyle = '#ff8a4c'
      ctx.font = '12px monospace'
      ctx.fillText(
        (en ? 'Steer ' : '指向 ') + s.toFixed(0) + '°',
        bx - 10,
        by - 8,
      )

      // ── 右面板：极坐标方向图（−90..90） ──
      const ox = 460
      const oy = H / 2
      const R = 150
      // 极坐标半圆栅格
      ctx.strokeStyle = 'rgba(120,140,180,0.14)'
      ctx.lineWidth = 1
      for (const frac of [0.25, 0.5, 0.75, 1]) {
        ctx.beginPath()
        ctx.arc(ox, oy, R * frac, -Math.PI / 2, Math.PI / 2)
        ctx.stroke()
      }
      // 角度刻度线
      ctx.fillStyle = '#64748b'
      ctx.font = '10px monospace'
      for (const a of [-90, -60, -30, 0, 30, 60, 90]) {
        const ang = a * DEG
        const lx = ox + R * Math.cos(ang)
        const ly = oy - R * Math.sin(ang)
        ctx.strokeStyle = 'rgba(120,140,180,0.10)'
        ctx.beginPath()
        ctx.moveTo(ox, oy)
        ctx.lineTo(lx, ly)
        ctx.stroke()
        ctx.fillText(a + '°', lx + (a < 0 ? -8 : 2), ly + (a === 90 ? 12 : a === -90 ? 0 : 4))
      }

      // 方向图曲线
      const pat = data.pattern
      ctx.strokeStyle = '#3ad6ff'
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let i = 0; i < pat.length; i++) {
        const { theta, gain } = pat[i]
        const ang = theta * DEG
        const r = R * gain
        const lx = ox + r * Math.cos(ang)
        const ly = oy - r * Math.sin(ang)
        i ? ctx.lineTo(lx, ly) : ctx.moveTo(lx, ly)
      }
      ctx.stroke()

      // 主瓣指向线
      const ms = s * DEG
      ctx.strokeStyle = '#ff8a4c'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(ox, oy)
      ctx.lineTo(ox + R * Math.cos(ms), oy - R * Math.sin(ms))
      ctx.stroke()
      ctx.setLineDash([])

      // 栅瓣标注
      const lobes = data.grating
      ctx.fillStyle = '#ff6b6b'
      for (const ang of lobes) {
        const a = ang * DEG
        const lx = ox + R * Math.cos(a)
        const ly = oy - R * Math.sin(a)
        ctx.beginPath()
        ctx.arc(lx, ly, 4, 0, 7)
        ctx.fill()
      }

      ctx.fillStyle = '#94a3b8'
      ctx.font = '12px monospace'
      ctx.fillText(zhRef.current ? '阵因子方向图' : 'Array factor pattern', ox - 50, 30)

      if (!renderRef.current.snapshot && runningRef.current) t += 0.12
    }
    const stopLoop = startLoop(loop)
    return () => { disposed = true; stopLoop() }
  }, [])

  return (
    <div>
      <PageHeader
        icon="📡"
        title="相控阵波束成形 · 电子扫描"
        subtitle="多个等距阵元排成一线，给每个阵元施加线性递增相移，无需机械转动即可让合成波束指向任意角度。右侧极坐标方向图实时显示主瓣、旁瓣与栅瓣。"
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


      {preview.error && <p role="alert" className="note mb-4">{zh ? '本地 WASM 计算不可用。' : 'Local WASM computation unavailable.'} {preview.error}</p>}
      <div className="toolbar mb-5">
        <label className="flex items-center gap-1.5 text-slate-400">
          {zh ? '阵元数' : 'Elements'} {n}
          <input
            type="range" min={2} max={48} step={1} value={n}
            onChange={(e) => { const v = Number(e.target.value); setN(v) }}
          />
        </label>
        <label className="flex items-center gap-1.5 text-slate-400">
          {zh ? '间距/波长' : 'd/λ'} {dOverLambda.toFixed(2)}
          <input
            type="range" min={0.25} max={1.5} step={0.05} value={dOverLambda}
            onChange={(e) => { const v = Number(e.target.value); setD(v) }}
          />
        </label>
        <label className="flex items-center gap-1.5 text-slate-400">
          {zh ? '指向' : 'Steer'} θ₀ {steer}°
          <input
            type="range" min={-80} max={80} step={1} value={steer}
            onChange={(e) => { const v = Number(e.target.value); setSteer(v) }}
          />
        </label>
        <button
          onClick={() => { setSteer(0); setD(0.5) }}
          className="btn border border-edge text-slate-300"
        >
          {zh ? '复位' : 'Reset'}
        </button>
      </div>

      <canvas
        ref={canvasRef}
        width={W} height={H}
        className="stage mx-auto w-full max-w-3xl"
        style={{ aspectRatio: '640/380' }}
      />

      <div data-phasedarray-readout className="mx-auto mt-4 flex max-w-3xl flex-wrap justify-center gap-x-6 gap-y-1 text-xs font-mono text-slate-400">
        <span>
          {zh ? '主瓣指向' : 'Main beam'}{' '}
          <span className="text-ember">{steer.toFixed(0)}°</span>
        </span>
        <span>
          {zh ? '−3dB 波束宽度' : '−3 dB beamwidth'}{' '}
          <span className="text-glow">{data?.beamwidthDeg.toFixed(1) ?? '—'}°{data?.beamwidthClipped ? (zh ? '（可见区截断）' : ' (clipped to visible range)') : ''}</span>
        </span>
        <span>
          {zh ? '栅瓣' : 'Grating lobes'}{' '}
          {!data ? <span>—</span> : data.grating.length === 0
            ? <span className="text-slate-500">{zh ? '无' : 'none'}</span>
            : <span className="text-[#ff6b6b]">{data.grating.map((a) => a.toFixed(0) + '°').join(', ')}</span>}
        </span>
      </div>

      <p className="note">
        {zh
          ? '归一化阵因子：所有阵元在指向角同相叠加得峰值 1。阵元越多主瓣越窄、增益越高；间距过大时出现栅瓣（红点）——这正是相控阵设计取半波长间距的原因。波束宽度围绕指定扫描角计算；超出 ±90° 可见区时标注截断。阵元闪烁仅表示相对激励相位。'
          : 'Normalized array factor peaks at 1 when all elements are co-phased toward the steer angle. More elements → narrower beam; d too large → grating lobes (red). That is why arrays often use ~λ/2 spacing. Beamwidth follows the requested steering angle and is marked when clipped by the ±90° visible range. Element animation illustrates relative excitation phase.'}
      </p>
    </div>
  )
}

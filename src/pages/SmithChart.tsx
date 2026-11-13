import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { ParamSlider } from '../components/ParamSlider'
import { useLocale } from '../lib/i18n'
import {
  smithResult,
  zFromGamma,
  buildSmithGrid,
  clampGammaToUnitDisk,
  gammaToPixel,
  pixelToGamma,
  type Complex,
  type Point2,
  type SmithGrid,
} from '../lib/sim/smith-chart'

import { useModuleCompute } from '../lib/hooks/useModuleCompute'

const SIZE = 520
const PAD = 28
const R = (SIZE / 2 - PAD)

type Preset = { id: string; label: string; labelEn: string; R: number; X: number }

const PRESETS: Preset[] = [
  { id: 'match', label: '匹配 50Ω', labelEn: 'Match 50Ω', R: 50, X: 0 },
  { id: 'short', label: '短路', labelEn: 'Short', R: 0, X: 0 },
  { id: 'open', label: '近开路', labelEn: 'Near open', R: 5000, X: 0 },
  { id: 'ind', label: '感性 25+j40', labelEn: 'Inductive 25+j40', R: 25, X: 40 },
  { id: 'cap', label: '容性 75−j30', labelEn: 'Capacitive 75−j30', R: 75, X: -30 },
  { id: 'highR', label: '高阻 200Ω', labelEn: 'High-R 200Ω', R: 200, X: 0 },
]

const Z0 = 50

function fmtComplex(z: Complex, digits = 2): string {
  const sign = z.im >= 0 ? '+' : '−'
  return `${z.re.toFixed(digits)} ${sign} j${Math.abs(z.im).toFixed(digits)}`
}

function drawPolyline(
  ctx: CanvasRenderingContext2D,
  pts: Point2[],
  cx: number,
  cy: number,
  radius: number,
  stroke: string,
  lineWidth: number,
) {
  if (pts.length < 2) return
  ctx.strokeStyle = stroke
  ctx.lineWidth = lineWidth
  ctx.beginPath()
  for (let i = 0; i < pts.length; i++) {
    const p = gammaToPixel(pts[i]!, cx, cy, radius)
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  }
  ctx.stroke()
}

/**
 * Interactive Smith chart: drag Γ on the unit disk, tune R/X and line length,
 * read VSWR / return loss. Grid + constant-r highlight + line rotation path.
 */
export function SmithChart() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('smith'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gridRef = useRef<SmithGrid | null>(null)
  if (!gridRef.current) gridRef.current = buildSmithGrid({ nPoints: 120 })

  const [Rload, setRload] = useState(25)
  const [Xload, setXload] = useState(40)
  const [thetaDeg, setThetaDeg] = useState(0) // electrical length βℓ in degrees
  const [showLine, setShowLine] = useState(true)
  const [showG, setShowG] = useState(false)
  const draggingRef = useRef(false)

  const scene = useMemo(() => ({ resistance: Rload, reactance: Xload, thetaDeg }), [Rload, Xload, thetaDeg])
  const compute = useModuleCompute({ module: 'smith', scene })
  const read = useMemo(() => compute.target === 'browser' ? smithResult(scene)
    : compute.result?.module === 'smith' ? compute.result.result : null, [scene, compute.target, compute.result])

  const paint = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const en = !zhRef.current
    const cx = SIZE / 2
    const cy = SIZE / 2
    const grid = gridRef.current!

    ctx.fillStyle = '#05070f'
    ctx.fillRect(0, 0, SIZE, SIZE)

    // soft rim
    ctx.beginPath()
    ctx.arc(cx, cy, R + 4, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(58,214,255,0.12)'
    ctx.lineWidth = 8
    ctx.stroke()

    // resistance circles
    for (const arc of grid.resistance) {
      const stroke =
        arc.r === 0
          ? 'rgba(148,163,184,0.55)'
          : arc.r === 1
            ? 'rgba(124,92,255,0.45)'
            : 'rgba(100,116,139,0.28)'
      drawPolyline(ctx, arc.points, cx, cy, R, stroke, arc.r === 0 ? 1.5 : 1)
    }

    // reactance arcs
    for (const arc of grid.reactance) {
      const stroke =
        arc.x > 0 ? 'rgba(58,214,255,0.22)' : 'rgba(255,138,76,0.22)'
      drawPolyline(ctx, arc.points, cx, cy, R, stroke, 1)
    }

    // outer rim already in resistance r=0; redraw crisp
    drawPolyline(ctx, grid.outer, cx, cy, R, 'rgba(148,163,184,0.7)', 1.6)

    // axes
    ctx.strokeStyle = 'rgba(148,163,184,0.35)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx - R, cy)
    ctx.lineTo(cx + R, cy)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx, cy - R)
    ctx.lineTo(cx, cy + R)
    ctx.stroke()

    if (read) drawPolyline(ctx, read.resistancePath, cx, cy, R, 'rgba(124,92,255,0.75)', 2)

    // optional conductance g=1 circle (match locus for shunt)
    if (showG) {
      const gPts: Point2[] = []
      const gcirc = { cx: -0.5, cy: 0, r: 0.5 } // g=1
      for (let i = 0; i <= 120; i++) {
        const th = (i / 120) * 2 * Math.PI
        const x = gcirc.cx + gcirc.r * Math.cos(th)
        const y = gcirc.cy + gcirc.r * Math.sin(th)
        if (x * x + y * y <= 1 + 1e-9) gPts.push({ x, y })
      }
      drawPolyline(ctx, gPts, cx, cy, R, 'rgba(52,211,153,0.55)', 1.5)
    }

    if (!read) return
    const { theta, gIn, atLoad: { gamma: gLoad } } = read
    if (showLine && Math.abs(theta) > 1e-9) {
      drawPolyline(ctx, read.linePath, cx, cy, R, 'rgba(250,204,21,0.85)', 2)
    }

    // VSWR circle at |Γ_load|
    const mag = read.gammaMag
    if (mag > 1e-6 && mag < 1 - 1e-9) {
      ctx.beginPath()
      ctx.arc(cx, cy, mag * R, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(250,204,21,0.25)'
      ctx.setLineDash([4, 4])
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.setLineDash([])
    }

    // center match mark
    ctx.fillStyle = 'rgba(148,163,184,0.5)'
    ctx.beginPath()
    ctx.arc(cx, cy, 3, 0, Math.PI * 2)
    ctx.fill()

    // load point
    const pL = gammaToPixel(gLoad, cx, cy, R)
    ctx.fillStyle = '#ff8a4c'
    ctx.beginPath()
    ctx.arc(pL.x, pL.y, 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#fff7ed'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // input point (after line)
    if (Math.abs(theta) > 1e-9) {
      const pI = gammaToPixel(gIn, cx, cy, R)
      ctx.fillStyle = '#facc15'
      ctx.beginPath()
      ctx.arc(pI.x, pI.y, 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = '#422006'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    // labels
    ctx.font = '11px sans-serif'
    ctx.fillStyle = '#94a3b8'
    ctx.fillText(en ? 'Open Γ=+1' : '开路 Γ=+1', cx + R - 72, cy - 8)
    ctx.fillText(en ? 'Short Γ=−1' : '短路 Γ=−1', cx - R + 4, cy - 8)
    ctx.fillStyle = 'rgba(58,214,255,0.7)'
    ctx.fillText(en ? '+jX inductive' : '+jX 感性', cx + 8, cy - R + 14)
    ctx.fillStyle = 'rgba(255,138,76,0.75)'
    ctx.fillText(en ? '−jX capacitive' : '−jX 容性', cx + 8, cy + R - 8)

    ctx.fillStyle = '#64748b'
    ctx.font = '10px monospace'
    ctx.fillText('r=1', cx + 0.5 * R - 10, cy + 14)
  }, [showG, showLine, read])

  // paint on param change
  useEffect(() => {
    paint()
  }, [paint, Rload, Xload, thetaDeg, showLine, showG, locale])

  const applyGamma = (gRaw: Complex) => {
    const g = clampGammaToUnitDisk(gRaw)
    const z = zFromGamma(g, Z0)
    setRload(Number.isFinite(z.re) ? Math.max(0, Math.min(5000, z.re)) : 5000)
    setXload(Number.isFinite(z.im) ? Math.max(-2000, Math.min(2000, z.im)) : 0)
  }

  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current
    if (!c) return
    const rect = c.getBoundingClientRect()
    const scaleX = SIZE / rect.width
    const scaleY = SIZE / rect.height
    const px = (e.clientX - rect.left) * scaleX
    const py = (e.clientY - rect.top) * scaleY
    const g = pixelToGamma(px, py, SIZE / 2, SIZE / 2, R)
    // ignore clicks far outside chart
    if (g.re * g.re + g.im * g.im > 1.15) return
    applyGamma(g)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    onPointer(e)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current) return
    onPointer(e)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const applyPreset = (p: Preset) => {
    setRload(p.R)
    setXload(p.X)
  }


  return (
    <div>
      <PageHeader
        icon="◎"
        title="史密斯圆图 · 反射系数"
        titleEn="Smith chart · reflection coefficient"
        subtitle="阻抗 z 经 Γ=(z−1)/(z+1) 折进单位圆盘：恒阻/恒抗变成圆族。拖动圆点或调 R、X，看驻波比与回波损耗；电长度滑条沿 |Γ| 圆顺时针旋转（朝向发生器）。"
        subtitleEn="Impedance z folds into the unit disk via Γ=(z−1)/(z+1): constant-r/x become circle families. Drag the point or tune R,X for VSWR and return loss; electrical length rotates clockwise at fixed |Γ| (toward generator)."
      />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">
          {zh ? '读匹配与反射时' : 'When reading match & reflection'}
        </span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <span className="text-slate-600">
          {zh ? '（悬停看一句人话）' : '(hover for plain language)'}
        </span>
      </p>

      <div className="toolbar mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-xs text-cyan-300">
          {zh ? 'RF · Γ 平面' : 'RF · Γ plane'}
        </span>
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => applyPreset(p)}
            className="btn border border-edge text-slate-300"
          >
            {zh ? p.label : p.labelEn}
          </button>
        ))}
        <label className="ml-1 flex items-center gap-1.5 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={showLine}
            onChange={(e) => setShowLine(e.target.checked)}
          />
          {zh ? '线长轨迹' : 'Line path'}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={showG}
            onChange={(e) => setShowG(e.target.checked)}
          />
          {zh ? 'g=1 导纳圆' : 'g=1 circle'}
        </label>
      </div>

      <div className="toolbar mb-5 flex flex-wrap items-center gap-4">
        <ParamSlider
          label={zh ? '电阻 R' : 'Resistance R'}
          value={Rload}
          min={0}
          max={5000}
          step={0.5}
          unit="Ω"
          format={(v) => v.toFixed(1)}
          onChange={setRload}
        />
        <ParamSlider
          label={zh ? '电抗 X' : 'Reactance X'}
          value={Xload}
          min={-2000}
          max={2000}
          step={0.5}
          unit="Ω"
          format={(v) => v.toFixed(1)}
          onChange={setXload}
        />
        <ParamSlider
          label={zh ? '电长度 βℓ' : 'Elec. length βℓ'}
          value={thetaDeg}
          min={0}
          max={180}
          step={0.5}
          unit="°"
          format={(v) => v.toFixed(1)}
          onChange={setThetaDeg}
        />
      </div>

      <div className="mx-auto flex max-w-5xl flex-wrap items-start justify-center gap-6">
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={zh ? '史密斯圆图交互画布' : 'Interactive Smith chart canvas'}
          className="stage max-w-full cursor-crosshair touch-none"
          style={{ aspectRatio: '1/1', width: 'min(100%, 520px)' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />

        {read && <div data-smith-readout className="min-w-[240px] flex-1 space-y-3 font-mono text-xs text-slate-400">
          <div className="rounded-lg border border-edge bg-black/30 p-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
              {zh ? '参考阻抗' : 'Reference'}
            </div>
            <div>
              Z₀ = <span className="text-slate-200">50</span> Ω
            </div>
          </div>

          <div className="rounded-lg border border-edge bg-black/30 p-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
              {zh ? '负载（橙点）' : 'Load (orange)'}
            </div>
            <div>
              Z_L ={' '}
              <span className="text-[#ff8a4c]">{fmtComplex(read.atLoad.Z)}</span> Ω
            </div>
            <div>
              z = Z/Z₀ ={' '}
              <span className="text-violet-300">
                {fmtComplex(read.atLoad.zNorm)}
              </span>
            </div>
            <div>
              Γ_L ={' '}
              <span className="text-cyan-300">
                {fmtComplex(read.atLoad.gamma, 3)}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-edge bg-black/30 p-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
              {zh
                ? Math.abs(thetaDeg) > 0
                  ? '线输入端（黄点）'
                  : '输入端 = 负载'
                : Math.abs(thetaDeg) > 0
                  ? 'Line input (yellow)'
                  : 'Input = load'}
            </div>
            <div>
              Γ ={' '}
              <span className="text-yellow-300">
                {fmtComplex(read.gIn, 3)}
              </span>
            </div>
            <div>
              |Γ| ={' '}
              <span className="text-yellow-200">
                {read.gammaMag.toFixed(4)}
              </span>
            </div>
            <div>
              ∠Γ ={' '}
              <span className="text-yellow-200">
                {read.gammaPhaseDeg.toFixed(1)}°
              </span>
            </div>
            <div>
              z_in ≈{' '}
              <span className="text-violet-300">
                {read.zNormIn ? fmtComplex(read.zNormIn) : '∞'}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-edge bg-black/30 p-3">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
              {zh ? '匹配指标' : 'Match metrics'}
            </div>
            <div>
              VSWR ={' '}
              <span className="text-emerald-300">
                {read.vswr === null ? '∞' : read.vswr.toFixed(3)}
              </span>
            </div>
            <div>
              {zh ? '回波损耗' : 'Return loss'} ={' '}
              <span className="text-emerald-300">
                {read.returnLossDb === null ? '∞' : `${read.returnLossDb.toFixed(2)} dB`}
              </span>
            </div>
            <div>
              {zh ? '反射功率比' : 'Power |Γ|²'} ={' '}
              <span className="text-rose-300">
                {(read.powerRefl * 100).toFixed(1)}%
              </span>
            </div>
            <div>
              {zh ? '透射功率比' : 'Transmit 1−|Γ|²'} ={' '}
              <span className="text-emerald-300">
                {(read.powerTrans * 100).toFixed(1)}%
              </span>
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500">
            {zh
              ? '紫环：当前恒阻 r 圆。虚线黄圆：恒 |Γ|（驻波比圆）。拖动画布任意处放置负载；电长度 0–180° 对应 λ/2 线长。'
              : 'Violet ring: constant-r for the load. Dashed yellow: constant |Γ| (VSWR circle). Drag on the chart to place the load; 0–180° electrical length is a half-wave span.'}
          </p>
        </div>}
      </div>

      <p className="note mt-6">
        {zh
          ? '模型：归一化阻抗 z=Z/Z₀ 经莫比乌斯变换 Γ=(z−1)/(z+1) 映入单位圆盘（被动负载 |Γ|≤1）。恒 r / 恒 x 为圆；无损线朝向发生器旋转 Γ→Γ e^{−j2βℓ}，|Γ| 不变。VSWR=(1+|Γ|)/(1−|Γ|)，回波损耗 −20log₁₀|Γ|。核心几何与逆变换已单测覆盖。灵感：Arena Physica Smith chart 教学文。'
          : 'Model: normalized z=Z/Z₀ maps by Möbius Γ=(z−1)/(z+1) into the unit disk (passive |Γ|≤1). Constant r/x are circles; a lossless line rotates Γ→Γ e^{−j2βℓ} toward the generator at fixed |Γ|. VSWR=(1+|Γ|)/(1−|Γ|), return loss −20log₁₀|Γ|. Geometry and inverse covered by unit tests. Inspired by Arena Physica’s Smith chart essay.'}
      </p>
    </div>
  )
}

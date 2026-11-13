import { useRef, useState, useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { PlayPauseButton } from '../components/PlayPauseButton'
import { ParamSlider } from '../components/ParamSlider'
import { SpeedControl } from '../components/SpeedControl'
import { faradayResult, FARADAY_SAMPLES as BUF } from '../lib/sim/faraday'
import { WasmFaraday } from '../lib/sim/wasm-fields'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { usePlayController, useRafLoop, useRunning, useSyncedParam } from '../lib/hooks'
import { useLocale } from '../lib/i18n'

const W = 720, H = 420
const TWO_PI = 2 * Math.PI

/**
 * 组装：法拉第定律可视化（纯过程）+ 播放端口 + rAF 环 + 线圈参数端口。
 * 物理只在 lib/sim/faraday；本页只嵌套「何时推进 t / 如何画」。
 */
export function Faraday() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('faraday'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scanRef = useRef(0)
  const [scanIndex, setScanIndex] = useState(0)
  const lastRef = useRef(0)

  const { running, runningRef, toggle, setRunning } = useRunning(true)
  // 旋转线圈参数（ref 供动画循环读取，value 供 UI）
  const omega = useSyncedParam(TWO_PI * 2) // 角速度 ω（rad/s），默认 2 Hz
  const B = useSyncedParam(0.3)            // 磁感应强度 B（T）
  const N = useSyncedParam(200)            // 匝数 N
  const A = useSyncedParam(0.01)           // 单匝面积 A（m²）
  const play = usePlayController(1)

  const vBar = useSyncedParam(2)   // 棒速 v（m/s）
  const bMot = useSyncedParam(0.5) // 动生模式磁感应强度（T）
  const lBar = useSyncedParam(0.2) // 棒长 L（m）

  const scene = useMemo(() => ({ omega: omega.value, B: B.value, N: N.value, A: A.value,
    vBar: vBar.value, bMot: bMot.value, lBar: lBar.value }), [omega.value, B.value, N.value, A.value, vBar.value, bMot.value, lBar.value])
  const compute = useModuleCompute({ module: 'faraday', scene })
  const owner = useRef<WasmFaraday | null>(null)
  const preview = useMemo(() => {
    if (compute.snapshot) return { data: compute.result?.module === 'faraday' ? compute.result.result : null, error: '' }
    try {
      owner.current ??= new WasmFaraday()
      return { data: faradayResult(scene, owner.current), error: '' }
    } catch (error) { return { data: null, error: error instanceof Error ? error.message : String(error) } }
  }, [scene, compute.snapshot, compute.result])
  const read = preview.data
  const renderRef = useRef({ read, snapshot: compute.snapshot })
  renderRef.current = { read, snapshot: compute.snapshot }

  useRafLoop(() => {
    const now = performance.now()
    if (!lastRef.current) lastRef.current = now
    const elapsed = Math.min(0.05, (now - lastRef.current) / 1000)
    lastRef.current = now

    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)
    const { read, snapshot } = renderRef.current
    if (!read) return
    if (runningRef.current && !snapshot) {
      scanRef.current = (scanRef.current + elapsed * play.playRef.current * (BUF - 1) / (2 * read.period)) % (BUF - 1)
    }
    const si = Math.min(BUF - 1, Math.floor(scanRef.current))
    setScanIndex(si)

    // ===== 左侧：匀强磁场中的旋转线圈 =====
    const cx = 150, cy = 150, R = 100
    // 磁场区域 + 磁感线（向右）
    ctx.strokeStyle = 'rgba(58,214,255,0.18)'; ctx.lineWidth = 1
    for (let fy = 40; fy <= 260; fy += 28) {
      ctx.beginPath(); ctx.moveTo(40, fy); ctx.lineTo(260, fy); ctx.stroke()
      ctx.fillStyle = 'rgba(58,214,255,0.5)'
      ctx.beginPath(); ctx.moveTo(260, fy); ctx.lineTo(253, fy - 4); ctx.lineTo(253, fy + 4); ctx.closePath(); ctx.fill()
    }
    ctx.fillStyle = 'rgba(58,214,255,0.6)'; ctx.font = '12px sans-serif'
    ctx.fillText(`B = ${B.ref.current.toFixed(2)} T  →`, 44, 32)

    // 线圈：以椭圆模拟绕轴旋转的投影（宽度随 cos(ωt) 收缩）
    const proj = read.flux[si] / read.linkage
    ctx.save()
    ctx.translate(cx, cy)
    ctx.strokeStyle = '#7c5cff'; ctx.lineWidth = 3
    ctx.beginPath()
    ctx.ellipse(0, 0, Math.max(2, Math.abs(proj) * R), R, 0, 0, Math.PI * 2)
    ctx.stroke()
    // 法线箭头（指示线圈朝向），亮度随 |cos| 表示磁通强弱
    const nLen = R * 0.9 * proj
    ctx.strokeStyle = `rgba(255,138,76,${0.4 + 0.6 * Math.abs(proj)})`; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(nLen, 0); ctx.stroke()
    ctx.restore()
    const en = !zhRef.current
    ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif'
    ctx.fillText(
      en
        ? 'Rotating coil (normal projection ∝ cos θ)'
        : '旋转线圈（法线投影随转角余弦变化）',
      44,
      280,
    )

    // 旋转方向小圆点
    const dotX = cx + Math.abs(proj) * R * Math.sign(proj || 1)
    ctx.fillStyle = '#ff8a4c'
    ctx.beginPath(); ctx.arc(dotX, cy - R * (read.emf[si] / read.peak), 5, 0, Math.PI * 2); ctx.fill()

    // ===== 右侧：Φ(t) 与 ε(t) 走纸示波器（相差 90°）=====
    const sx0 = 300, sw = W - sx0 - 16, sy0 = 30, sh = 250
    const midY = sy0 + sh / 2
    // 网格 + 零线
    ctx.strokeStyle = 'rgba(120,140,180,0.10)'; ctx.lineWidth = 1
    for (let gy = sy0; gy <= sy0 + sh; gy += sh / 4) { ctx.beginPath(); ctx.moveTo(sx0, gy); ctx.lineTo(sx0 + sw, gy); ctx.stroke() }
    ctx.strokeStyle = 'rgba(148,163,184,0.3)'; ctx.setLineDash([4, 4])
    ctx.beginPath(); ctx.moveTo(sx0, midY); ctx.lineTo(sx0 + sw, midY); ctx.stroke(); ctx.setLineDash([])

    const plot = (buf: number[], peak: number, color: string) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath()
      for (let i = 0; i < buf.length; i++) {
        const x = sx0 + (i / (BUF - 1)) * sw
        const y = midY - (buf[i] / peak) * (sh / 2 - 8)
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
      }
      ctx.stroke()
    }
    plot(read.flux, read.linkage, '#3ad6ff') // 磁通 Φ（青）
    plot(read.emf, read.peak, '#ff8a4c')  // 感应 EMF ε（橙）

    ctx.font = '12px sans-serif'
    ctx.fillStyle = '#3ad6ff'
    ctx.fillText(en ? 'Flux linkage NΦ (cosine)' : '磁链 NΦ（余弦）', sx0 + 6, sy0 + 16)
    ctx.fillStyle = '#ff8a4c'
    ctx.fillText(
      en ? 'Induced EMF ε (sine, 90° lag)' : '感应电动势（正弦，差 90°）',
      sx0 + 6,
      sy0 + 34,
    )
    ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif'
    ctx.fillText(
      en ? 'Two periods; curves 90° apart' : '显示两个周期；两曲线相差 90°',
      sx0 + 6,
      sy0 + sh + 16,
    )

    const cursorX = sx0 + si / (BUF - 1) * sw
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(cursorX, sy0); ctx.lineTo(cursorX, sy0 + sh); ctx.stroke()
  }, [])

  const reset = () => { scanRef.current = 0; setScanIndex(0) }

  return (
    <div>
      <PageHeader
        icon="🧲"
        title="电磁感应 · 法拉第"
        subtitle="变化的磁通会在闭合回路中激起感应电动势，感应电流总反抗磁通的变化（楞次定律）。匀强磁场中匀速旋转的线圈，磁通与感应电动势相位相差四分之一周期——这正是交流发电机的原理。拖动转速、磁场、匝数与面积，看峰值电动势如何缩放；也可切到动生模式看导体棒切割磁感线。"
      />

      {preview.error && <p role="alert" className="mb-4 text-rose-300">{preview.error}</p>}

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
          {zh ? '法拉第 · 楞次 · 交流发电' : 'Faraday · Lenz · AC generation'}
        </span>
        <PlayPauseButton running={running} onToggle={toggle} />
        <button type="button" onClick={reset} className="btn border border-edge text-slate-300">
          {zh ? '↺ 复位' : '↺ Reset'}
        </button>
        <SpeedControl value={play.playSpeed} onChange={play.setPlaySpeed} />
        <ParamSlider
          label={zh ? '转速' : 'Spin rate'}
          value={omega.value}
          min={0.2 * TWO_PI}
          max={10 * TWO_PI}
          step={0.1 * TWO_PI}
          unit="Hz"
          format={(v) => (v / TWO_PI).toFixed(1)}
          onChange={omega.set}
        />
        <ParamSlider
          label={zh ? '磁场' : 'B field'}
          value={B.value}
          min={0.05}
          max={1}
          step={0.01}
          unit="T"
          format={(v) => v.toFixed(2)}
          onChange={B.set}
        />
        <ParamSlider
          label={zh ? '匝数' : 'Turns N'}
          value={N.value}
          min={10}
          max={500}
          step={10}
          onChange={N.set}
        />
        <ParamSlider
          label={zh ? '面积' : 'Area'}
          value={A.value}
          min={0.001}
          max={0.05}
          step={0.001}
          unit="cm²"
          format={(v) => (v * 1e4).toFixed(0)}
          onChange={A.set}
        />
      </div>

      <label className="toolbar mb-3">
        {zh ? '读图位置' : 'Read position'}
        <input aria-label="faraday cursor" type="range" min={0} max={BUF - 1} step={1} value={scanIndex}
          onChange={e => { const i = Number(e.target.value); scanRef.current = i; setScanIndex(i); setRunning(false) }} />
      </label>
      <canvas
        ref={canvasRef}
        width={W} height={H}
        role="img"
        aria-label={zh ? '电磁感应法拉第模拟画布' : 'Faraday induction canvas'}
        className="stage mx-auto w-full max-w-3xl"
        style={{ aspectRatio: '720/420' }}
      />

      {read && <div data-faraday-readout className="mx-auto mt-3 flex max-w-3xl flex-wrap justify-center gap-6 font-mono text-xs text-slate-400">
        <span>
          {zh ? '峰值电动势' : 'Peak EMF'}{' '}
          <span className="text-[#ff8a4c]">{read.peak.toFixed(2)}</span> V
        </span>
        <span>
          {zh ? '磁链幅值' : 'Flux linkage'}{' '}
          <span className="text-[#3ad6ff]">{read.linkage.toFixed(3)}</span> Wb
        </span>
        <span>
          {zh ? '频率' : 'Frequency'}{' '}
          <span className="text-[#7c5cff]">{read.frequency.toFixed(2)}</span> Hz
        </span>
      </div>}

      {/* —— 动生电动势演示 —— */}
      <div className="mx-auto mt-6 max-w-3xl rounded-lg border border-edge p-4">
        <div className="mb-3 text-sm text-slate-300">
          {zh
            ? '⚙️ 动生电动势演示：导体棒切割磁感线，电动势 = 磁场 × 棒长 × 速度'
            : '⚙️ Motional EMF: rod cutting field lines; ε = B · ℓ · v'}
        </div>
        <div className="toolbar">
          <ParamSlider
            label={zh ? '棒速' : 'Rod speed'}
            value={vBar.value}
            min={0}
            max={10}
            step={0.1}
            unit="m/s"
            format={(v) => v.toFixed(1)}
            onChange={vBar.set}
          />
          <ParamSlider
            label={zh ? '磁场' : 'B field'}
            value={bMot.value}
            min={0.05}
            max={2}
            step={0.05}
            unit="T"
            format={(v) => v.toFixed(2)}
            onChange={bMot.set}
          />
          <ParamSlider
            label={zh ? '棒长' : 'Rod length'}
            value={lBar.value}
            min={0.05}
            max={1}
            step={0.01}
            unit="m"
            format={(v) => v.toFixed(2)}
            onChange={lBar.set}
          />
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-6 font-mono text-xs text-slate-400">
          <span>
            {zh ? '动生电动势' : 'Motional EMF'}{' '}
            <span className="text-[#ff8a4c]">{read?.motionalEmf.toFixed(3) ?? '—'}</span> V
          </span>
          <span className="text-slate-600">
            {zh
              ? '电动势线性正比于棒速：棒静止则为零'
              : 'EMF ∝ rod speed; zero when the rod is still'}
          </span>
        </div>
      </div>

      <p className="note">
        {zh
          ? '法拉第电磁感应定律：闭合回路的感应电动势等于其磁链变化率的负值；负号（楞次定律）表明感应电流的磁效应总是反抗引起它的磁通变化。匀强磁场中匀速旋转的线圈，磁通按余弦变化，感应电动势按正弦变化，二者相差 90°，峰值由匝数、磁场、面积与转速决定——这就是交流发电机输出正弦电压的来历。动生电动势是同一定律的运动观点表述。核心算法已测试验证（恒定磁通零电动势、线性磁通常值电动势、楞次负号、旋转正弦幅值、解析与数值差分对拍、动生线性于棒速）。'
          : 'Faraday’s law: loop EMF equals the negative rate of change of flux linkage; the minus (Lenz) means induced currents oppose the change that produces them. A coil spinning at constant rate in uniform B has cosine flux and sine EMF, 90° apart; peak scales with N, B, A, and ω—the origin of AC generator sine waves. Motional EMF is the same law in a moving-frame form. Core algorithm is tested (zero EMF for constant flux, Lenz sign, rotating sine amplitude, analytic vs numeric, ε ∝ v).'}
      </p>
    </div>
  )
}

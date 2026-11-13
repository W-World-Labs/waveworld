import { WasmAntenna } from '../lib/sim/wasm-fields'
import { useRunning } from '../lib/hooks/useRunning'
import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useEffect, useRef, useState, useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { antennaLinkResult, type AntennaType } from '../lib/sim/antennalink'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useLocale } from '../lib/i18n'

const W = 660
const H = 380
const DEG = Math.PI / 180

const TYPES: { key: AntennaType; label: string; labelEn: string }[] = [
  { key: 'isotropic', label: '各向同性', labelEn: 'Isotropic' },
  { key: 'dipole', label: '半波偶极子', labelEn: 'Half-wave dipole' },
  { key: 'directional', label: '定向天线', labelEn: 'Directional' },
]

export function AntennaPattern() {
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('antennapattern'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [type, setType] = useState<AntennaType>('dipole')
  const [ptDbm, setPt] = useState(20)
  const [gtDbi, setGt] = useState(6)
  const [grDbi, setGr] = useState(6)
  const [freqGHz, setFreq] = useState(2.4)
  const [distM, setDist] = useState(100)

  const params = useMemo(() => ({ type, ptDbm, gtDbi, grDbi, frequencyHz: freqGHz * 1e9, distM }), [type, ptDbm, gtDbi, grDbi, freqGHz, distM])
  const compute = useModuleCompute({ module: 'antennapattern', params })
  const kernelRef = useRef<WasmAntenna | null>(null)
  const { runningRef } = useRunning()
  const preview = useMemo(() => {
    if (compute.snapshot) return { data: compute.result?.module === 'antennapattern' ? compute.result.result : null, error: '' }
    try {
      kernelRef.current ??= new WasmAntenna('antennapattern')
      return { data: antennaLinkResult(params, kernelRef.current), error: '' }
    } catch (error) { return { data: null, error: error instanceof Error ? error.message : String(error) } }
  }, [params, compute.snapshot, compute.result])
  const data = preview.data
  const renderRef = useRef({ data, distM, snapshot: compute.snapshot })
  renderRef.current = { data, distM, snapshot: compute.snapshot }

  useEffect(() => {
    let disposed = false
    let t = 0

    const loop = () => {
      if (disposed) return
      const c = canvasRef.current
      if (!c) { return }
      const ctx = c.getContext('2d')!
      const { data, distM: dCur } = renderRef.current

      ctx.fillStyle = '#05070f'
      ctx.fillRect(0, 0, W, H)
      if (!data) return

      // ── 左：极坐标方向图 ──
      const ox = 165
      const oy = H / 2
      const R = 145
      // 同心圆栅格
      ctx.strokeStyle = 'rgba(120,140,180,0.14)'
      ctx.lineWidth = 1
      for (const frac of [0.25, 0.5, 0.75, 1]) {
        ctx.beginPath()
        ctx.arc(ox, oy, R * frac, 0, 2 * Math.PI)
        ctx.stroke()
      }
      // 角度辐条
      ctx.fillStyle = '#64748b'
      ctx.font = '10px monospace'
      for (let a = 0; a < 360; a += 30) {
        const ang = a * DEG
        ctx.strokeStyle = 'rgba(120,140,180,0.08)'
        ctx.beginPath()
        ctx.moveTo(ox, oy)
        ctx.lineTo(ox + R * Math.cos(ang), oy - R * Math.sin(ang))
        ctx.stroke()
      }

      // 方向图曲线：屏幕角 φ（0..2π）对应天线极角 θ。
      // dipole/isotropic 关于天线轴对称；directional 主瓣朝屏幕右方(φ=0)。
      ctx.strokeStyle = '#3ad6ff'
      ctx.lineWidth = 2
      ctx.beginPath()
      const N = 361
      for (let i = 0; i < N; i++) {
        const phi = (2 * Math.PI * i) / (N - 1)
        const amp = data.pattern[i]
        const r = R * amp
        const lx = ox + r * Math.cos(phi)
        const ly = oy - r * Math.sin(phi)
        i ? ctx.lineTo(lx, ly) : ctx.moveTo(lx, ly)
      }
      ctx.closePath()
      ctx.stroke()
      ctx.fillStyle = 'rgba(58,214,255,0.08)'
      ctx.fill()

      // 主瓣指向线（屏幕右方 φ=0）+ 旋转脉冲点示意辐射
      ctx.strokeStyle = '#ff8a4c'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(ox, oy)
      ctx.lineTo(ox + R, oy)
      ctx.stroke()
      ctx.setLineDash([])

      // 沿曲线扫动的发光点（动画）
      const pphi = (t % (2 * Math.PI))
      const pr = R * data.pattern[Math.round(pphi / (2 * Math.PI) * 360)]
      ctx.beginPath()
      ctx.arc(ox + pr * Math.cos(pphi), oy - pr * Math.sin(pphi), 4, 0, 7)
      ctx.fillStyle = '#7c5cff'
      ctx.fill()

      const en = !zhRef.current
      ctx.fillStyle = '#94a3b8'
      ctx.font = '12px monospace'
      ctx.fillText(en ? 'Normalized pattern |F(θ)|' : '归一化方向图 |F(θ)|', 24, 28)
      ctx.fillStyle = '#ff8a4c'
      ctx.fillText(en ? 'Boresight θ=0' : '主轴 θ=0', ox + R - 70, oy - 8)

      // ── 右：距离-Pr 曲线 ──
      const gx0 = 360
      const gy0 = 60
      const gw = 280
      const gh = 260
      ctx.strokeStyle = 'rgba(120,140,180,0.18)'
      ctx.lineWidth = 1
      ctx.strokeRect(gx0, gy0, gw, gh)
      ctx.fillStyle = '#94a3b8'
      ctx.font = '12px monospace'
      ctx.fillText(
        en ? 'Range → received power (dBm)' : '距离 → 接收功率 (dBm)',
        gx0,
        gy0 - 12,
      )

      // 对数距离轴 1m..100km，Pr 轴自适应
      const dMin = 1
      const dMax = 1e5
      const lgMin = Math.log10(dMin)
      const lgMax = Math.log10(dMax)
      // Pr 范围
      const prMax = data.powersDbm[0]
      const prMin = data.powersDbm[120]
      const xOf = (d: number) => gx0 + (gw * (Math.log10(d) - lgMin)) / (lgMax - lgMin)
      const yOf = (pr: number) =>
        gy0 + gh - (gh * (pr - prMin)) / (prMax - prMin || 1)

      // 灵敏度参考线 -90 dBm
      const sens = -90
      if (sens > prMin && sens < prMax) {
        ctx.strokeStyle = 'rgba(255,138,76,0.4)'
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(gx0, yOf(sens))
        ctx.lineTo(gx0 + gw, yOf(sens))
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(255,138,76,0.7)'
        ctx.font = '10px monospace'
        ctx.fillText(en ? '−90 dBm sensitivity' : '−90 dBm 灵敏度', gx0 + 4, yOf(sens) - 4)
      }

      // 曲线
      ctx.strokeStyle = '#3ad6ff'
      ctx.lineWidth = 2
      ctx.beginPath()
      const M = 120
      for (let i = 0; i <= M; i++) {
        const lg = lgMin + ((lgMax - lgMin) * i) / M
        const d = Math.pow(10, lg)
        const x = xOf(d)
        const y = yOf(data.powersDbm[i])
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
      }
      ctx.stroke()

      // 当前工作点
      const cx = xOf(dCur)
      const cy = yOf(data.link.prDbm)
      ctx.strokeStyle = 'rgba(124,92,255,0.5)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cx, gy0)
      ctx.lineTo(cx, gy0 + gh)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, cy, 5, 0, 7)
      ctx.fillStyle = '#7c5cff'
      ctx.fill()

      // 轴刻度
      ctx.fillStyle = '#64748b'
      ctx.font = '10px monospace'
      for (const d of [1, 10, 100, 1000, 10000, 100000]) {
        const x = xOf(d)
        const lbl = d >= 1000 ? d / 1000 + 'k' : '' + d
        ctx.fillText(lbl, x - 6, gy0 + gh + 14)
      }

      if (!renderRef.current.snapshot && runningRef.current) t += 0.06
    }
    const stopLoop = startLoop(loop)
    return () => { disposed = true; stopLoop() }
  }, [])

  return (
    <div>
      <PageHeader
        icon="📶"
        title="天线方向图 · 链路预算"
        subtitle="不同天线类型的辐射方向图（极坐标）：各向同性恒为 1、半波偶极子赤道面最强、定向天线主瓣集中。右侧做自由空间链路预算：距离每增 10 倍，路径损耗大约多 20 分贝。"
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
        {TYPES.map((tp) => (
          <button
            key={tp.key}
            onClick={() => { setType(tp.key) }}
            className={
              'btn border border-edge ' +
              (type === tp.key ? 'text-glow' : 'text-slate-300')
            }
          >
            {zh ? tp.label : tp.labelEn}
          </button>
        ))}
        <span className="mx-1 text-edge">|</span>
        <label className="flex items-center gap-1.5 text-slate-400">
          Pt {ptDbm}dBm
          <input
            type="range" min={0} max={46} step={1} value={ptDbm}
            onChange={(e) => { const v = Number(e.target.value); setPt(v) }}
          />
        </label>
        <label className="flex items-center gap-1.5 text-slate-400">
          Gt {gtDbi}dBi
          <input
            type="range" min={0} max={30} step={1} value={gtDbi}
            onChange={(e) => { const v = Number(e.target.value); setGt(v) }}
          />
        </label>
        <label className="flex items-center gap-1.5 text-slate-400">
          Gr {grDbi}dBi
          <input
            type="range" min={0} max={30} step={1} value={grDbi}
            onChange={(e) => { const v = Number(e.target.value); setGr(v) }}
          />
        </label>
        <label className="flex items-center gap-1.5 text-slate-400">
          {zh ? '频率' : 'Freq'} {freqGHz.toFixed(1)}GHz
          <input
            type="range" min={0.1} max={28} step={0.1} value={freqGHz}
            onChange={(e) => { const v = Number(e.target.value); setFreq(v) }}
          />
        </label>
        <label className="flex items-center gap-1.5 text-slate-400">
          {zh ? '距离' : 'Range'}{' '}
          {distM < 1000 ? distM + 'm' : (distM / 1000).toFixed(1) + 'km'}
          <input
            type="range" min={1} max={20000} step={1} value={distM}
            onChange={(e) => { const v = Number(e.target.value); setDist(v) }}
          />
        </label>
      </div>

      <canvas
        ref={canvasRef}
        width={W} height={H}
        className="stage mx-auto w-full max-w-3xl"
        style={{ aspectRatio: '660/380' }}
      />

      <div data-antenna-readout className="mx-auto mt-4 flex max-w-3xl flex-wrap justify-center gap-x-6 gap-y-1 text-xs font-mono text-slate-400">
        <span>
          {zh ? '方向性' : 'Directivity'}{' '}
          <span className="text-glow">{data?.directivityDb.toFixed(2) ?? '—'} dBi</span>
        </span>
        <span>
          {zh ? '−3dB 波束宽度' : '−3 dB beamwidth'}{' '}
          <span className="text-ember">
            {!data ? '—' : data.beamwidthDeg >= 360 ? (zh ? '全向' : 'omni') : data.beamwidthDeg.toFixed(1) + '°'}
          </span>
        </span>
        <span>
          {zh ? '自由空间路径损耗' : 'FSPL'}{' '}
          <span className="text-glow">{data?.link.fsplDb.toFixed(1) ?? '—'} dB</span>
        </span>
        <span>
          {zh ? '接收功率' : 'Pr'}{' '}
          <span className="text-[#7c5cff]">{data?.link.prDbm.toFixed(1) ?? '—'} dBm</span>
        </span>
      </div>

      <p className="note">
        {zh
          ? '辐射方向图描述天线各方向的相对场强：各向同性为理想点源(0 dBi)；半波偶极子在垂直于轴的平面最强、轴向为零点(约 2.15 dBi)；定向天线把能量压进窄主瓣，方向性越高波束越窄。链路侧自由空间路径损耗随距离与频率按对数增长；接收功率 = 发射功率 + 发/收增益 − 路径损耗：距离或频率每升 10 倍，路径损耗各增 20 dB。核心算法已测试验证。'
          : 'Radiation patterns map relative field vs angle: isotropic is an ideal point source (0 dBi); half-wave dipoles peak broadside and null on axis (~2.15 dBi); directive antennas pack energy into a narrow main lobe. Free-space path loss grows log-linearly with range and frequency; Pr = Pt + Gt + Gr − FSPL, +20 dB FSPL per decade of distance or frequency. Core algorithm is tested.'}
      </p>
    </div>
  )
}

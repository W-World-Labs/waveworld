import { useEffect, useRef, useState, useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { ANTENNAS, wavelength, quarterWave, fmt, type AntennaType } from '../lib/sim/antennatypes'
import { pickLocaleString, useLocale } from '../lib/i18n'

const W = 640, H = 300
// 对数频率滑块：0..1000 → 10kHz..30GHz
const LO = Math.log10(1e4), HI = Math.log10(30e9)
const sliderToF = (s: number) => 10 ** (LO + (s / 1000) * (HI - LO))
const fToSlider = (f: number) => ((Math.log10(f) - LO) / (HI - LO)) * 1000
const fmtFreq = (f: number) => (f >= 1e9 ? `${(f / 1e9).toFixed(2)} GHz` : f >= 1e6 ? `${(f / 1e6).toFixed(2)} MHz` : `${(f / 1e3).toFixed(0)} kHz`)

export function AntennaCatalog() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const pageTerms = useMemo(() => termIdsForSimPath('antennas'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [f, setF] = useState(2.45e9) // 默认 2.4G
  const lam = wavelength(f), q = quarterWave(f)

  useEffect(() => {
    const c = canvasRef.current; if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)
    const human = 1.7 // m
    const groundY = H - 24
    const view = Math.max(q, human, 0.05) * 1.15
    const scale = (H - 60) / view // px per meter
    // 地面
    ctx.strokeStyle = '#1c2438'; ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(W, groundY); ctx.stroke()
    // 人形参考（1.7m）
    const hx = 140, hpx = human * scale
    ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(hx, groundY - hpx * 0.92, Math.max(2, hpx * 0.08), 0, 7); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(hx, groundY - hpx * 0.84); ctx.lineTo(hx, groundY - hpx * 0.3)
    ctx.moveTo(hx, groundY - hpx * 0.3); ctx.lineTo(hx - hpx * 0.12, groundY)
    ctx.moveTo(hx, groundY - hpx * 0.3); ctx.lineTo(hx + hpx * 0.12, groundY)
    ctx.moveTo(hx - hpx * 0.14, groundY - hpx * 0.62); ctx.lineTo(hx + hpx * 0.14, groundY - hpx * 0.62); ctx.stroke()
    ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif'
    ctx.fillText(zh ? '人 1.7m' : 'Human 1.7m', hx - 18, groundY + 16)
    // 天线 ¼ 波（按比例，超界裁剪并标注）
    const ax = 380, apx = Math.min(H - 50, q * scale)
    const clipped = q * scale > H - 50
    ctx.strokeStyle = '#7c5cff'; ctx.lineWidth = 4
    ctx.beginPath(); ctx.moveTo(ax, groundY); ctx.lineTo(ax, groundY - apx); ctx.stroke()
    if (clipped) {
      ctx.fillStyle = '#7c5cff'
      ctx.fillText(zh ? '↑ 继续向上' : '↑ continues', ax - 20, groundY - apx + 4)
    }
    ctx.fillStyle = '#a78bfa'; ctx.font = '12px sans-serif'
    ctx.fillText(`${zh ? '¼ 波天线' : 'λ/4 monopole'} ${fmt(q)}`, ax - 30, groundY + 16)
    ctx.fillStyle = '#cbd5e1'; ctx.font = '13px sans-serif'
    ctx.fillText(`${fmtFreq(f)} · λ=${fmt(lam)}`, 16, 22)
  }, [f, lam, q, zh])

  const pick = (a: AntennaType) => setF(a.fMHz * 1e6)

  return (
    <div>
      <PageHeader
        icon="📡"
        title="天线图鉴 · 尺寸随频率"
        subtitle="天线尺寸由波长决定，通常取四分之一或半波长谐振。频率越低波长越长、天线越大——调频广播约 0.75 米，中波广播可到几十米（故改用磁棒环/长线），而 2.4G 无线只需几厘米。拖动频率或点选下方天线。"
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
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '频率' : 'Frequency'}{' '}
          <span className="font-mono text-glow">{fmtFreq(f)}</span>
          <input type="range" min={0} max={1000} step={1} value={fToSlider(f)} onChange={(e) => setF(sliderToF(Number(e.target.value)))} className="w-48" />
        </label>
        <span className="font-mono text-xs text-slate-400">
          {zh ? '波长' : 'λ'}={fmt(lam)} · {zh ? '¼波长' : 'λ/4'}={fmt(q)} · {zh ? '½波长' : 'λ/2'}={fmt(lam / 2)}
        </span>
      </div>

      <canvas ref={canvasRef} width={W} height={H} className="stage mx-auto w-full max-w-3xl" style={{ aspectRatio: `${W}/${H}` }} />

      <h3 className="mb-3 mt-6 text-center text-sm font-semibold text-slate-300">
        {zh
          ? '常用天线一览（频率由低到高 · 尺寸由大到小）'
          : 'Common antennas (low→high f · large→small size)'}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ANTENNAS.map((a) => {
          const aq = quarterWave(a.fMHz * 1e6)
          const sel = Math.abs(a.fMHz * 1e6 - f) / f < 0.02
          return (
            <button key={a.id} onClick={() => pick(a)}
              className={`card p-4 text-left transition hover:border-wave/60 ${sel ? 'border-wave' : ''}`}>
              <div className="mb-1 flex items-center gap-2">
                <span className="font-semibold text-white">
                  {pickLocaleString(a.name, a.nameEn, locale)}
                </span>
                <span className="ml-auto rounded bg-edge/60 px-1.5 py-0.5 font-mono text-[10px] text-glow">{a.gainDbi} dBi</span>
              </div>
              <div className="mb-1 text-xs text-slate-400">
                {pickLocaleString(a.band, a.bandEn, locale)}
              </div>
              <div className="mb-2 flex flex-wrap gap-x-3 font-mono text-[11px] text-slate-300">
                <span>{zh ? '波长' : 'λ'} {fmt(wavelength(a.fMHz * 1e6))}</span>
                <span className="text-wave">{zh ? '¼波长' : 'λ/4'} {fmt(aq)}</span>
              </div>
              <div className="mb-1 text-xs text-slate-400">
                {pickLocaleString(a.type, a.typeEn, locale)}
              </div>
              <div className="text-[11px] text-slate-500">
                {pickLocaleString(a.use, a.useEn, locale)}
              </div>
            </button>
          )
        })}
      </div>

      <p className="note">
        {zh
          ? '谐振天线长度正比波长（四分之一波长单极 / 半波长偶极）。低频天线巨大（中波与甚低频用磁棒环、长线、巨型塔阵规避），高频天线微小（2.4/5.8 GHz 做进电路板或陶瓷贴片）。相控阵则用大量微型振子电子扫描（见「相控阵波束成形」）。核心算法已测试验证。'
          : 'Resonant length scales with λ (λ/4 monopole / λ/2 dipole). Low-f antennas are huge (loops, long-wires, tower arrays); high-f ones fit on PCBs or ceramic patches. Phased arrays steer many mini elements electronically. Core algorithm is tested.'}
      </p>
    </div>
  )
}

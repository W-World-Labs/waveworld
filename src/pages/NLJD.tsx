import { WasmNljd } from '../lib/sim/wasm-fields'
import { useRunning } from '../lib/hooks/useRunning'
import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useEffect, useRef, useState, useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { nljdResult, type JunctionKind } from '../lib/sim/nljd'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useLocale } from '../lib/i18n'

const W = 640, H = 380

const KINDS: { id: JunctionKind; label: string; labelEn: string; emoji: string }[] = [
  { id: 'semiconductor', label: '电子器件（半导体结）', labelEn: 'Electronics (semiconductor)', emoji: '📟' },
  { id: 'corrosion', label: '锈蚀假结（MOM）', labelEn: 'Corrosion false junction', emoji: '🧱' },
  { id: 'metal', label: '纯金属（线性）', labelEn: 'Metal (linear)', emoji: '🔩' },
]

const VERDICT: Record<JunctionKind, { text: string; textEn: string; color: string }> = {
  semiconductor: { text: '半导体结模型（2f 占优）', textEn: 'Semiconductor model (2f dominant)', color: '#3ad6ff' },
  corrosion: { text: '锈蚀结模型（3f 占优）', textEn: 'Corrosion model (3f)', color: '#ff8a4c' },
  metal: { text: '线性模型（仅 1f）', textEn: 'Linear model (1f only)', color: '#94a3b8' },
}

export function NLJD() {
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('nljd'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const kindRef = useRef<JunctionKind>('semiconductor')
  const freqRef = useRef(8)
  const [kind, setKind] = useState<JunctionKind>('semiconductor')
  const [freq, setFreq] = useState(8)
  const compute = useModuleCompute({ module: 'nljd', kind })
  const kernelRef = useRef<WasmNljd | null>(null)
  const { runningRef } = useRunning()
  const preview = useMemo(() => {
    if (compute.snapshot) return { data: compute.result?.module === 'nljd' ? compute.result.result : null, error: '' }
    try {
      kernelRef.current ??= new WasmNljd()
      return { data: nljdResult(kind, kernelRef.current), error: '' }
    } catch (error) { return { data: null, error: error instanceof Error ? error.message : String(error) } }
  }, [kind, compute.snapshot, compute.result])
  const data = preview.data
  const renderRef = useRef({ data, snapshot: compute.snapshot })
  renderRef.current = { data, snapshot: compute.snapshot }

  useEffect(() => {
    let disposed = false, t = 0

    const loop = () => {
      if (disposed) return
      const c = canvasRef.current!; const ctx = c.getContext('2d')!
      ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)

      const kd = kindRef.current
      const f = freqRef.current
      const { data, snapshot } = renderRef.current
      if (!data) return
      const { coefficients: { a2, a3 }, relative: h, verdict } = data
      const en = !zhRef.current

      // —— 左：发射机 → 隐藏目标（非线性结）——
      const emX = 70, tgX = 250, midY = 110
      // 入射单频波束 f
      ctx.strokeStyle = 'rgba(124,92,255,0.85)'; ctx.lineWidth = 2; ctx.beginPath()
      for (let x = emX; x <= tgX; x += 2) {
        const ph = (x - emX) * (f / 30) - t * 0.15
        const y = midY - 14 + 10 * Math.sin(ph)
        x === emX ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke()
      // 反辐射谐波（颜色随判别）
      ctx.strokeStyle = VERDICT[verdict].color; ctx.lineWidth = 2; ctx.globalAlpha = 0.8
      const hk = verdict === 'corrosion' ? 3 : verdict === 'semiconductor' ? 2 : 1
      ctx.beginPath()
      for (let x = tgX; x >= emX; x -= 2) {
        const ph = (tgX - x) * (f * hk / 30) + t * 0.15
        const y = midY + 16 + 8 * Math.sin(ph)
        x === tgX ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.stroke(); ctx.globalAlpha = 1

      // 发射/接收天线
      ctx.fillStyle = '#7c5cff'; ctx.fillRect(emX - 18, midY - 30, 8, 60)
      ctx.fillStyle = '#cbd5e1'; ctx.font = '11px sans-serif'
      ctx.fillText(
        en ? 'NLJD TX / RX' : '非线性结探测 发射/接收',
        emX - 40,
        midY + 48,
      )
      ctx.fillText(en ? 'Tone f →' : '单频 f →', emX + 30, midY - 28)
      ctx.fillText(en ? '← Harmonic echo' : '← 谐波回波', emX + 30, midY + 40)

      // 隐藏目标（藏在墙里）
      ctx.fillStyle = '#101626'; ctx.fillRect(tgX, 40, 120, 140)
      ctx.strokeStyle = '#1e2942'; ctx.strokeRect(tgX, 40, 120, 140)
      ctx.fillStyle = '#64748b'
      ctx.fillText(en ? 'Hidden target behind wall' : '墙体后的隐藏目标', tgX + 6, 56)
      const ko = KINDS.find(k => k.id === kd)!
      ctx.font = '28px sans-serif'; ctx.fillText(ko.emoji, tgX + 44, midY + 8)
      ctx.font = '11px sans-serif'; ctx.fillStyle = '#94a3b8'
      ctx.fillText(
        en
          ? `2nd ${a2.toFixed(2)} · 3rd ${a3.toFixed(2)}`
          : `二次 ${a2.toFixed(2)} · 三次 ${a3.toFixed(2)}`,
        tgX + 12,
        midY + 50,
      )

      // —— 右上：传输特性曲线 y = v + a2 v² + a3 v³ ——
      const tpX = 430, tpY = 110, tpW = 170, tpH = 120
      ctx.strokeStyle = 'rgba(120,140,180,0.18)'
      ctx.beginPath(); ctx.moveTo(tpX, tpY); ctx.lineTo(tpX + tpW, tpY); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(tpX + tpW / 2, tpY - tpH / 2); ctx.lineTo(tpX + tpW / 2, tpY + tpH / 2); ctx.stroke()
      ctx.strokeStyle = '#7c5cff'; ctx.lineWidth = 1.6; ctx.beginPath()
      for (let i = 0; i <= 80; i++) {
        const o = data.transfer[i]
        const px = tpX + (i / 80) * tpW
        const py = tpY - o * 26
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
      }
      ctx.stroke()
      ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif'
      ctx.fillText(
        en ? 'Transfer (2nd/3rd nonlinear)' : '传输特性（含二次/三次非线性）',
        tpX,
        tpY - tpH / 2 - 8,
      )

      // —— 下：接收谐波频谱（柱状图 1f / 2f / 3f）——
      const specY = 350, specX = 70, barW = 130, gap = 60
      const bars = [
        { lab: en ? '1f' : '基频', v: h.f1, col: '#7c5cff' },
        { lab: en ? '2f' : '二次', v: h.f2, col: '#3ad6ff' },
        { lab: en ? '3f' : '三次', v: h.f3, col: '#ff8a4c' },
      ]
      ctx.strokeStyle = 'rgba(120,140,180,0.18)'; ctx.beginPath()
      ctx.moveTo(specX - 10, specY); ctx.lineTo(specX + 3 * (barW + gap), specY); ctx.stroke()
      ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif'
      ctx.fillText(
        en ? 'Received harmonic spectrum (relative)' : '接收谐波频谱（相对幅度）',
        specX - 10,
        specY - 130,
      )
      bars.forEach((b, i) => {
        const bx = specX + i * (barW + gap)
        const bh = Math.max(1, b.v * 110)
        ctx.fillStyle = b.col
        ctx.fillRect(bx, specY - bh, barW, bh)
        ctx.fillStyle = '#e2e8f0'; ctx.font = '12px sans-serif'
        ctx.fillText(b.lab, bx + barW / 2 - 8, specY + 16)
        ctx.fillStyle = '#cbd5e1'; ctx.font = '11px monospace'
        ctx.fillText(b.v.toFixed(2), bx + barW / 2 - 12, specY - bh - 6)
      })

      // 判读标签
      ctx.fillStyle = VERDICT[verdict].color; ctx.font = 'bold 13px sans-serif'
      const vText = en ? VERDICT[verdict].textEn : VERDICT[verdict].text
      ctx.fillText((en ? 'Verdict: ' : '判读：') + vText, specX + 3 * (barW + gap) - 250, specY - 110)

      if (runningRef.current && !snapshot) t += 1
    }
    const stopLoop = startLoop(loop)
    return () => { disposed = true; stopLoop() }
  }, [])

  return (
    <div>
      <PageHeader
        icon="🔎"
        title="非线性结探测"
        subtitle="发射单频照射目标：半导体结（真电子器件）因强非线性再辐射二次谐波；锈蚀假结往往三次谐波更强；纯线性金属只回基频。本页用三类预设非线性系数展示谐波差异与模型分类。"
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


      {preview.error && <p role="alert" className="mb-3 text-sm text-rose-300">{preview.error}</p>}
      <div className="toolbar mb-5">
        <span className="rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs text-violet-300">
          {zh ? '谐波再辐射 · 二次/三次判别' : 'Harmonic re-radiation · 2f/3f class'}
        </span>
        {KINDS.map(k => (
          <button
            key={k.id}
            onClick={() => { setKind(k.id); kindRef.current = k.id }}
            className={'btn border border-edge ' + (kind === k.id ? 'text-white bg-white/10' : 'text-slate-300')}
          >
            {k.emoji} {zh ? k.label : k.labelEn}
          </button>
        ))}
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '示意波形密度' : 'Illustration wave density'} {freq}
          <input type="range" min={4} max={14} step={1} value={freq} onChange={(e) => { const v = Number(e.target.value); setFreq(v); freqRef.current = v }} />
        </label>
      </div>

      <canvas ref={canvasRef} width={W} height={H} className="stage mx-auto w-full max-w-3xl" style={{ aspectRatio: '640/380' }} />

      <div data-nljd-readout className="mx-auto mt-3 flex max-w-3xl flex-wrap justify-center gap-6 font-mono text-xs text-slate-400">
        <span>{zh ? '基频' : '1f'} <span className="text-[#7c5cff]">{data?.relative.f1.toFixed(2) ?? '—'}</span></span>
        <span>{zh ? '二次' : '2f'} <span className="text-[#3ad6ff]">{data?.relative.f2.toFixed(2) ?? '—'}</span></span>
        <span>{zh ? '三次' : '3f'} <span className="text-[#ff8a4c]">{data?.relative.f3.toFixed(2) ?? '—'}</span></span>
        <span>
          {zh ? '判读' : 'Verdict'}{' '}
          <span style={{ color: data ? VERDICT[data.verdict].color : '#94a3b8' }}>
            {!data ? '—' : zh ? VERDICT[data.verdict].text : VERDICT[data.verdict].textEn}
          </span>
        </span>
      </div>

      <p className="note">
        {zh
          ? '非线性目标在单频照射下会再辐射谐波：二次项主导时二次谐波强（半导体结），三次项主导时三次谐波强（锈蚀金属–氧化物–金属假结），线性金属几乎只回基频。此处是预设三次多项式的教学模型，分类仅反映预设系数，不是实测识别结果；模型没有频率响应，波形密度仅控制示意动画。'
          : 'Nonlinear targets re-radiate harmonics under single-tone illumination: 2f-dominant → semiconductor; 3f-dominant → corrosion MOM; linear metal returns mostly 1f. This preset cubic teaching model classifies its coefficients, not measured targets. It has no frequency response; wave density only changes the illustration.'}
      </p>
    </div>
  )
}

import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useEffect, useRef, useState, useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { bioPipelineResult, type BioPipelineScene, BIO_SAMPLE_RATE as FS, BIO_SAMPLES as N, BIO_NOTCH_HZ as F0, BIO_SMOOTH_WINDOW as SMOOTH_WIN, BIO_GAIN as GAIN } from '../lib/sim/biodsp'
import { useLocale } from '../lib/i18n'

import { useModuleCompute } from '../lib/hooks/useModuleCompute'

const W = 720, H = 420
type Source = BioPipelineScene['source']

interface Stage {
  key: string
  label: string
  labelEn: string
  detail: string
  detailEn: string
  color: string
}

const STAGES: Stage[] = [
  { key: 'raw', label: '原始信号', labelEn: 'Raw signal', detail: '电极拾取 · 含工频/基线', detailEn: 'Electrode · mains/baseline', color: '#94a3b8' },
  { key: 'amp', label: `幅度增益 ×${GAIN}`, labelEn: `Amplitude ×${GAIN}`, detail: '逐点乘以固定增益', detailEn: 'Multiply samples by gain', color: '#ff8a4c' },
  { key: 'dc', label: '去基线', labelEn: 'De-baseline', detail: 'removeDC · 均值→0', detailEn: 'removeDC · mean→0', color: '#7c5cff' },
  { key: 'bp', label: `低通平滑 win=${SMOOTH_WIN}`, labelEn: `Smooth win=${SMOOTH_WIN}`, detail: 'movingAverage · 抑高频', detailEn: 'movingAverage · HF down', color: '#3ad6ff' },
  { key: 'notch', label: `工频陷波 ${F0}Hz`, labelEn: `Mains notch ${F0}Hz`, detail: 'notch · 二阶 IIR', detailEn: 'notch · 2nd-order IIR', color: '#4ade80' },
]

export function BioPipeline() {
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('biopipeline'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [src, setSrc] = useState<Source>('ECG')
  const [seed, setSeed] = useState(987654321)
  const scene = useMemo(() => ({ source: src, seed }), [src, seed])
  const compute = useModuleCompute({ module: 'biopipeline', scene })
  const data = useMemo(() => compute.target === 'browser' ? bioPipelineResult(scene)
    : compute.result?.module === 'biopipeline' ? compute.result.result : null, [scene, compute.target, compute.result])
  const renderRef = useRef(data); renderRef.current = data
  const read = data ? { dc: data.rawMean, rawAmp: data.rawPeak, outAmp: data.finalPeak } : null

  useEffect(() => {
    let disposed = false
    const loop = () => {
      if (disposed) return
      const c = canvasRef.current!; const ctx = c.getContext('2d')!
      ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)
      const data = renderRef.current
      if (!data) return
      const { series } = data

      const rows = STAGES.length
      const rowH = H / rows
      const padX = 132 // 左侧框区
      const plotX = padX + 8
      const plotW = W - plotX - 14
      const en = !zhRef.current

      for (let r = 0; r < rows; r++) {
        const st = STAGES[r]
        const data = series[r]
        const cy = r * rowH + rowH / 2

        // 行分隔淡线
        ctx.strokeStyle = 'rgba(120,140,180,0.10)'
        ctx.beginPath(); ctx.moveTo(0, r * rowH); ctx.lineTo(W, r * rowH); ctx.stroke()

        // 左侧处理级方框
        ctx.strokeStyle = st.color
        ctx.lineWidth = 1.4
        ctx.strokeRect(10, r * rowH + 10, padX - 24, rowH - 20)
        ctx.fillStyle = st.color
        ctx.font = '12px sans-serif'
        ctx.fillText(en ? st.labelEn : st.label, 20, r * rowH + 30)
        ctx.fillStyle = '#64748b'
        ctx.font = '10px sans-serif'
        ctx.fillText(en ? st.detailEn : st.detail, 20, r * rowH + 46)

        // 流向箭头（指向波形区）
        ctx.strokeStyle = 'rgba(124,92,255,0.5)'
        ctx.beginPath()
        ctx.moveTo(padX - 12, cy); ctx.lineTo(plotX - 2, cy)
        ctx.moveTo(plotX - 8, cy - 4); ctx.lineTo(plotX - 2, cy)
        ctx.lineTo(plotX - 8, cy + 4)
        ctx.stroke()

        // 波形基线
        ctx.strokeStyle = 'rgba(120,140,180,0.14)'
        ctx.beginPath(); ctx.moveTo(plotX, cy); ctx.lineTo(plotX + plotW, cy); ctx.stroke()

        // 自适应纵向缩放（按该级幅度归一）
        let amp = 1e-9
        for (let i = 0; i < data.length; i++) amp = Math.max(amp, Math.abs(data[i]))
        const scale = (rowH * 0.36) / amp

        ctx.strokeStyle = st.color
        ctx.lineWidth = 1.6
        ctx.shadowColor = st.color
        ctx.shadowBlur = 4
        ctx.beginPath()
        for (let i = 0; i < N; i++) {
          const x = plotX + (i / (N - 1)) * plotW
          const y = cy - data[i] * scale
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.shadowBlur = 0

        // 扫描光点
        ctx.fillStyle = st.color
        const tipY = cy - data[N - 1] * scale
        ctx.beginPath(); ctx.arc(plotX + plotW, tipY, 2.6, 0, Math.PI * 2); ctx.fill()
      }


    }
    const stopLoop = startLoop(loop)
    return () => { disposed = true; stopLoop() }
  }, [])

  const pick = (s: Source) => setSrc(s)

  return (
    <div data-sim-stage="biopipeline">
      <PageHeader
        icon="🔗"
        title="生物电信号链路"
        subtitle="从皮肤电极拾取的心电/肌电/脑电极其微弱，且混入基线漂移、工频干扰和宽带噪声。要看到干净波形，需经标准采集链路：幅度增益 → 去基线 → 低通平滑 → 工频陷波 → 数字化显示。本页展示固定种子的 600 点信号片段，逐级流过各处理框，对比每一级把信号「修」成什么样。"
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
          {zh ? `采集链路 · ${FS}Hz · 生物电` : `Acquisition chain · ${FS}Hz · bio`}
        </span>
        <span className="text-slate-400">{zh ? '信号源' : 'Source'}</span>
        <button onClick={() => pick('ECG')} className={`btn border border-edge ${src === 'ECG' ? 'text-white' : 'text-slate-300'}`}>
          {zh ? '心电' : 'ECG'}
        </button>
        <button onClick={() => pick('EMG')} className={`btn border border-edge ${src === 'EMG' ? 'text-white' : 'text-slate-300'}`}>
          {zh ? '肌电' : 'EMG'}
        </button>
        <button onClick={() => pick('EEG')} className={`btn border border-edge ${src === 'EEG' ? 'text-white' : 'text-slate-300'}`}>
          {zh ? '脑电' : 'EEG'}
        </button>
      </div>

      <button className="btn mb-3 border border-edge" onClick={() => setSeed(s => (s + 1) >>> 0)}>{zh ? '重新采样' : 'Resample'}</button>
      <canvas ref={canvasRef} width={W} height={H} className="stage mx-auto w-full max-w-3xl" style={{ aspectRatio: '720/420' }} />

      {read && <div data-biopipeline-readout className="mx-auto mt-3 flex max-w-3xl flex-wrap justify-center gap-6 font-mono text-xs text-slate-400">
        <span>{zh ? '增益' : 'Gain'} <span className="text-[#ff8a4c]">×{GAIN}</span></span>
        <span>{zh ? '平滑窗' : 'Smooth'} <span className="text-[#3ad6ff]">{SMOOTH_WIN}</span></span>
        <span>{zh ? '陷波' : 'Notch'} <span className="text-[#4ade80]">{F0}</span> Hz</span>
        <span>{zh ? '原始直流' : 'Raw DC'} <span className="text-[#7c5cff]">{read.dc.toFixed(3)}</span></span>
        <span>{zh ? '原始峰值' : 'Raw peak'} <span className="text-slate-300">{read.rawAmp.toFixed(3)}</span></span>
        <span>{zh ? '末级峰值' : 'Final peak'} <span className="text-[#4ade80]">{read.outAmp.toFixed(2)}</span></span>
      </div>}

      <p className="note">
        {zh
          ? `每一行是链路中的一级：左侧方框标注该级处理与关键数值，右侧走纸式波形展示该级输出（各级纵轴自适应归一，便于比较形态而非绝对幅度）。可以观察到原始信号上密集的 ${F0}Hz 工频纹波在「工频陷波」级后被显著抹平，基线偏置在「去基线」级后被拉回中线。核心算法已测试验证（removeDC 后均值≈0、movingAverage 降低方差、notch 使 ${F0}Hz 处能量下降到 1/10 以下且基本保留邻近主信号）。`
          : `Each row is one chain stage: left box labels processing, right strip chart shows that stage’s output (per-row y-scale). Dense ${F0} Hz mains ripple is wiped by the notch stage; baseline bias is pulled to zero by de-baseline. Core DSP is tested (removeDC mean≈0, MA variance down, notch cuts ${F0} Hz energy by 10× while keeping nearby signal).`}
      </p>
    </div>
  )
}

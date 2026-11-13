import { useRunning } from '../lib/hooks/useRunning'
import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useEffect, useRef, useState, useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { BANDS, EEG_STATES as STATES, eegResult } from '../lib/sim/eeg'
import { useLocale } from '../lib/i18n'

import { useModuleCompute } from '../lib/hooks/useModuleCompute'

const W = 640
const H = 380
const NCH = 4 // 通道数（多导联脑电走纸）
const BUF = 360 // 每通道 ring buffer 长度（走纸宽度）

const BAND_COLORS: Record<string, string> = {
  delta: '#ff8a4c',
  theta: '#ffd166',
  alpha: '#3ad6ff',
  beta: '#7c5cff',
  gamma: '#ff5ca8',
}

export function EEG() {
  const { runningRef, setRunning } = useRunning()
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('eeg'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState(0)
  const [noise, setNoise] = useState(0.25)
  const [seed, setSeed] = useState(7), [samples, setSamples] = useState(1024)
  const [scanIndex, setScanIndex] = useState(0)
  const scanRef = useRef(0)
  const scene = useMemo(() => ({ state, noise, seed, samples }), [state, noise, seed, samples])
  const compute = useModuleCompute({ module: 'eeg', scene })
  const data = useMemo(() => compute.target === 'browser' ? eegResult(scene)
    : compute.result?.module === 'eeg' ? compute.result.result : null, [scene, compute.target, compute.result])
  const renderRef = useRef({ data, target: compute.target })
  renderRef.current = { data, target: compute.target }
  const readout = data ? { name: zh ? STATES[data.stateIndex].name : STATES[data.stateIndex].nameEn,
    dom: data.dominant, amp: Math.max(...data.channels[0].slice(Math.max(0, scanIndex - 63), scanIndex + 1).map(Math.abs)) } : null

  useEffect(() => {
    let disposed = false, last = performance.now()
    const loop = () => {
      if (disposed) return
      const now = performance.now(), elapsed = Math.min(0.05, (now - last) / 1000); last = now
      const c = canvasRef.current
      if (!c) return
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)
      const { data, target } = renderRef.current
      if (!data) return
      if (runningRef.current && target === 'browser') scanRef.current += elapsed * data.sampleRate
      scanRef.current = Math.min(scanRef.current, data.channels[0].length - 1)
      const si = Math.floor(scanRef.current); setScanIndex(si)
      if (si === data.channels[0].length - 1 && runningRef.current) setRunning(false)
      const bufs = data.channels.map(values => values.slice(Math.max(0, si - BUF + 1), si + 1))

      // 走纸区域
      const padL = 56
      const padR = 12
      const plotW = W - padL - padR
      const topY = 30
      const traceH = 56 // 每通道高度
      const gap = 8

      // 淡网格（时间刻度，每 ~0.5s 一条）
      ctx.strokeStyle = 'rgba(120,140,180,0.08)'
      ctx.lineWidth = 1
      for (let g = 0; g <= 8; g++) {
        const x = padL + (g / 8) * plotW
        ctx.beginPath()
        ctx.moveTo(x, topY - 6)
        ctx.lineTo(x, topY + NCH * (traceH + gap))
        ctx.stroke()
      }

      // —— 各通道走纸波形 ——
      const chLabels = ['Fp1', 'C3', 'P3', 'O1']
      for (let ch = 0; ch < NCH; ch++) {
        const baseY = topY + ch * (traceH + gap) + traceH / 2
        const buf = bufs[ch]
        // 基线
        ctx.strokeStyle = 'rgba(120,140,180,0.18)'
        ctx.beginPath()
        ctx.moveTo(padL, baseY)
        ctx.lineTo(padL + plotW, baseY)
        ctx.stroke()
        // 标签
        ctx.fillStyle = '#94a3b8'
        ctx.font = '11px sans-serif'
        ctx.fillText(chLabels[ch], 10, baseY + 4)
        // 波形
        const scale = traceH / 2 / 3.2 // |信号|≈3 时占满半高
        ctx.strokeStyle = ch % 2 === 0 ? '#3ad6ff' : '#7c5cff'
        ctx.lineWidth = 1.3
        ctx.beginPath()
        for (let i = 0; i < buf.length; i++) {
          const x = padL + (i / (BUF - 1)) * plotW
          const y = baseY - buf[i] * scale
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
        }
        ctx.stroke()
      }
      // 走纸方向提示
      const en = !zhRef.current
      ctx.fillStyle = '#64748b'
      ctx.font = '10px sans-serif'
      ctx.fillText(
        en
          ? '← older                    strip (256 samples/s)                    newer →'
          : '← 旧                    走纸（256 次/秒）                    新 →',
        padL,
        topY + NCH * (traceH + gap) + 14,
      )

      // —— 右下：五频带功率条 δθαβγ ——
      const pw = data.power
      const barX = padL
      const barY = topY + NCH * (traceH + gap) + 26
      const barAreaW = plotW
      const bw = barAreaW / (BANDS.length * 1.6)
      const maxBarH = H - barY - 16
      let maxP = 1e-6
      for (const b of BANDS) maxP = Math.max(maxP, pw[b.name])
      BANDS.forEach((b, i) => {
        const h = (pw[b.name] / maxP) * maxBarH
        const x = barX + i * bw * 1.6 + bw * 0.3
        ctx.fillStyle = BAND_COLORS[b.name]
        ctx.fillRect(x, barY + maxBarH - h, bw, h)
        ctx.fillStyle = '#cbd5e1'
        ctx.font = '11px sans-serif'
        const sym = ['δ', 'θ', 'α', 'β', 'γ'][i]
        ctx.fillText(`${sym} ${b.freq}Hz`, x - 2, barY + maxBarH + 13)
        ctx.fillStyle = '#94a3b8'
        ctx.font = '10px sans-serif'
        ctx.fillText(`${(pw[b.name] * 100).toFixed(0)}%`, x, barY + maxBarH - h - 4)
      })


    }
    const stopLoop = startLoop(loop)
    return () => {
      disposed = true
      stopLoop()
    }
  }, [])

  return (
    <div>
      <PageHeader
        icon="🧠"
        title="脑电节律"
        subtitle="头皮电极记录到的脑电，是千万个皮层神经元同步放电叠加出的微弱电位。习惯上按频率拆成五个节律：深睡 δ、困倦 θ、放松闭眼 α、清醒专注 β、高级认知 γ。每个频带用一个正弦建模，按意识状态调权重再叠噪声——拖动滑块在清醒与睡眠之间切换，看主导节律如何滑动。"
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
          {zh ? '状态：' : 'State: '}
          <span className="text-violet-200">{readout?.name ?? '—'}</span>
        </span>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '意识状态 清醒' : 'Arousal awake'}
          <input
            type="range"
            min={0}
            max={3}
            step={0.01}
            value={state}
            onChange={(e) => {
              const v = Number(e.target.value)
              setState(v)
            }}
          />
          {zh ? '睡眠' : 'sleep'}
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '噪声' : 'Noise'}={noise.toFixed(2)}
          <input
            type="range"
            min={0}
            max={0.8}
            step={0.02}
            value={noise}
            onChange={(e) => {
              const v = Number(e.target.value)
              setNoise(v)
            }}
          />
        </label>
        <div className="flex gap-1">
          {STATES.map((s, i) => (
            <button
              key={s.name}
              className="btn border border-edge text-slate-300"
              onClick={() => {
                setState(i)
              }}
            >
              {zh ? s.name : s.nameEn}
            </button>
          ))}
        </div>
      </div>

      <div className="toolbar mb-3">
        <button className="btn border border-edge" onClick={() => setSeed(s => (s + 1) >>> 0)}>{zh ? '重新采样' : 'Resample'}</button>
        <label>{zh ? '采样点数' : 'Samples'}
          <input aria-label="EEG samples" type="number" min={8} max={2000} value={samples}
            onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 8 && n <= 2000) { setSamples(n); scanRef.current = 0; setScanIndex(0) } }} />
        </label>
        <label>{zh ? '读图位置' : 'Read position'}
          <input aria-label="EEG cursor" type="range" min={0} max={samples - 1} step={1} value={scanIndex}
            onChange={e => { const i = Number(e.target.value); scanRef.current = i; setScanIndex(i); setRunning(false) }} />
        </label>
      </div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        role="img"
        aria-label={zh ? '脑电模拟画布' : 'EEG canvas'}
        className="stage mx-auto w-full max-w-3xl"
        style={{ aspectRatio: '640/380' }}
      />

      {readout && <div data-eeg-readout className="mx-auto mt-3 flex max-w-3xl flex-wrap justify-center gap-x-6 gap-y-1 font-mono text-xs text-slate-400">
        <span>
          {zh ? '当前状态' : 'State'}{' '}
          <span className="text-violet-300">{readout?.name ?? '—'}</span>
        </span>
        <span>
          {zh ? '设定主导节律' : 'Preset dominant band'}{' '}
          <span style={{ color: BAND_COLORS[readout.dom] ?? '#cbd5e1' }}>
            {readout.dom || '—'}
          </span>
        </span>
        <span>
          Fp1 {zh ? '幅度' : 'amp'}{' '}
          <span className="text-sky-300">{readout.amp.toFixed(2)} μV</span>
        </span>
      </div>}

      <p className="note">
        {zh
          ? '合成信号为各频带加权正弦叠加再加噪声；功率条按设定振幅平方归一化，不是对合成波形做频谱估计。清醒态 β 占主导、波形快而碎；放松闭眼 α（约 10 Hz）涌现；越接近睡眠，慢波 θ/δ 逐渐压过一切——这正是真实多导联睡眠分期所依据的频谱迁移。核心算法已测试验证。'
          : 'Synthetic EEG is weighted band sines plus noise; power bars normalize preset amplitude squared, without estimating a spectrum from the samples. Awake: β-dominant fast traces; eyes-closed α (~10 Hz) emerges; toward sleep, θ/δ slow waves dominate—the spectral shift used in sleep staging. Core algorithm is tested.'}
      </p>
    </div>
  )
}

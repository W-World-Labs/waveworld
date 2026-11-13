import { useRunning } from '../lib/hooks/useRunning'
import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useEffect, useRef, useState, useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { emgResult } from '../lib/sim/emg'
import { useLocale } from '../lib/i18n'

import { useModuleCompute } from '../lib/hooks/useModuleCompute'

const W = 640
const H = 380
const TRACE = 480 // 走纸波形可见样本数（ring buffer 长度）
export function EMG() {
  const { runningRef, setRunning } = useRunning()
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('emg'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 主动肌「用力」与拮抗肌「共激活」强度
  const [agonist, setAgonist] = useState(0.5)
  const [antag, setAntag] = useState(0.15)
  const [seed, setSeed] = useState(0x1234abcd), [samples, setSamples] = useState(960)
  const [scanIndex, setScanIndex] = useState(0)
  const scanRef = useRef(0)
  const scene = useMemo(() => ({ agonist, antag, seed, samples }), [agonist, antag, seed, samples])
  const compute = useModuleCompute({ module: 'emg', scene })
  const data = useMemo(() => compute.target === 'browser' ? emgResult(scene)
    : compute.result?.module === 'emg' ? compute.result.result : null, [scene, compute.target, compute.result])
  const renderRef = useRef({ data, target: compute.target })
  renderRef.current = { data, target: compute.target }
  const readout = data ? { rmsA: data.rms[0][scanIndex], rmsB: data.rms[1][scanIndex], baseline: data.baselineRms,
    peak: Math.max(...data.channels[0].slice(Math.max(0, scanIndex - 7), scanIndex + 1).map(Math.abs)) } : null

  useEffect(() => {
    let disposed = false, last = performance.now()
    const plotX = 36
    const plotW = W - plotX - 16
    const cyA = 110 // 主动肌通道中线
    const cyB = 250 // 拮抗肌通道中线
    const chanH = 95 // 单通道半高（幅度满量程像素）
    const AMP_FS = 1.0 // 信号满量程（绘图归一）

    const drawChannel = (
      ctx: CanvasRenderingContext2D,
      buf: number[],
      cy: number,
      color: string,
      label: string,
      rms: number,
    ) => {
      // 中线
      ctx.strokeStyle = '#1b2438'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(plotX, cy)
      ctx.lineTo(plotX + plotW, cy)
      ctx.stroke()
      // 走纸波形（毛刺干涉模式）
      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.beginPath()
      const n = buf.length
      for (let i = 0; i < n; i++) {
        const x = plotX + (i / (TRACE - 1)) * plotW
        const y = cy - (buf[i] / AMP_FS) * chanH
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
      }
      ctx.stroke()
      // RMS 包络（整流后的幅度带，上下对称）
      const env = Math.min(1, rms / AMP_FS) * chanH
      ctx.fillStyle = color.replace(')', ',0.16)').replace('rgb', 'rgba')
      ctx.fillRect(plotX, cy - env, plotW, env * 2)
      ctx.strokeStyle = color.replace(')', ',0.55)').replace('rgb', 'rgba')
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(plotX, cy - env)
      ctx.lineTo(plotX + plotW, cy - env)
      ctx.moveTo(plotX, cy + env)
      ctx.lineTo(plotX + plotW, cy + env)
      ctx.stroke()
      ctx.setLineDash([])
      // 标签 + RMS 读数
      ctx.fillStyle = '#94a3b8'
      ctx.font = '11px sans-serif'
      ctx.fillText(label, plotX, cy - chanH - 8)
      ctx.fillStyle = color
      ctx.font = '11px monospace'
      ctx.fillText(`RMS=${rms.toFixed(3)}`, plotX + plotW - 96, cy - chanH - 8)
    }

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
      const [bufA, bufB] = data.channels.map(values => values.slice(Math.max(0, si - TRACE + 1), si + 1))
      const rmsA = data.rms[0][si], rmsB = data.rms[1][si]
      ctx.strokeStyle = 'rgba(124,92,255,0.06)'
      ctx.lineWidth = 1
      for (let gx = plotX; gx <= plotX + plotW; gx += 48) {
        ctx.beginPath()
        ctx.moveTo(gx, 24)
        ctx.lineTo(gx, H - 18)
        ctx.stroke()
      }

      // 两通道走纸
      const en = !zhRef.current
      drawChannel(
        ctx,
        bufA,
        cyA,
        'rgb(58,214,255)',
        en ? 'Agonist · effort channel' : '主动肌（agonist）· 用力通道',
        rmsA,
      )
      drawChannel(
        ctx,
        bufB,
        cyB,
        'rgb(255,138,76)',
        en ? 'Antagonist · co-activation' : '拮抗肌（antagonist）· 共激活通道',
        rmsB,
      )

      // 底部走纸方向提示
      ctx.fillStyle = '#475569'
      ctx.font = '10px sans-serif'
      ctx.fillText(en ? '← strip chart (time)' : '← 走纸方向（时间）', plotX, H - 6)


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
        icon="💪"
        title="肌电图"
        subtitle="肌肉收缩时，成百上千个运动单元各自发放动作电位，经皮肤电极叠加成高频、随机的毛刺信号——表面肌电的干涉模式。用力越大，被募集的单元越多、放电越快，幅度越高；静息时只剩基线噪声。整流平滑后的包络幅度正比于收缩强度，是假肢与人机接口的核心控制特征。"
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
        <span className="rounded-full bg-cyan-500/15 px-2.5 py-0.5 text-xs text-cyan-300">
          {zh
            ? '运动单元募集 · 干涉模式 · RMS 包络'
            : 'Motor-unit recruitment · interference · RMS envelope'}
        </span>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '主动肌用力' : 'Agonist effort'} ={(agonist * 100).toFixed(0)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={agonist}
            onChange={(e) => {
              const v = Number(e.target.value)
              setAgonist(v)
            }}
          />
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '拮抗肌共激活' : 'Antagonist co-act'} ={(antag * 100).toFixed(0)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={antag}
            onChange={(e) => {
              const v = Number(e.target.value)
              setAntag(v)
            }}
          />
        </label>
        <button
          className="btn border border-edge text-slate-300"
          onClick={() => {
            setAgonist(0)
            setAntag(0)
          }}
        >
          {zh ? '完全放松（静息）' : 'Full rest'}
        </button>
      </div>

      <div className="toolbar mb-3">
        <button className="btn border border-edge" onClick={() => setSeed(s => (s + 1) >>> 0)}>{zh ? '重新采样' : 'Resample'}</button>
        <label>{zh ? '采样点数' : 'Samples'}
          <input aria-label="EMG samples" type="number" min={8} max={2000} value={samples}
            onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 8 && n <= 2000) { setSamples(n); scanRef.current = 0; setScanIndex(0) } }} />
        </label>
        <label>{zh ? '读图位置' : 'Read position'}
          <input aria-label="EMG cursor" type="range" min={0} max={samples - 1} step={1} value={scanIndex}
            onChange={e => { const i = Number(e.target.value); scanRef.current = i; setScanIndex(i); setRunning(false) }} />
        </label>
      </div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        role="img"
        aria-label={zh ? '肌电图模拟画布' : 'EMG canvas'}
        className="stage mx-auto w-full max-w-3xl"
        style={{ aspectRatio: '640/380' }}
      />

      {readout && <div data-emg-readout className="mx-auto mt-3 flex max-w-3xl flex-wrap justify-center gap-x-6 gap-y-1 font-mono text-xs text-slate-400">
        <span>
          {zh ? '主动肌均方根' : 'Agonist RMS'}{' '}
          <span className="text-cyan-300">{readout.rmsA.toFixed(3)}</span>
        </span>
        <span>
          {zh ? '拮抗肌均方根' : 'Antagonist RMS'}{' '}
          <span className="text-orange-300">{readout.rmsB.toFixed(3)}</span>
        </span>
        <span>
          {zh ? '最近 8 点峰值' : 'Last 8 sample peak'}{' '}
          <span className="text-violet-300">{readout.peak.toFixed(3)}</span>
        </span>
        <span>
          {zh ? '静息基线均方根' : 'Rest baseline RMS'} ≈{' '}
          <span className="text-slate-300">{readout.baseline.toFixed(3)}</span>
        </span>
      </div>}

      <p className="note">
        {zh
          ? '按固定种子合成两通道有限片段，播放只读取返回样本；64 点滑窗均方根给出包络（半透明带 + 虚线）。拉高「主动肌用力」可见爆发幅度与均方根同步增大，点「完全放松」则回落到电极基线噪声。信号合成、均方根单调性与静息基线均由核心算法已测试验证。'
          : 'A seeded, finite two-channel segment is sampled at 512 Hz; playback reads returned samples and 64-sample sliding RMS draws envelopes (band + dashed). Raise agonist effort to grow bursts with RMS; Full rest falls to electrode baseline. Synthesis, RMS monotonicity, and baseline are tested.'}
      </p>
    </div>
  )
}

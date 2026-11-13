import { useEffect, useRef, useState, useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { termIdsForSimPath } from '../lib/termGlossary'
import { PlayPauseButton } from '../components/PlayPauseButton'
import { ParamSlider } from '../components/ParamSlider'
import { neuronResult, RESTING, NEURON_PULSE_STEPS } from '../lib/sim/neuron'
import { useRafLoop, useRunning, useSyncedParam } from '../lib/hooks'
import { useLocale } from '../lib/i18n'

import { useModuleCompute } from '../lib/hooks/useModuleCompute'

const W = 720, H = 420
const BUF = 360

// 轴突一维传导：若干隔室，前一隔室进入尖峰相位后耦合点燃下一隔室
const AXON_N = 22

/**
 * 组装：fhnStep（纯过程）+ 运行开关 + rAF 环 + 刺激电流参数端口。
 * 物理只在 lib/sim/neuron；本页只嵌套「何时 step / 如何画」。
 */
export function Neuron() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const pageTerms = useMemo(() => termIdsForSimPath('neuron'), [])

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { running, runningRef, toggle, setRunning } = useRunning(true)
  const current = useSyncedParam(0.5)
  const [steps, setSteps] = useState(1200), [pulses, setPulses] = useState<number[]>([])
  const [scanIndex, setScanIndex] = useState(0)
  const scanRef = useRef(0)
  const scene = useMemo(() => ({ current: current.value, steps, pulses }), [current.value, steps, pulses])
  const compute = useModuleCompute({ module: 'neuron', scene })
  const preview = useMemo(() => {
    if (compute.snapshot) return { data: compute.result?.module === 'neuron' ? compute.result.result : null, error: '' }
    try { return { data: neuronResult(scene), error: '' } } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [scene, compute.snapshot, compute.result])
  const data = preview.data
  useEffect(() => { if (compute.snapshot) setRunning(false) }, [compute.snapshot, data])
  useEffect(() => {
    if (running && scanRef.current >= steps) { scanRef.current = 0; setScanIndex(0) }
  }, [running, steps])
  const renderRef = useRef({ data, scene })
  renderRef.current = { data, scene }
  const read = data ? { v: data.voltage[Math.min(scanIndex, data.voltage.length - 1)], peak: data.peak, spikes: data.spikes.filter(step => step <= scanIndex).length } : null

  useRafLoop(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!

    ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, H)
    const { data, scene } = renderRef.current
    if (!data) return
    if (runningRef.current) scanRef.current += 3
    scanRef.current = Math.min(scanRef.current, data.voltage.length - 1)
    const si = Math.floor(scanRef.current); setScanIndex(si)
    if (si === data.voltage.length - 1 && runningRef.current) setRunning(false)
    const recent = data.voltage.slice(Math.max(0, si - BUF + 1), si + 1)
    const buf = Array(BUF - recent.length).fill(RESTING.v).concat(recent)
    const spikes = data.spikes.filter(step => step <= si)
    const lastSpike = spikes.at(-1)
    const firedFlash = lastSpike !== undefined && si - lastSpike < 42
    // Propagation is a display cue triggered by solved spikes, not an axon solver.
    const ax = Array.from({ length: AXON_N }, (_, i) => {
      for (let j = spikes.length - 1; j >= 0; j--) {
        const phase = ((si - spikes[j]) / 3 - i * 6) * 0.06
        if (phase >= 0 && phase <= 1) return phase
      }
      return -1
    })

    // 区块布局：上方走纸示波器，下方轴突
    const scopeY0 = 24, scopeH = 226
    const vMin = -2.3, vMax = 2.3
    const vy = (v: number) => scopeY0 + scopeH * (1 - (v - vMin) / (vMax - vMin))

    // 网格
    ctx.strokeStyle = 'rgba(120,140,180,0.10)'; ctx.lineWidth = 1
    for (let gx = 0; gx <= W; gx += 60) { ctx.beginPath(); ctx.moveTo(gx, scopeY0); ctx.lineTo(gx, scopeY0 + scopeH); ctx.stroke() }
    for (let v = -2; v <= 2; v++) { const y = vy(v); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }

    // 零线与阈线
    ctx.strokeStyle = 'rgba(58,214,255,0.35)'; ctx.setLineDash([5, 5])
    const y0 = vy(0); ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(W, y0); ctx.stroke()
    ctx.setLineDash([])
    const en = !zhRef.current
    ctx.fillStyle = 'rgba(58,214,255,0.7)'; ctx.font = '11px monospace'
    ctx.fillText(
      en ? 'Upward zero crossing → spike marker' : '上升过零 → 尖峰标记',
      8,
      y0 - 6,
    )

    // 静息线
    const yr = vy(RESTING.v)
    ctx.strokeStyle = 'rgba(148,163,184,0.25)'; ctx.setLineDash([2, 4])
    ctx.beginPath(); ctx.moveTo(0, yr); ctx.lineTo(W, yr); ctx.stroke(); ctx.setLineDash([])
    ctx.fillStyle = 'rgba(148,163,184,0.6)'
    ctx.fillText(
      en ? `Rest v≈${RESTING.v.toFixed(1)}` : `静息 v≈${RESTING.v.toFixed(1)}`,
      8,
      yr + 14,
    )

    // 走纸波形
    ctx.strokeStyle = '#7c5cff'; ctx.lineWidth = 2; ctx.beginPath()
    for (let i = 0; i < buf.length; i++) {
      const x = (i / (BUF - 1)) * W
      const y = vy(buf[i])
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
    }
    ctx.stroke()

    // 当前膜电位光点
    const curV = data.voltage[si]
    const headY = vy(curV)
    ctx.fillStyle = firedFlash ? '#ff8a4c' : '#3ad6ff'
    ctx.beginPath(); ctx.arc(W - 2, headY, firedFlash ? 6 : 4, 0, Math.PI * 2); ctx.fill()

    // 刺激注入指示条
    if (scene.pulses.some(start => si >= start && si < start + NEURON_PULSE_STEPS)) {
      ctx.fillStyle = 'rgba(255,138,76,0.85)'
      ctx.fillRect(W - 70, scopeY0 + 6, en ? 64 : 52, 16)
      ctx.fillStyle = '#05070f'; ctx.font = 'bold 11px sans-serif'
      ctx.fillText(en ? 'Stim on' : '刺激中', W - (en ? 64 : 54), scopeY0 + 18)
    }

    // —— 轴突一维传导 ——
    const axY = 340, axX0 = 60, axX1 = W - 60
    ctx.fillStyle = '#94a3b8'; ctx.font = '12px sans-serif'
    ctx.fillText(
      en
        ? 'Spike propagation illustration (fixed-speed animation):'
        : '尖峰传播示意（定速动画，未求解轴突方程）：',
      axX0,
      axY - 34,
    )
    // 轴突基线
    ctx.strokeStyle = 'rgba(124,92,255,0.35)'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(axX0, axY); ctx.lineTo(axX1, axY); ctx.stroke()
    for (let i = 0; i < AXON_N; i++) {
      const x = axX0 + (i / (AXON_N - 1)) * (axX1 - axX0)
      const p = ax[i]
      // 激活包络：相位 p∈[0,1] 时画出隆起；静息时小灰点
      const active = p >= 0
      const amp = active ? Math.sin(Math.min(1, Math.max(0, p)) * Math.PI) : 0
      const r = active ? 4 + amp * 7 : 3
      const y = axY - amp * 30
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
      if (active) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0, '#ff8a4c'); g.addColorStop(1, 'rgba(124,92,255,0.4)')
        ctx.fillStyle = g
      } else ctx.fillStyle = 'rgba(148,163,184,0.35)'
      ctx.fill()
    }
    ctx.fillStyle = '#64748b'; ctx.font = '11px sans-serif'
    if (zhRef.current) {
      ctx.fillText('刺激端', axX0 - 4, axY + 24)
      ctx.fillText('→ 示意方向', axX0 + 70, axY + 24)
    } else {
      ctx.fillText('Stim end', axX0 - 4, axY + 24)
      ctx.fillText('→ illustration direction', axX0 + 70, axY + 24)
    }

  }, [])

  const stimulate = () => {
    const start = Math.floor(scanRef.current)
    if (start >= steps) { setPulses([0]); scanRef.current = 0; setScanIndex(0) }
    else if (pulses.length < 64) setPulses(previous => [...new Set([...previous, start])].sort((a, b) => a - b))
    if (compute.target === 'browser') setRunning(true)
  }
  const reset = () => { scanRef.current = 0; setScanIndex(0); setPulses([]) }

  return (
    <div>
      <PageHeader
        icon="⚡"
        title="神经电 · 动作电位"
        subtitle="简化神经元模型再现动作电位的「全或无」：阈下刺激只让膜电位小幅去极化后回落；刺激足够强且持续足够久时，会触发大幅尖峰，再逐渐恢复。调大刺激电流再点「刺激一下」，观察膜电位响应；每次点击在当前计算步加入 54 步脉冲。"
      />
      {preview.error && <p role="alert" className="note mb-4">{zh ? '本地 WASM 计算不可用。' : 'Local WASM computation unavailable.'} {preview.error}</p>}

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
          {zh ? '菲茨休–南云 · 走纸示波 · 全或无' : 'FitzHugh–Nagumo · scope · all-or-none'}
        </span>
        <PlayPauseButton running={running} onToggle={toggle} />
        <button type="button" onClick={stimulate} disabled={pulses.length >= 64 && scanIndex < steps}
          className="btn border border-edge text-slate-300">
          {zh ? '⚡ 刺激一下' : '⚡ Stimulate'}
        </button>
        <button type="button" onClick={reset}
          className="btn border border-edge text-slate-300">
          {zh ? '↺ 复位' : '↺ Reset'}
        </button>
        <ParamSlider
          label={zh ? '刺激电流' : 'Stimulus I'}
          value={current.value}
          min={0}
          max={1}
          step={0.02}
          format={(v) => v.toFixed(2)}
          onChange={current.set}
        />
        <span className="text-xs text-slate-600">
          {zh
            ? '响应取决于电流、脉冲时长与当前恢复状态'
            : 'Response depends on current, pulse duration and recovery state'}
        </span>
      </div>

      <div className="toolbar mb-3">
        <label>{zh ? '计算步数' : 'Compute steps'}
          <input aria-label="Neuron steps" type="number" min={1} max={2000} value={steps}
            onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 2000) { setSteps(n); reset() } }} />
        </label>
        <label>{zh ? '读图位置' : 'Read position'}
          <input aria-label="Neuron cursor" type="range" min={0} max={steps} step={1} value={scanIndex}
            onChange={e => { const i = Number(e.target.value); scanRef.current = i; setScanIndex(i); setRunning(false) }} />
        </label>
        <span>{zh ? '脉冲数' : 'Pulses'} {pulses.length}/64</span>
      </div>
      <canvas
        ref={canvasRef}
        width={W} height={H}
        onMouseDown={stimulate}
        role="img"
        aria-label={zh ? '神经动作电位模拟画布' : 'Neuron action-potential canvas'}
        className="stage mx-auto w-full max-w-3xl cursor-pointer"
        style={{ aspectRatio: '720/420' }}
      />

      {read && <div data-neuron-readout className="mx-auto mt-3 flex max-w-3xl flex-wrap justify-center gap-6 font-mono text-xs text-slate-400">
        <span>{zh ? '膜电位' : 'Membrane potential'} {read.v.toFixed(3)}</span>
        <span>{zh ? '已发生尖峰' : 'Spikes so far'} {read.spikes}</span>
        <span>{zh ? '完整轨迹峰值' : 'Full trajectory peak'} {read.peak.toFixed(3)}</span>
        <span>t = {(scanIndex * 0.06).toFixed(2)} {zh ? '约化单位' : 'reduced units'}</span>
      </div>}

      <p className="note">
        {zh
          ? '两变量菲茨休–南云模型：显式欧拉法以 dt=0.06 推进膜电位与恢复变量，从固定近似静息态开始。脉冲持续 54 步，重叠脉冲按一次注入处理；重复刺激可观察恢复状态对响应的影响。下方光点仅按求得的尖峰时刻播放传播示意，未求解轴突电缆方程。'
          : 'Two-variable FitzHugh–Nagumo, explicit Euler dt=0.06 from a fixed approximate resting state. Pulses last 54 steps; overlaps form a union. Repeated pulses let you inspect recovery-dependent responses. Dots illustrate propagation from computed spike times; no axon cable equation is solved.'}

      </p>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { SpectrumView } from '../components/SpectrumView'
import { ParamSlider } from '../components/ParamSlider'
import { SpeedControl } from '../components/SpeedControl'
import { VIBRATION } from '../data/spectrum'
import { useLocale } from '../lib/i18n'
import { useRafLoop, useRunning } from '../lib/hooks'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { drainSteps } from '../lib/playback'
import { vibrationResult, type VibrationScene } from '../lib/sim/spectrum-runnable-algos'

const W = 720, H_TIME = 200, H_RES = 160
type VibrationResult = ReturnType<typeof vibrationResult>

export function Vibration() {
  const { locale } = useLocale(), zh = locale === 'zh'
  const { running, runningRef, toggle, setRunning } = useRunning()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef(0), speedRef = useRef(1), accRef = useRef({ v: 0 })
  const [mass, setMass] = useState(1)
  const [stiffness, setStiffness] = useState(100)
  const [damping, setDamping] = useState(1)
  const [driveFrequency, setDriveFrequency] = useState(1.5)
  const [steps, setSteps] = useState(1200)
  const [cursor, setCursor] = useState(0)
  const [speed, setSpeed] = useState(1)
  const scene = useMemo<VibrationScene>(() => ({ mass, stiffness, damping, driveFrequency, steps }), [mass, stiffness, damping, driveFrequency, steps])
  const compute = useModuleCompute({ module: 'vibration', scene })
  const preview = useMemo(() => {
    if (compute.snapshot) return { data: compute.result?.module === 'vibration' ? compute.result.result : null, error: '' }
    try { return { data: vibrationResult(scene), error: '' } } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : String(error) }
    }
  }, [scene, compute.snapshot, compute.result])
  const data = preview.data
  const state = data?.states[cursor]

  useEffect(() => {
    cursorRef.current = 0; setCursor(0); accRef.current.v = 0
    setRunning(!compute.snapshot)
  }, [scene])
  useEffect(() => { if (compute.snapshot) setRunning(false) }, [compute.snapshot, data])
  useEffect(() => {
    if (running && cursorRef.current >= steps) { cursorRef.current = 0; setCursor(0); accRef.current.v = 0 }
  }, [running, steps])

  useRafLoop(() => {
    if (!data || !runningRef.current) return
    const count = drainSteps(accRef.current, speedRef.current, 4)
    if (!count) return
    cursorRef.current = Math.min(data.steps, cursorRef.current + count)
    setCursor(cursorRef.current)
    if (cursorRef.current === data.steps) setRunning(false)
  }, [data])

  useEffect(() => { drawVibration(canvasRef.current, data, cursor, driveFrequency, zh) }, [data, cursor, driveFrequency, zh])

  return <div className="space-y-8">
    <div>
      <PageHeader icon="〰️" title="受迫阻尼振动" titleEn="Forced damped vibration"
        subtitle="从静止初态计算位移与速度轨迹，比较瞬态响应和解析稳态共振曲线。"
        subtitleEn="Calculate displacement and velocity from rest; compare the transient response with the analytic steady-state resonance curve." />
      {preview.error && <p role="alert" className="note mb-4">{zh ? '本地 WASM 计算不可用。' : 'Local WASM computation unavailable.'} {preview.error}</p>}
      <div className="toolbar mb-4">
        <ParamSlider label={zh ? '质量 m (kg)' : 'Mass m (kg)'} ariaLabel="Vibration mass" value={mass} min={0.2} max={5} step={0.1} onChange={setMass} />
        <ParamSlider label={zh ? '刚度 k (N/m)' : 'Stiffness k (N/m)'} ariaLabel="Vibration stiffness" value={stiffness} min={10} max={400} step={1} onChange={setStiffness} />
        <ParamSlider label={zh ? '阻尼 c (N·s/m)' : 'Damping c (N·s/m)'} ariaLabel="Vibration damping" value={damping} min={0.05} max={8} step={0.05} onChange={setDamping} />
        <ParamSlider label={zh ? '驱动 f (Hz)' : 'Drive f (Hz)'} ariaLabel="Vibration frequency" value={driveFrequency} min={0.2} max={5} step={0.05} onChange={setDriveFrequency} />
        <label className="flex items-center gap-2 text-slate-400">{zh ? '计算步数' : 'Compute steps'}
          <input aria-label="Vibration steps" type="number" min={1} max={2000} value={steps}
            onChange={e => setSteps(Math.max(1, Math.min(2000, Math.round(Number(e.target.value)) || 1)))}
            className="w-24 rounded border border-edge bg-panel p-2" />
        </label>
      </div>
      <div className="toolbar mb-4">
        {compute.snapshot && <button className="btn border border-edge text-slate-300" disabled={!data} onClick={toggle}>
          {running ? (zh ? '暂停回放' : 'Pause replay') : (zh ? '播放结果' : 'Replay result')}
        </button>}
        <SpeedControl value={speed} onChange={v => { setSpeed(v); speedRef.current = v }} />
        <label className="flex items-center gap-2 text-slate-400">{zh ? '读图步骤' : 'Read step'}
          <input aria-label="Vibration cursor" type="range" min={0} max={steps} step={1} value={cursor} disabled={!data}
            onChange={e => { const value = Number(e.target.value); cursorRef.current = value; setCursor(value); setRunning(false) }} />
          {cursor} / {steps}
        </label>
      </div>
      <canvas ref={canvasRef} width={W} height={H_TIME + H_RES + 16}
        role="img" aria-label={zh ? '受迫振子时域与共振曲线' : 'Forced oscillator time and resonance'}
        className="stage mb-3 w-full max-w-4xl" />
      <div data-vibration-readout data-vibration-step={data?.steps ?? ''} data-vibration-cursor={cursor}
        className="grid max-w-4xl gap-3 rounded-xl border border-edge p-4 font-mono text-sm text-slate-300 sm:grid-cols-3">
        <span>t = {data ? (cursor * data.dt).toFixed(6) : '—'} s</span>
        <span>x = {state?.x.toFixed(6) ?? '—'} m</span>
        <span>v = {state?.v.toFixed(6) ?? '—'} m/s</span>
        <span>|X|ₛₛ = {data?.amplitude.toFixed(6) ?? '—'} m</span>
        <span>ω₀ = {data?.omega0.toFixed(4) ?? '—'} rad/s</span>
        <span>{zh ? '完成步数' : 'Computed steps'}: {data?.steps ?? '—'}</span>
      </div>
      <p className="note mt-4">{zh
        ? 'mẍ+cẋ+kx=cos(2πft)，驱动力幅值 1 N。固定 Δt=1/240 s，以四阶 Runge–Kutta 从 x=v=0 积分。修改物理参数会重算；播放和读图只使用已计算的轨迹。'
        : 'mẍ+cẋ+kx=cos(2πft), force amplitude 1 N. RK4 integrates from x=v=0 with fixed Δt=1/240 s. Physical edits recalculate; playback and reading use the computed trajectory.'}</p>
      <p className="note">{zh
        ? '上图显示完整有限轨迹，虚线标记当前读图时刻；下图是解析稳态振幅，黄线为驱动频率，绿线为无阻尼固有频率。短时轨迹不保证达到稳态。'
        : 'Top: the full finite trajectory, with the current reading time marked. Bottom: analytic steady-state amplitude, yellow drive frequency and green undamped natural frequency. A short run need not reach steady state.'}</p>
    </div>
    <SpectrumView spectrum={VIBRATION} />
  </div>
}

function drawVibration(canvas: HTMLCanvasElement | null, data: VibrationResult | null, cursor: number, driveFrequency: number, zh: boolean) {
  const ctx = canvas?.getContext('2d')
  if (!ctx || !canvas) return
  ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, canvas.height)
  if (!data) return
  const pad = 18, width = W - pad * 2
  const maxX = Math.max(1e-8, ...data.states.map(s => Math.abs(s.x)))
  const y = (x: number) => H_TIME / 2 - x / maxX * (H_TIME * 0.32)
  ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(pad, H_TIME / 2); ctx.lineTo(W - pad, H_TIME / 2); ctx.stroke()
  ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.beginPath()
  data.states.forEach((s, i) => { const x = pad + i / data.steps * width; i ? ctx.lineTo(x, y(s.x)) : ctx.moveTo(x, y(s.x)) })
  ctx.stroke()
  const marker = pad + cursor / data.steps * width
  ctx.strokeStyle = '#94a3b8'; ctx.setLineDash([3, 3])
  ctx.beginPath(); ctx.moveTo(marker, 25); ctx.lineTo(marker, H_TIME - 23); ctx.stroke(); ctx.setLineDash([])
  ctx.fillStyle = '#94a3b8'; ctx.font = '12px system-ui'
  ctx.fillText((zh ? '位移 x(t) · ±' : 'Displacement x(t) · ±') + maxX.toExponential(2) + ' m', pad, 16)
  ctx.fillText('0 s', pad, H_TIME - 3)
  ctx.fillText(data.time.toFixed(4) + ' s', W - 95, H_TIME - 3)

  const y0 = H_TIME + 8, curve = data.resonance
  const maxA = Math.max(...curve.amplitude), omegaMin = curve.omega[0], omegaMax = curve.omega.at(-1)!
  ctx.fillStyle = '#0f172a'; ctx.fillRect(0, y0, W, H_RES)
  ctx.strokeStyle = '#f472b6'; ctx.beginPath()
  curve.amplitude.forEach((a, i) => {
    const x = pad + i / (curve.amplitude.length - 1) * width, yy = y0 + H_RES - 20 - a / maxA * (H_RES - 44)
    i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy)
  })
  ctx.stroke()
  for (const [omega, color] of [[2 * Math.PI * driveFrequency, '#fbbf24'], [data.omega0, '#34d399']] as const) {
    const fraction = (omega - omegaMin) / (omegaMax - omegaMin)
    if (fraction < 0 || fraction > 1) continue
    const x = pad + fraction * width
    ctx.strokeStyle = color; ctx.setLineDash([4, 4]); ctx.beginPath()
    ctx.moveTo(x, y0 + 22); ctx.lineTo(x, y0 + H_RES - 16); ctx.stroke(); ctx.setLineDash([])
  }
  ctx.fillStyle = '#94a3b8'
  ctx.fillText((zh ? '解析稳态 |X(ω)| · 最大采样值 ' : 'Steady |X(ω)| · sampled max ') + maxA.toExponential(2) + ' m', pad, y0 + 15)
  ctx.fillText(omegaMin.toFixed(2), pad, y0 + H_RES - 3)
  ctx.fillText(omegaMax.toFixed(2) + ' rad/s', W - 105, y0 + H_RES - 3)
}

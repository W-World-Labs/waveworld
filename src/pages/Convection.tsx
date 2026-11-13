import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ParamSlider } from '../components/ParamSlider'
import { SpeedControl } from '../components/SpeedControl'
import { CONVECTION_N as N, createConvectionScene, stepConvectionScene, convectionResult, type ConvectionScene } from '../lib/sim/fluid'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useRunning, useStartRafLoop } from '../lib/hooks'
import { drainSteps } from '../lib/playback'
import { useLocale } from '../lib/i18n'

type Result = ReturnType<typeof convectionResult>
function divColor(t: number, out: Uint8ClampedArray, o: number) {
  const v = Math.max(-1, Math.min(1, t))
  if (v >= 0) { out[o] = 30 + v * 225; out[o + 1] = 20 + v * 90; out[o + 2] = 40 + v * 30 }
  else { const k = -v; out[o] = 30 + k * 20; out[o + 1] = 40 + k * 120; out[o + 2] = 60 + k * 195 }
  out[o + 3] = 255
}

export function Convection() {
  const { locale } = useLocale(), zh = locale === 'zh'
  const { running, runningRef, setRunning } = useRunning()
  const startLoop = useStartRafLoop()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef<((result: Result | null) => void) | null>(null)
  const stepRef = useRef(0), speedRef = useRef(1)
  const [buoyancy, setBuoyancy] = useState(0.07)
  const [steps, setSteps] = useState(120)
  const [initialDrop, setInitialDrop] = useState(true)
  const [seeds, setSeeds] = useState<ConvectionScene['seeds']>([])
  const [hot, setHot] = useState(true)
  const [view, setView] = useState<'temperature' | 'speed'>('temperature')
  const [speed, setSpeed] = useState(1)
  const [resetKey, setResetKey] = useState(0)
  const [local, setLocal] = useState<Result | null>(null)
  const scene = useMemo<ConvectionScene>(() => ({ buoyancy, steps, initialDrop, seeds }), [buoyancy, steps, initialDrop, seeds])
  const compute = useModuleCompute({ module: 'convection', scene })
  const remote = compute.result?.module === 'convection' ? compute.result.result : null
  const result = compute.snapshot ? remote : local

  useEffect(() => {
    const off = document.createElement('canvas'); off.width = N; off.height = N
    const octx = off.getContext('2d')!, img = octx.createImageData(N, N)
    drawRef.current = data => {
      const canvas = canvasRef.current, ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, canvas.width, canvas.height)
      if (!data) return
      const peak = Math.max(1e-6, view === 'temperature' ? Math.max(Math.abs(data.minTemperature), Math.abs(data.maxTemperature)) : data.maxSpeed)
      for (let i = 0; i < data.temperature.length; i++) {
        const value = view === 'temperature' ? data.temperature[i] : Math.hypot(data.vx[i], data.vy[i])
        divColor(value / peak, img.data, i * 4)
      }
      octx.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = true
      ctx.drawImage(off, 0, 0, canvas.width, canvas.height)
    }
    return () => { drawRef.current = null }
  }, [view])
  useEffect(() => { drawRef.current?.(result) }, [result, view])

  useEffect(() => {
    stepRef.current = 0; setLocal(null)
    if (compute.snapshot) return
    const fluid = createConvectionScene(scene), acc = { v: 0 }
    setLocal(convectionResult(fluid, 0)); setRunning(true)
    const stop = startLoop(() => {
      if (!runningRef.current || stepRef.current >= scene.steps) return
      const count = Math.min(drainSteps(acc, speedRef.current, 1), scene.steps - stepRef.current)
      if (!count) return
      for (let i = 0; i < count; i++) stepConvectionScene(fluid)
      stepRef.current += count; setLocal(convectionResult(fluid, stepRef.current))
      if (stepRef.current === scene.steps) setRunning(false)
    })
    return stop
  }, [scene, compute.snapshot, resetKey])
  useEffect(() => {
    if (!compute.snapshot && running && stepRef.current >= steps) setResetKey(key => key + 1)
  }, [running, compute.snapshot, steps])

  return <div>
    <PageHeader icon="💧" title="热对流 · 温差驱动流动" titleEn="Thermal convection · buoyant flow"
      subtitle="设置初始冷热区域，计算温差平流和浮力驱动的速度场。"
      subtitleEn="Set initial hot and cold regions; calculate temperature advection and buoyancy-driven velocity." />
    <div className="toolbar mb-4">
      <ParamSlider label={zh ? '约化浮力系数' : 'Reduced buoyancy'} ariaLabel="Convection buoyancy" value={buoyancy} min={0} max={0.2} step={0.01} format={v => v.toFixed(2)} onChange={setBuoyancy} />
      <label className="flex items-center gap-2 text-slate-300">{zh ? '计算步数' : 'Compute steps'}
        <input aria-label="Convection steps" type="number" min={1} max={2000} value={steps}
          onChange={e => setSteps(Math.max(1, Math.min(2000, Math.trunc(Number(e.target.value) || 1))))}
          className="min-h-11 w-24 rounded border border-edge bg-panel px-2" />
      </label>
      <label className="flex items-center gap-2 text-slate-300">
        <input aria-label="Convection initial drop" type="checkbox" checked={initialDrop} onChange={e => setInitialDrop(e.target.checked)} />
        {zh ? '顶部初始热滴' : 'Initial top hot drop'}
      </label>
      <label className="flex items-center gap-2 text-slate-300">{zh ? '点击添加' : 'Click to add'}
        <select aria-label="Convection drop" value={hot ? 'hot' : 'cold'} onChange={e => setHot(e.target.value === 'hot')} className="rounded border border-edge bg-panel p-2">
          <option value="hot">{zh ? '初始热区' : 'Initial hot region'}</option><option value="cold">{zh ? '初始冷区' : 'Initial cold region'}</option>
        </select>
      </label>
      <button className="btn border border-edge" onClick={() => { setInitialDrop(true); setSeeds([]) }}>{zh ? '恢复初始热滴' : 'Restore initial drop'}</button>
      <button className="btn border border-edge" onClick={() => { setInitialDrop(false); setSeeds([]) }}>{zh ? '清空冷热区域' : 'Clear thermal regions'}</button>
    </div>
    <div className="toolbar mb-4">
      <label className="flex items-center gap-2 text-slate-300">{zh ? '显示' : 'View'}
        <select aria-label="Convection view" value={view} onChange={e => setView(e.target.value as typeof view)} className="rounded border border-edge bg-panel p-2">
          <option value="temperature">{zh ? '温差 ΔT*' : 'Temperature ΔT*'}</option><option value="speed">{zh ? '速度大小 |v*|' : 'Speed |v*|'}</option>
        </select>
      </label>
      {!compute.snapshot && <SpeedControl value={speed} onChange={v => { setSpeed(v); speedRef.current = v }} />}
      <span className="text-sm text-slate-400">{zh ? '添加区域：' : 'Added regions: '}{seeds.length} / 64</span>
    </div>
    <p className="note mb-3">{zh ? '点击编辑初始冷热区域；修改物理输入会从初态重算。显示切换只读取已有场数据。' : 'Click to edit initial thermal regions; physical input edits restart the scene. View changes only read existing field data.'}</p>
    <canvas ref={canvasRef} width={N * 4} height={N * 4}
      onPointerDown={e => {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = Math.max(1, Math.min(N - 2, Math.round((e.clientX - rect.left) / rect.width * N)))
        const y = Math.max(1, Math.min(N - 2, Math.round((e.clientY - rect.top) / rect.height * N)))
        setSeeds(previous => previous.length < 64 ? [...previous, { x, y, hot: hot && !e.shiftKey }] : previous)
      }}
      role="img" aria-label={zh ? '热对流温差与速度场' : 'Convection temperature and velocity field'}
      className="stage w-full max-w-2xl cursor-crosshair" style={{ aspectRatio: '1/1' }} />
    <div data-convection-readout data-convection-step={result?.steps ?? ''} className="mt-4 flex flex-wrap gap-5 rounded-xl border border-edge p-4 text-sm text-slate-300">
      <span>{zh ? '完成步数' : 'Completed steps'}: {result?.steps ?? '—'} / {steps}</span>
      <span>t* = {result?.time.toFixed(3) ?? '—'}</span>
      <span>ΔT*: {result?.minTemperature.toFixed(4) ?? '—'} … {result?.maxTemperature.toFixed(4) ?? '—'}</span>
      <span>{zh ? '最大 |v*|' : 'Peak |v*|'}: {result?.maxSpeed.toFixed(5) ?? '—'}</span>
      <span>{zh ? '投影残差（格点差分）' : 'Projection residual (grid difference)'}: {result?.gridDivergence.toExponential(2) ?? '—'}</span>
    </div>
    <p className="note mt-4">{zh
      ? '约化二维 Stable Fluids 模型，110×110 格点，Δt*=0.1，14 次压力迭代；温差平流并通过 Boussinesq 浮力驱动速度，每求解步乘以 0.997 衰减。该数值衰减不是已标定的换热系数。'
      : 'Reduced 2D Stable Fluids model, 110×110 grid, Δt*=0.1, 14 pressure iterations. Temperature is advected and drives Boussinesq buoyancy; each solver step applies a 0.997 decay factor. This numerical decay is not a calibrated heat-transfer coefficient.'}</p>
    <p className="note">{zh
      ? '颜色按当前场值归一化；绝对变化看数值读数。场值为 FP32，后端原生与本机 WASM 共用 Rust 混合精度内核。本页未包含实体导热、热辐射或材料标定，不能据此判断实际机箱或芯片温度。'
      : 'Colors normalize to the current field; use readouts for absolute changes. Fields use FP32 storage with mixed CPU precision. Solid conduction, thermal radiation and material calibration are not included; this model does not predict actual enclosure or chip temperatures.'}</p>
  </div>
}

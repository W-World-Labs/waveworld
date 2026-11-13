import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ParamSlider } from '../components/ParamSlider'
import { SpeedControl } from '../components/SpeedControl'
import { RIPPLE_N as N, createRippleScene, defaultRippleSeeds, rippleResult, type RippleScene } from '../lib/sim/wave'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useRunning, useStartRafLoop } from '../lib/hooks'
import { drainSteps } from '../lib/playback'
import { useLocale } from '../lib/i18n'

function waveColor(v: number, out: Uint8ClampedArray, o: number) {
  const t = Math.max(-1, Math.min(1, v))
  if (t >= 0) { out[o] = 40 + t * 120; out[o + 1] = 90 + t * 165; out[o + 2] = 120 + t * 135 }
  else { const k = -t; out[o] = 20; out[o + 1] = 40 + k * 40; out[o + 2] = 70 + k * 150 }
  out[o + 3] = 255
}

export function Ripple() {
  const { locale } = useLocale(), zh = locale === 'zh'
  const { running, runningRef, setRunning } = useRunning()
  const startLoop = useStartRafLoop()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef<((field: ArrayLike<number> | null) => void) | null>(null)
  const stepRef = useRef(0), speedRef = useRef(1)
  const [damping, setDamping] = useState(0.997)
  const [steps, setSteps] = useState(240)
  const [seeds, setSeeds] = useState(defaultRippleSeeds)
  const [crest, setCrest] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [resetKey, setResetKey] = useState(0)
  const [local, setLocal] = useState<ReturnType<typeof rippleResult> | null>(null)
  const scene = useMemo<RippleScene>(() => ({ damping, steps, seeds }), [damping, steps, seeds])
  const compute = useModuleCompute({ module: 'ripple', scene })
  const remote = compute.result?.module === 'ripple' ? compute.result.result : null
  const result = compute.snapshot ? remote : local

  useEffect(() => {
    const off = document.createElement('canvas'); off.width = N; off.height = N
    const octx = off.getContext('2d')!, img = octx.createImageData(N, N)
    const draw = (field: ArrayLike<number> | null) => {
      const canvas = canvasRef.current, ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, canvas.width, canvas.height)
      if (!field) return
      let peak = 1e-6
      for (let i = 0; i < field.length; i++) peak = Math.max(peak, Math.abs(field[i]))
      for (let i = 0; i < field.length; i++) waveColor(field[i] / peak, img.data, i * 4)
      octx.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = true
      ctx.drawImage(off, 0, 0, canvas.width, canvas.height)
    }
    drawRef.current = draw; stepRef.current = 0; setLocal(null); draw(null)
    if (compute.snapshot) return () => { drawRef.current = null }
    let wave: ReturnType<typeof createRippleScene>
    try { wave = createRippleScene(scene) }
    catch (error) {
      compute.reportLocalError?.(error); setRunning(false)
      return () => { drawRef.current = null }
    }
    const acc = { v: 0 }
    draw(wave.u); setLocal(rippleResult(wave.u, 0)); setRunning(true)
    const stop = startLoop(() => {
      if (!runningRef.current || stepRef.current >= scene.steps) return
      const count = Math.min(drainSteps(acc, speedRef.current, 2), scene.steps - stepRef.current)
      if (!count) return
      for (let i = 0; i < count; i++) wave.step()
      stepRef.current += count
      draw(wave.u); setLocal(rippleResult(wave.u, stepRef.current))
      if (stepRef.current === scene.steps) setRunning(false)
    })
    return () => { stop(); drawRef.current = null }
  }, [scene, compute.snapshot, resetKey])
  useEffect(() => { if (compute.snapshot) drawRef.current?.(remote?.field ?? null) }, [remote, scene, compute.snapshot])
  useEffect(() => {
    if (!compute.snapshot && running && stepRef.current >= steps) setResetKey(key => key + 1)
  }, [running, compute.snapshot, steps])

  return <div>
    <PageHeader icon="💦" title="波纹水池 · 传播与叠加" titleEn="Ripple tank · propagation and superposition"
      subtitle="设置初始波峰或波谷，从静止释放，观察二维波动传播和固定边界反射。"
      subtitleEn="Set initial crests or troughs, release them from rest, and observe 2D propagation and reflection from fixed walls." />
    <div className="toolbar mb-4">
      <ParamSlider label={zh ? '每步振幅因子' : 'Per-step amplitude factor'} ariaLabel="Ripple damping" value={damping} min={0.98} max={1} step={0.001} format={v => v.toFixed(3)} onChange={setDamping} />
      <label className="flex items-center gap-2 text-slate-300">{zh ? '计算步数' : 'Compute steps'}
        <input aria-label="Ripple steps" type="number" min={1} max={2000} value={steps}
          onChange={e => setSteps(Math.max(1, Math.min(2000, Math.trunc(Number(e.target.value) || 1))))}
          className="min-h-11 w-24 rounded border border-edge bg-panel px-2" />
      </label>
      <label className="flex items-center gap-2 text-slate-300">{zh ? '点击添加' : 'Click to add'}
        <select aria-label="Ripple pulse" value={crest ? 'crest' : 'trough'} onChange={e => setCrest(e.target.value === 'crest')} className="rounded border border-edge bg-panel p-2">
          <option value="crest">{zh ? '初始波峰' : 'Initial crest'}</option><option value="trough">{zh ? '初始波谷' : 'Initial trough'}</option>
        </select>
      </label>
      <button className="btn border border-edge" onClick={() => setSeeds(defaultRippleSeeds())}>{zh ? '恢复双脉冲' : 'Restore two pulses'}</button>
      <button className="btn border border-edge" onClick={() => setSeeds([])}>{zh ? '清空扰动' : 'Clear pulses'}</button>
      {!compute.snapshot && <SpeedControl value={speed} onChange={v => { setSpeed(v); speedRef.current = v }} />}
    </div>
    <p className="note mb-3">{zh ? '点击编辑初始位移；修改输入会从初态重新计算。扰动数：' : 'Click to edit initial displacement; input edits restart from the initial state. Pulses: '}{seeds.length} / 64</p>
    <canvas ref={canvasRef} width={N * 3} height={N * 3}
      onPointerDown={e => {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = Math.max(1, Math.min(N - 2, Math.round((e.clientX - rect.left) / rect.width * N)))
        const y = Math.max(1, Math.min(N - 2, Math.round((e.clientY - rect.top) / rect.height * N)))
        setSeeds(previous => previous.length < 64 ? [...previous, { x, y, radius: 2, amount: (e.shiftKey || !crest) ? -8 : 8 }] : previous)
      }}
      role="img" aria-label={zh ? '二维波纹位移场' : '2D ripple displacement field'}
      className="stage w-full max-w-2xl cursor-crosshair" style={{ aspectRatio: '1/1' }} />
    <div data-ripple-readout data-ripple-step={result?.steps ?? ''} className="mt-4 flex flex-wrap gap-5 rounded-xl border border-edge p-4 text-sm text-slate-300">
      <span>{zh ? '完成步数' : 'Completed steps'}: {result?.steps ?? '—'} / {steps}</span>
      <span>{zh ? '最大 |u*|' : 'Peak |u*|'}: {result?.peak.toFixed(5) ?? '—'}</span>
      <span>{zh ? '位移均方根' : 'RMS displacement'}: {result?.rms.toFixed(5) ?? '—'}</span>
    </div>
    <p className="note mt-4">{zh
      ? '约化二维标量波动模型，180×180 格点，c²Δt²/Δx²=0.25，固定边界 u=0。初始位移同时写入当前和上一时刻场；每步整体乘以所选振幅因子。这些是有限脉冲，不是持续单频波源。'
      : 'Reduced 2D scalar wave model, 180×180 grid, c²Δt²/Δx²=0.25, fixed walls u=0. Initial displacement is written to current and previous fields; the selected amplitude factor multiplies each step. These are finite pulses, not sustained monochromatic sources.'}</p>
    <p className="note">{zh
      ? '颜色按当前最大绝对位移归一化；衰减请看数值读数。位移均方根不是物理总能量。本机和后端均使用 CPU 计算与 FP32 场值存储。'
      : 'Colors normalize to the current peak absolute displacement; use readouts to assess decay. RMS displacement is not total physical energy. Local and backend use CPU arithmetic with FP32 field storage.'}</p>
  </div>
}

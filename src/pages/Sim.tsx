import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { SpeedControl } from '../components/SpeedControl'
import { ParamSlider } from '../components/ParamSlider'
import { createHeatSim, type HeatSim } from '../lib/webgpu/heatSim'
import { HEAT_W as GW, HEAT_H as GH, defaultHeatSeeds, heatFieldResult, type HeatScene } from '../lib/sim/heat'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useRunning } from '../lib/hooks/useRunning'
import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { drainSteps } from '../lib/playback'
import { useLocale } from '../lib/i18n'
import { IgbtSpatialJobForm } from '../components/thermal/IgbtSpatialJobForm'

const SCALE = 4

// 值→颜色（黑→蓝→红→橙→白）热图
function ramp(t: number, out: Uint8ClampedArray, o: number) {
  t = Math.max(0, Math.min(1, t))
  let r: number, g: number, b: number
  if (t < 0.25) { const k = t / 0.25; r = 0; g = 0; b = 80 + k * 175 }
  else if (t < 0.5) { const k = (t - 0.25) / 0.25; r = k * 220; g = 0; b = 255 - k * 255 }
  else if (t < 0.75) { const k = (t - 0.5) / 0.25; r = 220 + k * 35; g = k * 180; b = 0 }
  else { const k = (t - 0.75) / 0.25; r = 255; g = 180 + k * 75; b = k * 255 }
  out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255
}

export function Sim() {
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef = useRef<HeatSim | null>(null)
  const drawRef = useRef<((field: Float32Array) => void) | null>(null)
  const stepRef = useRef(0)
  const playRef = useRef(1)
  const [backend, setBackend] = useState<'cpu' | '…'>('…')
  const { running, runningRef, setRunning } = useRunning()
  const [r, setR] = useState(0.22)
  const [steps, setSteps] = useState(240)
  const [seeds, setSeeds] = useState(defaultHeatSeeds)
  const [playSpeed, setPlaySpeed] = useState(1)
  const [resetKey, setResetKey] = useState(0)
  const [local, setLocal] = useState<ReturnType<typeof heatFieldResult> | null>(null)
  const scene = useMemo<HeatScene>(() => ({ r, steps, seeds }), [r, steps, seeds])
  const compute = useModuleCompute({ module: 'sim', scene })
  const remote = compute.result?.module === 'sim' ? compute.result.result : null
  const result = compute.snapshot ? remote : local

  useEffect(() => {
    let disposed = false
    const acc = { v: 0 }
    stepRef.current = 0
    setLocal(null)
    const off = document.createElement('canvas'); off.width = GW; off.height = GH
    const octx = off.getContext('2d')!
    const img = octx.createImageData(GW, GH)
    const draw = (field: Float32Array) => {
      let max = 1e-6
      for (const value of field) max = Math.max(max, value)
      for (let i = 0; i < field.length; i++) ramp(field[i] / max, img.data, i * 4)
      octx.putImageData(img, 0, 0)
      const c = canvasRef.current
      if (!c) return
      const ctx = c.getContext('2d')!
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(off, 0, 0, c.width, c.height)
    }
    drawRef.current = draw
    draw(new Float32Array(GW * GH))
    if (compute.snapshot) return () => { drawRef.current = null }
    setBackend('…')
    setRunning(true)
    let stopLoop = () => {}
    ;(async () => {
      const sim = await createHeatSim(GW, GH, { preferCpu: true })
      if (disposed) { sim.dispose(); return }
      simRef.current = sim
      const prepare = async () => {
        for (const seed of scene.seeds) sim.seed(seed.x, seed.y, seed.radius, seed.amount)
        const field = await sim.field()
        if (disposed) return
        stepRef.current = 0
        simRef.current = sim
        setBackend('cpu')
        draw(field)
        setLocal(heatFieldResult(field, 0))
      }
      await prepare()
      if (disposed) return
      stopLoop = startLoop(async () => {
        if (disposed || !runningRef.current) return
        const count = Math.min(scene.steps - stepRef.current, drainSteps(acc, playRef.current, 2))
        if (count) await sim.step(scene.r, count)
        if (disposed) return
        const field = await sim.field()
        if (disposed) return
        stepRef.current += count
        draw(field)
        setLocal(heatFieldResult(field, stepRef.current))
        if (stepRef.current >= scene.steps) setRunning(false)
      })
    })().catch(error => { if (!disposed) { compute.reportLocalError?.(error); setRunning(false) } })
    return () => { disposed = true; stopLoop(); simRef.current?.dispose(); simRef.current = null; drawRef.current = null }
  }, [scene, compute.snapshot, resetKey])

  useEffect(() => {
    if (compute.snapshot) drawRef.current?.(Float32Array.from(remote?.field ?? new Float32Array(GW * GH)))
  }, [remote, compute.snapshot, scene])
  useEffect(() => {
    if (!compute.snapshot && running && stepRef.current >= scene.steps) setResetKey(key => key + 1)
  }, [running, compute.snapshot, scene.steps])

  return (
    <div>
      <PageHeader icon="🌡️" title="二维热扩散" titleEn="2D heat diffusion"
        subtitle="设置初始热区，观察热量在绝热边界内扩散。点击画布添加热区；编辑输入会从初始场重新计算。"
        subtitleEn="Set initial hot regions and observe diffusion inside insulated walls. Click to add a region; editing inputs restarts from the initial field." />
      <div className="toolbar mb-5">
        <ParamSlider label={zh ? '扩散稳定数 r' : 'Diffusion ratio r'} ariaLabel="Heat diffusion ratio" value={r} min={0.05} max={0.25} step={0.01} format={v => v.toFixed(2)} onChange={setR} />
        <label className="flex items-center gap-2 text-slate-300">{zh ? '计算步数' : 'Steps'}
          <input type="number" aria-label="Heat steps" min={1} max={2000} value={steps} onChange={e => setSteps(Math.max(1, Math.min(2000, Math.trunc(Number(e.target.value) || 1))))} className="min-h-11 w-24 rounded border border-edge bg-canvas px-2" />
        </label>
        <button type="button" className="btn border border-edge" onClick={() => setSeeds(defaultHeatSeeds())}>{zh ? '恢复初始热区' : 'Restore initial regions'}</button>
        {!compute.snapshot && <SpeedControl value={playSpeed} onChange={value => { setPlaySpeed(value); playRef.current = value }} />}
      </div>
      <p className="mb-3 text-sm text-slate-400">{!compute.snapshot
        ? zh ? `本机：${backend === 'cpu' ? 'Rust/WASM · FP32 场值 / FP64 运算' : '初始化中…'}` : `Local: ${backend === 'cpu' ? 'Rust/WASM · FP32 fields / FP64 arithmetic' : 'initializing…'}`
        : compute.target === 'browser'
          ? (zh ? '本机 WASM 任务快照 · 结果保存到统一任务记录。' : 'Local WASM job snapshot · saved in the shared job history.')
          : (zh ? '后端 CPU · 与本机 WASM 共用 Rust 热传导内核。' : 'Backend CPU · the same Rust heat kernel as local WASM.')}</p>
      <canvas ref={canvasRef} width={GW * SCALE} height={GH * SCALE}
        onPointerDown={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const x = Math.max(0, Math.min(GW - 1, Math.round((e.clientX - rect.left) / rect.width * GW)))
          const y = Math.max(0, Math.min(GH - 1, Math.round((e.clientY - rect.top) / rect.height * GH)))
          setSeeds(previous => previous.length < 32 ? [...previous, { x, y, radius: 6, amount: 100 }] : previous)
        }}
        role="img" aria-label={zh ? '二维热扩散场' : '2D heat diffusion field'} className="stage w-full max-w-3xl cursor-crosshair" style={{ aspectRatio: `${GW}/${GH}` }} />
      <div data-heat-step={result?.steps ?? 0} data-heat-readout className="mt-4 flex flex-wrap gap-5 rounded-xl border border-edge p-4 text-sm text-slate-300">
        <span>{zh ? '完成步数' : 'Completed steps'}: {result ? `${result.steps} / ${steps}` : '—'}</span>
        <span>{zh ? '最高场值' : 'Peak field'}: {result?.peak.toFixed(3) ?? '—'}</span>
        <span>{zh ? '场值总和' : 'Field sum'}: {result?.total.toFixed(3) ?? '—'}</span>
      </div>
      <p className="note">{zh
        ? `${seeds.length} / 32 处初始热区，非持续发热组件。场值与网格均为约化量；r = αΔt/Δx²，二维显式格式须 r ≤ 0.25。颜色按当前最大值归一化，绝对变化请看数值读数。本页尚未包含实体导热与流体的耦合。`
        : `${seeds.length} / 32 initial regions, not continuous heat sources. Field and grid use reduced units; r = αΔt/Δx² must be ≤ 0.25. Colors normalize to the current peak; use readouts for absolute changes. Solid/fluid thermal coupling is not included.`}</p>
      <IgbtSpatialJobForm />
    </div>
  )
}

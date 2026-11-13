import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { ParamSlider } from '../components/ParamSlider'
import { SpeedControl } from '../components/SpeedControl'
import { FLUID_N as N, createFluidScene, stepFluidScene, fluidResult, defaultFluidSeeds, type FluidScene } from '../lib/sim/fluid'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useRunning, useStartRafLoop } from '../lib/hooks'
import { drainSteps } from '../lib/playback'
import { useLocale } from '../lib/i18n'

type Result = ReturnType<typeof fluidResult>
const defaultInlet = { speed: 0.3, density: 1, spacing: 10, width: 2 }
function cylinderObstacle() {
  return Array.from({ length: N * N }, (_, i) => (i % N - 30) ** 2 + (Math.floor(i / N) - 50) ** 2 <= 36 ? 1 : 0)
}
function ramp(t: number, out: Uint8ClampedArray, o: number) {
  t = Math.max(0, Math.min(1, t))
  out[o] = Math.min(255, t * 255 * 1.4)
  out[o + 1] = Math.min(255, Math.max(0, (t - 0.35) * 255 * 1.6))
  out[o + 2] = Math.min(255, Math.max(0, t * 255 * 0.6 + (t > 0.7 ? (t - 0.7) * 700 : 0)))
  out[o + 3] = 255
}

export function Fluid() {
  const { locale } = useLocale(), zh = locale === 'zh'
  const [params] = useSearchParams(), cylinder = params.get('preset') === 'cylinder'
  const { running, runningRef, setRunning } = useRunning()
  const startLoop = useStartRafLoop()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef<((result: Result | null) => void) | null>(null)
  const stepRef = useRef(0), speedRef = useRef(1)
  const [viscosity, setViscosity] = useState(0)
  const [diffusion, setDiffusion] = useState(0)
  const [rotation, setRotation] = useState(cylinder ? 0 : 0.02)
  const [decay, setDecay] = useState(cylinder ? 0.999 : 0.995)
  const [steps, setSteps] = useState(120)
  const [seeds, setSeeds] = useState<FluidScene['seeds']>(() => cylinder ? [] : defaultFluidSeeds())
  const [openBoundary, setOpenBoundary] = useState(cylinder)
  const [inlet, setInlet] = useState(defaultInlet)
  const [obstacle, setObstacle] = useState<number[] | undefined>(() => cylinder ? cylinderObstacle() : undefined)
  const [brushMode, setBrushMode] = useState<'seed' | 'solid' | 'erase'>('seed')
  const [brush, setBrush] = useState({ radius: 3, density: 40, vx: 0.5, vy: 0 })
  const [view, setView] = useState<'density' | 'speed'>('density')
  const [speed, setSpeed] = useState(1)
  const [resetKey, setResetKey] = useState(0)
  const [local, setLocal] = useState<Result | null>(null)
  const scene = useMemo<FluidScene>(() => ({ viscosity, diffusion, rotation, decay, steps, seeds, inlet: openBoundary ? inlet : undefined, obstacle }), [viscosity, diffusion, rotation, decay, steps, seeds, openBoundary, inlet, obstacle])
  const compute = useModuleCompute({ module: 'fluid', scene })
  const remote = compute.result?.module === 'fluid' ? compute.result.result : null
  const result = compute.snapshot ? remote : local

  useEffect(() => {
    const off = document.createElement('canvas'); off.width = N; off.height = N
    const octx = off.getContext('2d')!, img = octx.createImageData(N, N)
    drawRef.current = data => {
      const canvas = canvasRef.current, ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, canvas.width, canvas.height)
      const peak = Math.max(1e-6, data ? view === 'density' ? data.peakDensity : data.maxSpeed : 1)
      for (let i = 0; i < N * N; i++) {
        const value = data ? view === 'density' ? data.density[i] : Math.hypot(data.vx[i], data.vy[i]) : 0
        ramp(value / peak, img.data, i * 4)
        if ((data?.solid ?? obstacle)?.[i]) {
          img.data[i * 4] = 148; img.data[i * 4 + 1] = 163; img.data[i * 4 + 2] = 184
        }
      }
      octx.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = true
      ctx.drawImage(off, 0, 0, canvas.width, canvas.height)
    }
    return () => { drawRef.current = null }
  }, [view, obstacle])
  useEffect(() => { drawRef.current?.(result) }, [result, view, obstacle])

  useEffect(() => {
    stepRef.current = 0; setLocal(null)
    if (compute.snapshot) return
    const fluid = createFluidScene(scene), acc = { v: 0 }
    setLocal(fluidResult(fluid, 0)); setRunning(true)
    const stop = startLoop(() => {
      if (!runningRef.current || stepRef.current >= scene.steps) return
      const count = Math.min(drainSteps(acc, speedRef.current, 1), scene.steps - stepRef.current)
      if (!count) return
      for (let i = 0; i < count; i++) stepFluidScene(fluid, scene)
      stepRef.current += count; setLocal(fluidResult(fluid, stepRef.current))
      if (stepRef.current === scene.steps) setRunning(false)
    })
    return stop
  }, [scene, compute.snapshot, resetKey])
  useEffect(() => {
    if (!compute.snapshot && running && stepRef.current >= steps) setResetKey(key => key + 1)
  }, [running, compute.snapshot, steps])

  return <div>
    <PageHeader icon="🌊" title="二维流体 · 染料与速度场" titleEn="2D fluid · dye and velocity"
      subtitle="设置边界、障碍形状、初始速度与染料，计算二维流动。"
      subtitleEn="Set boundaries, obstacle geometry, initial velocity and dye to calculate 2D flow." />
    <div className="toolbar mb-4">
      <ParamSlider label={zh ? '黏度 ν*' : 'Viscosity ν*'} ariaLabel="Fluid viscosity" value={viscosity} min={0} max={0.0001} step={0.000005} format={v => v.toExponential(1)} onChange={setViscosity} />
      <ParamSlider label={zh ? '染料扩散 D*' : 'Dye diffusion D*'} ariaLabel="Fluid diffusion" value={diffusion} min={0} max={0.0001} step={0.000005} format={v => v.toExponential(1)} onChange={setDiffusion} />
      <ParamSlider label={zh ? '初始旋转系数' : 'Initial rotation'} ariaLabel="Fluid rotation" value={rotation} min={-0.04} max={0.04} step={0.005} onChange={setRotation} />
      <ParamSlider label={zh ? '每步染料保留比例' : 'Dye retained per step'} ariaLabel="Fluid decay" value={decay} min={0.9} max={1} step={0.001} onChange={setDecay} />
      <label className="flex items-center gap-2 text-slate-300">{zh ? '计算步数' : 'Compute steps'}
        <input aria-label="Fluid steps" type="number" min={1} max={2000} value={steps}
          onChange={e => setSteps(Math.max(1, Math.min(2000, Math.trunc(Number(e.target.value) || 1))))}
          className="min-h-11 w-24 rounded border border-edge bg-panel px-2" />
      </label>
    </div>
    <div className="toolbar mb-4">
      <label className="flex items-center gap-2 text-slate-300">{zh ? '边界条件' : 'Boundaries'}
        <select aria-label="Fluid boundary" value={openBoundary ? 'channel' : 'closed'} onChange={e => setOpenBoundary(e.target.value === 'channel')} className="rounded border border-edge bg-panel p-2">
          <option value="closed">{zh ? '封闭盒' : 'Closed box'}</option><option value="channel">{zh ? '左侧来流 → 右侧出口' : 'Left inlet → right outlet'}</option>
        </select>
      </label>
      {openBoundary && <>
        <ParamSlider label={zh ? '来流速度 U*' : 'Inlet speed U*'} ariaLabel="Fluid inlet speed" value={inlet.speed} min={0} max={3} step={0.05} onChange={speed => setInlet(v => ({ ...v, speed }))} />
        <ParamSlider label={zh ? '入口染料浓度' : 'Inlet dye'} ariaLabel="Fluid inlet dye" value={inlet.density} min={0} max={100} step={1} onChange={density => setInlet(v => ({ ...v, density }))} />
        <ParamSlider label={zh ? '染料条纹间距' : 'Dye stripe spacing'} ariaLabel="Fluid inlet spacing" value={inlet.spacing} min={1} max={N - 2} step={1} onChange={spacing => setInlet(v => ({ ...v, spacing, width: Math.min(v.width, spacing) }))} />
        <ParamSlider label={zh ? '染料条纹宽度' : 'Dye stripe width'} ariaLabel="Fluid inlet width" value={inlet.width} min={1} max={inlet.spacing} step={1} onChange={width => setInlet(v => ({ ...v, width }))} />
      </>}
    </div>
    <details className="mb-4 rounded-xl border border-edge p-3">
      <summary className="cursor-pointer text-sm text-slate-300">{zh ? '编辑模型 · 笔刷参数' : 'Edit model · brush parameters'}</summary>
      <div className="toolbar mt-3">
        <label className="flex items-center gap-2 text-slate-300">{zh ? '笔刷' : 'Brush'}
          <select aria-label="Fluid brush" value={brushMode} onChange={e => setBrushMode(e.target.value as typeof brushMode)} className="rounded border border-edge bg-panel p-2">
            <option value="seed">{zh ? '染料与速度' : 'Dye and velocity'}</option>
            <option value="solid">{zh ? '添加固体' : 'Add solid'}</option><option value="erase">{zh ? '擦除固体' : 'Erase solid'}</option>
          </select>
        </label>
        <ParamSlider label={zh ? '半径（格点）' : 'Radius (cells)'} ariaLabel="Fluid radius" value={brush.radius} min={1} max={12} step={1} onChange={radius => setBrush(b => ({ ...b, radius }))} />
        <ParamSlider label={zh ? '染料浓度' : 'Dye concentration'} ariaLabel="Fluid dye" value={brush.density} min={0} max={100} step={1} onChange={density => setBrush(b => ({ ...b, density }))} />
        <ParamSlider label="vx*" ariaLabel="Fluid vx" value={brush.vx} min={-4} max={4} step={0.1} onChange={vx => setBrush(b => ({ ...b, vx }))} />
        <ParamSlider label="vy*" ariaLabel="Fluid vy" value={brush.vy} min={-4} max={4} step={0.1} onChange={vy => setBrush(b => ({ ...b, vy }))} />
      </div>
    </details>
    <div className="toolbar mb-4">
      <button className="btn border border-edge" onClick={() => { setSeeds(defaultFluidSeeds()); setRotation(0.02); setDecay(0.995); setViscosity(0); setDiffusion(0); setOpenBoundary(false); setObstacle(undefined) }}>{zh ? '载入中心涡旋示例' : 'Load central vortex example'}</button>
      <button className="btn border border-edge" onClick={() => { setSeeds([]); setRotation(0); setDecay(0.999); setViscosity(0); setDiffusion(0); setOpenBoundary(true); setInlet(defaultInlet); setObstacle(cylinderObstacle()) }}>{zh ? '载入圆柱绕流示例' : 'Load cylinder flow example'}</button>
      <button className="btn border border-edge" onClick={() => { setSeeds([]); setRotation(0); setObstacle(undefined) }}>{zh ? '清空初态' : 'Clear initial state'}</button>
      <label className="flex items-center gap-2 text-slate-300">{zh ? '显示' : 'View'}
        <select aria-label="Fluid view" value={view} onChange={e => setView(e.target.value as typeof view)} className="rounded border border-edge bg-panel p-2">
          <option value="density">{zh ? '染料浓度' : 'Dye concentration'}</option><option value="speed">{zh ? '速度大小 |v*|' : 'Speed |v*|'}</option>
        </select>
      </label>
      {!compute.snapshot && <SpeedControl value={speed} onChange={v => { setSpeed(v); speedRef.current = v }} />}
      <span className="text-sm text-slate-400">{zh ? '初始区域：' : 'Initial regions: '}{seeds.length} / 64</span>
    </div>
    <p className="note mb-3">{zh ? '点击按当前笔刷添加染料、速度或固体；灰色为固体，边缘保留两层流体格点。编辑后从初态重算，示例参数均可修改。' : 'Click to paint dye, velocity or solids. Gray marks solids; two boundary cell layers stay clear. Edits restart from initial conditions; all example parameters are editable.'}</p>
    <canvas ref={canvasRef} width={N * 5} height={N * 5}
      onPointerDown={e => {
        const rect = e.currentTarget.getBoundingClientRect()
        const x = Math.max(1, Math.min(N - 2, Math.round((e.clientX - rect.left) / rect.width * N)))
        const y = Math.max(1, Math.min(N - 2, Math.round((e.clientY - rect.top) / rect.height * N)))
        if (brushMode === 'seed') setSeeds(previous => previous.length < 64 ? [...previous, { x, y, ...brush }] : previous)
        else setObstacle(previous => {
          const mask = previous ? [...previous] : Array<number>(N * N).fill(0)
          for (let dy = -brush.radius; dy <= brush.radius; dy++) for (let dx = -brush.radius; dx <= brush.radius; dx++) {
            const px = x + dx, py = y + dy
            if (dx * dx + dy * dy <= brush.radius ** 2 && px >= 2 && py >= 2 && px < N - 2 && py < N - 2) mask[px + py * N] = brushMode === 'solid' ? 1 : 0
          }
          return mask.some(Boolean) ? mask : undefined
        })
      }} role="img" aria-label={zh ? '二维流体染料与速度场' : '2D fluid dye and velocity field'}
      className="stage w-full max-w-2xl cursor-crosshair" style={{ aspectRatio: '1/1' }} />
    <div data-fluid-readout data-fluid-step={result?.steps ?? ''} className="mt-4 flex flex-wrap gap-5 rounded-xl border border-edge p-4 text-sm text-slate-300">
      <span>{zh ? '完成步数' : 'Completed steps'}: {result?.steps ?? '—'} / {steps}</span>
      <span>t* = {result?.time.toFixed(3) ?? '—'}</span>
      <span>{zh ? '最大染料浓度' : 'Peak dye'}: {result?.peakDensity.toFixed(4) ?? '—'}</span>
      <span>{zh ? '格点平均染料浓度' : 'Grid mean dye'}: {result?.meanDensity.toFixed(4) ?? '—'}</span>
      <span>{zh ? '最大 |v*|' : 'Peak |v*|'}: {result?.maxSpeed.toFixed(5) ?? '—'}</span>
      <span>{zh ? '投影残差（格点差分）' : 'Projection residual (grid difference)'}: {result?.gridDivergence.toExponential(2) ?? '—'}</span>
    </div>
    <p className="note mt-4">{zh
      ? '约化二维 Stable Fluids 模型，100×100 格点，Δt*=0.12，8 次原位 Gauss–Seidel 压力迭代。封闭盒采用法向速度反射；开放模式为左侧指定来流、右侧压力出口、上下滑移壁。染料是被动标量，半拉格朗日平流不保证其总量严格守恒。'
      : 'Reduced 2D Stable Fluids model, 100×100 grid, Δt*=0.12 and 8 in-place Gauss–Seidel pressure iterations. Closed mode reflects normal velocity; open mode uses a prescribed left inlet, right pressure outlet and top/bottom slip walls. Dye is a passive scalar; semi-Lagrangian advection does not conserve its total exactly.'}</p>
    <p className="note">{zh
      ? '颜色按当前场归一化，绝对变化看读数。每步保留比例为数值衰减参数；场值为 FP32，后端原生与本机 WASM 共用 Rust 混合精度内核。固体格点清零是定性近似，压力求解与平流尚未贴合固体边界；不提供可信阻力系数、出口回流处理、自由液面、湍流闭合或共轭传热。'
      : 'Colors normalize to the current field; use readouts for absolute changes. Retention is a numerical decay parameter. Fields use FP32; native and browser WASM share the Rust mixed-precision kernel. Solid-cell clearing is qualitative: pressure projection and advection are not body-fitted. This does not provide validated drag coefficients, outlet backflow treatment, free surfaces, turbulence closure or conjugate heat transfer.'}</p>
  </div>
}

import { useRunning } from '../lib/hooks/useRunning'
// src/pages/Fdtd.tsx
// 2D TMz：本机 WebGPU 预览或 Rust/WASM，保存任务使用统一 Agent。
// Ez 场以发散色标热图（红=正、蓝=负、白≈0）渲染；点击注入软源，预设算例切换介质/边界。
// 介质界面预设下显示菲涅耳正入射反射系数 |r|，把能量本体「电磁」节点的介质界面反射边可计算化。
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { createFdtdSim, type FdtdSim } from '../lib/webgpu/fdtdSim'
import type { FdtdScene } from '../lib/sim/fdtd'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { runGpuStepWithFallback } from '../lib/webgpu/gpuFallback'
import { fresnelReflection, FDTD_PRESETS as PRESETS, FDTD_NX as NX, FDTD_NY as NY, injectFdtdSceneSources, defaultFdtdSources, type FdtdBoundary, type FdtdPresetId as PresetId, type SourceShape, type SourceTime } from '../lib/sim/fdtd'
import { drainSteps } from '../lib/playback'
import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { SpeedControl } from '../components/SpeedControl'
import { termIdsForSimPath } from '../lib/termGlossary'
import { useLocale } from '../lib/i18n'

const SCALE = 3            // 画布像素/格（600×600）
const PX_W = NX * SCALE
const PX_H = NY * SCALE

const idx = (i: number, j: number) => j * NX + i

// ---------- Ez 发散色标：红=正、蓝=负、白≈0 ----------
function divergingColor(v: number, out: Uint8ClampedArray, o: number) {
  // v ∈ [-1,1]（已按本帧 max|Ez| 归一）。0→白，正→红，负→蓝。
  const t = Math.max(-1, Math.min(1, v))
  const a = Math.abs(t)
  let r: number, g: number, b: number
  if (t >= 0) { r = 255; g = 255 - a * 235; b = 255 - a * 235 } // 白→红
  else { r = 255 - a * 235; g = 255 - a * 235; b = 255 }        // 白→蓝
  out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255
}

export function Fdtd() {
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef = useRef<FdtdSim | null>(null)
  const pageTerms = useMemo(() => termIdsForSimPath('fdtd'), [])
  const tStepRef = useRef(0)
  const drawRef = useRef<((field: Float32Array) => void) | null>(null)
  const lastFieldRef = useRef<Float32Array>(new Float32Array(NX * NY))
  const [sources, setSources] = useState(() => defaultFdtdSources('free'))
  const [steps, setSteps] = useState(240)
  const [stepsDone, setStepsDone] = useState(0)
  const [preset, setPreset] = useState<PresetId>('free')
  const [shape, setShape] = useState<SourceShape>('line')
  const [time, setTime] = useState<SourceTime>('pulse')
  const [omega, setOmega] = useState(0.3)
  const [boundary, setBoundary] = useState<FdtdBoundary>('mur')
  const [showMedia, setShowMedia] = useState(true)
  const showMediaRef = useRef(showMedia)
  showMediaRef.current = showMedia
  const [backend, setBackend] = useState<'webgpu' | 'cpu' | '…'>('…')
  const { running, runningRef, toggle, setRunning } = useRunning()
  const [sps, setSps] = useState(0)
  const playRef = useRef(1)
  const [playSpeed, setPlaySpeed] = useState(1)
  /** 递增以无刷新重建仿真（重置场）。 */
  const [resetKey, setResetKey] = useState(0)

  const scene = useMemo<FdtdScene>(() => ({ preset, boundary, shape, time, omega, steps, sources }), [preset, boundary, shape, time, omega, steps, sources])
  const compute = useModuleCompute({ module: 'fdtd', scene })
  const remote = compute.result?.module === 'fdtd' ? compute.result : null
  const current = PRESETS.find((p) => p.id === preset) ?? PRESETS[0]
  const reflEps = current.fresnelEps

  // 预设/边界/resetKey 变化 → 整体重建仿真。
  useEffect(() => {
    let disposed = false
    let stepsAcc = 0, lastTick = performance.now()
    const acc = { v: 0 } // 变速播放余量累加器
    const p = PRESETS.find((x) => x.id === preset) ?? PRESETS[0]
    const epsArr = p.eps?.() ?? null
    const pecArr = p.pec?.() ?? null
    tStepRef.current = 0
    setStepsDone(0)
    setSps(0)
    // 离屏画布按网格分辨率绘 ImageData，再放大到舞台画布。
    const off = document.createElement('canvas'); off.width = NX; off.height = NY
    const octx = off.getContext('2d')!
    const img = octx.createImageData(NX, NY)

    // 介质/理想导体 叠层预烘到离屏画布：preset/边界重建时只画一次，每帧 drawImage 复用。
    const mediaOff = document.createElement('canvas')
    mediaOff.width = NX; mediaOff.height = NY
    const mctx = mediaOff.getContext('2d')!
    mctx.clearRect(0, 0, NX, NY)
    if (epsArr) {
      mctx.fillStyle = 'rgba(167,139,250,0.16)'
      for (let j = 0; j < NY; j++)
        for (let i = 0; i < NX; i++)
          if (epsArr[idx(i, j)] > 1.001) mctx.fillRect(i, j, 1, 1)
    }
    if (pecArr) {
      mctx.fillStyle = 'rgba(226,232,240,0.55)'
      for (let j = 0; j < NY; j++)
        for (let i = 0; i < NX; i++)
          if (pecArr[idx(i, j)] !== 0) mctx.fillRect(i, j, 1, 1)
    }

    const draw = (Ez: Float32Array) => {
      lastFieldRef.current = Ez
      let amax = 1e-6
      for (let k = 0; k < Ez.length; k++) { const a = Math.abs(Ez[k]); if (a > amax) amax = a }
      for (let k = 0; k < Ez.length; k++) divergingColor(Ez[k] / amax, img.data, k * 4)
      octx.putImageData(img, 0, 0)
      const c = canvasRef.current; if (!c) return
      const ctx = c.getContext('2d')!
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(off, 0, 0, c.width, c.height)
      // 半透明叠加：介质区（εR>1）紫罗兰、PEC 挡板灰白。showMedia 走 ref，不入 effect deps。
      if (showMediaRef.current) {
        ctx.drawImage(mediaOff, 0, 0, c.width, c.height)
      }
    }

    drawRef.current = draw
    draw(new Float32Array(NX * NY))
    if (compute.snapshot) return () => { drawRef.current = null }
    setBackend('…')
    setRunning(true)

    let stopLoop = () => {}
    ;(async () => {
      let sim = await createFdtdSim({
        Nx: NX, Ny: NY, boundary,
        eps: epsArr ?? undefined,
        pecMask: pecArr,
      })
      if (disposed) { sim.destroy(); return }
      simRef.current = sim
      setBackend(sim.backend)
      const loop = async () => {
        if (disposed) return
        if (runningRef.current) {
          const result = await runGpuStepWithFallback({
            backend: sim.backend,
            work: async () => {
              const STEPS = Math.min(scene.steps - tStepRef.current, drainSteps(acc, playRef.current, 4)) // 变速：慢放时可为 0（场静止一两帧）
              for (let s = 0; s < STEPS; s++) {
                if (disposed) return { Ez: new Float32Array(0), STEPS: 0 }
                injectFdtdSceneSources(scene, tStepRef.current, (i, j, amplitude) => sim.injectSource(i, j, amplitude))
                await sim.step(1)
                if (disposed) return { Ez: new Float32Array(0), STEPS: 0 }
                tStepRef.current++
              }
              const { Ez } = await sim.read()
              return { Ez, STEPS }
            },
            onFallback: async () => {
              try { sim.destroy() } catch { /* GPU device already lost */ }
              sim = await createFdtdSim({
                Nx: NX, Ny: NY, boundary,
                eps: epsArr ?? undefined,
                pecMask: pecArr,
                preferCpu: true,
              })
              if (disposed) { sim.destroy(); return }
              simRef.current = sim
              setBackend(sim.backend)
              // Rebuild the complete source timeline with the fresh CPU field.
              tStepRef.current = 0
              setStepsDone(0)
              draw(new Float32Array(NX * NY))
            },
          })
          if (disposed) return
          if (result.ok) {
            setStepsDone(tStepRef.current)
            if (tStepRef.current >= scene.steps) setRunning(false)
            stepsAcc += result.value.STEPS
            draw(result.value.Ez)
            const now = performance.now()
            if (now - lastTick > 500) {
              setSps(Math.round((stepsAcc * 1000) / (now - lastTick)))
              stepsAcc = 0; lastTick = now
            }
          }
        }
      }
      if (!disposed) stopLoop = startLoop(loop)
    })().catch((error) => { if (!disposed) { compute.reportLocalError?.(error); setRunning(false) } })

    return () => { disposed = true; stopLoop(); simRef.current?.destroy(); simRef.current = null; drawRef.current = null }
    // The complete scene owns preparation; view-only controls redraw without rebuilding.
  }, [scene, compute.snapshot, resetKey])

  useEffect(() => {
    const field = compute.snapshot ? Float32Array.from(remote?.Ez ?? new Float32Array(NX * NY)) : lastFieldRef.current
    drawRef.current?.(field)
  }, [remote, compute.snapshot, showMedia, scene])

  // The shared Resume control starts a fresh run when the previous interval is complete.
  useEffect(() => {
    if (!compute.snapshot && running && tStepRef.current >= scene.steps) setResetKey(key => key + 1)
  }, [running, compute.snapshot, scene.steps])

  // 点击画布 → 在该处放置源发射器。
  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current; if (!c) return
    const rect = c.getBoundingClientRect()
    const i = Math.round(((e.clientX - rect.left) / rect.width) * NX)
    const j = Math.round(((e.clientY - rect.top) / rect.height) * NY)
    const ci = Math.max(1, Math.min(NX - 2, i))
    const cj = Math.max(1, Math.min(NY - 2, j))
    setSources(previous => previous.length < 32 ? [...previous, { i: ci, j: cj }] : previous)
  }

  return (
    <div>
      <PageHeader
        icon="📡"
        title="时域电磁场 · 麦克斯韦"
        subtitle="在交错网格上积分麦克斯韦旋度方程，看电磁波在真空与介质中传播、反射、衍射与会聚。打开即注入默认线/点源，也可点击画布加源；切换介质界面、双缝、透镜、谐振腔等经典算例——电磁能量的可计算验证。"
      />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">{zh ? '读仿真时' : 'When reading the sim'}</span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <span className="text-slate-600">
          {zh ? '（悬停看一句人话；含 CFL 稳定）' : '(hover for plain language; CFL stability)'}
        </span>
        <Link to="/method-depth?m=method-fdtd" className="text-wave/80 hover:text-wave">
          {zh ? '原理深度树 →' : 'Principle depth tree →'}
        </Link>
      </p>

      <div className="toolbar mb-5">
        {!compute.snapshot && <>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${backend === 'webgpu' ? 'bg-emerald-500/15 text-emerald-300' : backend === 'cpu' ? 'bg-amber-500/15 text-amber-300' : 'bg-edge text-slate-400'}`}>
          {zh
            ? `本机：${backend === 'webgpu' ? `图形加速 (${sps} 步/秒)` : backend === 'cpu' ? `本机计算 (${sps} 步/秒)` : '初始化…'}`
            : `Local: ${backend === 'webgpu' ? `GPU (${sps} steps/s)` : backend === 'cpu' ? `CPU (${sps} steps/s)` : 'init…'}`}
        </span>
        <button onClick={toggle}
          className="btn border border-edge text-slate-300">
          {running ? (zh ? '⏸ 暂停' : '⏸ Pause') : zh ? '▶ 继续' : '▶ Resume'}
        </button>
        <button onClick={() => { setSources(defaultFdtdSources(preset)); setResetKey((k) => k + 1) }}
          className="btn border border-edge text-slate-300">
          {zh ? '↺ 重置场' : '↺ Reset field'}
        </button>
        <SpeedControl value={playSpeed} onChange={(v) => { setPlaySpeed(v); playRef.current = v }} />

        </>}
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '计算步数' : 'Steps'}
          <input aria-label={zh ? 'FDTD 计算步数' : 'FDTD steps'} type="number" min={1} max={2000} value={steps} className="w-20 bg-transparent border border-edge rounded px-1"
            onChange={(e) => setSteps(Math.min(2000, Math.max(1, Math.floor(Number(e.target.value) || 1))))} />
        </label>
        <span data-fdtd-step={compute.snapshot ? remote?.steps ?? 0 : stepsDone}>
          {zh ? '已计算' : 'Computed'}: {compute.snapshot ? remote?.steps ?? 0 : stepsDone} / {steps}
        </span>

        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '预设算例' : 'Preset'}
          <select value={preset} onChange={(e) => {
            const id = e.target.value as PresetId
            setPreset(id)
            setSources(defaultFdtdSources(id))
            if (id === 'cavity') setShape('point')
            const p = PRESETS.find((x) => x.id === id)
            if (p) { setBoundary(p.boundary) }
          }} className="bg-transparent border border-edge rounded px-1">
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{zh ? p.label : p.labelEn}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '源类型' : 'Source'}
          <select value={shape} onChange={(e) => { const v = e.target.value as SourceShape; setShape(v) }}
            className="bg-transparent border border-edge rounded px-1">
            <option value="line">{zh ? '线源（平面波）' : 'Line (plane wave)'}</option>
            <option value="point">{zh ? '点源（圆波）' : 'Point (circular)'}</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '时间波形' : 'Time form'}
          <select value={time} onChange={(e) => { const v = e.target.value as SourceTime; setTime(v) }}
            className="bg-transparent border border-edge rounded px-1">
            <option value="pulse">{zh ? '高斯脉冲' : 'Gaussian pulse'}</option>
            <option value="cw">{zh ? '连续正弦' : 'CW sine'}</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '源相位增量（rad/步）' : 'Phase increment (rad/step)'} {omega.toFixed(2)}
          <input type="range" min={0.05} max={1.2} step={0.01} value={omega}
            onChange={(e) => { const v = Number(e.target.value); setOmega(v) }} />
        </label>

        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '边界' : 'Boundary'}
          <select value={boundary} onChange={(e) => setBoundary(e.target.value as FdtdBoundary)}
            className="bg-transparent border border-edge rounded px-1">
            <option value="mur">{zh ? '吸波边界' : 'Absorbing (Mur)'}</option>
            <option value="pec">{zh ? '金属壁全反射' : 'PEC walls'}</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-slate-400">
          <input type="checkbox" checked={showMedia} onChange={(e) => setShowMedia(e.target.checked)} />
          {zh ? '介质/挡板叠加' : 'Overlay media / masks'}
        </label>
      </div>

      <p className="mb-3 text-xs text-slate-400">
        {zh ? '前后端从同一算例与波源开始。本机可预览演化，也可免登录计算；发布任务才需登录；修改参数或添加波源会清除旧场。Rust/WASM 使用 FP32 场与 FP64 运算，WebGPU 预览为 FP32。' : 'Both locations start from the same scene and sources. Preview or compute locally without signing in; sign in only to publish a task. Editing inputs clears the field. Rust/WASM uses FP32 fields and FP64 arithmetic; WebGPU previews use FP32.'}
        {' '}{zh ? '波源' : 'Sources'}: {sources.length} / 32
      </p>
      <div className="flex flex-wrap gap-5">
        <canvas
          ref={canvasRef}
          width={PX_W}
          height={PX_H}
          onMouseDown={onClick}
          role="img"
          aria-label={zh ? '二维时域有限差电磁场模拟画布' : '2D FDTD Maxwell canvas'}
          className="stage cursor-crosshair"
          style={{ width: 'min(100%, 560px)', aspectRatio: `${NX}/${NY}` }}
        />
        <div className="flex flex-col gap-3 min-w-[230px] max-w-[300px]">
          <div className="rounded border border-edge p-3 text-sm text-slate-300">
            <div className="text-xs text-slate-500 mb-2">
              {zh ? '当前算例' : 'Current case'}
            </div>
            <div className="text-slate-200 mb-1">{zh ? current.label : current.labelEn}</div>
            <div className="text-xs text-slate-400 leading-relaxed">
              {zh ? current.hint : current.hintEn}
            </div>
            <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#ef4444' }} />
                {zh ? '电场>0' : 'E>0'}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm border border-slate-600" style={{ background: '#ffffff' }} />
                ≈0
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: '#3b82f6' }} />
                {zh ? '电场<0' : 'E<0'}
              </span>
            </div>
          </div>

          {reflEps && (
            <div className="rounded border border-wave/40 bg-wave/5 p-3 text-sm text-slate-300">
              <div className="text-xs text-wave/80 mb-1 font-medium">
                {zh ? '叙事卡 · 菲涅耳正入射反射' : 'Card · Fresnel normal incidence'}
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                {zh
                  ? `介质界面相对介电常数：${reflEps[0]} → ${reflEps[1]}（折射率 ${Math.sqrt(reflEps[0]).toFixed(2)}、${Math.sqrt(reflEps[1]).toFixed(2)}）。正入射菲涅耳反射系数幅值`
                  : `Interface εR: ${reflEps[0]} → ${reflEps[1]} (n = ${Math.sqrt(reflEps[0]).toFixed(2)}, ${Math.sqrt(reflEps[1]).toFixed(2)}). Normal-incidence Fresnel |r|`}
              </p>
              <div className="my-2 text-center tabular-nums text-slate-200">
                |r| = |(n₁−n₂)/(n₁+n₂)| ={' '}
                <span className="text-wave font-semibold">{fresnelReflection(reflEps[0], reflEps[1]).toFixed(3)}</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                {zh ? (
                  <>
                    功率反射率 ≈ <span className="text-slate-200 tabular-nums">{(fresnelReflection(reflEps[0], reflEps[1]) ** 2).toFixed(3)}</span>。
                    这是能量本体<span className="text-wave"> 「电磁」节点</span>上「介质界面反射 / 菲涅耳」转换边的
                    <span className="text-slate-200">可计算化验证</span>：解析反射系数与左侧时域有限差分网格里
                    真实传播到界面、自发产生的反射波幅度互为印证——公式与仿真双向对照。
                  </>
                ) : (
                  <>
                    Power reflectance ≈{' '}
                    <span className="text-slate-200 tabular-nums">
                      {(fresnelReflection(reflEps[0], reflEps[1]) ** 2).toFixed(3)}
                    </span>
                    . A computable check of the ontology edge “dielectric interface / Fresnel” under the{' '}
                    <span className="text-wave">EM</span> node: analytic |r| cross-validates the reflected amplitude that spontaneously appears on the FDTD grid.
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      </div>

      <p className="note">
        {zh
          ? '交错网格蛙跳推进：每步先更新磁场，再更新电场，最后施加边界（吸波开放边界或金属壁全反射）。逐格介电常数实现介质界面与透镜，金属掩膜实现双缝与谐振腔；时间步须满足稳定性条件。Rust 原生与 WASM 共用数值内核；WebGPU 采用相同离散方程与 FP32 精度。点击画布注入软源（波可透过叠加）。'
          : 'Yee leapfrog: update H, then E, then apply boundaries (Mur open or PEC walls). Per-cell εR makes interfaces/lenses; PEC masks make slits/cavities; Δt must meet CFL. Native and WASM share the Rust kernel; WebGPU uses the same discrete equations in FP32. Click to inject soft sources (waves pass through).'}
      </p>
    </div>
  )
}

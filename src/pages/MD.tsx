import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { GromacsGroPreview } from '../components/gromacs/GromacsGroPreview'
import { GromacsMdpPreview } from '../components/gromacs/GromacsMdpPreview'
import { TermChip } from '../components/TermChip'
import { SpeedControl } from '../components/SpeedControl'
import { ParamSlider } from '../components/ParamSlider'
import { termIdsForSimPath } from '../lib/termGlossary'
import { createMdScene, advanceMdScene, type MdSim } from '../lib/webgpu/mdSim'
import { runGpuStepWithFallback } from '../lib/webgpu/gpuFallback'
import { MD_DT, MD_PARTICLE_COUNTS, mdBoxLength, mdMaxSteps, mdResult, type MdScene, type MdHistory, type MdFrame } from '../lib/sim/md'
import { MATERIALS, findMaterial, materialScale } from '../lib/sim/materials'
import { tStarToKelvin, reducedTimeToPs, diffusionReducedToNm2PerPs, pressureReducedToSI } from '../lib/sim/units'
import { drainSteps } from '../lib/playback'
import { useRunning } from '../lib/hooks/useRunning'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useLocale } from '../lib/i18n'

const PX = 648
type ColorMode = 'speed' | 'tracer'
type MdResult = ReturnType<typeof mdResult>

export function MD() {
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const { running, runningRef, setRunning } = useRunning()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef = useRef<MdSim | null>(null)
  const stepRef = useRef(0)
  const playRef = useRef(1)
  const colorRef = useRef<ColorMode>('speed')
  const [backend, setBackend] = useState<'webgpu' | 'cpu' | '…'>('…')
  const [temperature, setTemperature] = useState(0.4)
  const [N, setN] = useState(256)
  const [steps, setSteps] = useState(240)
  const [seed, setSeed] = useState(1)
  const [thermostat, setThermostat] = useState(true)
  const [barostat, setBarostat] = useState(false)
  const [targetP, setTargetP] = useState(0.5)
  const [tauP, setTauP] = useState(0.5)
  const [playSpeed, setPlaySpeed] = useState(1)
  const [colorMode, setColorMode] = useState<ColorMode>('speed')
  const [materialName, setMaterialName] = useState('氩')
  const [showSI, setShowSI] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [local, setLocal] = useState<MdResult | null>(null)
  const pageTerms = useMemo(() => termIdsForSimPath('md'), [])
  const scene = useMemo<MdScene>(() => ({ N, temperature, thermostat, barostat, targetP, tauP, steps, seed }),
    [N, temperature, thermostat, barostat, targetP, tauP, steps, seed])
  const compute = useModuleCompute({ module: 'md', scene })
  const remote = compute.result?.module === 'md' ? compute.result.result : null
  const result = compute.snapshot ? remote : local
  const obs = result?.observables
  const material = findMaterial(materialName) ?? MATERIALS[0]
  const scale = materialScale(material)

  useEffect(() => {
    let disposed = false, stopLoop = () => {}
    let lastUi = 0
    const acc = { v: 0 }
    const history: MdHistory = []
    stepRef.current = 0
    setLocal(null)
    setBackend('…')
    drawMd(canvasRef.current, null, scene.barostat, colorRef.current)
    if (compute.snapshot) return
    setRunning(true)
    const publish = (frame: MdFrame, force = false) => {
      drawMd(canvasRef.current, frame, scene.barostat, colorRef.current)
      const now = performance.now()
      if (force || now - lastUi >= 100) {
        lastUi = now
        setLocal(mdResult(frame, stepRef.current, history, scene.barostat))
      }
    }
    ;(async () => {
      let sim = await createMdScene(scene)
      if (disposed) { sim.destroy(); return }
      simRef.current = sim
      setBackend(sim.backend)
      const initial = await sim.read()
      if (disposed) return
      history.push({ step: 0, time: 0, msd: initial.observables.msd })
      publish(initial, true)
      stopLoop = startLoop(async () => {
        if (disposed || !runningRef.current || stepRef.current >= scene.steps) return
        // Playback changes the number of fixed physics batches per frame, never their size.
        const batches = drainSteps(acc, playRef.current, 1)
        for (let batch = 0; batch < batches && stepRef.current < scene.steps; batch++) {
          const next = await runGpuStepWithFallback({
            backend: sim.backend,
            work: () => advanceMdScene(sim, scene, stepRef.current, history),
            onFallback: async () => {
              if (disposed) return
              sim.destroy()
              sim = await createMdScene(scene, true, 2)
              if (disposed) { sim.destroy(); return }
              simRef.current = sim
              setBackend('cpu')
              const initial = await sim.read()
              if (disposed) return
              stepRef.current = 0; history.length = 0; acc.v = 0
              history.push({ step: 0, time: 0, msd: initial.observables.msd })
              publish(initial, true)
            },
          })
          if (!next.ok || disposed) return
          stepRef.current = next.value.steps
          publish(next.value.frame, stepRef.current === scene.steps)
        }
        if (stepRef.current === scene.steps) setRunning(false)
      })
    })().catch(error => { if (!disposed) { compute.reportLocalError?.(error); setRunning(false) } })
    return () => {
      disposed = true; stopLoop()
      simRef.current?.destroy(); simRef.current = null
    }
  }, [compute.snapshot, scene, resetKey])

  useEffect(() => {
    drawMd(canvasRef.current, result, barostat, colorMode)
  }, [result, barostat, colorMode])

  useEffect(() => {
    if (!compute.snapshot && running && stepRef.current >= scene.steps) setResetKey(key => key + 1)
  }, [running, compute.snapshot, scene.steps])

  return (
    <div>
      <PageHeader icon="⚛️" title="分子动力学"
        subtitle="从相同初态推进二维 Lennard–Jones 粒子，观察能量、压强、均方位移与径向分布。" />
      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
        {pageTerms.map(id => <TermChip key={id} id={id} mode="compact" />)}
        <Link to="/method-depth?m=method-md-lj" className="text-wave/80 hover:text-wave">
          {zh ? '原理深度树 →' : 'Principle depth tree →'}
        </Link>
      </p>
      <div className="toolbar mb-4">
        <ParamSlider label={zh ? '初始 / 目标温度 T*' : 'Initial / target temperature T*'} ariaLabel="MD temperature"
          min={0.05} max={2.5} step={0.01} value={temperature} onChange={setTemperature} />
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '粒子数' : 'Particles'}
          <select aria-label="MD particles" value={N} onChange={e => {
            const count = Number(e.target.value)
            setN(count); setSteps(value => Math.min(value, mdMaxSteps(count)))
          }} className="rounded border border-edge bg-panel px-2 py-2">
            {MD_PARTICLE_COUNTS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '计算步数' : 'Steps'}
          <input aria-label="MD steps" type="number" min={1} max={mdMaxSteps(N)} value={steps}
            onChange={e => setSteps(Math.max(1, Math.min(mdMaxSteps(N), Math.round(Number(e.target.value)) || 1)))}
            className="w-24 rounded border border-edge bg-panel px-2 py-2" />
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '初态种子' : 'Initial seed'}
          <input aria-label="MD seed" type="number" min={0} max={4294967295} value={seed}
            onChange={e => setSeed(Math.max(0, Math.min(4294967295, Math.round(Number(e.target.value)) || 0)))}
            className="w-24 rounded border border-edge bg-panel px-2 py-2" />
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          <input aria-label="MD thermostat" type="checkbox" checked={thermostat} onChange={e => setThermostat(e.target.checked)} />
          {zh ? '速度缩放控温' : 'Velocity-rescaling thermostat'}
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          <input aria-label="MD barostat" type="checkbox" checked={barostat} onChange={e => setBarostat(e.target.checked)} />
          {zh ? '弱耦合控压' : 'Weak-coupling barostat'}
        </label>
        {barostat && <>
          <ParamSlider label={zh ? '目标压强 P*' : 'Target pressure P*'} ariaLabel="MD target pressure"
            min={-1} max={8} step={0.05} value={targetP} onChange={setTargetP} />
          <ParamSlider label={zh ? '控压时间 τ*' : 'Barostat time τ*'} ariaLabel="MD barostat time"
            min={0.1} max={3} step={0.05} value={tauP} onChange={setTauP} />
        </>}
      </div>
      <p className="note mb-4">
        {zh ? '修改计算参数会从所选种子重建晶格。当前粒子数最多运行 ' : 'Parameter edits restart the seeded lattice. Maximum steps for this particle count: '}
        {mdMaxSteps(N)}{zh ? ' 步。' : '.'}
        {barostat && (zh ? ' 控压使用 CPU；盒缩放也会计入原始均方位移。' : ' The barostat uses CPU; raw MSD includes box rescaling.')}
      </p>
      <div className="toolbar mb-4">
        {!compute.snapshot && <SpeedControl value={playSpeed} onChange={value => { setPlaySpeed(value); playRef.current = value }} />}
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '配色' : 'Color'}
          <select aria-label="MD color" value={colorMode} onChange={e => {
            const mode = e.target.value as ColorMode
            setColorMode(mode); colorRef.current = mode
          }} className="rounded border border-edge bg-panel px-2 py-2">
            <option value="speed">{zh ? '速度' : 'Speed'}</option>
            <option value="tracer">{zh ? '示踪粒子' : 'Tracers'}</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '单位标度' : 'Unit scale'}
          <select aria-label="MD unit scale" value={materialName} onChange={e => setMaterialName(e.target.value)}
            className="max-w-full rounded border border-edge bg-panel px-2 py-2">
            {MATERIALS.filter(m => m.sigma_nm > 0 && m.epsilon_kJmol > 0 && m.mass_amu > 0).map(m =>
              <option key={m.name} value={m.name}>{zh ? m.name : m.nameEn ?? m.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          <input aria-label="MD scaled units" type="checkbox" checked={showSI} onChange={e => setShowSI(e.target.checked)} />
          {zh ? '显示换算值' : 'Show scaled values'}
        </label>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        {compute.target === 'backend'
          ? (zh ? '后端返回最终粒子状态与统计曲线 · CPU / 混合精度' : 'Backend final particles and statistics · CPU / mixed precision')
          : compute.snapshot ? (zh ? '本机计算任务 · Rust / WASM · 混合精度' : 'Local compute job · Rust / WASM · mixed precision')
          : backend === '…' ? (zh ? '初始化…' : 'Initializing…')
            : backend === 'webgpu' ? 'WebGPU · FP32 / JS reduction' : 'Rust / WASM · FP32 storage / FP64 arithmetic'}
      </p>
      <div className="flex flex-wrap items-start gap-5">
        <canvas ref={canvasRef} width={PX} height={PX} role="img"
          aria-label={zh ? '分子动力学粒子位置' : 'Molecular dynamics particle positions'}
          className="stage w-full max-w-[520px]" style={{ aspectRatio: '1/1' }} />
        <div className="flex min-w-0 flex-1 basis-[260px] flex-col gap-3">
          <div data-md-readout data-md-step={result?.steps ?? ''} className="rounded-xl border border-edge p-4 text-sm text-slate-300">
            <div className="mb-2 text-slate-400">{zh ? '计算结果（约化单位）' : 'Results (reduced units)'}</div>
            <Metric label={zh ? '完成步数' : 'Completed steps'} value={result?.steps} digits={0} />
            <Metric label={zh ? '时间 t*' : 'Time t*'} value={result?.time} />
            <Metric label={zh ? '温度 T*' : 'Temperature T*'} value={obs?.temperature} />
            <Metric label={zh ? '压强 P*' : 'Pressure P*'} value={obs?.pressure} />
            <Metric label={zh ? '盒长 L*' : 'Box L*'} value={obs?.boxL} />
            <Metric label={zh ? '面积 A*' : 'Area A*'} value={obs?.volume} />
            <Metric label={zh ? '数密度 ρ*' : 'Number density ρ*'} value={obs?.density} />
            <Metric label={zh ? '动能' : 'Kinetic energy'} value={obs?.kinetic} />
            <Metric label={zh ? '势能' : 'Potential energy'} value={obs?.potential} />
            <Metric label={zh ? '总能' : 'Total energy'} value={obs?.total} />
            <Metric label={zh ? '均方位移 MSD*' : 'MSD*'} value={obs?.msd} digits={6} />
            <Metric label={zh ? 'MSD 斜率估计 D*' : 'MSD slope estimate D*'} value={result?.diffusion?.D} digits={6} />
            {showSI && obs && result && <div className="mt-3 border-t border-edge pt-2 text-xs leading-relaxed text-slate-400" data-md-scaled>
              <div>{tStarToKelvin(obs.temperature, scale).toFixed(2)} K · {pressureReducedToSI(obs.pressure, scale, 2).toExponential(3)} N/m</div>
              <div>{zh ? '经过时间' : 'Elapsed time'}: {reducedTimeToPs(result.time, scale).toFixed(6)} ps</div>
              <div>Δt = {reducedTimeToPs(MD_DT, scale).toFixed(6)} ps/{zh ? '步' : 'step'}</div>
              {result.diffusion && <div>D ≈ {diffusionReducedToNm2PerPs(result.diffusion.D, scale).toExponential(3)} nm²/ps</div>}
            </div>}
          </div>
          <div className="rounded-xl border border-edge p-4">
            <div className="mb-2 text-xs text-slate-400">{zh ? '均方位移与实际积分时间' : 'MSD versus integration time'}</div>
            <MsdChart data={result?.history ?? []} />
          </div>
          <div className="rounded-xl border border-edge p-4">
            <div className="mb-2 text-xs text-slate-400">{zh ? '最终构型的径向分布 g(r*)' : 'Snapshot radial distribution g(r*)'}</div>
            <GrChart data={result?.rdf ?? null} />
          </div>
        </div>
      </div>
      <p className="note mt-4">
        {zh
          ? '当前为二维单组分 Lennard–Jones 模型，截断半径 2.5σ，采用周期边界和速度 Verlet 积分。单位标度仅使用 σ、ε、质量做换算；材料的电荷、键合及其他力场不参与计算。'
          : '2D single-component Lennard–Jones model with cutoff 2.5σ, periodic boundaries and velocity Verlet. Unit scaling uses σ, ε and mass only; material charges, bonds and other force fields are not included.'}
      </p>
      <p className="note">
        {zh
          ? 'MSD 使用未回绕坐标；曲线斜率只是当前时间窗的估计，短轨迹不能确认为长期扩散系数。控压时不报告扩散系数。速度缩放和弱耦合控压不保证严格正则或等温等压系综采样，也不据此判定相态。'
          : 'MSD uses unwrapped coordinates. Its fitted slope is a finite-window estimate, not proof of long-time diffusion; no diffusion estimate is reported with the barostat. Velocity rescaling and weak pressure coupling do not ensure exact canonical or NPT sampling or identify phases.'}
      </p>
      <details className="mt-3 text-xs text-slate-500">
        <summary className="cursor-pointer py-2">{zh ? '所选单位标度的参考参数' : 'Selected unit-scale reference'}</summary>
        <p>{zh ? material.name : material.nameEn ?? material.name}: σ = {material.sigma_nm} nm · ε = {material.epsilon_kJmol} kJ/mol · m = {material.mass_amu} amu</p>
        <p className="mt-2 break-words">{material.source}</p>
      </details>
      <GromacsGroPreview />
      <GromacsMdpPreview />
    </div>
  )
}

function drawMd(canvas: HTMLCanvasElement | null, frame: Pick<MdResult, 'pos' | 'speed' | 'observables'> | MdFrame | null, barostat: boolean, mode: ColorMode) {
  const ctx = canvas?.getContext('2d')
  if (!ctx || !canvas) return
  ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  if (!frame) return
  const size = PX / Math.max(frame.observables.boxL, mdBoxLength(frame.speed.length))
  const box = frame.observables.boxL * size
  ctx.strokeStyle = barostat ? '#a78bfa55' : '#1f2433'; ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, box - 1, box - 1)
  let vmax = 0.5
  for (const speed of frame.speed) vmax = Math.max(vmax, speed)
  for (let i = 0; i < frame.speed.length; i++) {
    const t = Math.min(1, frame.speed[i] / vmax)
    ctx.fillStyle = mode === 'tracer' ? (i < 24 ? '#f43f5e' : '#3b4252') : 'rgb(' + Math.round(60 + t * 195) + ',90,' + Math.round(220 - t * 200) + ')'
    ctx.beginPath(); ctx.arc(frame.pos[i * 2] * size, frame.pos[i * 2 + 1] * size, size * 0.32, 0, Math.PI * 2); ctx.fill()
  }
}

function Metric({ label, value, digits = 3 }: { label: string; value?: number; digits?: number }) {
  return <div className="flex justify-between gap-3 tabular-nums"><span className="text-slate-500">{label}</span><span>{value == null ? '—' : value.toFixed(digits)}</span></div>
}

function MsdChart({ data }: { data: MdHistory }) {
  const w = 260, h = 100, max = Math.max(1e-8, ...data.map(p => p.msd)), end = data.at(-1)?.time ?? 0
  const points = data.map(p => (end ? p.time / end * w : 0) + ',' + (h - p.msd / max * h)).join(' ')
  return <>
    <svg viewBox={'0 0 ' + w + ' ' + h} className="w-full" aria-label="MD MSD curve">
      {data.length > 1 && <><text x={3} y={11} fill="#94a3b8" fontSize={10}>{max.toExponential(2)} MSD*</text>
        <polyline points={points} fill="none" stroke="#a78bfa" strokeWidth={1.5} /></>}
    </svg>
    {data.length > 1 && <div className="mt-1 flex justify-between text-xs tabular-nums text-slate-500"><span>0</span><span>{end.toFixed(3)} t*</span></div>}
  </>
}

function GrChart({ data }: { data: MdResult['rdf'] | null }) {
  const w = 260, h = 100, max = Math.max(1.2, ...(data?.g ?? []))
  const points = data?.g.map((g, i) => i / (data.g.length - 1) * w + ',' + (h - g / max * h)).join(' ')
  return <>
    <svg viewBox={'0 0 ' + w + ' ' + h} className="w-full" aria-label="MD RDF curve">
      {data && <><text x={3} y={11} fill="#94a3b8" fontSize={10}>{max.toFixed(2)} g(r*)</text>
        <line x1={0} y1={h - h / max} x2={w} y2={h - h / max} stroke="#334155" strokeDasharray="3 3" />
        <polyline points={points} fill="none" stroke="#34d399" strokeWidth={1.5} /></>}
    </svg>
    {data && <div className="mt-1 flex justify-between text-xs tabular-nums text-slate-500"><span>{data.r[0].toFixed(2)}</span><span>{data.r.at(-1)?.toFixed(2)} r*</span></div>}
  </>
}

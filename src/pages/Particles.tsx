import { useEffect, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ParamSlider } from '../components/ParamSlider'
import { SpeedControl } from '../components/SpeedControl'
import { useRunning } from '../lib/hooks/useRunning'
import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { createParticleScene, advanceParticleScene, type ParticleSim } from '../lib/webgpu/particleSim'
import { runGpuStepWithFallback } from '../lib/webgpu/gpuFallback'
import { particleCount, particleProperties, particleResult, type ParticleScene } from '../lib/sim/particles'
import { pedotParticleScene } from '../lib/sim/pedotpss'
import { validateModuleInput } from '../lib/sim/module-compute'
import { parseLammpsData, LAMMPS_DATA_MAX_BYTES } from '../lib/sim/lammps-data'
import { MD_BATCH_STEPS, mdMaxSteps } from '../lib/sim/md'
import { drainSteps } from '../lib/playback'
import { useLocale } from '../lib/i18n'

const PX = 600
const KIND_STYLE = [
  { fill: '#fb7185', r: 0.34 }, { fill: '#38bdf8', r: 0.40 },
  { fill: '#fde047', r: 0.22 }, { fill: '#475569', r: 0.18 },
]
type Result = ReturnType<typeof particleResult>

export function Particles() {
  const { locale } = useLocale(), zh = locale === 'zh'
  const { running, runningRef, setRunning } = useRunning()
  const startLoop = useStartRafLoop()
  const canvasRef = useRef<HTMLCanvasElement>(null), simRef = useRef<ParticleSim | null>(null)
  const drawRef = useRef<((data: Result | null) => void) | null>(null)
  const stepRef = useRef(0), speedRef = useRef(1)
  const [scene, setScene] = useState<ParticleScene>(() => pedotParticleScene(64))
  const [draft, setDraft] = useState(() => JSON.stringify(scene, null, 2))
  const [draftFormat, setDraftFormat] = useState<'json' | 'lammps'>('json')
  const [importing, setImporting] = useState(false)
  const importRef = useRef<AbortController | null>(null)
  useEffect(() => () => { importRef.current?.abort(); importRef.current = null }, [])
  const [inputError, setInputError] = useState<string | null>(null)
  const [speed, setSpeed] = useState(1)
  const [resetKey, setResetKey] = useState(0)
  const [backend, setBackend] = useState<'cpu' | 'webgpu' | '…'>('…')
  const [local, setLocal] = useState<Result | null>(null)
  const steps = scene.steps, N = particleCount(scene)
  const applyModel = () => {
    try {
      const next = draftFormat === 'lammps' ? parseLammpsData(draft) : JSON.parse(draft)
      validateModuleInput({ module: 'particles', scene: next })
      setScene(next); setInputError(null); setDraftFormat('json'); setDraft(JSON.stringify(next, null, 2))
    } catch (error) { setInputError(error instanceof Error ? error.message : String(error)) }
  }
  const importModel = async (file?: File) => {
    importRef.current?.abort()
    const controller = new AbortController(); importRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(new Error('Model import timed out')), 15000)
    setImporting(true); setInputError(null)
    try {
      let text: string
      if (file) {
        if (file.size > LAMMPS_DATA_MAX_BYTES) throw new Error('Model file exceeds 512 KiB')
        text = await file.text()
      } else {
        const response = await fetch('/datasets/lammps-lj-2d.data', { signal: controller.signal })
        if (!response.ok) throw new Error(`LAMMPS example: HTTP ${response.status}`)
        text = await response.text()
      }
      if (importRef.current !== controller) return
      if (controller.signal.aborted) throw controller.signal.reason
      if (new TextEncoder().encode(text).length > LAMMPS_DATA_MAX_BYTES) throw new Error('Model file exceeds 512 KiB')
      text = text.replace(/^\uFEFF/, '')
      setDraft(text); setDraftFormat(text.trimStart().startsWith('{') ? 'json' : 'lammps')
    } catch (error) {
      if (importRef.current === controller) setInputError(error instanceof Error ? error.message : String(error))
    } finally {
      window.clearTimeout(timeout)
      if (importRef.current === controller) { importRef.current = null; setImporting(false) }
    }
  }
  const loadExample = (name: 'pedot' | 'binary') => {
    importRef.current?.abort(); importRef.current = null; setImporting(false); setDraftFormat('json')
    const next = name === 'pedot' ? pedotParticleScene(64) : {
      species: [{ name: 'A', count: 32, charge: 1, sigma: 0.8, epsilon: 1 }, { name: 'B', count: 32, charge: -1, sigma: 0.8, epsilon: 0.5 }],
      boxL: 10, temperature: 0.5, thermostat: true, epsR: 24, lambdaD: 4, kCoulomb: 1, steps: 120, seed: 1,
    }
    setDraft(JSON.stringify(next, null, 2)); setScene(next); setInputError(null)
  }
  const compute = useModuleCompute({ module: 'particles', scene })
  const remote = compute.result?.module === 'particles' ? compute.result.result : null
  const result = compute.snapshot ? remote : local
  const obs = result?.observables

  useEffect(() => {
    let disposed = false, stopLoop = () => {}
    const acc = { v: 0 }, initialKind = scene.positions ? particleProperties(scene).kind : null
    const draw = (data: Result | null) => {
      const c = canvasRef.current, ctx = c?.getContext('2d')
      if (!c || !ctx) return
      ctx.fillStyle = '#0a0a12'; ctx.fillRect(0, 0, PX, PX)
      const positions = data?.pos ?? scene.positions, kind = data?.kind ?? initialKind
      if (!positions || !kind) return
      const scale = PX / (data?.observables.boxL ?? scene.boxL)
      for (let i = 0; i < kind.length; i++) {
        const style = KIND_STYLE[kind[i] % KIND_STYLE.length]
        ctx.fillStyle = style.fill; ctx.beginPath()
        ctx.arc(positions[i * 2] * scale, positions[i * 2 + 1] * scale, style.r * scale, 0, 2 * Math.PI); ctx.fill()
      }
    }
    drawRef.current = draw; stepRef.current = 0; setLocal(null); draw(null)
    if (compute.snapshot) return () => { drawRef.current = null }
    setBackend('…'); setRunning(true)
    ;(async () => {
      let sim = await createParticleScene(scene)
      if (disposed) { sim.destroy(); return }
      simRef.current = sim
      const prepare = async () => {
        const frame = await sim.read()
        if (disposed) return
        stepRef.current = 0; acc.v = 0; setBackend(sim.backend)
        const data = particleResult(frame, 0); draw(data); setLocal(data)
      }
      const fallback = async () => {
        try { sim.destroy() } catch { /* device may already be lost */ }
        if (disposed) return
        sim = await createParticleScene(scene, true, 2)
        if (disposed) { sim.destroy(); return }
        simRef.current = sim
        await prepare()
      }
      await runGpuStepWithFallback({ backend: sim.backend, work: prepare, onFallback: fallback })
      if (disposed) return
      stopLoop = startLoop(async () => {
        if (disposed || !runningRef.current || stepRef.current >= scene.steps) return
        const batches = Math.min(drainSteps(acc, speedRef.current, 1), Math.ceil((scene.steps - stepRef.current) / MD_BATCH_STEPS))
        if (!batches) return
        const output = await runGpuStepWithFallback({
          backend: sim.backend,
          work: async () => {
            let data: Result | null = null
            for (let i = 0; i < batches; i++) {
              const next = await advanceParticleScene(sim, scene, stepRef.current)
              if (disposed) return null
              stepRef.current = next.steps
              if (i === batches - 1) data = particleResult(next.frame, next.steps)
            }
            return data
          },
          onFallback: fallback,
        })
        if (disposed || !output.ok || !output.value) return
        draw(output.value); setLocal(output.value)
        if (stepRef.current === scene.steps) setRunning(false)
      })
    })().catch(error => { if (!disposed) { compute.reportLocalError?.(error); setRunning(false) } })
    return () => { disposed = true; stopLoop(); simRef.current?.destroy(); simRef.current = null; drawRef.current = null }
  }, [scene, compute.snapshot, resetKey])
  useEffect(() => { if (compute.snapshot) drawRef.current?.(remote) }, [remote, scene, compute.snapshot])
  useEffect(() => {
    if (!compute.snapshot && running && stepRef.current >= steps) setResetKey(key => key + 1)
  }, [running, compute.snapshot, steps])

  return <div>
    <PageHeader icon="🧪" title="粒子与材料模型" titleEn="Particle and material models"
      subtitle="输入模型，选择相互作用参数，在本机或后端运行分子动力学。示例可直接修改。"
      subtitleEn="Define a model and interaction parameters, then run molecular dynamics locally or on the backend. Examples are editable inputs." />
    <div className="toolbar mb-3">
      <button onClick={() => loadExample('pedot')} className="btn">{zh ? '载入 PEDOT:PSS 示例' : 'Load PEDOT:PSS example'}</button>
      <button onClick={() => loadExample('binary')} className="btn">{zh ? '载入双组分示例' : 'Load binary example'}</button>
      <button onClick={() => void importModel()} disabled={importing} className="btn">{zh ? '载入 LAMMPS 示例' : 'Load LAMMPS example'}</button>
      {!compute.snapshot && <SpeedControl value={speed} onChange={v => { setSpeed(v); speedRef.current = v }} />}
    </div>
    <details className="mb-4 rounded-xl border border-edge p-4" open>
      <summary className="mb-3 cursor-pointer text-sm text-slate-300">{zh ? '模型输入 · 编辑后应用' : 'Model input · apply after editing'}</summary>
      <div className="toolbar mb-3">
        <label className="flex items-center gap-2 text-slate-300">{zh ? '输入格式' : 'Input format'}
          <select aria-label="Particle input format" disabled={importing} value={draftFormat} onChange={e => setDraftFormat(e.target.value as typeof draftFormat)} className="rounded border border-edge bg-panel p-2">
            <option value="json">{zh ? '模型 JSON' : 'Model JSON'}</option><option value="lammps">LAMMPS data · 2D LJ</option>
          </select>
        </label>
        <label className="btn cursor-pointer border border-edge">{zh ? '选择模型文件' : 'Choose model file'}
          <input aria-label="Particle model file" type="file" accept=".data,.lmp,.txt,.json" className="sr-only"
            onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) void importModel(file) }} />
        </label>
        <a className="text-sm text-sky-300 underline" href="/datasets/lammps-lj-2d.data" download>{zh ? '下载 LAMMPS 示例文件' : 'Download LAMMPS example data'}</a>
        {importing && <span role="status" className="text-sm text-slate-400">{zh ? '正在读取模型…' : 'Reading model…'}</span>}
      </div>
      <p className="note mb-2">{zh
        ? 'species 定义名称、数量、电荷、σ 与 ε；boxL 设置周期盒长，epsR / lambdaD / kCoulomb 设置屏蔽相互作用。positions 为 x,y 坐标，velocities 为 vx,vy 初速，kind 指定每个粒子的物种序号；省略时使用种子生成。所有数值为约化单位，当前粒子质量均为 1。'
        : 'species defines names, counts, charges, sigma and epsilon; boxL sets the periodic box, and epsR / lambdaD / kCoulomb set screening. positions contains x,y coordinates, velocities contains vx,vy, and kind sets each particle’s species index; omitted arrays are generated using the seed. Values are reduced units; all particle masses are 1.'}</p>
      {draftFormat === 'lammps' && <p className="note mb-2">{zh
        ? '按二维周期正方盒、LJ 约化单位导入 atomic 数据：质量 1、截断 2.5、势能平移、Lorentz–Berthelot 混合。保留文件位置与初速，缺省初速为零；粒子按原子 ID 排序。默认继续 5 步 NVE。data 文件不包含完整运行设置；暂不执行 LAMMPS 脚本、键合、三维或其他力场。'
        : 'Import atomic data into a square 2D periodic LJ box: mass 1, cutoff 2.5, shifted energy and Lorentz–Berthelot mixing. File positions/velocities are retained; absent velocities are zero. Particles follow ascending atom IDs. Continue 5 NVE steps by default. Data files lack full run settings; scripts, bonds, 3D and other force fields are not supported.'}</p>}
      <textarea aria-label="Particle model JSON" disabled={importing} value={draft} onChange={e => setDraft(e.target.value)} spellCheck={false}
        className="block h-60 w-full rounded border border-edge bg-panel p-3 font-mono text-xs text-slate-200" />
      <button onClick={applyModel} disabled={importing} className="btn mt-3">{zh ? '应用模型' : 'Apply model'}</button>
      {inputError && <p role="alert" className="mt-2 text-sm text-rose-400">{inputError}</p>}
    </details>
    <div className="toolbar mb-4">
      {(!scene.velocities || scene.thermostat) && <ParamSlider label="T*" ariaLabel="Particle temperature" value={scene.temperature} min={0.1} max={2} step={0.01}
        onChange={temperature => { const next = { ...scene, temperature }; setScene(next); setDraftFormat('json'); setDraft(JSON.stringify(next, null, 2)) }} />}
      <label className="flex items-center gap-2 text-slate-300">{zh ? '计算步数' : 'Compute steps'}
        <input aria-label="Particle steps" type="number" min={1} max={mdMaxSteps(N)} value={steps}
          onChange={e => { const next = { ...scene, steps: Math.max(1, Math.min(mdMaxSteps(N), Math.trunc(Number(e.target.value) || 1))) }; setScene(next); setDraftFormat('json'); setDraft(JSON.stringify(next, null, 2)) }}
          className="min-h-11 w-24 rounded border border-edge bg-panel px-2" />
      </label>
    </div>
    {scene.velocities && <p className="note mb-3">{zh ? '初始速度来自模型输入；可在上方 velocities 中修改。' : 'Initial velocities come from the model input; edit velocities above to change them.'}</p>}
    <p className="note mb-3">{zh ? '当前模型' : 'Active model'}: {N} {zh ? '粒子' : 'particles'}, L*={scene.boxL}, εr={scene.epsR}, λD*={scene.lambdaD}.
      {' '}{compute.target === 'backend' ? (zh ? '后端 CPU · 混合精度。' : 'Backend CPU · mixed precision.')
        : compute.snapshot ? (zh ? '本机计算任务 · Rust / WASM · 混合精度。' : 'Local compute job · Rust / WASM · mixed precision.')
        : (zh ? '本机：' : 'Local: ') + (backend === 'webgpu' ? 'WebGPU · FP32' : backend === 'cpu' ? 'Rust / WASM · mixed' : '…')}</p>
    <div className="flex flex-wrap items-start gap-5">
      <canvas ref={canvasRef} width={PX} height={PX} role="img" aria-label={zh ? '用户模型粒子场' : 'User-model particle field'}
        className="stage w-full max-w-[520px]" style={{ aspectRatio: '1/1' }} />
      <div className="min-w-0 flex-1 basis-[260px] space-y-3">
        <div data-particles-readout data-particles-step={result?.steps ?? ''} className="rounded-xl border border-edge p-4 text-sm text-slate-300">
          <Metric label={zh ? '完成步数' : 'Completed steps'} value={result?.steps} digits={0} />
          <Metric label="t*" value={result?.time} />
          <Metric label="T*" value={obs?.temperature} />
          <Metric label={zh ? '动能' : 'Kinetic energy'} value={obs?.kinetic} />
          <Metric label={zh ? '势能' : 'Potential energy'} value={obs?.potential} />
          <Metric label={zh ? '总能' : 'Total energy'} value={obs?.total} />
          <Metric label="P*" value={obs?.pressure} />
          <Metric label="MSD*" value={obs?.msd} />
          <Metric label={zh ? '总电荷 q*' : 'Total charge q*'} value={obs?.totalCharge} digits={0} />
        </div>
        <div className="rounded-xl border border-edge p-4">
          <p className="mb-2 text-sm text-slate-400">{zh ? '当前结构 g(r*)' : 'Instantaneous structure g(r*)'}</p>
          <GrABChart data={result} />
          <p className="mt-2 text-xs text-rose-400">{zh ? '全部粒子 g(r*)' : 'All-particle g(r*)'} · <span className="text-slate-500">g=1</span></p>
        </div>
        <div className="rounded-xl border border-edge p-4 text-xs text-slate-400">
          <p className="mb-2">{zh ? '已应用的物种参数' : 'Applied species parameters'}</p>
          {scene.species.map((sp, i) => <div key={sp.name} className="flex flex-wrap justify-between gap-2 py-1"><span className="break-all" style={{ color: KIND_STYLE[i % KIND_STYLE.length].fill }}>{sp.name} × {sp.count}</span><span>q*={sp.charge} · σ*={sp.sigma.toFixed(2)} · ε*={sp.epsilon.toFixed(2)}</span></div>)}
        </div>
      </div>
    </div>
    <p className="note mt-4">{zh
      ? '当前方法：二维周期边界、等质量粒子、异质 LJ + 屏蔽库仑、速度 Verlet，Δt*=0.005，截断 r*=2.5。恒温按固定四步分批；模型编辑后从初态重算。'
      : 'Current method: 2D periodic boundaries, equal-mass particles, heterogeneous LJ + screened Coulomb, velocity Verlet, Δt*=0.005 and cutoff r*=2.5. Thermostat batches contain four steps; model edits restart from the initial state.'}</p>
    <p className="note">{zh
      ? 'PEDOT:PSS 和双组分只是输入示例，不是专用求解器。当前没有键链、电子结构、化学反应或电导预测；需要这些物理的模型应使用相应方法，不能仅通过修改材料名称得到。'
      : 'PEDOT:PSS and the binary mixture are input examples, not dedicated solvers. Bonds, electronic structure, reactions and conductivity are not modeled here; those require corresponding methods, not a change of material name.'}</p>

  </div>
}

function Metric({ label, value, digits = 4 }: { label: string; value?: number; digits?: number }) {
  return <div className="flex justify-between gap-3 py-0.5 tabular-nums"><span className="text-slate-500">{label}</span><span>{value == null ? '—' : value.toFixed(digits)}</span></div>
}

function GrABChart({ data }: { data: Result | null }) {
  const w = 300, h = 160, pad = 26, xmax = data ? data.observables.boxL / 2 : 10
  const max = data ? Math.max(1.5, ...data.rdf.g) : 1.5
  const x = (r: number) => pad + r / xmax * (w - pad - 8), y = (g: number) => h - pad - g / max * (h - pad - 8)
  return <svg viewBox={'0 0 ' + w + ' ' + h} className="block w-full" aria-label="Particle radial distribution">
    <path d={'M '+pad+' 6 V '+(h-pad)+' H '+(w-6)} fill="none" stroke="#475569" />
    <line x1={pad} y1={y(1)} x2={w-8} y2={y(1)} stroke="#475569" strokeDasharray="3 3" />
    {data && <polyline points={data.rdf.r.map((r, i) => x(r)+','+y(data.rdf.g[i])).join(' ')}
      fill="none" stroke="#fb7185" strokeWidth={1.5} />}
    <text x={pad} y={h-7} fill="#94a3b8" fontSize={10}>0</text><text x={w-48} y={h-7} fill="#94a3b8" fontSize={10}>{xmax.toFixed(1)} r*</text>
    <text x={2} y={12} fill="#94a3b8" fontSize={10}>{max.toFixed(1)}</text>
  </svg>
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ParamSlider } from '../components/ParamSlider'
import { SpeedControl } from '../components/SpeedControl'
import { HEAT_1D_M as M, HEAT_1D_L as L, HEAT_1D_X0 as X0, initHeat1D, ftcsStep, heat1DResult, type Heat1D, type Heat1DScene } from '../lib/sim/heaterfc'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { usePlayController, useRafLoop, useRunning } from '../lib/hooks'
import { useLocale } from '../lib/i18n'

type Result = ReturnType<typeof heat1DResult>

export function Heaterfc() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const fieldRef = useRef<HTMLCanvasElement>(null)
  const hRef = useRef<Heat1D | null>(null)
  const stepRef = useRef(0)
  const { running, runningRef, setRunning } = useRunning(true)
  const [kappa, setKappa] = useState(0.5)
  const [steps, setSteps] = useState(240)
  const [resetKey, setResetKey] = useState(0)
  const [local, setLocal] = useState<Result | null>(null)
  const play = usePlayController(3)
  const scene = useMemo<Heat1DScene>(() => ({ kappa, steps }), [kappa, steps])
  const compute = useModuleCompute({ module: 'heaterfc', scene })
  const result = compute.target === 'backend' ? compute.result?.module === 'heaterfc' ? compute.result.result : null : local

  useEffect(() => {
    stepRef.current = 0
    if (compute.target === 'backend') { hRef.current = null; setLocal(null); return }
    hRef.current = initHeat1D(M, L, scene.kappa, X0)
    setLocal(heat1DResult(hRef.current, 0))
    setRunning(true)
    return () => { hRef.current = null }
  }, [scene, compute.target, resetKey])

  useRafLoop(() => {
    const h = hRef.current
    if (!h || compute.target !== 'browser') return
    const n = Math.min(scene.steps - stepRef.current, play.stepsThisFrame(runningRef.current))
    if (!n) return
    for (let step = 0; step < n; step++) ftcsStep(h)
    stepRef.current += n
    setLocal(heat1DResult(h, stepRef.current))
    if (stepRef.current >= scene.steps) setRunning(false)
  }, [scene, compute.target])

  useEffect(() => {
    if (compute.target === 'browser' && running && stepRef.current >= scene.steps) setResetKey(key => key + 1)
  }, [running, compute.target, scene.steps])

  useEffect(() => {
    const c = fieldRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    if (!result) return
    for (let i = 0; i < M; i++) {
      const t = Math.max(0, Math.min(1, result.temperatures[i]))
      ctx.fillStyle = `rgb(${Math.round(30 + t * 215)},${Math.round(58 + t * 100)},${Math.round(138 - t * 110)})`
      ctx.fillRect(i, 0, 1, 1)
    }
  }, [result])

  return (
    <div>
      <PageHeader icon="🌡️" title="一维热扩散" titleEn="1D heat diffusion"
        subtitle="观察冷热界面随时间展宽，将数值温度剖面与无限域误差函数解析解比较。"
        subtitleEn="Observe a hot/cold interface spread over time and compare the numerical temperature profile with the infinite-domain erfc solution." />
      <div className="toolbar mb-5">
        <ParamSlider label={zh ? '扩散率 κ' : 'Diffusivity κ'} ariaLabel="Heat 1D diffusivity" value={kappa} min={0.1} max={1.5} step={0.05} format={v => v.toFixed(2)} onChange={setKappa} />
        <label className="flex items-center gap-2 text-slate-300">{zh ? '计算步数' : 'Steps'}
          <input type="number" aria-label="Heat 1D steps" min={1} max={2000} value={steps} onChange={e => setSteps(Math.max(1, Math.min(2000, Math.trunc(Number(e.target.value) || 1))))} className="min-h-11 w-24 rounded border border-edge bg-canvas px-2" />
        </label>
        {compute.target === 'browser' && <SpeedControl value={play.playSpeed} onChange={play.setPlaySpeed} />}
      </div>
      <canvas ref={fieldRef} width={M} height={1} role="img" aria-label={zh ? '一维热扩散温度场' : '1D heat diffusion field'} className="stage mb-4 w-full max-w-3xl" style={{ height: 56, imageRendering: 'pixelated' }} />
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
        <section className="min-w-0 rounded-xl border border-edge p-4">
          <h2 className="mb-3 font-medium text-slate-200">{zh ? '温度剖面与解析参考' : 'Temperature profile and analytic reference'}</h2>
          {result ? <ErfcChart result={result} /> : <p className="py-16 text-center text-slate-400">{zh ? '尚无当前参数的计算结果' : 'No result for the current inputs'}</p>}
          <p className="mt-2 text-sm text-slate-400">{zh ? '琥珀：数值解 · 青色虚线：无限域解析参考 · 灰线：界面与扩散长度' : 'Amber: numerical · cyan dashed: infinite-domain reference · grey: interface and diffusion length'}</p>
        </section>
        <div data-heaterfc-step={result?.steps ?? 0} data-heaterfc-readout className="space-y-3 rounded-xl border border-edge p-4 text-sm text-slate-300">
          <h2 className="font-medium">{zh ? '计算结果（约化量）' : 'Results (reduced units)'}</h2>
          <Metric label={zh ? '完成步数' : 'Completed steps'} value={result?.steps} digits={0} />
          <Metric label={zh ? '时间' : 'Time'} value={result?.time} />
          <Metric label={zh ? '扩散长度' : 'Diffusion length'} value={result?.diffusionLength} />
          <Metric label={zh ? '最大绝对偏差' : 'Max absolute difference'} value={result?.maxError} digits={5} />
        </div>
      </div>
      <p className="note">{zh
        ? '使用 201 个节点的显式差分与 FP32 温度场，两端温度固定为 1 和 0。稳定数 r = κΔt/Δx² 固定为 0.4；改变扩散率会改变每步对应时间，相同步数的剖面保持一致。实际偏差受离散步长、初始阶跃和有限边界影响，不承诺全程小于某个固定百分比。'
        : 'Explicit differences on 201 nodes with FP32 temperatures and fixed endpoints at 1 and 0. The stability ratio κΔt/Δx² is 0.4: changing diffusivity changes the time per step, while equal step counts produce equal profiles. Differences depend on discretization, the initial step and finite boundaries; no fixed error percentage is guaranteed.'}</p>
    </div>
  )
}

function Metric({ label, value, digits = 3 }: { label: string; value?: number; digits?: number }) {
  return <div className="flex justify-between gap-3 tabular-nums"><span className="text-slate-400">{label}</span><span>{value?.toFixed(digits) ?? '—'}</span></div>
}

function ErfcChart({ result }: { result: Result }) {
  const w = 520, h = 260, pad = 28
  const xx = (x: number) => pad + x / L * (w - pad - 8)
  const yy = (t: number) => h - pad - t * (h - pad - 8)
  const curve = (values: number[]) => values.map((t, i) => `${xx(i * L / (M - 1)).toFixed(2)},${yy(t).toFixed(2)}`).join(' ')
  const dl = result.diffusionLength
  return <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Numerical and analytic heat profiles">
    <line x1={pad} y1={h - pad} x2={w - 4} y2={h - pad} stroke="#475569" />
    <line x1={pad} y1={4} x2={pad} y2={h - pad} stroke="#475569" />
    <line x1={xx(X0)} y1={4} x2={xx(X0)} y2={h - pad} stroke="#475569" strokeDasharray="2 3" />
    {dl > 0 && dl < L / 2 && [-dl, dl].map(offset => <line key={offset} x1={xx(X0 + offset)} y1={yy(0)} x2={xx(X0 + offset)} y2={yy(1)} stroke="#475569" />)}
    <polyline points={curve(result.reference)} fill="none" stroke="#2dd4bf" strokeWidth={2} strokeDasharray="5 3" />
    <polyline points={curve(result.temperatures)} fill="none" stroke="#f59e0b" strokeWidth={1.5} />
    <text x={pad + 4} y={18} fill="#94a3b8" fontSize={12}>T</text>
    <text x={w - 22} y={h - 6} fill="#94a3b8" fontSize={12}>x</text>
  </svg>
}

import { WasmLaser } from '../lib/sim/wasm-fields'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useRunning } from '../lib/hooks/useRunning'
import { useStartRafLoop } from '../lib/hooks/useRafLoop'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { laserCharacteristics, DEFAULT, LASER_DEFAULT_PUMP, LASER_MAX_PUMP, LASER_DT, type LaserState } from '../lib/sim/laser'
import { termIdsForSimPath } from '../lib/termGlossary'
import { useLocale } from '../lib/i18n'

export function Laser() {
  const { runningRef, setRunning } = useRunning()
  const startLoop = useStartRafLoop()
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const zhRef = useRef(zh)
  zhRef.current = zh
  const cavityRef = useRef<HTMLCanvasElement>(null)
  const curveRef = useRef<HTMLCanvasElement>(null)
  const kernelRef = useRef<WasmLaser | null>(null)
  const [pump, setPump] = useState(LASER_DEFAULT_PUMP)
  const [steps, setSteps] = useState(500)
  const [stepsDone, setStepsDone] = useState(0)
  const [readout, setReadout] = useState<LaserState>({ N: 0, S: 0 })
  const pageTerms = useMemo(() => termIdsForSimPath('laser'), [])
  const compute = useModuleCompute({ module: 'laser', pump, steps })
  const remote = compute.result?.module === 'laser' ? compute.result : null
  const preview = useMemo(() => {
    if (compute.snapshot) return { data: remote?.characteristics ?? null, error: '' }
    try {
      kernelRef.current ??= new WasmLaser()
      return { data: laserCharacteristics(pump, kernelRef.current), error: '' }
    } catch (error) { return { data: null, error: error instanceof Error ? error.message : String(error) } }
  }, [pump, compute.snapshot, remote])
  const characteristics = preview.data
  const displayed = compute.snapshot ? remote?.state : characteristics ? readout : undefined
  const Pmax = LASER_MAX_PUMP

  useEffect(() => {
    let disposed = false, t = 0, completed = 0
    const owner = !compute.snapshot && characteristics ? kernelRef.current : null
    let state: LaserState = { N: 0, S: 0 }
    setReadout(state); setStepsDone(0)
    if (owner) { owner.configure(DEFAULT, pump, LASER_DT); owner.setState(state); setRunning(true) }

    const drawCavity = (st: LaserState) => {
      const c = cavityRef.current!; const ctx = c.getContext('2d')!; const W = c.width, Hh = c.height
      ctx.fillStyle = '#070912'; ctx.fillRect(0, 0, W, Hh)
      const mY = Hh / 2, x0 = 50, x1 = W - 90
      const inten = st.S / (st.S + 20) // 0..1 光强
      // 腔内光束辉光
      const grad = ctx.createLinearGradient(x0, 0, x1, 0)
      grad.addColorStop(0, `rgba(255,90,90,${0.15 + inten * 0.6})`)
      grad.addColorStop(1, `rgba(255,160,90,${0.15 + inten * 0.7})`)
      ctx.fillStyle = grad; ctx.fillRect(x0, mY - 10 - inten * 18, x1 - x0, 20 + inten * 36)
      // 增益介质里的受激原子（密度 ∝ N）
      const atoms = Math.min(120, Math.floor(st.N * 6))
      for (let i = 0; i < atoms; i++) {
        const ax = x0 + ((i * 53 % (x1 - x0)))
        const ay = mY + Math.sin(i * 1.7 + t) * 22
        ctx.fillStyle = 'rgba(124,92,255,0.5)'; ctx.fillRect(ax, ay, 2, 2)
      }
      // 镜面
      ctx.fillStyle = '#cbd5e1'; ctx.fillRect(x0 - 6, mY - 40, 5, 80)        // 全反镜
      ctx.fillStyle = '#64748b'; ctx.fillRect(x1, mY - 40, 5, 80)            // 输出耦合镜（半透）
      const en = !zhRef.current
      ctx.fillStyle = '#94a3b8'; ctx.font = '11px sans-serif'
      ctx.fillText(en ? 'HR mirror' : '全反镜', x0 - 10, mY - 46)
      ctx.fillText(en ? 'OC mirror' : '输出镜', x1 - 8, mY - 46)
      // 输出激光束
      ctx.fillStyle = `rgba(255,80,80,${inten})`; ctx.fillRect(x1 + 5, mY - 3 - inten * 4, 80, 6 + inten * 8)
      ctx.fillStyle = '#cbd5e1'
      ctx.fillText(en ? 'Laser out' : '激光输出', x1 + 8, mY - 14)
      // 条形指示
      ctx.fillStyle = '#7c5cff'; ctx.fillRect(x0, Hh - 22, (st.N / 8) * (x1 - x0) > x1 - x0 ? x1 - x0 : (st.N / 8) * (x1 - x0), 6)
      ctx.fillStyle = '#94a3b8'
      ctx.fillText(en ? 'Population inversion' : '粒子数反转', x0, Hh - 26)
    }

    const drawCurve = () => {
      const c = curveRef.current!; const ctx = c.getContext('2d')!; const W = c.width, Hh = c.height
      ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, W, Hh)
      const en = !zhRef.current
      if (!characteristics) return
      const { curve, threshold: Pth, pumpMax: Pmax } = characteristics
      const Smax = Math.max(...curve.map(c => c.s), 1)
      const px = (p: number) => 30 + (p / Pmax) * (W - 40)
      const py = (s: number) => Hh - 24 - (s / Smax) * (Hh - 40)
      // 阈值线
      ctx.strokeStyle = 'rgba(255,107,107,0.5)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(px(Pth), 8); ctx.lineTo(px(Pth), Hh - 24); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = '#ff8787'; ctx.font = '10px sans-serif'
      ctx.fillText(en ? 'Threshold' : '阈值', px(Pth) + 3, 16)
      // 曲线
      ctx.strokeStyle = '#3ad6ff'; ctx.lineWidth = 2; ctx.beginPath()
      curve.forEach((c2, i) => { i ? ctx.lineTo(px(c2.p), py(c2.s)) : ctx.moveTo(px(c2.p), py(c2.s)) }); ctx.stroke()
      // 当前工作点
      const s = characteristics.steadyPhotons
      ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.arc(px(pump), py(s), 4, 0, 7); ctx.fill()
      ctx.fillStyle = '#94a3b8'
      ctx.fillText(en ? 'Pump →' : '泵浦 →', W - 52, Hh - 8)
      ctx.fillText(en ? '↑ Photons out' : '↑ 输出光子数', 4, 14)
    }

    const loop = () => {
      if (disposed) return
      if (compute.snapshot || !owner) {
        if (remote) { t = remote.steps * 0.015; drawCavity(remote.state) }
        else {
          const c = cavityRef.current!
          c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
        }
      } else {
        if (runningRef.current) {
          try {
            if (completed === steps) { completed = 0; owner.setState({ N: 0, S: 0 }) }
            const count = Math.min(4, steps - completed)
            owner.advance(count); completed += count; state = owner.snapshot()
            setStepsDone(completed); setReadout(state)
            if (completed === steps) setRunning(false)
          } catch (error) { compute.reportLocalError?.(error); setRunning(false) }
        }
        t = completed * 0.015
        drawCavity(state)
      }
      drawCurve()
    }
    const stopLoop = startLoop(loop)
    return () => { disposed = true; stopLoop() }
  }, [pump, steps, compute.snapshot, remote, characteristics, setRunning])

  const lasing = (displayed?.S ?? 0) > 1
  return (
    <div>
      <PageHeader
        icon="🔦"
        title="激光原理 · 受激辐射与阈值"
        subtitle="泵浦把原子抽运到高能级形成「粒子数反转」；腔内光子经受激辐射被相干放大、在两镜间往返。泵浦超过阈值时光子数雪崩式增长——起振，从输出镜射出激光。拖动泵浦观察阈值现象。"
      />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">
          {zh ? '读激光效率时' : 'When reading laser efficiency'}
        </span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <span className="text-slate-600">
          {zh
            ? '（悬停看一句人话；壁塞 / 量子产率）'
            : '(hover for plain language; wall-plug / quantum yield)'}
        </span>
      </p>

      {preview.error && <p role="alert" className="mb-3 text-sm text-rose-300">{preview.error}</p>}
      <div className="toolbar mb-5">
        <span className={`rounded-full px-2.5 py-0.5 text-xs ${lasing ? 'bg-rose-500/20 text-rose-300' : 'bg-edge text-slate-400'}`}>
          {!displayed ? (zh ? '待计算' : 'Pending') : lasing
            ? zh ? '● 已起振' : '● Lasing'
            : zh ? '○ 未起振' : '○ Below threshold'}
        </span>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '泵浦功率' : 'Pump power'} {pump.toFixed(1)}
          <input type="range" min={0} max={Pmax} step={Pmax / 100} value={pump}
            onChange={(e) => { const v = Number(e.target.value); setPump(v) }} />
        </label>
        <label className="flex items-center gap-2 text-slate-400">
          {zh ? '计算步数' : 'Steps'}
          <input aria-label="Laser steps" type="number" min={1} max={2000} step={1} value={steps}
            onChange={(e) => setSteps(Math.max(1, Math.min(2000, Math.round(Number(e.target.value)))))} />
        </label>
        <span data-laser-step={compute.snapshot ? remote?.steps ?? 0 : stepsDone} className="text-xs text-slate-400">
          {compute.snapshot ? remote?.steps ?? 0 : stepsDone} / {steps}
        </span>
        <span className="text-xs text-slate-600">
          {zh ? '阈值' : 'Threshold'} ≈ {characteristics?.threshold.toFixed(1) ?? '—'}
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <canvas ref={cavityRef} width={520} height={260} className="stage w-full" style={{ aspectRatio: '2/1' }} />
          <p className="mt-2 text-center text-xs text-slate-500">
            {zh
              ? '谐振腔：全反镜 ↔ 增益介质 ↔ 输出镜'
              : 'Cavity: HR mirror ↔ gain medium ↔ output coupler'}
          </p>
        </div>
        <div className="card p-3">
          <canvas ref={curveRef} width={400} height={240} className="w-full rounded-lg border border-edge" />
          <div data-laser-readout className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-violet-300">{zh ? '粒子数反转' : 'Inversion N'}</span>
              <span className="text-slate-300">{displayed?.N.toFixed(2) ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-rose-300">{zh ? '光子数' : 'Photons S'}</span>
              <span className="text-slate-300">{displayed?.S.toFixed(1) ?? '—'}</span>
            </div>
          </div>
        </div>
      </div>

      <p className="note">
        {zh
          ? '双速率方程描述反转粒子数与腔内光子：泵浦增加反转，受激发射把反转转为光子，腔损耗带走光子。阈值处增益恰好补偿腔损耗；阈下光子近零，阈上输出随泵浦近线性增长。前后端均从 N=S=0 开始，以约化时间步长 0.02 演化指定步数；曲线为同一方程的解析稳态解，有限步瞬态不等同于稳态。'
          : 'Two rate equations couple inversion and cavity photons: pump builds inversion, stimulated emission converts it to photons, cavity loss removes them. At threshold gain equals loss; below threshold S≈0, above it output grows nearly linearly with pump. Both targets start at N=S=0 with reduced timestep 0.02 for the requested steps. The curve is the analytic equilibrium of the same equations; a finite transient need not have reached it.'}
      </p>
    </div>
  )
}

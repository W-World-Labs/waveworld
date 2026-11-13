import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ParamSlider } from '../components/ParamSlider'
import { SpeedControl } from '../components/SpeedControl'
import { createIsingScene, stepIsingScene, isingSceneSteps, isingResult, onsagerTc, onsagerReferences, type IsingScene, type IsingPoint } from '../lib/sim/ising'
import { useModuleCompute } from '../lib/hooks/useModuleCompute'
import { useRunning, useStartRafLoop } from '../lib/hooks'
import { drainSteps } from '../lib/playback'
import { useLocale } from '../lib/i18n'

const PX = 512
type IsingResult = ReturnType<typeof isingResult>

export function Ising() {
  const { locale } = useLocale(), zh = locale === 'zh'
  const { running, runningRef, setRunning } = useRunning()
  const startLoop = useStartRafLoop()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef<((spins: ArrayLike<number> | null) => void) | null>(null)
  const stepRef = useRef(0)
  const speedRef = useRef(1)
  const [size, setSize] = useState(128)
  const [temperature, setTemperature] = useState(2)
  const [seed, setSeed] = useState(1)
  const [hot, setHot] = useState(false)
  const [sweep, setSweep] = useState(false)
  const [from, setFrom] = useState(0.8)
  const [to, setTo] = useState(3.6)
  const [pointCount, setPointCount] = useState(57)
  const [burnSetting, setBurnSetting] = useState(4)
  const [sampleSetting, setSampleSetting] = useState(30)
  const [speed, setSpeed] = useState(1)
  const [resetKey, setResetKey] = useState(0)
  const [local, setLocal] = useState<IsingResult | null>(null)
  const [localError, setLocalError] = useState('')
  const TC = useMemo(() => { try { return onsagerTc() } catch { return null } }, [])
  const temperatures = useMemo(() => sweep
    ? Array.from({ length: pointCount }, (_, i) => Math.round((from + (to - from) * i / (pointCount - 1)) * 10000) / 10000)
    : [temperature], [sweep, pointCount, from, to, temperature])
  const perPoint = Math.floor(2000 / temperatures.length)
  const burnIn = Math.min(burnSetting, perPoint - 1)
  const samples = Math.min(sampleSetting, perPoint - burnIn)
  const scene = useMemo<IsingScene>(() => ({ size, temperatures, seed, hot, burnIn, samples }), [size, temperatures, seed, hot, burnIn, samples])
  const total = isingSceneSteps(scene)
  const compute = useModuleCompute({ module: 'ising', scene })
  const remote = compute.result?.module === 'ising' ? compute.result.result : null
  const result = compute.snapshot ? remote : local
  const current = result?.current

  useEffect(() => {
    const off = document.createElement('canvas'); off.width = size; off.height = size
    const octx = off.getContext('2d')!, img = octx.createImageData(size, size)
    const draw = (spins: ArrayLike<number> | null) => {
      const canvas = canvasRef.current, ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      ctx.fillStyle = '#05070f'; ctx.fillRect(0, 0, PX, PX)
      if (!spins) return
      for (let i = 0; i < spins.length; i++) {
        const p = i * 4, up = spins[i] > 0
        img.data[p] = up ? 94 : 30; img.data[p + 1] = up ? 234 : 27
        img.data[p + 2] = up ? 212 : 75; img.data[p + 3] = 255
      }
      octx.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = false
      ctx.drawImage(off, 0, 0, PX, PX)
    }
    drawRef.current = draw
    setLocal(null); setLocalError(''); stepRef.current = 0; draw(null)
    if (compute.snapshot) return () => { drawRef.current = null }
    let run: ReturnType<typeof createIsingScene>
    try { run = createIsingScene(scene) } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error)); setRunning(false)
      return () => { drawRef.current = null }
    }
    const acc = { v: 0 }
    setLocal(isingResult(run)); draw(run.state.spins); setRunning(true)
    let lastUi = 0
    const stop = startLoop(() => {
      if (!runningRef.current || run.steps >= total) return
      const count = Math.min(drainSteps(acc, speedRef.current, 2), total - run.steps)
      if (!count) return
      try { for (let n = 0; n < count; n++) stepIsingScene(run, scene) } catch (error) {
        setLocalError(error instanceof Error ? error.message : String(error)); setRunning(false); return
      }
      stepRef.current = run.steps; draw(run.state.spins)
      const now = performance.now()
      if (now - lastUi >= 100 || run.steps === total) {
        lastUi = now; setLocal(isingResult(run))
      }
      if (run.steps === total) setRunning(false)
    })
    return () => { stop(); drawRef.current = null }
  }, [scene, compute.snapshot, resetKey])

  useEffect(() => {
    if (compute.snapshot) drawRef.current?.(remote?.spins ?? null)
  }, [remote, scene, compute.snapshot])

  useEffect(() => {
    if (!compute.snapshot && running && stepRef.current >= total) setResetKey(key => key + 1)
  }, [running, compute.snapshot, total])

  return <div>
    <PageHeader icon="🧲" title="二维伊辛模型 · 蒙特卡洛"
      subtitle="设置初态、预热与采样次数，比较有限格点的磁化统计和无限格点平衡参考。" />
    <div className="toolbar mb-4">
      <label className="flex items-center gap-2 text-slate-400">{zh ? '格点边长' : 'Lattice size'}
        <select aria-label="Ising size" value={size} onChange={e => setSize(Number(e.target.value))} className="rounded border border-edge bg-panel p-2">
          {[16, 64, 128, 256].map(n => <option key={n} value={n}>{n}²</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-slate-400">{zh ? '初态' : 'Initial state'}
        <select aria-label="Ising initial state" value={hot ? 'hot' : 'cold'} onChange={e => setHot(e.target.value === 'hot')} className="rounded border border-edge bg-panel p-2">
          <option value="cold">{zh ? '全对齐（冷）' : 'Aligned (cold)'}</option>
          <option value="hot">{zh ? '随机（热）' : 'Random (hot)'}</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-slate-400">{zh ? '初态种子' : 'Initial seed'}
        <input aria-label="Ising seed" type="number" min={0} max={4294967295} value={seed}
          onChange={e => setSeed(Math.max(0, Math.min(4294967295, Math.round(Number(e.target.value)) || 0)))}
          className="w-24 rounded border border-edge bg-panel p-2" />
      </label>
      <label className="flex items-center gap-2 text-slate-400">
        <input aria-label="Ising temperature sweep" type="checkbox" checked={sweep} onChange={e => setSweep(e.target.checked)} />
        {zh ? '逐温度扫描' : 'Temperature sweep'}
      </label>
      {!sweep ? <ParamSlider label={zh ? '温度 T*' : 'Temperature T*'} ariaLabel="Ising temperature"
        value={temperature} min={0.5} max={4} step={0.01} onChange={setTemperature} />
        : <>
          <ParamSlider label={zh ? '起始 T*' : 'Start T*'} ariaLabel="Ising start temperature" value={from} min={0.5} max={4} step={0.05} onChange={setFrom} />
          <ParamSlider label={zh ? '结束 T*' : 'End T*'} ariaLabel="Ising end temperature" value={to} min={0.5} max={4} step={0.05} onChange={setTo} />
          <label className="flex items-center gap-2 text-slate-400">{zh ? '温度点数' : 'Temperature points'}
            <input aria-label="Ising temperature count" type="number" min={2} max={57} value={pointCount}
              onChange={e => setPointCount(Math.max(2, Math.min(57, Math.round(Number(e.target.value)) || 2)))}
              className="w-20 rounded border border-edge bg-panel p-2" />
          </label>
        </>}
      <label className="flex items-center gap-2 text-slate-400">{zh ? '每温度预热' : 'Burn-in per temperature'}
        <input aria-label="Ising burn-in" type="number" min={0} max={Math.min(1000, perPoint - 1)} value={burnIn}
          onChange={e => setBurnSetting(Math.max(0, Math.min(1000, perPoint - 1, Math.round(Number(e.target.value)) || 0)))}
          className="w-20 rounded border border-edge bg-panel p-2" />
      </label>
      <label className="flex items-center gap-2 text-slate-400">{zh ? '每温度采样' : 'Samples per temperature'}
        <input aria-label="Ising samples" type="number" min={1} max={Math.min(1000, perPoint - burnIn)} value={samples}
          onChange={e => setSampleSetting(Math.max(1, Math.min(1000, perPoint - burnIn, Math.round(Number(e.target.value)) || 1)))}
          className="w-20 rounded border border-edge bg-panel p-2" />
      </label>
      {!compute.snapshot && <SpeedControl value={speed} onChange={v => { setSpeed(v); speedRef.current = v }} />}
    </div>
    <p className="note mb-4">{zh
      ? '每次扫描包含 L² 次随机翻转尝试；预热后每扫描采样一次。修改参数从指定初态重算。总扫描次数：'
      : 'Each sweep attempts L² random flips; sample once per sweep after burn-in. Parameter edits restart the chosen initial state. Total sweeps: '}{total} / 2000</p>
    {localError && <p role="alert" className="note mb-4">{zh ? '本地 WASM 计算不可用。' : 'Local WASM computation unavailable.'} {localError}</p>}
    <div className="flex flex-wrap items-start gap-5">
      <canvas ref={canvasRef} width={PX} height={PX} role="img" aria-label={zh ? '伊辛自旋格点' : 'Ising spin lattice'}
        className="stage w-full max-w-[460px]" style={{ aspectRatio: '1/1', imageRendering: 'pixelated' }} />
      <div className="min-w-0 flex-1 basis-[260px] space-y-3">
        <div data-ising-readout data-ising-step={result?.steps ?? ''} className="rounded-xl border border-edge p-4 text-sm text-slate-300">
          <Metric label={zh ? '完成扫描' : 'Completed sweeps'} value={result?.steps} digits={0} />
          <Metric label="T*" value={current?.temperature} />
          <Metric label={zh ? '当前温度采样数' : 'Samples at current T'} value={current?.samples} digits={0} />
          <Metric label={zh ? '瞬时 |m|' : 'Instantaneous |m|'} value={result?.magnetization} />
          <Metric label={zh ? '瞬时 E/N' : 'Instantaneous E/N'} value={result?.energy} />
          <Metric label="〈|m|〉" value={current?.meanAbsM} />
          <Metric label="〈m〉" value={current?.meanM} />
          <Metric label="〈E/N〉" value={current?.meanEnergy} />
          <Metric label={zh ? '比热估计 C/N' : 'Heat-capacity estimate C/N'} value={current?.specificHeat} />
          <Metric label={zh ? '磁化率估计 χ/N' : 'Susceptibility estimate χ/N'} value={current?.susceptibility} />
          <Metric label={zh ? '无限格点参考 |m|' : 'Infinite-lattice reference |m|'} value={current?.reference} />
        </div>
        <div className="rounded-xl border border-edge p-4">
          <div className="mb-2 text-xs text-slate-400">{zh ? '采样磁化与 Onsager / Yang 平衡参考' : 'Sample magnetization and Onsager / Yang reference'}</div>
          <OnsagerChart points={result?.points ?? []} current={current} tc={TC} />
          <p className="mt-2 text-xs text-slate-500">{zh
            ? '青线：无限格点参考；粉点：完成的温度点；黄点：当前采样。有限格点与有限样本不保证落在参考线上。'
            : 'Cyan: infinite-lattice reference; pink: completed temperatures; yellow: current sample. Finite lattices and finite samples need not lie on the reference curve.'}</p>
        </div>
      </div>
    </div>
    <p className="note mt-4">{zh
      ? '零外场、最近邻铁磁 J=kB=1、周期边界。扫描温度时沿用上一温度的格点和随机序列，按每点设定重新预热。预热次数不代表已经平衡；相关样本会影响涨落估计，少于两个样本不显示比热或磁化率。'
      : 'Zero field, nearest-neighbor ferromagnetic J=kB=1, periodic boundaries. Temperature sweeps retain the previous lattice and random stream, with burn-in at each point. Burn-in does not guarantee equilibrium; correlated samples affect fluctuation estimates. At least two samples are needed for heat capacity or susceptibility.'}</p>
    <p className="note">{zh ? '无限格点临界温度' : 'Infinite-lattice critical temperature'} Tc = {TC?.toFixed(6) ?? '—'}.
      {' '}<a href="https://journals.aps.org/pr/abstract/10.1103/PhysRev.85.808" target="_blank" rel="noreferrer" className="underline">{zh ? '自发磁化参考来源' : 'Spontaneous-magnetization reference'}</a>
    </p>
  </div>
}

function Metric({ label, value, digits = 4 }: { label: string; value?: number | null; digits?: number }) {
  return <div className="flex justify-between gap-3 tabular-nums"><span className="text-slate-500">{label}</span><span>{value == null ? '—' : value.toFixed(digits)}</span></div>
}

function OnsagerChart({ points, current, tc }: { points: IsingPoint[]; current?: IsingPoint; tc: number | null }) {
  const w = 260, h = 170, pad = 24
  const xx = (T: number) => pad + (T - 0.5) / 3.5 * (w - pad - 6)
  const yy = (m: number) => h - pad - m * (h - pad - 6)
  const curve = useMemo(() => {
    if (tc === null) return ''
    const temperatures = Array.from({ length: 176 }, (_, i) => 0.5 + i * 0.02)
    const values = onsagerReferences(temperatures)
    return temperatures.map((T, i) => xx(T).toFixed(1) + ',' + yy(values[i]).toFixed(1)).join(' ')
  }, [tc])
  return <svg viewBox={'0 0 ' + w + ' ' + h} className="block w-full" aria-label="Ising magnetization curve">
    <line x1={pad} y1={h - pad} x2={w - 4} y2={h - pad} stroke="#334155" />
    <line x1={pad} y1={4} x2={pad} y2={h - pad} stroke="#334155" />
    {tc !== null && <line x1={xx(tc)} y1={4} x2={xx(tc)} y2={h - pad} stroke="#64748b" strokeDasharray="3 3" />}
    {tc !== null && <text x={xx(tc) + 3} y={14} fill="#94a3b8" fontSize={9}>Tc≈2.27</text>}
    <polyline points={curve} fill="none" stroke="#2dd4bf" strokeWidth={1.6} />
    {points.map((p, i) => p.meanAbsM !== null && <circle key={i} cx={xx(p.temperature)} cy={yy(p.meanAbsM)} r={2.2} fill="#f0abfc" opacity={0.8} />)}
    {current?.meanAbsM != null && <circle cx={xx(current.temperature)} cy={yy(current.meanAbsM)} r={4} fill="#fde047" stroke="#0a0a12" />}
    <text x={pad} y={h - 6} fill="#64748b" fontSize={9}>0.5</text>
    <text x={w - 30} y={h - 6} fill="#64748b" fontSize={9}>4 T*</text>
    <text x={3} y={14} fill="#64748b" fontSize={9}>|m|</text>
  </svg>
}

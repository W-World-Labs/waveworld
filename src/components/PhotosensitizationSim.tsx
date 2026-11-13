import { useEffect, useRef, useState } from 'react'
import {
  defaultPhotoParams, rk4Step, initPhotoState, steadyState, branchFractions,
  effectiveTripletDecay, type PhotoParams, type PhotoState,
} from '../lib/sim/photosensitization'
import { drainSteps } from '../lib/playback'
import { scheduleRafIfVisible, onPageVisible } from '../lib/visibilityRaf'
import { useLocale } from '../lib/i18n'
import { SpeedControl } from './SpeedControl'

// SDT 仿真面板（spec §5.2）：三线态→ROS 动力学的逐帧 RK4 演化。
//   左：[T1]/[¹O₂] 时间曲线（数值轨迹 + 解析稳态对拍水平线）；
//   右：Type I/II/失活 分支条（氧 ↑ → Type II 占比 ↑）+ 实时稳态指标；
//   滑块：[³O₂] 氧池、k_exc 激发率、k_q Type II 猝灭、k_I Type I（=0 关闭）；
//   SpeedControl 变速复用——不改物理 dt，只调每帧推进步数。
// 嵌入 PhenomenonDetail 的 simPanel 挂载点（sampleId==='photosensitization'）。

// 节点光谱色（与 nodes.ts 对齐）：三线态/ROS 走 chemical 紫红，¹O₂ 用青 glow。
const C_T1 = '#da77f2'   // chemical（三线态枢纽）
const C_O2 = '#3ad6ff'   // glow（¹O₂）
const C_TYPE2 = '#3ad6ff'
const C_TYPE1 = '#ff8a4c' // ember
const C_DEACT = '#475569'

const PLOT_W = 320, PLOT_H = 200, PAD = 28
const WINDOW = 8 // 时间曲线滚动窗口（约化时间单位）

interface Sample { t: number; T1: number; O2: number }

export function PhotosensitizationSim() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  // 参数（约化单位）；ref 给动画循环读、state 给滑块显示。
  const pRef = useRef<PhotoParams>(defaultPhotoParams())
  const sRef = useRef<PhotoState>(initPhotoState(pRef.current))
  const trajRef = useRef<Sample[]>([])
  const runningRef = useRef(true)
  const playRef = useRef(1)
  const accRef = useRef({ v: 0 })

  const [p, setP] = useState<PhotoParams>(() => defaultPhotoParams())
  const [running, setRunning] = useState(true)
  const [playSpeed, setPlaySpeed] = useState(1)
  const [, force] = useState(0)

  // 参数变更 → 同步 ref + 重置演化（轨迹从初态重跑，新稳态生效）。
  const update = (patch: Partial<PhotoParams>) => {
    const next = { ...pRef.current, ...patch }
    pRef.current = next
    setP(next)
    reset(next)
  }
  const reset = (params: PhotoParams = pRef.current) => {
    sRef.current = initPhotoState(params)
    trajRef.current = [{ t: 0, T1: 0, O2: 0 }]
  }

  useEffect(() => {
    let raf = 0, disposed = false, frame = 0
    reset(pRef.current)
    const loop = () => {
      if (disposed) return
      const params = pRef.current
      if (runningRef.current) {
        const n = drainSteps(accRef.current, playRef.current, 4)
        let s = sRef.current
        for (let i = 0; i < n; i++) s = rk4Step(s, params, params.dt)
        sRef.current = s
        if (n > 0) {
          const traj = trajRef.current
          traj.push({ t: s.t, T1: s.T1, O2: s.singletO2 })
          // 滚动窗口：丢弃超出 WINDOW 的旧点。
          const cutoff = s.t - WINDOW
          while (traj.length > 2 && traj[0].t < cutoff) traj.shift()
        }
      }
      // React re-render 每 6 帧一批（轨迹/曲线），避免每帧 force
      if (frame % 6 === 0) force((v) => (v + 1) % 100000)
      frame++
      raf = scheduleRafIfVisible(disposed, loop)
    }
    const stopVis = onPageVisible(() => {
      if (!disposed) raf = scheduleRafIfVisible(disposed, loop)
    })
    loop()
    return () => { disposed = true; stopVis(); cancelAnimationFrame(raf) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ss = steadyState(p)
  const bf = branchFractions(p)
  const kTeff = effectiveTripletDecay(p)
  const traj = trajRef.current

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
        <span aria-hidden="true">📈</span>
        {zh
          ? '量化样板间 · 三线态→活性氧动力学（雅布隆斯基速率方程，四阶龙格–库塔 + 解析稳态对拍）'
          : 'Quantitative sandbox · Triplet → ROS kinetics (Jablonski rates, RK4 + analytic steady-state check)'}
      </div>

      {/* 控制条 */}
      <div className="toolbar mb-4">
        <button onClick={() => { const v = !running; setRunning(v); runningRef.current = v }}
          className="btn border border-edge text-slate-300"
          aria-label={running ? (zh ? '暂停' : 'Pause') : zh ? '继续' : 'Resume'}>
          {running ? (zh ? '⏸ 暂停' : '⏸ Pause') : zh ? '▶ 继续' : '▶ Resume'}
        </button>
        <button onClick={() => reset()} className="btn border border-edge text-slate-300">
          {zh ? '↺ 重演化' : '↺ Re-evolve'}
        </button>
        <SpeedControl value={playSpeed} onChange={(v) => { setPlaySpeed(v); playRef.current = v }} />
        <Slider label={zh ? '氧浓度' : 'O₂ pool'} value={p.O2} min={0} max={3} step={0.05}
          onChange={(v) => update({ O2: v })} />
        <Slider label={zh ? '激发率' : 'Excitation rate'} value={p.k_exc} min={0.05} max={3} step={0.05}
          onChange={(v) => update({ k_exc: v })} />
        <Slider label={zh ? '二型猝灭速率' : 'Type-II quench k_q'} value={p.k_q} min={0} max={4} step={0.05}
          onChange={(v) => update({ k_q: v })} />
        <Slider label={zh ? '一型速率' : 'Type-I rate k_I'} value={p.k_I} min={0} max={2} step={0.05}
          onChange={(v) => update({ k_I: v })} />
      </div>

      <div className="flex flex-wrap gap-5">
        {/* 三线态 / 单线态氧 时间曲线 + 稳态对拍水平线 */}
        <div className="rounded border border-edge p-3">
          <div className="mb-1 text-xs text-slate-500">
            {zh
              ? '★ 对拍护栏：数值轨迹 → 解析稳态（虚线）'
              : '★ Checkrail: numerical trajectory → analytic SS (dashed)'}
          </div>
          <KineticsChart traj={traj} ssT1={ss.T1} ssO2={ss.singletO2} concLabel={zh ? '浓度（约化）' : 'conc. (reduced)'} />
          <div className="mt-1 text-[11px] text-slate-500">
            <span style={{ color: C_T1 }}>{zh ? '紫=三线态' : 'magenta=T₁'}</span> ·
            <span style={{ color: C_O2 }}>{zh ? ' 青=单线态氧' : ' cyan=¹O₂'}</span>
            {zh ? ' · 虚线=解析稳态（数值末态应收敛于此）' : ' · dashed=analytic SS (numerics should converge)'}
          </div>
        </div>

        <div className="flex min-w-[240px] flex-1 flex-col gap-3">
          {/* I/II 型分支条 */}
          <div className="rounded border border-edge p-3">
            <div className="mb-2 text-xs text-slate-500">
              {zh
                ? '三线态去激分支占比（氧 ↑ → 二型 ↑）'
                : 'Triplet deactivation branches (O₂ ↑ → Type II ↑)'}
            </div>
            <BranchBar f={bf} />
            <div className="mt-2 space-y-0.5 text-[11px]">
              <BranchRow color={C_TYPE2} label={zh ? '二型（→ 单线态氧）' : 'Type II (→ ¹O₂)'} v={bf.typeII} />
              <BranchRow color={C_TYPE1} label={zh ? '一型（→ 自由基）' : 'Type I (→ radicals)'} v={bf.typeI} />
              <BranchRow
                color={C_DEACT}
                label={zh ? '氧无关失活（磷光/无辐射）' : 'O₂-independent (phos./NR)'}
                v={bf.deactivation}
              />
            </div>
          </div>

          {/* 实时稳态指标 */}
          <div className="rounded border border-edge p-3 text-sm text-slate-300">
            <div className="mb-2 text-xs text-slate-500">
              {zh ? '解析稳态（约化单位）' : 'Analytic steady state (reduced units)'}
            </div>
            <Metric k={zh ? '三线态稳态占比' : 'T₁ steady fraction'} v={ss.phiTss} />
            <Metric k={zh ? '稳态单线态氧' : 'Steady ¹O₂'} v={ss.singletO2} />
            <Metric k={zh ? '单线态氧生成率' : '¹O₂ generation rate'} v={ss.genRateSinglet} />
            <Metric k={zh ? '三线态有效失活' : 'Effective T₁ decay'} v={kTeff} />
            <div className="mt-2 text-xs leading-relaxed text-slate-400">
              {zh
                ? '提氧或激发率 → 稳态单线态氧生成率上升；一型速率为 0 即关闭一型路径，分支全归二型与失活。'
                : 'Raise O₂ or excitation → higher steady ¹O₂ generation; k_I = 0 closes Type I so branches go to Type II and deactivation only.'}
            </div>
          </div>
        </div>
      </div>

      <p className="note">
        {zh
          ? '三线态由激发态系间窜越补给，再经氧猝灭产单线态氧或走 I 型自由基路径；基态/单线态/三线态守恒。数值末态与闭式稳态已对拍，氧单调性已锁。光动力与声动力共享此三线态网关——声动力只是把光泵浦换成超声激活率。'
          : 'Triplets are fed by ISC from the excited singlet, then quenched by O₂ to ¹O₂ or via Type-I radical paths; ground/singlet/triplet populations conserve. Numerics match closed-form SS; O₂ monotonicity is locked. PDT and SDT share this triplet gateway—SDT only swaps optical pumping for ultrasound activation rate.'}
      </p>
    </div>
  )
}

function Slider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center gap-2 text-slate-400">
      <span className="whitespace-nowrap tabular-nums">{label}={value.toFixed(2)}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </label>
  )
}

function Metric({ k, v }: { k: string; v: number }) {
  return (
    <div className="flex justify-between tabular-nums">
      <span className="text-slate-500">{k}</span>
      <span>{v.toFixed(4)}</span>
    </div>
  )
}

function BranchRow({ color, label, v }: { color: string; label: string; v: number }) {
  return (
    <div className="flex items-center justify-between gap-2 tabular-nums">
      <span className="flex items-center gap-1.5 text-slate-400">
        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} aria-hidden="true" />
        {label}
      </span>
      <span className="text-slate-300">{(v * 100).toFixed(1)}%</span>
    </div>
  )
}

/** Type II / Type I / 失活 三段水平堆叠条（占比和=1）。 */
function BranchBar({ f }: { f: { typeII: number; typeI: number; deactivation: number } }) {
  const segs = [
    { w: f.typeII, c: C_TYPE2 },
    { w: f.typeI, c: C_TYPE1 },
    { w: f.deactivation, c: C_DEACT },
  ]
  return (
    <div className="flex h-4 w-full overflow-hidden rounded-full border border-edge bg-canvas">
      {segs.map((s, i) => (
        <div key={i} style={{ width: `${Math.max(0, s.w) * 100}%`, background: s.c }}
          className="h-full transition-[width] duration-150" />
      ))}
    </div>
  )
}

/** [T1]/[¹O₂] 随时间曲线，叠加解析稳态水平虚线作对拍参照。 */
function KineticsChart({ traj, ssT1, ssO2, concLabel }: {
  traj: Sample[]; ssT1: number; ssO2: number; concLabel: string
}) {
  const w = PLOT_W, h = PLOT_H, pad = PAD
  // y 轴上界：取轨迹与稳态的最大值，留 15% 余量；避免除零。
  let ymax = Math.max(ssT1, ssO2, 1e-6)
  for (const s of traj) ymax = Math.max(ymax, s.T1, s.O2)
  ymax *= 1.15
  const t0 = traj.length > 0 ? traj[0].t : 0
  const t1 = traj.length > 0 ? traj[traj.length - 1].t : WINDOW
  const span = Math.max(t1 - t0, WINDOW)
  const xx = (t: number) => pad + ((t - t0) / span) * (w - pad - 6)
  const yy = (y: number) => h - pad - (y / ymax) * (h - pad - 6)
  const poly = (key: 'T1' | 'O2') =>
    traj.map((s) => `${xx(s.t).toFixed(1)},${yy(s[key]).toFixed(1)}`).join(' ')
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="block" style={{ minWidth: 280 }}>
      {/* 轴 */}
      <line x1={pad} y1={h - pad} x2={w - 4} y2={h - pad} stroke="#334155" />
      <line x1={pad} y1={4} x2={pad} y2={h - pad} stroke="#334155" />
      {/* 解析稳态水平虚线（对拍参照） */}
      <line x1={pad} y1={yy(ssT1)} x2={w - 4} y2={yy(ssT1)} stroke={C_T1} strokeWidth={1} strokeDasharray="5 4" opacity={0.7} />
      <line x1={pad} y1={yy(ssO2)} x2={w - 4} y2={yy(ssO2)} stroke={C_O2} strokeWidth={1} strokeDasharray="5 4" opacity={0.7} />
      {/* 数值轨迹 */}
      <polyline points={poly('T1')} fill="none" stroke={C_T1} strokeWidth={1.8} />
      <polyline points={poly('O2')} fill="none" stroke={C_O2} strokeWidth={1.8} />
      <text x={pad + 2} y={14} fill="#64748b" fontSize={9}>{concLabel}</text>
      <text x={w - 18} y={h - pad - 4} fill="#64748b" fontSize={9}>t→</text>
    </svg>
  )
}

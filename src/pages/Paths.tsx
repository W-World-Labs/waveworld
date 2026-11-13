import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { KnowledgeReleaseBadge } from '../components/KnowledgeReleaseBadge'
import { ConsensusBadge } from '../components/ConsensusBadge'
import { TermChip } from '../components/TermChip'
import { isTransport, chainEffInterval } from '../lib/paths'
import { termTitle } from '../lib/termGlossary'
import { edgeDisplayName, useLocale } from '../lib/i18n'
import { buildPathGraph, findPaths } from '../lib/paths'
import type { Path } from '../lib/paths'
import { buildOptGraph, findOptimalPaths } from '../lib/optimize'
import { pathExergy } from '../lib/exergy'
import { bindingLimit } from '../lib/physics/registry'
import { runMonteCarlo } from '../lib/webgpu/mcSim'
import type { McStat } from '../lib/mc'
import type { ConversionEdge, EnergyNode } from '../data/ontology/types'
import { energyDisplayName } from '../lib/energyAlias'
import { formatCop, formatPercent } from '../lib/efficiencyFormat'
import { topEnergyForm } from '../lib/conversionCatalog'
import { useAtlasOntology } from '../lib/knowledge-db/use-atlas-ontology'

const MC_N = 65536

const formOf = topEnergyForm
/** 跨页统一：η 百分比走 efficiencyFormat（KUX 靶 E） */
const pct = formatPercent

type Mode = 'optimal' | 'browse'

export function Paths() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  /** K11: default createKnowledgeAdapter(db) / Host API, explicit static fallback */
  const ontology = useAtlasOntology()
  const nodes = ontology.nodes
  const edges = ontology.edges
  const forms = useMemo(() => nodes.filter((n) => !n.parent), [nodes])
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const og = useMemo(() => buildOptGraph(nodes, edges), [nodes, edges])
  const fg = useMemo(() => buildPathGraph(nodes, edges), [nodes, edges])
  const [from, setFrom] = useState('nuclear')
  const [to, setTo] = useState('mechanical')
  const [maxHops, setMaxHops] = useState(5)
  const [mode, setMode] = useState<Mode>('optimal')
  const [excludeDisputed, setExcludeDisputed] = useState(false)

  const filter = useMemo(
    () => (excludeDisputed
      ? (e: ConversionEdge) => e.consensus.status !== 'contested' && e.consensus.status !== 'open'
      : undefined),
    [excludeDisputed],
  )

  // 优化模式：节点级图上 Dijkstra/Yen 求 K 条最短（-ln η 权重，保证全局最优）。
  // 浏览模式：旧 DFS 枚举（顶层形式坍缩图），用于浏览“全部路径”。
  const paths: Path[] = useMemo(() => {
    if (ontology.loading || nodes.length === 0) return []
    if (mode === 'optimal') return findOptimalPaths(og, from, to, { k: 20, maxHops, filter })
    const dfs = findPaths(fg, from, to, { maxDepth: maxHops, maxResults: 20 })
    return filter ? dfs.filter((p) => p.hops.every((h) => filter(h.edge))) : dfs
  }, [ontology.loading, nodes.length, og, fg, mode, from, to, maxHops, filter])

  const [mc, setMc] = useState<{ backend: 'webgpu' | 'cpu'; stats: McStat[] } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { setMc(null) }, [mode, from, to, maxHops, excludeDisputed]) // 路径变了清空旧结果

  const robustBest = useMemo(() => {
    if (!mc) return -1
    let bi = -1, bm = -1
    mc.stats.forEach((s, i) => { if (s.mean > bm) { bm = s.mean; bi = i } })
    return bi
  }, [mc])

  const runMc = async () => {
    if (!paths.length) return
    setBusy(true)
    const mcPaths = paths.map((p) => ({
      // 与 effForChain 同源的链路区间(搬运型整段封顶 [1,1])，使稳健最优与效率最优口径一致(C5)
      hops: p.hops.map((h) => chainEffInterval(h.edge)),
    }))
    setMc(await runMonteCarlo(mcPaths, MC_N))
    setBusy(false)
  }

  return (
    <div>
      <PageHeader
        icon="🛤️"
        title="能量转换路径"
        subtitle={
          ontology.loading
            ? zh
              ? '正在加载知识库节点与转换边…'
              : 'Loading knowledge nodes & edges…'
            : '从一种能量到另一种，往往要经过多次转换。优化模式在能量图上求「累积效率最高」的全局最优路径，以及若干次优备选——把效率换成损耗代价后找最短路，避免被跳数截断漏解。'
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <KnowledgeReleaseBadge zh={zh} />
        {!ontology.loading && (
          <span
            className="text-[10px] text-slate-600"
            data-knowledge-source={ontology.source}
            title={ontology.error ?? undefined}
          >
            {zh ? '知识源' : 'Source'}: {ontology.source}
            {ontology.usedFallback ? (zh ? '（静态回退）' : ' (static fallback)') : ''}
          </span>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Sel label={zh ? '从' : 'From'} value={from} onChange={setFrom} forms={forms} />
        <span className="text-slate-500">→</span>
        <Sel label={zh ? '到' : 'To'} value={to} onChange={setTo} forms={forms} />

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {/* 模式切换 */}
          <div className="flex overflow-hidden rounded border border-edge text-xs">
            <button onClick={() => setMode('optimal')}
              className={`px-2.5 py-1 ${mode === 'optimal' ? 'bg-wave/20 text-wave' : 'text-slate-400'}`}>
              {zh ? '最优路径' : 'Optimal'}
            </button>
            <button onClick={() => setMode('browse')}
              className={`px-2.5 py-1 ${mode === 'browse' ? 'bg-wave/20 text-wave' : 'text-slate-400'}`}>
              {zh ? '浏览全部' : 'Browse all'}
            </button>
          </div>

          {/* 优化目标（P0 仅效率；成本/碳待补边级数据） */}
          <label className="flex items-center gap-1.5 text-slate-400">
            {zh ? '目标' : 'Objective'}
            <select disabled value="eff"
              className="rounded border border-edge bg-edge/40 px-2 py-1 text-slate-200 disabled:opacity-70"
              title={zh
                ? '按累积效率最优。成本与碳排目标需先补边级数据。'
                : 'Best cumulative efficiency. Cost/carbon need edge-level data first.'}>
              <option value="eff">{zh ? '效率最优' : 'Best efficiency'}</option>
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-slate-400">
            {mode === 'optimal'
              ? zh ? '最大跳数' : 'Max hops'
              : zh ? '最大深度' : 'Max depth'}
            <select value={maxHops} onChange={(e) => setMaxHops(Number(e.target.value))}
              className="rounded border border-edge bg-edge/40 px-2 py-1 text-slate-200">
              {[2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-slate-400"
            title={zh
              ? '排除共识状态为「有争议/开放」的转换边'
              : 'Exclude edges with contested/open consensus'}>
            <input type="checkbox" checked={excludeDisputed} onChange={(e) => setExcludeDisputed(e.target.checked)}
              className="accent-wave" />
            {zh ? '排除争议/未解边' : 'Exclude contested/open'}
          </label>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="text-sm font-semibold text-slate-300">
          {energyDisplayName(from, locale)} → {energyDisplayName(to, locale)}：
          {mode === 'optimal' ? (zh ? '最优 + 次优' : 'best + near-best') : (zh ? '枚举' : 'enumerated')}{' '}
          {paths.length} {zh ? '条路径' : 'paths'}
        </h3>
        {paths.length > 0 && (
          <button onClick={runMc} disabled={busy}
            className="btn border border-edge text-xs text-slate-300">
            {busy
              ? zh ? '抽样中…' : 'Sampling…'
              : zh
                ? `🎲 蒙特卡洛稳健性（${MC_N.toLocaleString()} 次/路径）`
                : `🎲 MC robustness (${MC_N.toLocaleString()} / path)`}
          </button>
        )}
        {mc && (
          <span className={`rounded-full px-2 py-0.5 text-xs ${mc.backend === 'webgpu' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
            {mc.backend === 'webgpu'
              ? zh ? '图形加速' : 'GPU accel'
              : zh ? '本机计算' : 'CPU'}
            ·{zh ? '效率区间随机抽样' : 'η-range sampling'}
          </span>
        )}
      </div>

      {paths.length === 0 ? (
        <p className="text-sm text-slate-500">
          {zh
            ? `在 ${maxHops} 跳内未找到${excludeDisputed ? '（排除争议边后的）' : ''}路径，试着增大跳数${excludeDisputed ? '、放开约束' : ''}或换一对。`
            : `No path within ${maxHops} hops${excludeDisputed ? ' (after excluding contested edges)' : ''}. Try more hops${excludeDisputed ? ', relax filters' : ''} or another pair.`}
        </p>
      ) : (
        <div className="space-y-3">
          {paths.map((p, i) => (
            <div key={i} className="card p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="rounded bg-wave/15 px-2 py-0.5 text-xs font-medium text-wave">
                  {p.hops.length} {zh ? '跳' : 'hops'}
                </span>
                <span className="text-xs text-slate-400">{zh ? '累积效率' : 'Cumulative η'}</span>
                <span className="font-mono text-sm text-ember">{pct(p.totalEff)}</span>
                {i === 0 && (
                  <span className="rounded bg-glow/15 px-2 py-0.5 text-xs text-glow">
                    {zh ? '效率最优' : 'η-best'}
                  </span>
                )}
                {mc && i === robustBest && (
                  <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300">
                    {zh ? '稳健最优' : 'Robust best'}
                  </span>
                )}
              </div>
              {/* 路径链 */}
              <div className="flex flex-wrap items-center gap-1.5">
                <FormChip id={p.hops[0].from} byId={byId} />
                {p.hops.map((h, j) => (
                  <span key={j} className="flex items-center gap-1.5">
                    <span className="flex flex-col items-center text-[10px] text-slate-500">
                      <span className={`font-mono ${isTransport(h.edge) ? 'text-sky-300' : 'text-wave'}`}
                        title={isTransport(h.edge)
                          ? `${termTitle('cop', locale)} ${locale === 'en' ? 'hop' : '本跳'} ${formatCop(h.edge.efficiency.min, h.edge.efficiency.max)}`
                          : edgeDisplayName(h.edge, locale)}>
                        {isTransport(h.edge)
                          ? formatCop(h.edge.efficiency.min, h.edge.efficiency.max)
                          : pct(h.eff)}
                      </span>
                      <span className="leading-none" title={edgeDisplayName(h.edge, locale)}>↓</span>
                    </span>
                    <FormChip id={h.to} byId={byId} />
                  </span>
                ))}
              </div>

              {/* 能量账：每投入 100 单位能量，逐跳剩余与净产出（这就是“能耗”的直观呈现） */}
              <EnergyLedger hops={p.hops} totalEff={p.totalEff} />

              {/* 㶲(可用功)账：能量守恒不等于做功能力守恒——第二定律 */}
              <ExergyLine hops={p.hops} />

              {/* 第一性原理理论上限：实际效率距热力学天花板还有多远 */}
              <LimitLine hops={p.hops} />

              {/* 每跳机理 */}
              <div className="mt-2 space-y-0.5">
                {p.hops.map((h, j) => (
                  <div key={j} className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="text-slate-400">
                      {energyDisplayName(h.from, locale)}→{energyDisplayName(h.to, locale)}
                    </span>
                    <span>{edgeDisplayName(h.edge, locale)}</span>
                    <ConsensusBadge c={h.edge.consensus} />
                  </div>
                ))}
              </div>

              {/* 蒙特卡洛稳健性（效率区间随机抽样的累积效率分布） */}
              {mc && mc.stats[i] && (
                <div className="mt-2 border-t border-edge pt-2 text-xs">
                  <div className="mb-1 flex flex-wrap items-center gap-3 text-slate-400">
                    <span>
                      {zh ? '稳健均值' : 'Robust mean'}{' '}
                      <span className="font-mono text-ember">{pct(mc.stats[i].mean)}</span>
                    </span>
                    <span>
                      p10–p90{' '}
                      <span className="font-mono text-slate-300">
                        {pct(mc.stats[i].p10)} – {pct(mc.stats[i].p90)}
                      </span>
                    </span>
                    <span className="text-slate-600">
                      {zh ? '中位' : 'median'} {pct(mc.stats[i].p50)}
                    </span>
                  </div>
                  {/* p10–p90 区间条 */}
                  <div className="relative h-1.5 w-full max-w-md overflow-hidden rounded bg-edge/50">
                    <div className="absolute h-full bg-gradient-to-r from-wave/60 to-glow/60"
                      style={{ left: `${mc.stats[i].p10 * 100}%`, width: `${Math.max(1, (mc.stats[i].p90 - mc.stats[i].p10) * 100)}%` }} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 max-w-2xl space-y-2 border-t border-edge pt-3 text-xs text-slate-500">
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="text-slate-400">{zh ? '术语速查' : 'Term quick-ref'}</span>
          <TermChip id="exergy" mode="compact" />
          <TermChip id="phi" mode="compact" />
          <TermChip id="eta" mode="compact" />
          <TermChip id="cop" mode="compact" />
          <TermChip id="transport" mode="compact" />
          <TermChip id="first-law" mode="compact" />
          <TermChip id="second-law" mode="compact" />
          <TermChip id="carnot-limit" mode="compact" />
          <TermChip id="zt" mode="compact" />
          <TermChip id="snr" mode="compact" />
          <TermChip id="quantum-yield" mode="compact" />
          <span className="text-slate-600">
            {zh
              ? '（悬停或点路径卡片内带 ? 的标签可看一句人话）'
              : '(hover or expand ? chips for plain language)'}
          </span>
        </p>
        {zh ? (
          <>
            <p>
              <span className="text-slate-400">最优 vs 浏览</span>：
              <span className="text-slate-300">最优路径</span>模式用 Dijkstra/Yen 在节点级图上求严格最优——顶层端点按“族”
              （自身 + 子形态）展开，故能用上子形态边；每跳都是真实转换边、节点级严格连续，
              不做跨分辨率免费拼接。<span className="text-slate-300">浏览全部</span>模式是 DFS 枚举（顶层形式坍缩），便于看清所有可能链路。
            </p>
            <p>
              <span className="text-slate-400">能量 vs </span>
              <TermChip id="exergy" mode="compact" className="text-slate-400" />
              <span>：</span>
              <TermChip id="first-law" mode="compact" /> 管「量」还在，
              <TermChip id="second-law" mode="compact" className="mx-0.5" /> 管「还能做多少功」。
              电能 φ≈1；室温废热 φ→0。电→电阻热可以 η≈100% 却几乎毁掉可用功。
              <span className="text-slate-600">（热㶲按代表温度估算；辐射品位随源温变化。）</span>
            </p>
            <p>
              <span className="text-slate-400">转换 vs 搬运</span>：标
              <TermChip id="cop" mode="compact" className="mx-1 font-mono text-sky-300" />
              的跳是
              <TermChip id="transport" mode="compact" className="mx-0.5" />
              （热泵、制冷等）。链路累积
              <TermChip id="eta" mode="compact" className="mx-0.5" />
              时，这类跳按 100% 封顶，避免把性能系数当 η 连乘。
            </p>
          </>
        ) : (
          <>
            <p>
              <span className="text-slate-400">Optimal vs browse</span>:{' '}
              <span className="text-slate-300">Optimal path</span> mode runs Dijkstra/Yen on the node-level graph for strict
              optima—top endpoints expand by “family” (self + subforms) so subform edges are usable; every hop is a real
              conversion edge with strict node continuity (no free cross-resolution stitching).{' '}
              <span className="text-slate-300">Browse all</span> is DFS enumeration (top-form collapsed) to see every
              possible chain.
            </p>
            <p>
              <span className="text-slate-400">Energy vs </span>
              <TermChip id="exergy" mode="compact" className="text-slate-400" />
              <span>: </span>
              <TermChip id="first-law" mode="compact" /> tracks “how much is left”;{' '}
              <TermChip id="second-law" mode="compact" className="mx-0.5" /> tracks “how much work remains”.
              Electrical φ≈1; room-temp waste heat φ→0. Electricity→Joule heat can hit η≈100% while destroying useful work.
              <span className="text-slate-600"> (Thermal exergy uses a representative T; radiation quality tracks source T.)</span>
            </p>
            <p>
              <span className="text-slate-400">Conversion vs transport</span>: hops tagged{' '}
              <TermChip id="cop" mode="compact" className="mx-1 font-mono text-sky-300" /> are{' '}
              <TermChip id="transport" mode="compact" className="mx-0.5" />
              (heat pumps, refrigeration, …). When accumulating chain{' '}
              <TermChip id="eta" mode="compact" className="mx-0.5" />, those hops cap at 100% so COP is never multiplied as η.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

/** 每投入 100 单位能量，逐跳剩余 + 净产出 + 总损耗。 */
function EnergyLedger({ hops, totalEff }: { hops: Path['hops']; totalEff: number }) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const E0 = 100
  let cur = E0
  const steps = hops.map((h) => { cur *= h.eff; return cur })
  const out = E0 * totalEff
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
      <TermChip id="energy-ledger" />
      <span className="font-mono text-slate-300">{E0}</span>
      {steps.map((s, j) => (
        <span key={j} className="flex items-center gap-2">
          <span className="text-slate-600">→</span>
          <span className="font-mono text-slate-300">{s < 1 ? s.toFixed(2) : s.toFixed(1)}</span>
        </span>
      ))}
      <span className="ml-1 text-slate-500">
        {zh ? '净产出' : 'net out'}{' '}
        <span className="font-mono text-ember">{out < 1 ? out.toFixed(2) : out.toFixed(1)}</span>
        {zh ? '，损耗→热' : ', loss→heat'}{' '}
        <span className="font-mono text-rose-300/80">
          {(E0 - out) < 1 ? (E0 - out).toFixed(2) : (E0 - out).toFixed(1)}
        </span>
        <span className="text-slate-600">
          ({zh ? '每 100 单位' : 'per 100 units'};
          <TermChip id="first-law" mode="compact" className="mx-0.5" />
          : {zh ? '产物 + 热' : 'product + heat'})
        </span>
      </span>
    </div>
  )
}

/** 㶲(可用功)账：能量留存 vs 可用功留存。 */
function ExergyLine({ hops }: { hops: Path['hops'] }) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const ex = pathExergy(hops, formOf)
  const endName = energyDisplayName(ex.endForm, locale)
  const lowGrade = ex.phiEnd < 0.7
  const violated = ex.hops.some((h) => h.secondLawViolation)
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
      <TermChip id="exergy" />
      <span className="font-mono text-sky-300" title={termTitle('exergy', locale)}>
        {pct(ex.usableWorkOut)}
      </span>
      <span className="text-slate-600">
        · {zh ? '对比能量留存' : 'vs energy retained'} {pct(ex.energyEff)}
      </span>
      <span className="text-slate-500">
        · {zh ? '终态' : 'end'}「{endName}」
        <TermChip id="phi" mode="compact" className="mx-0.5" />
        ={ex.phiEnd.toFixed(2)}
      </span>
      {lowGrade && (
        <span className="text-amber-300/80" title={termTitle('exergy', locale)}>
          {zh ? '低品位·可用功已大量销毁' : 'Low grade · much useful work destroyed'}
        </span>
      )}
      {violated && (
        <span className="text-rose-400" title={termTitle('second-law', locale)}>
          ⚠ {zh ? '疑似违反' : 'possible violation of'}
          <TermChip id="second-law" mode="compact" className="ml-0.5 text-rose-400" />
        </span>
      )}
    </div>
  )
}

/** 第一性原理理论上限。 */
function LimitLine({ hops }: { hops: Path['hops'] }) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const b = bindingLimit(hops.map((h) => ({ edge: h.edge, eff: h.eff })), formOf)
  if (!b || b.limitEta >= 0.999) return null
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
      <TermChip id="carnot-limit" />
      <span className="font-mono text-violet-300" title={termTitle('carnot-limit', locale)}>{pct(b.limitEta)}</span>
      <span className="text-slate-600">
        ({zh ? b.law : b.lawEn})
      </span>
      <span>
        · {zh ? '瓶颈跳已达上限的' : 'bottleneck hop at'}{' '}
        <span className="font-mono text-slate-300">{(b.fraction * 100).toFixed(0)}%</span>
        {zh ? '' : ' of limit'}
      </span>
    </div>
  )
}

function FormChip({
  id,
  byId,
}: {
  id: string
  byId: Map<string, EnergyNode>
}) {
  const { locale } = useLocale()
  const n = byId.get(id)
  return (
    <span className="rounded-lg border px-2.5 py-1 text-sm text-slate-200"
      style={{ borderColor: n?.color ?? '#334155' }}
      title={id /* raw id only in title; main label localized */}>
      {n?.icon} {energyDisplayName(id, locale)}
    </span>
  )
}

function Sel({
  label,
  value,
  onChange,
  forms,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  forms: EnergyNode[]
}) {
  const { locale } = useLocale()
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-slate-500">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded border border-edge bg-edge/40 px-2 py-1 text-slate-200">
        {forms.map((f) => (
          <option key={f.id} value={f.id}>
            {f.icon} {energyDisplayName(f.id, locale)}
          </option>
        ))}
      </select>
    </label>
  )
}

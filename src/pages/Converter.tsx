import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConsensusBadge } from '../components/ConsensusBadge'
import { EfficiencyRange } from '../components/EfficiencyRange'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import type { ConversionEdge } from '../data/ontology/types'
import {
  directConversionEdges,
  enumerateConversionPaths,
  ONTOLOGY_ENERGY_FORMS,
  topEnergyForm,
  type CatalogPath,
} from '../lib/conversionCatalog'
import { energyDisplayName } from '../lib/energyAlias'
import { formatPercent } from '../lib/efficiencyFormat'
import {
  appDisplayName,
  deviceDisplayName,
  edgeDisplayName,
  edgeEfficiencyNote,
  edgePrinciple,
  maturityLabel,
  productModel,
  productSpec,
  productVendor,
  useLocale,
} from '../lib/i18n'
import { termIdsForSimPath } from '../lib/termGlossary'

const PAGE_SIZE = 50

export function Converter() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [from, setFrom] = useState('electromagnetic')
  const [to, setTo] = useState('mechanical')
  const [maxHops, setMaxHops] = useState(3)
  const [visiblePaths, setVisiblePaths] = useState(PAGE_SIZE)
  const direct = useMemo(() => directConversionEdges(from, to), [from, to])
  const indirect = useMemo(
    () => enumerateConversionPaths(from, to, { maxHops, includeDirect: false }),
    [from, to, maxHops],
  )
  useEffect(() => setVisiblePaths(PAGE_SIZE), [from, to, maxHops])
  const pageTerms = useMemo(() => termIdsForSimPath('converter'), [])

  return (
    <div>
      <PageHeader
        icon="🔁"
        title="工程推荐目录"
        subtitle="由主本体自动生成：完整保留直接转换边，并按明确跳数枚举多级无环路径。新增或修订本体边后，这里无需再手工抄录。"
      />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">{zh ? '读工程方案时' : 'When reading engineering options'}</span>
        {pageTerms.map((id) => <TermChip key={id} id={id} mode="compact" />)}
        <span className="text-slate-600">
          {zh ? '（与矩阵、图谱、路径共用同一事实源）' : '(same source of truth as matrix, graph, and paths)'}
        </span>
      </p>

      <div className="note mb-5">
        <strong className="text-slate-200">{zh ? '自动派生口径：' : 'Automatic derivation contract: '}</strong>
        {zh
          ? '“直接机制”是该顶层能量对下全部本体边；“多级路径”是所选最大跳数内的边级无环路径。循环可无限重复，因此不冒充“无限制的所有路径”；触及安全上限时会明确标为未完整。'
          : 'Direct mechanisms include every ontology edge for the top-level pair. Multi-stage paths are edge-level, node-simple paths within the selected hop bound. Cyclic walks are infinite, so the UI never claims unbounded completeness; safety-cap truncation is explicit.'}
      </div>

      <div className="card mb-6 flex flex-wrap items-end gap-4 p-5">
        <EnergySelect label={zh ? '源能量' : 'Source energy'} value={from} onChange={setFrom} />
        <div className="pb-2 text-2xl text-slate-500">→</div>
        <EnergySelect label={zh ? '目标能量' : 'Target energy'} value={to} onChange={setTo} />
        <label className="block">
          <span className="mb-1 block text-xs text-slate-400">{zh ? '多级最大跳数' : 'Multi-stage max hops'}</span>
          <select value={maxHops} onChange={(event) => setMaxHops(Number(event.target.value))}
            className="rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-slate-200 outline-none focus:border-wave">
            {[2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <div className="ml-auto text-right text-sm text-slate-400">
          <div>{energyDisplayName(from, locale)} → {energyDisplayName(to, locale)}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            {zh ? `${direct.length} 条直接机制 · ` : `${direct.length} direct mechanisms · `}
            {indirect.complete ? indirect.paths.length : `≥${indirect.paths.length}`}
            {zh ? ` 条 ≤${maxHops} 跳多级路径` : ` multi-stage paths ≤${maxHops} hops`}
          </div>
        </div>
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-300">
            {zh ? `全部已知直接机制（${direct.length}）` : `All known direct mechanisms (${direct.length})`}
          </h2>
          <Link to="/matrix" className="text-xs text-wave hover:underline">
            {zh ? '在转换矩阵核对 →' : 'Cross-check in matrix →'}
          </Link>
        </div>
        {direct.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {direct.map((edge) => <OntologyMethodCard key={edge.id} edge={edge} />)}
          </div>
        ) : <p className="text-sm text-slate-500">{zh ? '主本体尚无直接转换边。' : 'No direct ontology edge is known.'}</p>}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-300">
            {zh
              ? `${indirect.complete ? '完整枚举' : '部分枚举'}：≤${maxHops} 跳多级无环路径（${indirect.complete ? indirect.paths.length : `至少 ${indirect.paths.length}`}）`
              : `${indirect.complete ? 'Complete' : 'Partial'} enumeration: node-simple paths ≤${maxHops} hops (${indirect.complete ? indirect.paths.length : `at least ${indirect.paths.length}`})`}
          </h2>
          <Link to="/paths" className="text-xs text-wave hover:underline">
            {zh ? '进入效率/不确定性路径分析 →' : 'Efficiency / uncertainty path analysis →'}
          </Link>
        </div>
        {!indirect.complete && (
          <p className="note mb-3 text-xs text-amber-300">
            {zh ? `搜索检查了 ${indirect.examined} 个候选跳后达到安全上限；当前结果不是全集。请降低跳数。` :
              `The search reached its safety cap after ${indirect.examined} candidate hops; this is not the full set. Lower the hop bound.`}
          </p>
        )}
        <div className="space-y-3">
          {indirect.paths.slice(0, visiblePaths).map((path) => <PathCard key={path.edgeIds.join('|')} path={path} />)}
        </div>
        {visiblePaths < indirect.paths.length && (
          <button className="btn mt-4 border border-edge text-sm text-slate-300"
            onClick={() => setVisiblePaths((value) => value + PAGE_SIZE)}>
            {zh ? `再显示 ${Math.min(PAGE_SIZE, indirect.paths.length - visiblePaths)} 条` : `Show ${Math.min(PAGE_SIZE, indirect.paths.length - visiblePaths)} more`}
          </button>
        )}
      </section>
    </div>
  )
}

function EnergySelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const { locale } = useLocale()
  return <label className="block">
    <span className="mb-1 block text-xs text-slate-400">{label}</span>
    <select value={value} onChange={(event) => onChange(event.target.value)}
      className="rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-slate-200 outline-none focus:border-wave">
      {ONTOLOGY_ENERGY_FORMS.map((form) => <option key={form.id} value={form.id}>{form.icon} {energyDisplayName(form.id, locale)}</option>)}
    </select>
  </label>
}

function OntologyMethodCard({ edge }: { edge: ConversionEdge }) {
  const { locale } = useLocale(); const zh = locale === 'zh'
  return <Link to={`/graph?node=${encodeURIComponent(topEnergyForm(edge.from))}&edge=${encodeURIComponent(edge.id)}`}
    className="card group block p-5 transition hover:border-wave/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-wave">
    <div className="mb-2 flex flex-wrap items-start gap-2">
      <h3 className="min-w-0 flex-1 font-semibold text-white">{edgeDisplayName(edge, locale)}</h3>
      <ConsensusBadge c={edge.consensus} />
      {edge.maturity && <span className="rounded-full bg-edge/70 px-2 py-0.5 text-[10px] text-slate-400">{maturityLabel(edge.maturity, locale)}</span>}
    </div>
    <p className="mb-3 text-sm text-slate-300">{edgePrinciple(edge, locale)}</p>
    <EfficiencyRange mode="quantity" min={edge.efficiency.min} max={edge.efficiency.max}
      note={edgeEfficiencyNote(edge, locale)} className="mb-3" />
    {(edge.device?.length ?? 0) > 0 && <div className="mb-2 flex flex-wrap gap-1.5">
      {edge.device!.slice(0, 8).map((item) => <span key={item} className="rounded bg-edge/60 px-2 py-0.5 text-xs text-slate-300">{deviceDisplayName(item, locale)}</span>)}
    </div>}
    {(edge.products?.length ?? 0) > 0 && <div className="space-y-1 border-t border-edge/60 pt-2 text-[11px] text-slate-500">
      {edge.products!.slice(0, 4).map((product, index) => <div key={`${product.model}-${index}`}>
        {[productVendor(product, locale), productModel(product, locale), productSpec(product, locale)].filter(Boolean).join(' · ')}
      </div>)}
    </div>}
    {(edge.apps?.length ?? 0) > 0 && <div className="mt-2 flex flex-wrap gap-1.5">
      {edge.apps!.slice(0, 8).map((item) => <span key={item} className="rounded-full bg-wave/10 px-2 py-0.5 text-[11px] text-wave/80">{appDisplayName(item, locale)}</span>)}
    </div>}
    <div className="mt-3 text-right text-[11px] text-wave/70 group-hover:text-wave">{zh ? '完整公式、损耗与证据 →' : 'Full equations, losses & evidence →'}</div>
  </Link>
}

function PathCard({ path }: { path: CatalogPath }) {
  const { locale } = useLocale(); const zh = locale === 'zh'
  return <div className="card p-4">
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded bg-wave/15 px-2 py-0.5 text-wave">{path.hops.length} {zh ? '跳' : 'hops'}</span>
      <span className="text-slate-500">{zh ? '累积典型效率' : 'Typical cumulative η'}</span>
      <span className="font-mono text-ember">{formatPercent(path.totalEfficiency)}</span>
    </div>
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-300">
      <span>{energyDisplayName(path.hops[0].from, locale)}</span>
      {path.hops.map((hop) => <span key={hop.edge.id} className="flex items-center gap-1.5">
        <span className="text-slate-600">→</span><span>{energyDisplayName(hop.to, locale)}</span>
      </span>)}
    </div>
    <ol className="mt-2 space-y-1 text-[11px] text-slate-500">
      {path.hops.map((hop) => <li key={hop.edge.id}>{edgeDisplayName(hop.edge, locale)} · η {formatPercent(hop.efficiency)}</li>)}
    </ol>
  </div>
}

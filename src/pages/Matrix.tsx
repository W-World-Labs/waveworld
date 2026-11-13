import { useMemo, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ConsensusBadge } from '../components/ConsensusBadge'
import { FormulaBlock } from '../components/FormulaBlock'
import { EfficiencyRange } from '../components/EfficiencyRange'
import { TermChip } from '../components/TermChip'
import { KnowledgeReleaseBadge } from '../components/KnowledgeReleaseBadge'
import { ReleasedClaimsPanel } from '../components/ReleasedClaimsPanel'
import { energyDisplayName } from '../lib/energyAlias'
import { topEnergyForm } from '../lib/conversionCatalog'
import { isTransport } from '../lib/paths'
import { safeHttpUrl } from '../lib/safeUrl'
import {
  appDisplayName,
  consensusSummary,
  deviceDisplayName,
  edgeDisplayName,
  edgeEfficiencyNote,
  edgePrinciple,
  lossDisplayDesc,
  lossDisplayName,
  maturityLabel,
  productModel,
  productSpec,
  productVendor,
  useLocale,
  viewpointStance,
} from '../lib/i18n'
import type { ConversionEdge, EnergyNode } from '../data/ontology/types'
import { useAtlasOntology } from '../lib/knowledge-db/use-atlas-ontology'

// 子形态 id → 顶层 id；顶层 → 自身
const formOf = topEnergyForm
const effMax = (e: ConversionEdge) => e.efficiency.max ?? e.efficiency.min ?? 0

function buildSubsOf(nodes: EnergyNode[]): Map<string, EnergyNode[]> {
  const m = new Map<string, EnergyNode[]>()
  for (const n of nodes) {
    if (!n.parent) continue
    const arr = m.get(n.parent) ?? []
    arr.push(n)
    m.set(n.parent, arr)
  }
  return m
}

export function Matrix() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  /** K11: default createKnowledgeAdapter(db) / Host API, explicit static fallback */
  const ontology = useAtlasOntology()
  const nodes = ontology.nodes
  const edges = ontology.edges
  /** 主文案用本地化名；禁止 fallback 到 raw id（KUX 靶 A） */
  const nameOf = (id: string) => energyDisplayName(id, locale)
  const [from, setFrom] = useState('chemical')
  const [to, setTo] = useState('thermal')
  const [sortEff, setSortEff] = useState(true)
  const [drill, setDrill] = useState(false) // 子形态级下钻

  // 顶层能量形式（矩阵的行/列）
  const forms = useMemo(() => nodes.filter((n) => !n.parent), [nodes])
  const subsOf = useMemo(() => buildSubsOf(nodes), [nodes])

  // 每个 (from,to) 顶层组合的边数（网格总览始终按大类）
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of edges) {
      const k = `${formOf(e.from)}>${formOf(e.to)}`
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [edges])

  const list = useMemo(() => {
    const rows = drill
      ? edges.filter((e) => e.from === from && e.to === to) // 子形态级：精确匹配
      : edges.filter((e) => formOf(e.from) === from && formOf(e.to) === to) // 大类级：归并
    return sortEff ? [...rows].sort((a, b) => effMax(b) - effMax(a)) : rows
  }, [edges, from, to, sortEff, drill])

  return (
    <div>
      <PageHeader
        icon="🔀"
        title="能量转换矩阵"
        subtitle={
          ontology.loading
            ? zh
              ? '正在加载知识库节点与转换边…'
              : 'Loading knowledge nodes & edges…'
            : `${forms.length}×${forms.length} 全组合 · ${edges.length} 条已知转换 · 选「从什么 → 到什么」，按效率排序，含公式·损耗·真实产品型号·学界共识。`
        }
      />
      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">{zh ? '读效率时' : 'When reading efficiency'}</span>
        <TermChip id="eta" mode="compact" />
        <TermChip id="cop" mode="compact" />
        <TermChip id="exergy" mode="compact" />
        <TermChip id="phi" mode="compact" />
        <TermChip id="carnot-limit" mode="compact" />
        <TermChip id="fill-factor" mode="compact" />
        <TermChip id="wall-plug" mode="compact" />
        <span className="text-slate-600">
          {zh ? '（悬停看一句人话）' : '(hover for plain language)'}
        </span>
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
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

      {ontology.loading && (
        <p className="mb-4 text-sm text-slate-500">
          {zh ? '加载知识图…' : 'Loading knowledge graph…'}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
      {/* 左：矩阵（sticky 锁定）+ 选择器 */}
      <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
      {/* 矩阵网格总览 */}
      <div className="card overflow-x-auto p-3 sm:p-4">
        <table className="mx-auto border-separate border-spacing-1">
          <thead>
            <tr>
              <th className="sticky left-0 bg-panel/0 p-0.5 text-right text-[10px] text-slate-500">
                {zh ? '从＼到' : 'From＼To'}
              </th>
              {forms.map((c) => (
                <th key={c.id} className="p-0.5 align-bottom" title={nameOf(c.id)}>
                  <span className="text-base">{c.icon}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {forms.map((r) => (
              <tr key={r.id}>
                <th className="sticky left-0 whitespace-nowrap bg-canvas/0 p-0.5 pr-1.5 text-right text-xs font-normal text-slate-300" title={nameOf(r.id)}>
                  <span className="mr-1">{r.icon}</span>{nameOf(r.id)}
                </th>
                {forms.map((c) => {
                  const n = counts.get(`${r.id}>${c.id}`) ?? 0
                  const sel = from === r.id && to === c.id
                  return (
                    <td key={c.id} className="p-0">
                      <button
                        disabled={n === 0}
                        onClick={() => { setFrom(r.id); setTo(c.id) }}
                        title={`${nameOf(r.id)} → ${nameOf(c.id)}: ${n}${zh ? ' 条' : ''}`}
                        className={`h-8 w-8 rounded text-xs font-mono transition hover:brightness-125 ${
                          sel ? 'ring-2 ring-glow' : ''
                        } ${
                          n === 0 ? 'bg-edge/20 text-slate-700'
                            : n >= 4 ? 'bg-wave/80 text-white'
                            : n >= 2 ? 'bg-wave/50 text-white'
                            : 'bg-wave/25 text-wave'
                        }`}
                      >
                        {n || ''}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex items-center justify-center gap-3 text-[10px] text-slate-500">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-edge/20" />
            {zh ? '无' : 'none'}
          </span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-wave/25" />1</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-wave/50" />2–3</span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-wave/80" />
            {zh ? '≥4 条转换' : '≥4 edges'}
          </span>
        </div>
      </div>

      {/* 选择器 + 排序 + 下钻 */}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Sel label={zh ? '从' : 'From'} value={from} onChange={setFrom} drill={drill} locale={locale} forms={forms} subsOf={subsOf} />
        <span className="text-slate-500">→</span>
        <Sel label={zh ? '到' : 'To'} value={to} onChange={setTo} drill={drill} locale={locale} forms={forms} subsOf={subsOf} />
        <label className="flex items-center gap-1.5 text-slate-400">
          <input type="checkbox" checked={drill} onChange={(e) => setDrill(e.target.checked)} />
          {zh ? '展开子形态' : 'Expand subforms'}
        </label>
        <label className="ml-auto flex items-center gap-1.5 text-slate-400">
          <input type="checkbox" checked={sortEff} onChange={(e) => setSortEff(e.target.checked)} />
          {zh ? '按效率排序' : 'Sort by η'}
        </label>
      </div>
      </div>{/* /左栏 */}

      {/* 右：转换渠道（随选择实时更新） */}
      <div className="min-w-0">
      <h3 className="mb-3 text-sm font-semibold text-slate-300">
        {nameOf(from)} → {nameOf(to)}：{list.length}{' '}
        {zh ? '条转换' : 'conversions'}
      </h3>

      {list.length === 0 ? (
        <p className="text-sm text-slate-500">
          {zh
            ? '该组合暂无已知直接转换（可换一对，或经中间形式间接转换）。'
            : 'No known direct conversion for this pair (try another, or go via intermediates).'}
        </p>
      ) : (
        <div className="space-y-4">
          {list.map((e) => <EdgeCard key={e.id} e={e} />)}
        </div>
      )}
      </div>{/* /右栏 */}
      </div>{/* /grid */}
    </div>
  )
}

function Sel({
  label,
  value,
  onChange,
  drill,
  locale = 'zh',
  forms,
  subsOf,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  drill?: boolean
  locale?: 'zh' | 'en'
  forms: EnergyNode[]
  subsOf: Map<string, EnergyNode[]>
}) {
  const whole = locale === 'en' ? '(whole class)' : '（大类整体）'
  const labelOf = (id: string) => energyDisplayName(id, locale)
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-edge bg-edge/40 px-2 py-1 text-slate-200"
      >
        {drill
          ? forms.map((f) => (
              <optgroup key={f.id} label={`${f.icon} ${labelOf(f.id)}`}>
                <option value={f.id}>
                  {labelOf(f.id)}
                  {whole}
                </option>
                {(subsOf.get(f.id) ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {'　└ '}
                    {labelOf(s.id)}
                  </option>
                ))}
              </optgroup>
            ))
          : forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.icon} {labelOf(f.id)}
              </option>
            ))}
      </select>
    </label>
  )
}

function EdgeCard({ e }: { e: ConversionEdge }) {
  const { locale } = useLocale()
  return (
    <div className="card p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h4 className="font-semibold text-white">{edgeDisplayName(e, locale)}</h4>
        <ConsensusBadge c={e.consensus} />
        {e.maturity && (
          <span className="rounded bg-edge/60 px-2 py-0.5 text-xs text-slate-400">
            {maturityLabel(e.maturity, locale)}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-500">
          {energyDisplayName(e.from, locale)} → {energyDisplayName(e.to, locale)}
        </span>
      </div>
      <p className="mb-3 text-sm text-slate-300">{edgePrinciple(e, locale)}</p>
      {e.consensus.summary && (
        <p className="mb-2 text-xs text-slate-500">⚖ {consensusSummary(e.consensus, locale)}</p>
      )}
      {e.consensus.viewpoints && e.consensus.viewpoints.length > 0 && (
        <div className="mb-3 space-y-1 border-l border-edge/60 pl-2">
          {e.consensus.viewpoints.map((v, i) => (
            <p key={i} className="text-[11px] text-slate-400">
              ▪ {viewpointStance(v, locale)}
              {v.proponents && v.proponents.length > 0 && (
                <span className="text-slate-600">
                  {' '}
                  — {v.proponents.join(locale === 'zh' ? '、' : ', ')}
                </span>
              )}
            </p>
          ))}
        </div>
      )}

      <EfficiencyRange
        mode="quantity"
        min={e.efficiency.min}
        max={e.efficiency.max}
        transport={isTransport(e)}
        note={edgeEfficiencyNote(e, locale)}
        className="mb-3"
      />

      {/* 公式（人话优先；expr 折叠为校验用） */}
      {e.formula && (
        <div className="mb-3">
          <FormulaBlock formula={e.formula} />
        </div>
      )}

      {/* 损耗机理 */}
      {e.lossMechanisms.length > 0 && (
        <div className="mb-3 space-y-0.5">
          {e.lossMechanisms.map((l) => (
            <div key={l.name} className="text-xs text-slate-500">
              ↳{' '}
              <span className="text-slate-400">{lossDisplayName(l, locale)}</span>
              {locale === 'zh' ? '：' : ': '}
              {lossDisplayDesc(l, locale)}
              {l.formula && (
                <details className="ml-1 inline">
                  <summary className="inline cursor-pointer font-mono text-slate-600 hover:text-slate-400">
                    {locale === 'zh' ? '式' : 'eq'}
                  </summary>
                  <div className="mt-1">
                    <FormulaBlock formula={l.formula} density="compact" />
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 典型器件 */}
      {(e.device?.length ?? 0) > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-slate-600">
            {locale === 'zh' ? '器件' : 'Devices'}
          </span>
          {e.device!.slice(0, 8).map((d) => (
            <span key={d} className="rounded border border-edge/80 px-2 py-0.5 text-[11px] text-slate-400">
              {deviceDisplayName(d, locale)}
            </span>
          ))}
        </div>
      )}

      {/* 真实产品型号 */}
      {e.products && e.products.length > 0 && (
        <div className="mb-2">
          <div className="mb-1 text-xs font-semibold text-slate-400">
            {locale === 'zh' ? '实际产品型号' : 'Commercial product models'}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {e.products.map((p, i) => {
              const spec = productSpec(p, locale)
              const vendor = productVendor(p, locale)
              const model = productModel(p, locale)
              return (
                <span key={i} className="rounded border border-edge px-2 py-0.5 text-xs text-slate-300">
                  {vendor && <span className="text-slate-500">{vendor} </span>}
                  <span className="font-medium">{model}</span>
                  {spec && <span className="text-slate-500"> · {spec}</span>}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* 应用 + 来源 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {e.apps?.map((a) => (
          <span key={a} className="rounded-full bg-edge/60 px-2 py-0.5 text-xs text-slate-400">
            {appDisplayName(a, locale)}
          </span>
        ))}
        {e.refs?.slice(0, 3).map((r, i) => {
          const href = safeHttpUrl(r)
          return href ? (
            <a key={i} href={href} target="_blank" rel="noreferrer" className="text-xs text-wave/70 underline">
              {locale === 'zh' ? `来源${i + 1}` : `Ref ${i + 1}`}
            </a>
          ) : null
        })}
      </div>

      {/* #48-J: released claims + evidence for this edge (silent if no catalog) */}
      <ReleasedClaimsPanel subjectId={e.id} zh={locale === 'zh'} />
    </div>
  )
}

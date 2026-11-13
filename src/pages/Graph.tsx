import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { ConsensusBadge } from '../components/ConsensusBadge'
import { FormulaBlock } from '../components/FormulaBlock'
import { EfficiencyRange } from '../components/EfficiencyRange'
import { KnowledgeReleaseBadge } from '../components/KnowledgeReleaseBadge'
import { ReleasedClaimsPanel } from '../components/ReleasedClaimsPanel'
import { buildGraph } from '../lib/graph'
import { isTransport } from '../lib/paths'
import { controversiesBoundToNode } from '../lib/ontologyViews'
import { termIdsForSimPath } from '../lib/termGlossary'
import {
  appDisplayName,
  consensusSummary,
  deviceDisplayName,
  edgeDisplayName,
  edgeEfficiencyNote,
  edgePrinciple,
  localizedName,
  lossDisplayName,
  pickLocaleString,
  quantityNote,
  useLocale,
  viewpointStance,
} from '../lib/i18n'
import type { EnergyNode } from '../data/ontology/types'
import { useAtlasOntology } from '../lib/knowledge-db/use-atlas-ontology'

export function Graph() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  /** K11: default createKnowledgeAdapter(db) / Host API, explicit static fallback */
  const ontology = useAtlasOntology()
  const g = useMemo(
    () => buildGraph(ontology.nodes, ontology.edges),
    [ontology.nodes, ontology.edges],
  )
  const nodeLabel = (n: EnergyNode) => localizedName(n, locale)
  const [searchParams] = useSearchParams()
  const requestedNode = searchParams.get('node')
  const requestedEdge = searchParams.get('edge')
  const [sel, setSel] = useState<EnergyNode | null>(null)

  useEffect(() => {
    if (ontology.loading || g.topLevels.length === 0) return
    setSel((prev) => {
      if (prev && g.topLevels.some((n) => n.id === prev.id)) {
        return g.topLevels.find((n) => n.id === prev.id) ?? prev
      }
      return (
        g.topLevels.find((node) => node.id === requestedNode) ?? g.topLevels[0]
      )
    })
  }, [ontology.loading, g, requestedNode])

  const active = sel ?? g.topLevels[0]
  const children = active ? g.childrenOf(active.id) : []
  const edges = active ? g.edgesOf(active.id) : []
  const relatedControversies = useMemo(
    () => (active ? controversiesBoundToNode(active.id) : []),
    [active],
  )
  const pageTerms = useMemo(() => termIdsForSimPath('graph'), [])
  useEffect(() => {
    if (!requestedEdge || !edges.some((edge) => edge.id === requestedEdge)) return
    document.getElementById(`edge-${requestedEdge}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [edges, requestedEdge])

  if (ontology.loading || !active) {
    return (
      <div>
        <PageHeader
          icon="🕸️"
          title="能量本体图谱"
          subtitle={zh ? '正在加载知识库节点与转换边…' : 'Loading knowledge nodes & edges…'}
        />
        <p className="text-sm text-slate-500">
          {zh ? '加载知识图…' : 'Loading knowledge graph…'}
        </p>
      </div>
    )
  }

  return (
    <div>
      <PageHeader icon="🕸️" title="能量本体图谱" subtitle="一切能量传输都是节点与节点之间的连线。点击顶层能量，查看其子形态、转换边、可执行公式与学界共识。关联元争议见「争议与多解释」。" />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">
          {zh ? '读边与公式时' : 'When reading edges & formulas'}
        </span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <span className="text-slate-600">
          {zh ? '（悬停看一句人话；与矩阵同词典）' : '(hover for plain language; same glossary as matrix)'}
        </span>
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <KnowledgeReleaseBadge zh={zh} />
        <span
          className="text-[10px] text-slate-600"
          data-knowledge-source={ontology.source}
          title={ontology.error ?? undefined}
        >
          {zh ? '知识源' : 'Source'}: {ontology.source}
          {ontology.usedFallback ? (zh ? '（静态回退）' : ' (static fallback)') : ''}
        </span>
      </div>

      {/* 顶层节点选择 */}
      <div className="mb-6 flex flex-wrap gap-2">
        {g.topLevels.map((n) => (
          <button key={n.id} onClick={() => setSel(n)}
            className={`btn border text-sm ${active.id === n.id ? 'border-wave text-wave' : 'border-edge text-slate-300'} ${g.isFilled(n.id) ? '' : 'opacity-50'}`}>
            <span className="mr-1">{n.icon}</span>{nodeLabel(n)}
            {!g.isFilled(n.id) && (
              <span className="ml-1 text-[10px] text-slate-500">{zh ? '骨架' : 'skeleton'}</span>
            )}
          </button>
        ))}
      </div>

      {/* 选中节点详情 */}
      <div className="card mb-6 p-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-2xl">{active.icon}</span>
          <h2 className="text-lg font-semibold text-white">{nodeLabel(active)}</h2>
          {active.symbol && <span className="font-mono text-sm text-slate-400">{active.symbol}</span>}
          <ConsensusBadge c={active.consensus} />
        </div>
        <p className="mb-3 text-sm text-slate-300">
          {pickLocaleString(active.desc, active.descEn, locale)}
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          {active.quantities.map((q) => {
            const qNote = quantityNote(q.note, locale)
            return (
              <span key={q.symbol} className="rounded bg-edge/60 px-2 py-0.5 font-mono text-slate-300">
                {q.symbol} [{q.unit}]{qNote ? ` · ${qNote}` : ''}
              </span>
            )
          })}
        </div>
        {active.consensus.viewpoints && (
          <div className="mt-3 space-y-1.5 border-t border-edge pt-3">
            {active.consensus.viewpoints.map((v, i) => (
              <div key={i} className="text-xs text-slate-400">
                <span className="text-slate-300">
                  ▪ {viewpointStance(v, locale)}
                </span>
                {v.proponents && (
                  <span className="ml-1 text-slate-500">
                    — {v.proponents.join(zh ? '、' : ', ')}
                  </span>
                )}
                {v.source && <span className="ml-1 italic text-slate-600">{v.source}</span>}
              </div>
            ))}
          </div>
        )}
        {active.consensus.summary && (
          <p className="mt-2 text-xs text-slate-500">
            ⚖ {consensusSummary(active.consensus, locale)}
          </p>
        )}
        {relatedControversies.length > 0 && (
          <div className="mt-3 space-y-1.5 border-t border-edge pt-3">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>
                {zh
                  ? '关联元争议（多解释 · 不裁决）'
                  : 'Related meta-controversies (multi-view · no single truth)'}
              </span>
              <Link to="/controversies" className="text-wave/80 hover:underline">
                {zh ? '全部争议 →' : 'All controversies →'}
              </Link>
            </div>
            {relatedControversies.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <ConsensusBadge c={c.consensus} />
                <span className="text-slate-300">
                  {pickLocaleString(c.title, c.titleEn, locale)}
                </span>
                {c.consensus.summary && (
                  <span className="text-slate-500">
                    — {consensusSummary(c.consensus, locale)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 子形态 */}
      {children.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-2 text-sm font-semibold text-slate-400">
            {zh ? `子形态（${children.length}）` : `Subforms (${children.length})`}
          </h3>
          <div className="flex flex-wrap gap-2">
            {children.map((c) => (
              <span key={c.id} className="rounded-lg border border-edge px-3 py-1 text-sm text-slate-300" style={{ borderColor: c.color }}>
                {nodeLabel(c)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 转换边 */}
      {edges.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-400">
            {zh ? `转换边（${edges.length}）` : `Conversion edges (${edges.length})`}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {edges.map((e) => (
              <div
                key={e.id}
                id={`edge-${e.id}`}
                className={`card scroll-mt-6 p-4 transition ${requestedEdge === e.id ? 'border-wave ring-2 ring-wave/40' : ''}`}
              >
                <div className="mb-1 flex items-center gap-2">
                  <h4 className="text-sm font-semibold text-white">
                    {edgeDisplayName(e, locale)}
                  </h4>
                  <ConsensusBadge c={e.consensus} />
                </div>
                <p className="mb-2 text-xs text-slate-400">{edgePrinciple(e, locale)}</p>
                <EfficiencyRange
                  mode="quantity"
                  min={e.efficiency.min}
                  max={e.efficiency.max}
                  transport={isTransport(e)}
                  note={edgeEfficiencyNote(e, locale)}
                  className="mb-2"
                />
                {e.formula && <div className="mb-2"><FormulaBlock formula={e.formula} density="compact" /></div>}
                <div className="space-y-0.5">
                  {e.lossMechanisms.map((l) => (
                    <div key={l.name} className="text-xs text-slate-500">
                      ↳ {zh ? '损耗：' : 'Loss: '}
                      {lossDisplayName(l, locale)}
                      {l.formula && (
                        <details className="mt-0.5">
                          <summary className="cursor-pointer text-slate-600 hover:text-slate-400">
                            {zh ? '损耗公式' : 'Loss formula'}
                          </summary>
                          <FormulaBlock formula={l.formula} density="compact" className="mt-1" />
                        </details>
                      )}
                    </div>
                  ))}
                </div>
                {(e.device?.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {e.device!.slice(0, 6).map((d) => (
                      <span key={d} className="rounded border border-edge/70 px-1.5 py-0.5 text-[10px] text-slate-500">
                        {deviceDisplayName(d, locale)}
                      </span>
                    ))}
                  </div>
                )}
                {(e.apps?.length ?? 0) > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {e.apps!.slice(0, 6).map((a) => (
                      <span key={a} className="rounded-full bg-edge/50 px-1.5 py-0.5 text-[10px] text-slate-500">
                        {appDisplayName(a, locale)}
                      </span>
                    ))}
                  </div>
                )}
                {/* #48-L: released claims + evidence for this edge (silent if no catalog) */}
                <ReleasedClaimsPanel subjectId={e.id} zh={zh} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

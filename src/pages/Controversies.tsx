import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { ConsensusBadge } from '../components/ConsensusBadge'
import { KnowledgeReleaseBadge } from '../components/KnowledgeReleaseBadge'
import { ReleasedClaimsPanel } from '../components/ReleasedClaimsPanel'
import { CONTROVERSIES } from '../data/ontology/controversies'
import { energyDisplayName } from '../lib/energyAlias'
import { termIdsForSimPath } from '../lib/termGlossary'
import { pickLocaleString, useLocale } from '../lib/i18n'
import {
  fetchKnowledgeConflicts,
  fetchKnowledgeSnapshotsByContentSha,
  type HostKnowledgeConflictSet,
  type HostKnowledgeSnapshotRef,
  type KnowledgeConflictStateFilter,
} from '../lib/hostApi'
import { isContentSha256, knowledgeSnapshotsByShaPath } from '../lib/knowledge/contentSha'

const LAYER_LABEL: Record<string, { zh: string; en: string }> = {
  meta: { zh: '元层 · 分类/教学', en: 'Meta · taxonomy/teaching' },
  conventional: { zh: '约定 · 边界划法', en: 'Convention · boundary drawing' },
  frontier: { zh: '前沿 · 未闭合', en: 'Frontier · open questions' },
}

/**
 * 多学派/多解释入口：不裁决唯一真理，并列展示观点。
 * 数据源 CONTROVERSIES；与转换矩阵（EDGES）正交。
 */
export function Controversies() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const nameOf = (id: string) => energyDisplayName(id, locale)
  const pageTerms = useMemo(() => termIdsForSimPath('controversies'), [])

  return (
    <div>
      <PageHeader
        icon="⚖️"
        title="争议与多解释"
        subtitle="不追求唯一正确模型：元层与前沿争议并列。页眉方法叙事说明卡片、共识徽章与关联节点；禁止静默删少数派。"
      />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">
          {zh ? '读多解释时' : 'When reading multi-explanations'}
        </span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <span className="text-slate-600">
          {zh ? '（悬停看一句人话；与矩阵同词典）' : '(hover for plain language; same glossary as matrix)'}
        </span>
      </p>
      <div className="mb-4">
        <KnowledgeReleaseBadge zh={zh} />
      </div>

      <KdbConflictSetsPanel zh={zh} />

      <div className="note mb-6">
        <strong className="text-slate-200">{zh ? '产品原则：' : 'Product principle: '}</strong>
        {zh ? (
          <>
            接口层统一（节点/边/共识结构）；教义层允许多解释并存。
            计算样板（分子动力学 / 伊辛 / 连续介质…）是不同<strong>透镜</strong>，不是互斥真理。
            与「转换矩阵 / 路径」正交——那些是运营/教学排序视图，不是唯一物理教义。
          </>
        ) : (
          <>
            Unified interface layer (nodes/edges/consensus structure); doctrine layer allows multiple explanations.
            Compute demos (MD / Ising / continuum…) are different <strong>lenses</strong>, not mutually exclusive truths.
            Orthogonal to the conversion matrix / paths—those are ops/teaching sort views, not a single physical creed.
          </>
        )}
      </div>

      <div className="space-y-5">
        {CONTROVERSIES.map((c) => {
          const layer = LAYER_LABEL[c.layer]
          const layerText = layer
            ? pickLocaleString(layer.zh, layer.en, locale)
            : c.layer
          return (
            <article key={c.id} className="card p-5">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-white">
                  {pickLocaleString(c.title, c.titleEn, locale)}
                </h2>
                <ConsensusBadge c={c.consensus} />
                <span className="rounded-full bg-edge/80 px-2 py-0.5 text-[10px] text-slate-400">
                  {layerText}
                </span>
              </div>
              {c.consensus.summary && (
                <p className="mb-3 text-sm text-slate-300">
                  {pickLocaleString(c.consensus.summary, c.consensus.summaryEn, locale)}
                </p>
              )}
              {(c.relatedNodeIds?.length ?? 0) > 0 && (
                <div className="mb-3 flex flex-wrap gap-2 text-xs">
                  <span className="text-slate-500">
                    {zh ? '关联本体：' : 'Related ontology: '}
                  </span>
                  {c.relatedNodeIds!.map((id) => (
                    <Link
                      key={id}
                      to="/graph"
                      className="rounded border border-edge px-2 py-0.5 text-wave/90 hover:border-wave"
                      title={id}
                    >
                      {nameOf(id)}
                    </Link>
                  ))}
                </div>
              )}
              {c.consensus.viewpoints && c.consensus.viewpoints.length > 0 && (
                <div className="space-y-2 border-t border-edge pt-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {zh ? '并立观点' : 'Parallel viewpoints'}
                  </h3>
                  {c.consensus.viewpoints.map((v, i) => (
                    <div key={i} className="rounded-lg bg-edge/40 px-3 py-2 text-xs text-slate-400">
                      <p className="text-slate-200">
                        ▪ {pickLocaleString(v.stance, v.stanceEn, locale)}
                      </p>
                      {v.proponents && (
                        <p className="mt-1 text-slate-500">— {v.proponents.join(zh ? '、' : ', ')}</p>
                      )}
                      {v.source && (
                        <p className="mt-0.5 italic text-slate-600">{v.source}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {/* #48-P: released claims for controversy id / related subjects (silent if none) */}
              <ReleasedClaimsPanel subjectId={c.id} zh={zh} />
              {(c.relatedNodeIds ?? []).map((nodeId) => (
                <ReleasedClaimsPanel key={nodeId} subjectId={nodeId} zh={zh} />
              ))}
            </article>
          )
        })}
      </div>
    </div>
  )
}

/** Live Knowledge DB conflict_sets (K17 API) — orthogonal to static CONTROVERSIES. */
function KdbConflictSetsPanel({ zh }: { zh: boolean }) {
  const [items, setItems] = useState<HostKnowledgeConflictSet[] | null>(null)
  const [total, setTotal] = useState(0)
  const [stateFilter, setStateFilter] = useState<KnowledgeConflictStateFilter>('open')
  const [error, setError] = useState<string | null>(null)
  const [shaInput, setShaInput] = useState('')
  const [snapItems, setSnapItems] = useState<HostKnowledgeSnapshotRef[] | null>(null)
  const [snapError, setSnapError] = useState<string | null>(null)
  const [snapLoading, setSnapLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setItems(null)
    setError(null)
    void fetchKnowledgeConflicts({ limit: 20, state: stateFilter })
      .then((r) => {
        if (!cancelled) {
          setItems(r.items)
          setTotal(r.total)
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [stateFilter])

  const onLookupSha = () => {
    setSnapError(null)
    setSnapItems(null)
    if (!isContentSha256(shaInput)) {
      setSnapError(zh ? '需要 64 位十六进制 content_sha256' : 'Need 64-hex content_sha256')
      return
    }
    setSnapLoading(true)
    void fetchKnowledgeSnapshotsByContentSha(shaInput)
      .then((r) => {
        setSnapItems(r.items)
      })
      .catch((e: unknown) => {
        setSnapError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setSnapLoading(false))
  }

  const snapPath = knowledgeSnapshotsByShaPath(shaInput)
  const stateTabs: { id: KnowledgeConflictStateFilter; label: string }[] = [
    { id: 'open', label: zh ? '开放' : 'open' },
    { id: 'resolved', label: zh ? '已解决' : 'resolved' },
    { id: 'all', label: zh ? '全部' : 'all' },
  ]

  return (
    <div className="card mb-6 p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">
        {zh ? '知识库争议集（Knowledge DB）' : 'Knowledge DB conflict sets'}
      </h2>
      <p className="mb-2 text-[11px] text-slate-500">
        {zh
          ? '来自 Host GET /api/v1/knowledge/conflicts?state=（K31/K33）。与上方静态 CONTROVERSIES 正交，不自动裁决。'
          : 'From Host GET /api/v1/knowledge/conflicts?state= (K31/K33). Orthogonal to static CONTROVERSIES; no auto-adjudication.'}
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {stateTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={
              stateFilter === t.id
                ? 'rounded bg-wave/25 px-2 py-0.5 text-[11px] text-wave'
                : 'rounded bg-edge/40 px-2 py-0.5 text-[11px] text-slate-400 hover:bg-edge/70'
            }
            onClick={() => setStateFilter(t.id)}
          >
            {t.label}
          </button>
        ))}
        {items != null && !error && (
          <span className="self-center text-[10px] text-slate-600">
            total={total}
          </span>
        )}
      </div>
      {error && (
        <p className="text-xs text-amber-400/90">
          {zh ? '暂不可用（Host/API）：' : 'Unavailable (Host/API): '}
          {error}
        </p>
      )}
      {items && items.length === 0 && !error && (
        <p className="text-xs text-slate-500">
          {zh
            ? `当前无 ${stateFilter} conflict_sets。`
            : `No ${stateFilter} conflict_sets.`}
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="space-y-2 text-xs text-slate-300">
          {items.map((c) => (
            <li key={c.id} className="rounded border border-edge/60 px-2 py-1.5">
              <span className="font-mono text-wave/90">{c.id}</span>
              <span className="mx-2 rounded bg-edge/50 px-1 text-[10px] text-slate-400">
                {c.state}
              </span>
              <span className="mx-2 text-slate-500">subject={c.subjectId}</span>
              {c.reason && <span className="text-slate-400">{c.reason}</span>}
              <span className="ml-2 text-slate-600">claims×{c.claimIds.length}</span>
            </li>
          ))}
        </ul>
      )}

      {/* C residual: wire Controversies UI to snapshots reverse index (K19) */}
      <div className="mt-4 border-t border-edge/50 pt-3">
        <h3 className="mb-1 text-xs font-semibold text-slate-300">
          {zh ? '快照 content_sha 反查（K19）' : 'Snapshot content_sha reverse lookup (K19)'}
        </h3>
        <p className="mb-2 text-[10px] text-slate-500">
          {zh
            ? 'GET /api/v1/knowledge/snapshots?sha= — 粘贴 64 位 hex 查同源快照。'
            : 'GET /api/v1/knowledge/snapshots?sha= — paste 64-hex to list snapshots.'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="min-w-[12rem] flex-1 rounded border border-edge/70 bg-void/40 px-2 py-1 font-mono text-[11px] text-slate-200"
            placeholder="content_sha256…"
            value={shaInput}
            onChange={(e) => setShaInput(e.target.value)}
            spellCheck={false}
          />
          <button
            type="button"
            className="rounded bg-wave/20 px-2 py-1 text-[11px] text-wave hover:bg-wave/30 disabled:opacity-40"
            disabled={snapLoading}
            onClick={onLookupSha}
          >
            {snapLoading ? (zh ? '查询中…' : 'Looking up…') : zh ? '反查' : 'Lookup'}
          </button>
        </div>
        {snapPath && (
          <p className="mt-1 font-mono text-[10px] text-slate-600">{snapPath}</p>
        )}
        {snapError && <p className="mt-1 text-[11px] text-amber-400/90">{snapError}</p>}
        {snapItems && (
          <p className="mt-1 text-[11px] text-slate-400">
            {zh ? `命中 ${snapItems.length} 条快照` : `${snapItems.length} snapshot(s)`}
            {snapItems[0]?.id ? (
              <span className="ml-2 font-mono text-slate-500">
                e.g. {String(snapItems[0].id).slice(0, 24)}
              </span>
            ) : null}
          </p>
        )}
      </div>
    </div>
  )
}

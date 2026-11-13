/**
 * 方法 × 原理深度 — 方法脊梁上的深度视图（产品树，已 residual 剥离）
 *
 * 数据：`data/methods/depthTrees.product.ts`（spine id = methods.data）
 * 目录：`/methods` · 先修：`/taxonomy` · 时序：`/world?m=`
 *
 * 用户可：并行选方法、筛层级、树下探；不再展示 CI honesty residual 清单。
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { ModuleTryRun } from '../components/ModuleTryRun'
import { ElmerMeshExportPanel } from '../components/elmer/ElmerMeshExportPanel'
import { ELMER_MESH_CONVERT_METHOD } from '../components/elmer/elmerMeshExport'
import { localizedName, pickLocaleString, useLocale } from '../lib/i18n'
import {
  PRINCIPLE_DEPTH_LAYERS,
  buildParallelExplainSession,
  enrichWithFormulaViews,
  listMethods,
  resolveDepthSpineId,
  type ExplainNode,
  type PrincipleDepthLayer,
} from '../lib/principle-depth'
import { methodById } from '../data/methods/methods'
import { termIdsForSimPath } from '../lib/termGlossary'

const LAYER_META: Record<
  PrincipleDepthLayer,
  { zh: string; en: string; tone: string }
> = {
  product: { zh: '产品', en: 'Product', tone: 'bg-violet-500/15 text-violet-200 border-violet-400/30' },
  method: { zh: '方法', en: 'Method', tone: 'bg-wave/15 text-wave border-wave/30' },
  principle: { zh: '原理', en: 'Principle', tone: 'bg-sky-500/15 text-sky-200 border-sky-400/30' },
  foundation: { zh: '基础', en: 'Foundation', tone: 'bg-amber-500/15 text-amber-100 border-amber-400/30' },
  L0: { zh: 'L0 教学', en: 'L0 teaching', tone: 'bg-emerald-500/15 text-emerald-100 border-emerald-400/30' },
  smoke: { zh: 'Smoke', en: 'Smoke', tone: 'bg-slate-500/20 text-slate-300 border-slate-400/30' },
  engineering: { zh: '工程', en: 'Engineering', tone: 'bg-cyan-500/15 text-cyan-100 border-cyan-400/30' },
  compose: { zh: '合成', en: 'Compose', tone: 'bg-fuchsia-500/15 text-fuchsia-100 border-fuchsia-400/30' },
}

function LayerPill({
  layer,
  active,
  onClick,
  count,
}: {
  layer: PrincipleDepthLayer
  active: boolean
  onClick: () => void
  count?: number
}) {
  const { locale } = useLocale()
  const meta = LAYER_META[layer]
  const label = pickLocaleString(meta.zh, meta.en, locale)
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? meta.tone + ' ring-1 ring-wave/40'
          : 'border-edge bg-panel/40 text-slate-500 hover:border-slate-500 hover:text-slate-300',
      ].join(' ')}
    >
      {label}
      {typeof count === 'number' ? (
        <span className="ml-1 opacity-70">{count}</span>
      ) : null}
    </button>
  )
}

function ExplainTreeNode({
  node,
  depth,
  zh,
  openIds,
  toggle,
}: {
  node: ExplainNode
  depth: number
  zh: boolean
  openIds: Set<string>
  toggle: (id: string) => void
}) {
  const { locale } = useLocale()
  const kids = node.children ?? []
  const hasKids = kids.length > 0
  const open = openIds.has(node.id) || depth < 1
  const title = pickLocaleString(node.titleZh, node.titleEn, locale)
  const body = pickLocaleString(node.bodyZh, node.bodyEn, locale)
  const meta = LAYER_META[node.layer]
  const layerLabel = pickLocaleString(meta.zh, meta.en, locale)
  const formulaView = node.formula
    ? // lazy: enrich only when showing
      null
    : null
  void formulaView

  return (
    <div
      className="border-l border-edge/80"
      style={{ marginLeft: depth === 0 ? 0 : 12, paddingLeft: depth === 0 ? 0 : 12 }}
    >
      <div className="card mb-2 p-3.5">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          {hasKids ? (
            <button
              type="button"
              className="btn border border-edge bg-panel/80 px-2 py-0.5 text-[11px] text-slate-300"
              onClick={() => toggle(node.id)}
              aria-expanded={open}
            >
              {open ? '▾' : '▸'}
            </button>
          ) : (
            <span className="inline-block w-7 text-center text-[11px] text-slate-600">·</span>
          )}
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] ${meta.tone}`}
          >
            {layerLabel}
          </span>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {hasKids ? (
            <span className="text-[10px] text-slate-500">
              {zh ? `${kids.length} 条子解释` : `${kids.length} sub-explains`}
            </span>
          ) : null}
        </div>
        <p className="ml-9 text-sm leading-relaxed text-slate-300">{body}</p>
        {node.formula ? (
          <FormulaBlock node={node} zh={zh} />
        ) : null}
        {(node.jobKinds?.length || node.simMethodIds?.length) ? (
          <div className="ml-9 mt-2 flex flex-wrap gap-1.5 text-[10px] text-slate-500">
            {node.jobKinds?.map((k) => (
              <span key={k} className="rounded border border-edge px-1.5 py-0.5 font-mono">
                kind:{k}
              </span>
            ))}
            {node.simMethodIds?.map((k) => (
              <span key={k} className="rounded border border-edge px-1.5 py-0.5 font-mono">
                sim:{k}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {hasKids && open
        ? kids.map((c) => (
            <ExplainTreeNode
              key={c.id}
              node={c}
              depth={depth + 1}
              zh={zh}
              openIds={openIds}
              toggle={toggle}
            />
          ))
        : null}
    </div>
  )
}

function FormulaBlock({ node, zh }: { node: ExplainNode; zh: boolean }) {
  const { locale } = useLocale()
  const views = enrichWithFormulaViews(
    [{ ...node, path: [node.titleZh], depth: 0 }],
    locale,
  )
  const fv = views[0]?.formulaView
  if (!fv) return null
  return (
    <div className="ml-9 mt-3 rounded-xl border border-wave/25 bg-wave/5 p-3">
      <div className="text-xs font-medium text-wave/90">
        {zh ? '公式解释' : 'Formula explain'}
      </div>
      <p className="mt-1 text-sm text-slate-200">
        {locale === 'en' ? fv.plainEn || fv.plainZh : fv.plainZh}
      </p>
      <code className="mt-2 block overflow-x-auto rounded-lg bg-black/30 px-2 py-1.5 font-mono text-[12px] text-slate-300">
        {fv.expr}
      </code>
      {fv.vars.length > 0 ? (
        <ul className="mt-2 grid gap-1 text-[11px] text-slate-400 sm:grid-cols-2">
          {fv.vars.map((v) => (
            <li key={v.symbol}>
              <span className="font-mono text-slate-300">{v.symbol}</span>
              <span className="mx-1 text-slate-600">—</span>
              {v.meaning}
              {v.sample != null ? (
                <span className="ml-1 text-slate-500">= {v.sample}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {fv.hasSample ? (
        <div className="mt-2 text-[11px] text-slate-500">
          {zh ? '工作算例结果' : 'Sample result'}:{' '}
          <span className="font-mono text-slate-300">{fv.expected}</span>
        </div>
      ) : null}
    </div>
  )
}

export function MethodDepth() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const [searchParams, setSearchParams] = useSearchParams()
  const allMethods = useMemo(() => listMethods(), [])
  const pageTerms = useMemo(() => termIdsForSimPath('method-depth'), [])

  const [query, setQuery] = useState('')
  const [selectedMethods, setSelectedMethods] = useState<string[]>(() => {
    const ids = listMethods().map((m) => m.id)
    const fromUrl = searchParams.get('m')
    if (fromUrl) {
      const spine = resolveDepthSpineId(fromUrl)
      if (ids.includes(spine)) return [spine]
    }
    const pick = [
      'method-alfven-speed',
      'method-electro-thermal-igbt',
      'method-lattice-boltzmann',
    ].filter((id) => ids.includes(id))
    return pick.length ? pick : ids.slice(0, 2)
  })
  const [selectedLayers, setSelectedLayers] = useState<PrincipleDepthLayer[] | 'all'>('all')
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set())
  const [showFlatIndex, setShowFlatIndex] = useState(false)

  // Deep-link ?m=method-id (or legacy kind-*) keeps selection in sync
  useEffect(() => {
    const raw = searchParams.get('m')
    if (!raw) return
    const spine = resolveDepthSpineId(raw)
    if (!allMethods.some((m) => m.id === spine)) return
    setSelectedMethods((prev) => (prev.includes(spine) ? prev : [spine]))
  }, [searchParams, allMethods])

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allMethods
    return allMethods.filter((m) => {
      const blob = `${m.id} ${m.titleZh} ${m.titleEn ?? ''} ${m.summaryZh} ${m.summaryEn ?? ''} ${(m.jobKinds ?? []).join(' ')}`.toLowerCase()
      return blob.includes(q)
    })
  }, [allMethods, query])

  const session = useMemo(
    () =>
      buildParallelExplainSession({
        methodIds: selectedMethods,
        layers: selectedLayers,
        includeAllSubExplains: true,
      }),
    [selectedMethods, selectedLayers],
  )

  const layerCounts = useMemo(() => {
    const c: Partial<Record<PrincipleDepthLayer, number>> = {}
    for (const n of session.allSubExplains) {
      c[n.layer] = (c[n.layer] ?? 0) + 1
    }
    return c
  }, [session])

  function toggleMethod(id: string) {
    setSelectedMethods((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function selectOnly(id: string) {
    setSelectedMethods([id])
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('m', id)
        return next
      },
      { replace: true },
    )
  }

  function toggleLayer(layer: PrincipleDepthLayer) {
    setSelectedLayers((prev) => {
      if (prev === 'all') {
        return PRINCIPLE_DEPTH_LAYERS.filter((l) => l !== layer)
      }
      const has = prev.includes(layer)
      const next = has ? prev.filter((l) => l !== layer) : [...prev, layer]
      if (next.length === 0) return 'all'
      return next.length === PRINCIPLE_DEPTH_LAYERS.length ? 'all' : next
    })
  }

  function toggleOpen(id: string) {
    setOpenIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function expandAll() {
    const ids = new Set<string>()
    for (const b of session.methods) {
      const walk = (node: ExplainNode) => {
        ids.add(node.id)
        for (const c of node.children ?? []) walk(c)
      }
      walk(b.tree)
    }
    setOpenIds(ids)
  }

  function collapseAll() {
    setOpenIds(new Set())
  }

  return (
    <div>
      <PageHeader
        icon="🌳"
        title="方法 × 原理深度"
        titleEn="Methods × principle depth"
        subtitle="方法脊梁上的深度视图：原理 → 基础式 → 合成视角。与「基础方法」同一套 method- id；已去掉 CI residual 清单。"
        subtitleEn="Depth view on the methods spine: principle → foundation → compose. Same method- ids as the catalog; CI residual noise stripped."
      />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">
          {zh ? '读深度树时' : 'While reading the depth tree'}
        </span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <Link to="/methods" className="text-wave/80 hover:text-wave">
          {zh ? '全部方法目录 →' : 'All methods →'}
        </Link>
        <Link to="/taxonomy" className="text-wave/80 hover:text-wave">
          {zh ? '分类/先修 →' : 'Taxonomy →'}
        </Link>
        <Link to="/world" className="text-wave/80 hover:text-wave">
          {zh ? '世界图 →' : 'World map →'}
        </Link>
      </p>

      <div className="note mb-6 max-w-3xl text-left">
        <strong className="text-slate-200">{zh ? '怎么用：' : 'How to use: '}</strong>
        {zh
          ? '左侧勾选方法（可多选对照）；上方筛层级；树中点 ▾ 下探。每条深度树对应方法目录中的同一 id——可跳回卡片、试跑与仿真样板。'
          : 'Multi-select methods; filter layers; expand ▾ to drill. Each tree shares the catalog method id—jump back for cards, try-run, and sim demos.'}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">
          {zh ? '层级筛选' : 'Layer filter'}
        </span>
        <LayerPill
          layer="method"
          active={selectedLayers === 'all'}
          onClick={() => setSelectedLayers('all')}
        />
        <button
          type="button"
          className={[
            'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
            selectedLayers === 'all'
              ? 'border-wave/40 bg-wave/15 text-wave'
              : 'border-edge bg-panel/40 text-slate-500 hover:text-slate-300',
          ].join(' ')}
          onClick={() => setSelectedLayers('all')}
        >
          {zh ? '全部层级' : 'All layers'}
        </button>
        {PRINCIPLE_DEPTH_LAYERS.map((layer) => (
          <LayerPill
            key={layer}
            layer={layer}
            active={selectedLayers === 'all' || selectedLayers.includes(layer)}
            onClick={() => {
              if (selectedLayers === 'all') {
                setSelectedLayers([layer])
              } else {
                toggleLayer(layer)
              }
            }}
            count={layerCounts[layer]}
          />
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(240px,300px)_1fr]">
        {/* Method picker */}
        <aside className="card flex max-h-[70vh] flex-col p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {zh ? '计算方法' : 'Methods'}
              <span className="ml-1 font-normal text-slate-600">
                {selectedMethods.length}/{allMethods.length}
              </span>
            </h2>
            <button
              type="button"
              className="text-[11px] text-wave/80 hover:text-wave"
              onClick={() => setSelectedMethods([])}
            >
              {zh ? '清空' : 'Clear'}
            </button>
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={zh ? '搜索方法 / kind…' : 'Search methods / kinds…'}
            className="mb-2 w-full rounded-lg border border-edge bg-canvas/80 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
          />
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {filteredCatalog.length === 0 ? (
              <p className="p-2 text-xs text-slate-500">{zh ? '无匹配' : 'No matches'}</p>
            ) : (
              filteredCatalog.map((m) => {
                const on = selectedMethods.includes(m.id)
                const title = pickLocaleString(m.titleZh, m.titleEn, locale)
                const summary = pickLocaleString(m.summaryZh, m.summaryEn, locale)
                const lm = LAYER_META[m.layer]
                return (
                  <div
                    key={m.id}
                    className={[
                      'rounded-xl border px-2.5 py-2 transition-colors',
                      on
                        ? 'border-wave/40 bg-wave/10'
                        : 'border-transparent hover:border-edge hover:bg-panel/50',
                    ].join(' ')}
                  >
                    <label className="flex cursor-pointer gap-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={on}
                        onChange={() => toggleMethod(m.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-white">{title}</span>
                          <span
                            className={`rounded-full border px-1.5 py-0.5 text-[9px] ${lm.tone}`}
                          >
                            {pickLocaleString(lm.zh, lm.en, locale)}
                          </span>
                        </span>
                        <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-slate-500">
                          {summary}
                        </span>
                      </span>
                    </label>
                    <div className="mt-1 flex flex-wrap gap-2 pl-6">
                      <button
                        type="button"
                        className="text-[10px] text-slate-500 hover:text-wave"
                        onClick={() => selectOnly(m.id)}
                      >
                        {zh ? '仅此' : 'Only'}
                      </button>
                      <Link
                        to={`/methods#${encodeURIComponent(m.id)}`}
                        className="text-[10px] text-wave/80 hover:text-wave"
                      >
                        {zh ? '目录卡片' : 'Catalog card'}
                      </Link>
                      <Link
                        to={`/world?m=${encodeURIComponent(m.id)}`}
                        className="text-[10px] text-wave/80 hover:text-wave"
                      >
                        {zh ? '世界图' : 'World map'}
                      </Link>
                      {m.jobKinds?.[0] ? (
                        <span className="truncate font-mono text-[10px] text-slate-600">
                          {m.jobKinds[0]}
                        </span>
                      ) : null}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </aside>

        {/* Tree panel */}
        <main className="min-w-0">
          <div className="toolbar mb-4 justify-between gap-2">
            <div className="text-xs text-slate-400">
              {zh ? (
                <>
                  已选 <strong className="text-slate-200">{session.methods.length}</strong> 方法 ·{' '}
                  <strong className="text-slate-200">{session.allSubExplains.length}</strong>{' '}
                  条子解释
                </>
              ) : (
                <>
                  <strong className="text-slate-200">{session.methods.length}</strong> methods ·{' '}
                  <strong className="text-slate-200">{session.allSubExplains.length}</strong>{' '}
                  sub-explains
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn border border-edge bg-panel/70" onClick={expandAll}>
                {zh ? '展开全部' : 'Expand all'}
              </button>
              <button type="button" className="btn border border-edge bg-panel/70" onClick={collapseAll}>
                {zh ? '收起' : 'Collapse'}
              </button>
              <button
                type="button"
                className={[
                  'btn border',
                  showFlatIndex
                    ? 'border-wave/40 bg-wave/15 text-wave'
                    : 'border-edge bg-panel/70',
                ].join(' ')}
                onClick={() => setShowFlatIndex((v) => !v)}
              >
                {zh ? '扁平索引' : 'Flat index'}
              </button>
            </div>
          </div>

          {session.methods.length === 0 ? (
            <div className="card p-8 text-center text-sm text-slate-500">
              {zh
                ? '请在左侧至少选择一种计算方法。'
                : 'Select at least one calculation method on the left.'}
            </div>
          ) : (
            <div className="space-y-8">
              {session.methods.map((bundle) => {
                const title = pickLocaleString(
                  bundle.method.titleZh,
                  bundle.method.titleEn,
                  locale,
                )
                const summary = pickLocaleString(
                  bundle.method.summaryZh,
                  bundle.method.summaryEn,
                  locale,
                )
                return (
                  <section key={bundle.method.id} className="min-w-0">
                    <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-edge pb-2">
                      <div>
                        <h2 className="text-lg font-semibold text-white">{title}</h2>
                        <p className="mt-0.5 max-w-2xl text-xs text-slate-500">{summary}</p>
                        {(() => {
                          const spine = methodById(bundle.method.id)
                          if (!spine) return null
                          return (
                            <p className="mt-1 text-[11px] text-slate-500">
                              {zh ? '脊梁节点' : 'Spine'}{' '}
                              <Link
                                to={`/methods#${encodeURIComponent(spine.id)}`}
                                className="text-wave hover:underline"
                              >
                                {spine.icon} {localizedName(spine, locale)}
                              </Link>
                              <span className="mx-1 text-slate-600">·</span>
                              <span className="font-mono text-slate-600">{spine.id}</span>
                            </p>
                          )
                        })()}
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {bundle.allExplains.length}{' '}
                        {zh ? '节点' : 'nodes'}
                      </span>
                    </div>
                    <ModuleTryRun methodId={bundle.method.id} />
                    {bundle.method.id === ELMER_MESH_CONVERT_METHOD ? <ElmerMeshExportPanel /> : null}
                    <ExplainTreeNode
                      node={bundle.tree}
                      depth={0}
                      zh={zh}
                      openIds={openIds}
                      toggle={toggleOpen}
                    />
                  </section>
                )
              })}
            </div>
          )}

          {showFlatIndex && session.allSubExplains.length > 0 ? (
            <section className="card mt-8 p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-200">
                {zh ? '全部子解释（扁平）' : 'All sub-explanations (flat)'}
              </h2>
              <ul className="space-y-2">
                {session.allSubExplains.map((n) => (
                  <li
                    key={`flat-${n.id}-${n.path.join('/')}`}
                    className="rounded-lg border border-edge/60 px-3 py-2 text-sm"
                  >
                    <div className="text-[10px] text-slate-500">{n.path.join(' · ')}</div>
                    <div className="font-medium text-slate-100">
                      <span
                        className={`mr-2 rounded-full border px-1.5 py-0.5 text-[9px] ${LAYER_META[n.layer].tone}`}
                      >
                        {pickLocaleString(
                          LAYER_META[n.layer].zh,
                          LAYER_META[n.layer].en,
                          locale,
                        )}
                      </span>
                      {pickLocaleString(n.titleZh, n.titleEn, locale)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Layer cross-cut summary */}
          {session.methods.length > 0 ? (
            <section className="mt-8 grid gap-3 sm:grid-cols-2">
              {PRINCIPLE_DEPTH_LAYERS.map((layer) => {
                const items = session.byLayer[layer] ?? []
                if (!items.length) return null
                const meta = LAYER_META[layer]
                return (
                  <div key={layer} className="card p-3">
                    <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${meta.tone}`}>
                        {pickLocaleString(meta.zh, meta.en, locale)}
                      </span>
                      <span className="font-normal normal-case text-slate-600">
                        {items.length}
                      </span>
                    </h3>
                    <ul className="space-y-1 text-[12px] text-slate-400">
                      {items.slice(0, 8).map((n) => (
                        <li key={`${layer}-${n.id}-${n.path.join('/')}`} className="truncate">
                          {pickLocaleString(n.titleZh, n.titleEn, locale)}
                        </li>
                      ))}
                      {items.length > 8 ? (
                        <li className="text-slate-600">
                          +{items.length - 8} {zh ? '更多' : 'more'}
                        </li>
                      ) : null}
                    </ul>
                  </div>
                )
              })}
            </section>
          ) : null}
        </main>
      </div>
    </div>
  )
}

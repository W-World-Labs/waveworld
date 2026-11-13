import { Link } from 'react-router-dom'
import { useMemo, useState, type CSSProperties } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { ConsensusBadge } from '../components/ConsensusBadge'
import {
  METHODS,
  childrenOf,
  effectiveRole,
  methodById,
  methodsHierarchyFlat,
  parallelsOf,
  pathToRoot,
} from '../data/methods/methods'
import type { FoundationalMethod, MethodKind, MethodModuleRole } from '../data/methods/types'
import { KIND_LABEL, KIND_LABEL_EN, KIND_ORDER } from '../data/methods/kindMeta'
import { energyDisplayName } from '../lib/energyAlias'
import { termIdsForSimPath } from '../lib/termGlossary'
import { ModuleTryRun } from '../components/ModuleTryRun'
import {
  localizedName,
  methodFoundation,
  methodSchoolNote,
  methodSchoolStance,
  pickLocaleString,
  secondaryName,
  useLocale,
} from '../lib/i18n'
import { ALL_LEAVES } from '../nav'
import { PRODUCT_CALCULATION_METHODS } from '../data/methods/depthTrees.product'

const DEPTH_SPINE_IDS = new Set(PRODUCT_CALCULATION_METHODS.map((m) => m.id))

const KINDS = KIND_ORDER
const LEAF_LABEL = new Map(ALL_LEAVES.map((l) => [l.path, l.label]))
const LEAF_LABEL_EN = new Map(ALL_LEAVES.map((l) => [l.path, l.labelEn ?? l.label]))

/** 年代快捷筛选桶（按方法 yearIntroduced 归类） */
const YEAR_BUCKETS: { id: string; label: string; test: (y: number) => boolean }[] = [
  { id: 'pre1900', label: '–1900', test: (y) => y < 1900 },
  { id: '1900s', label: '1900–49', test: (y) => y >= 1900 && y < 1950 },
  { id: '1950s', label: '1950–99', test: (y) => y >= 1950 && y < 2000 },
  { id: '2000s', label: '2000–', test: (y) => y >= 2000 },
]

const ROLE_LABEL: Record<MethodModuleRole, string> = {
  family: '方法族',
  algorithm: '算法模块',
  step: '步进/原子',
  'parallel-variant': '并行解释',
}

const ROLE_LABEL_PAGE_EN: Record<MethodModuleRole, string> = {
  family: 'Family',
  algorithm: 'Algorithm module',
  step: 'Step / atom',
  'parallel-variant': 'Parallel variant',
}

const ROLE_BADGE: Record<MethodModuleRole, string> = {
  family: 'bg-violet-500/15 text-violet-300',
  algorithm: 'bg-wave/10 text-wave',
  step: 'bg-slate-500/20 text-slate-300',
  'parallel-variant': 'bg-amber-500/15 text-amber-300',
}

function matchesFilters(
  m: FoundationalMethod,
  kind: MethodKind | 'all',
  yearBucket: string | 'all',
): boolean {
  if (kind !== 'all' && m.kind !== kind) return false
  if (yearBucket !== 'all') {
    const bucket = YEAR_BUCKETS.find((b) => b.id === yearBucket)
    if (!bucket || m.yearIntroduced == null || !bucket.test(m.yearIntroduced)) return false
  }
  return true
}

function indentStyle(depth: number, role: MethodModuleRole): CSSProperties | undefined {
  if (depth <= 0) return undefined
  return {
    marginLeft: `${Math.min(depth, 6) * 0.85}rem`,
    borderColor:
      role === 'parallel-variant' ? 'rgba(251,191,36,0.35)' : 'rgba(58,214,255,0.25)',
  }
}

/**
 * 波世界方法脊梁：基础物理/计算技术方法一等节点。
 * 支持 parent→child 递归下钻（族 → 算法 → 步进），含并行解释模块。
 */
export function Methods() {
  const { locale } = useLocale()
  const kindText = (k: MethodKind) => pickLocaleString(KIND_LABEL[k], KIND_LABEL_EN[k], locale)
  const roleText = (r: MethodModuleRole) =>
    pickLocaleString(ROLE_LABEL[r], ROLE_LABEL_PAGE_EN[r], locale)
  const [kind, setKind] = useState<MethodKind | 'all'>('all')
  const [yearBucket, setYearBucket] = useState<string | 'all'>('all')
  const [compact, setCompact] = useState(false)

  /** 递归层级扁平：父在前、子/孙缩进；过滤时若子命中则祖先也露出 */
  const rows = useMemo(() => {
    const active = kind !== 'all' || yearBucket !== 'all'
    return methodsHierarchyFlat(
      active ? (m) => matchesFilters(m, kind, yearBucket) : undefined,
    )
  }, [kind, yearBucket])

  const nodeName = (id: string) => energyDisplayName(id, locale)

  const yearCounts = useMemo(() => {
    return YEAR_BUCKETS.map((b) => ({
      ...b,
      n: METHODS.filter((m) => m.yearIntroduced != null && b.test(m.yearIntroduced)).length,
    })).filter((b) => b.n > 0)
  }, [])

  const researchOnly = METHODS.filter((m) => !(m.simPaths?.length)).length
  const maxDepth = useMemo(
    () => rows.reduce((d, r) => Math.max(d, r.depth), 0),
    [rows],
  )
  const pageTerms = useMemo(() => termIdsForSimPath('methods'), [])

  return (
    <div>
      <PageHeader
        icon="🧭"
        title="基础方法 · 波世界"
        subtitle="一切计算步骤皆可模块化：方法族 → 算法/步进 → 更细原子。同一现象允许多学科并行模块并列，不裁决唯一真理。"
      />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">
          {locale === 'zh' ? '读方法目录时' : 'When reading the method catalog'}
        </span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <span className="text-slate-600">
          {locale === 'zh'
            ? '（悬停看一句人话；与矩阵同词典）'
            : '(hover for plain language; same glossary as matrix)'}
        </span>
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link
          to="/world"
          className="btn border border-wave/40 text-sm text-wave hover:bg-wave/10"
        >
          {locale === 'zh' ? '在世界图中查看' : 'View on world map'}
        </Link>
        <Link
          to="/taxonomy"
          className="btn border border-edge text-sm text-slate-300 hover:border-wave/40"
        >
          {locale === 'zh' ? '🧬 方法分类图谱 · 先修' : '🧬 Method taxonomy · prerequisites'}
        </Link>
        <button
          type="button"
          onClick={() => setCompact((c) => !c)}
          className={`btn border text-sm ${
            compact ? 'border-wave text-wave' : 'border-edge text-slate-300'
          }`}
          title={
            locale === 'zh'
              ? '紧凑树：仅标题与角色；卡片：完整字段'
              : 'Compact tree: title & role only; cards: full fields'
          }
        >
          {compact
            ? locale === 'zh'
              ? '🌲 紧凑树'
              : '🌲 Compact tree'
            : locale === 'zh'
              ? '🃏 卡片列表'
              : '🃏 Card list'}
        </button>
      </div>

      <div className="note mb-6">
        <strong className="text-slate-200">
          {locale === 'zh' ? '模块化策略：' : 'Modular strategy: '}
        </strong>
        <span className="text-slate-400">
          {' '}
          {locale === 'zh' ? (
            <>
              纵轴拆分（父模块：族→算法→步进，深度可达 {Math.max(2, maxDepth)}+）；横轴并立（并行组：多解释/多力场/数值↔解析）。
              目录 {METHODS.length} 节点 · {researchOnly} 研究骨架（无仿真页）
              {rows.length !== METHODS.length ? ` · 筛选后 ${rows.length}` : ''}。
            </>
          ) : (
            <>
              Vertical split (parent modules: family→algorithm→step, depth up to{' '}
              {Math.max(2, maxDepth)}+); horizontal parallels (groups: multi-interpretation /
              multi-force-field / numeric↔analytic). Catalog {METHODS.length} nodes ·{' '}
              {researchOnly} research skeletons (no sim page)
              {rows.length !== METHODS.length ? ` · ${rows.length} after filters` : ''}.
            </>
          )}
        </span>
        <span className="mt-1 block text-slate-500">
          {locale === 'zh' ? '能量脊梁' : 'Energy spine'}{' '}
          <Link to="/graph" className="text-wave underline">
            {locale === 'zh' ? '图谱' : 'Graph'}
          </Link>
          {' · '}
          <Link to="/controversies" className="text-wave underline">
            {locale === 'zh' ? '争议' : 'Controversies'}
          </Link>
          {' · '}
          <Link to="/world" className="text-wave underline">
            {locale === 'zh' ? '世界图' : 'World map'}
          </Link>
          {' · '}
          <Link to="/taxonomy" className="text-wave underline">
            {locale === 'zh' ? '分类/先修' : 'Taxonomy / prereqs'}
          </Link>
        </span>
      </div>

      <div className="toolbar mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setKind('all')}
          className={`btn border text-sm ${kind === 'all' ? 'border-wave text-wave' : 'border-edge text-slate-300'}`}
        >
          {locale === 'zh' ? `全部 ${METHODS.length}` : `All ${METHODS.length}`}
        </button>
        {KINDS.map((k) => {
          const n = METHODS.filter((m) => m.kind === k).length
          if (!n) return null
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`btn border text-sm ${kind === k ? 'border-wave text-wave' : 'border-edge text-slate-300'}`}
            >
              {kindText(k)} {n}
            </button>
          )
        })}
      </div>

      <div className="toolbar mb-6 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          {locale === 'en' ? 'Era' : '年代'}
        </span>
        <button
          type="button"
          onClick={() => setYearBucket('all')}
          className={`btn border text-sm ${yearBucket === 'all' ? 'border-wave text-wave' : 'border-edge text-slate-300'}`}
        >
          {locale === 'zh' ? '全部年代' : 'All eras'}
        </button>
        {yearCounts.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setYearBucket(b.id)}
            className={`btn border text-sm ${yearBucket === b.id ? 'border-wave text-wave' : 'border-edge text-slate-300'}`}
          >
            {b.label} {b.n}
          </button>
        ))}
      </div>

      {compact ? (
        <div className="card divide-y divide-edge/60 p-2">
          {rows.map(({ method: m, depth }) => {
            const role = effectiveRole(m)
            const peers = parallelsOf(m.id)
            const kids = childrenOf(m.id)
            return (
              <div
                key={m.id}
                id={m.id}
                className="flex flex-wrap items-center gap-2 px-2 py-1.5 hover:bg-wave/5"
                style={{ paddingLeft: `${0.5 + depth * 1.1}rem` }}
              >
                <span className="font-mono text-[9px] text-slate-600">
                  {depth === 0 ? '·' : '└'.padStart(depth, '│')}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${ROLE_BADGE[role]}`}
                >
                  {roleText(role)}
                </span>
                <span className="text-base">{m.icon}</span>
                <a href={`#${m.id}`} className="text-sm font-medium text-white hover:text-wave">
                  {localizedName(m, locale)}
                </a>
                {secondaryName(m, locale) && (
                  <span className="font-mono text-[10px] text-slate-500">
                    {secondaryName(m, locale)}
                  </span>
                )}
                <span className="rounded-full bg-edge/80 px-1.5 py-0.5 text-[9px] text-slate-500">
                  {kindText(m.kind)}
                </span>
                {m.yearIntroduced != null && (
                  <span className="font-mono text-[9px] text-slate-600">≈{m.yearIntroduced}</span>
                )}
                {kids.length > 0 && (
                  <span className="text-[9px] text-slate-600">↓{kids.length}</span>
                )}
                {peers.length > 0 && (
                  <span className="text-[9px] text-amber-500/70">∥{peers.length}</span>
                )}
                {(m.simPaths?.length ?? 0) > 0 ? (
                  <Link
                    to={`/${m.simPaths![0]}`}
                    className="text-[9px] text-wave hover:underline"
                  >
                    {locale === 'zh' ? '仿真' : 'Sim'}
                  </Link>
                ) : (
                  <span className="text-[9px] text-amber-500/60">
                    {locale === 'zh' ? '骨架' : 'Scaffold'}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map(({ method: m, depth }) => {
            const kids = childrenOf(m.id)
            const parent = m.parentId ? methodById(m.parentId) : undefined
            const trail = pathToRoot(m.id)
            const peers = parallelsOf(m.id)
            const role = effectiveRole(m)
            return (
              <article
                key={m.id}
                id={m.id}
                className="card p-5"
                style={indentStyle(depth, role)}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  {depth > 0 && (
                    <span
                      className="font-mono text-[9px] text-slate-600"
                      title={locale === 'zh' ? `嵌套深度 ${depth}` : `nesting depth ${depth}`}
                    >
                      d{depth}
                    </span>
                  
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${ROLE_BADGE[role]}`}
                  >
                    {roleText(role)}
                  </span>
                  <span className="text-2xl">{m.icon}</span>
                  <h2 className="text-lg font-semibold text-white">{localizedName(m, locale)}</h2>
                  {secondaryName(m, locale) && (
                    <span className="font-mono text-xs text-slate-500">
                      {secondaryName(m, locale)}
                    </span>
                  )}
                  <ConsensusBadge c={m.consensus} />
                  <span className="rounded-full bg-edge/80 px-2 py-0.5 text-[10px] text-slate-400">
                    {kindText(m.kind)}
                  </span>
                  {m.yearIntroduced != null && (
                    <span className="font-mono text-[10px] text-slate-500">
                      ≈{m.yearIntroduced}
                    </span>
                  )}
                  {!(m.simPaths?.length) && (
                    <span className="rounded border border-amber-500/40 px-1.5 py-0.5 text-[9px] text-amber-400/90">
                      {locale === 'zh' ? '研究骨架' : 'Research skeleton'}
                    </span>
                  )}
                </div>
                {parent && (
                  <p className="mb-2 text-[10px] text-slate-500">
                    {locale === 'zh' ? '隶属于' : 'Parent'}{' '}
                    <a href={`#${parent.id}`} className="text-wave hover:underline">
                      {parent.icon} {localizedName(parent, locale)}
                    </a>
                    {trail.length > 2 && (
                      <span className="text-slate-600">
                        {' '}
                        · {locale === 'zh' ? '链' : 'chain'}{' '}
                        {[...trail]
                          .reverse()
                          .map((t) => localizedName(t, locale))
                          .join(' → ')}
                      </span>
                    )}
                  </p>
                )}
                <p className="mb-3 text-sm text-slate-300">
                  {pickLocaleString(m.summary, m.summaryEn, locale)}
                </p>
                <div className="mb-3">
                  <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {locale === 'zh' ? '基础方程 / 公理' : 'Foundations / axioms'}
                  </h3>
                  <ul className="space-y-0.5 text-xs text-slate-400">
                    {m.foundations.map((f) => (
                      <li key={f}>· {methodFoundation(f, locale)}</li>
                    ))}
                  </ul>
                </div>
                {m.schools && m.schools.length > 0 && (
                  <div className="mb-3 border-t border-edge pt-2">
                    <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {locale === 'zh' ? '并立实现 / 学派' : 'Parallel implementations / schools'}
                    </h3>
                    {m.schools.map((s, i) => {
                      const note = methodSchoolNote(s, locale)
                      return (
                        <p key={i} className="text-xs text-slate-400">
                          ▪ {methodSchoolStance(s, locale)}
                          {s.proponents && (
                            <span className="text-slate-500">
                              {' '}
                              — {s.proponents.join(locale === 'zh' ? '、' : ', ')}
                            </span>
                          )}
                          {note && (
                            <span className="text-slate-600">
                              {locale === 'zh' ? `（${note}）` : ` (${note})`}
                            </span>
                          )}
                        </p>
                      )
                    })}
                  </div>
                )}
                {kids.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    <span className="text-[10px] text-slate-500">
                      {locale === 'zh' ? '下钻模块：' : 'Drill-down modules: '}
                    </span>
                    {kids.map((c) => {
                      const cr = effectiveRole(c)
                      return (
                        <a
                          key={c.id}
                          href={`#${c.id}`}
                          className={`rounded border px-2 py-0.5 text-[10px] hover:border-wave ${
                            c.parallelGroupId
                              ? 'border-amber-500/40 text-amber-200/90'
                              : 'border-wave/30 text-wave'
                          }`}
                          title={roleText(cr)}
                        >
                          {c.icon} {localizedName(c, locale)}
                          {childrenOf(c.id).length > 0 ? ' ▸' : ''}
                        </a>
                      )
                    })}
                  </div>
                )}
                {peers.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    <span className="text-[10px] text-amber-500/80">
                      {locale === 'zh' ? '并行模块（同槽位）：' : 'Parallel modules (same slot): '}
                    </span>
                    {peers.map((p) => (
                      <a
                        key={p.id}
                        href={`#${p.id}`}
                        className="rounded border border-amber-500/40 px-2 py-0.5 text-[10px] text-amber-200/90 hover:border-amber-400"
                      >
                        {p.icon} {localizedName(p, locale)}
                      </a>
                    ))}
                  </div>
                )}
                {(m.simPaths?.length ?? 0) > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    <span className="text-[10px] text-slate-500">
                      {locale === 'zh' ? '可运行样板：' : 'Runnable demos: '}
                    </span>
                    {m.simPaths!.map((p) => (
                      <Link
                        key={p}
                        to={`/${p}`}
                        className="rounded border border-edge px-2 py-0.5 text-[10px] text-wave hover:border-wave"
                      >
                        {(locale === 'en' ? LEAF_LABEL_EN : LEAF_LABEL).get(p) ?? p}
                      </Link>
                    ))}
                  </div>
                )}
                {(m.relatedNodeIds?.length ?? 0) > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5 text-[10px] text-slate-500">
                    <span>{locale === 'zh' ? '能量本体：' : 'Energy ontology: '}</span>
                    {m.relatedNodeIds!.map((id) => (
                      <span key={id} className="rounded bg-edge/60 px-1.5 py-0.5 text-slate-400">
                        {nodeName(id)}
                      </span>
                    ))}
                  </div>
                )}
                <ModuleTryRun methodId={m.id} />
                <div className="mt-3 flex flex-wrap gap-3 border-t border-edge pt-2">
                  <Link
                    to={`/world?m=${encodeURIComponent(m.id)}`}
                    className="text-[11px] text-wave hover:underline"
                  >
                    {locale === 'zh' ? '世界图' : 'World map'}
                  </Link>
                  <Link
                    to={`/taxonomy?m=${encodeURIComponent(m.id)}`}
                    className="text-[11px] text-wave hover:underline"
                  >
                    {locale === 'zh' ? '分类图谱' : 'Taxonomy'}
                  </Link>
                  {DEPTH_SPINE_IDS.has(m.id) && (
                    <Link
                      to={`/method-depth?m=${encodeURIComponent(m.id)}`}
                      className="text-[11px] text-wave hover:underline"
                    >
                      {locale === 'zh' ? '原理深度树' : 'Principle depth tree'}
                    </Link>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

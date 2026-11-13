import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { ConsensusBadge } from '../components/ConsensusBadge'
import { METHODS } from '../data/methods/methods'
import type { FoundationalMethod, MethodKind } from '../data/methods/types'
import { KIND_COLOR, KIND_LABEL, KIND_LABEL_EN } from '../data/methods/kindMeta'
import { NODES } from '../data/ontology/nodes'
import { CONTROVERSIES } from '../data/ontology/controversies'
import { energyDisplayName } from '../lib/energyAlias'
import {
  localizedName,
  methodFoundation,
  methodSchoolStance,
  pickLocaleString,
  secondaryName,
  useLocale,
} from '../lib/i18n'
import { termIdsForSimPath } from '../lib/termGlossary'
import { ALL_LEAVES } from '../nav'

/**
 * 波世界 世界图：时间轴上的基础方法节点 + 能量关联 + 争议标记。
 * 可嵌套入口：点方法 → 样板仿真 / 能量本体 / 争议页。
 * 支持 ?m=method-id 深链选中（与 /methods 卡片「世界图」联动）。
 */
export function WorldMap() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const kindText = (k: MethodKind) => pickLocaleString(KIND_LABEL[k], KIND_LABEL_EN[k], locale)
  const leafLabel = (path: string) => {
    const l = ALL_LEAVES.find((x) => x.path === path)
    return l ? pickLocaleString(l.label, l.labelEn, locale) : path
  }
  const [searchParams, setSearchParams] = useSearchParams()
  const mParam = searchParams.get('m')
  const validM =
    mParam && METHODS.some((m) => m.id === mParam) ? mParam : null

  const [selId, setSelId] = useState<string | null>(
    () => validM ?? METHODS[0]?.id ?? null,
  )
  const [kindFilter, setKindFilter] = useState<MethodKind | 'all'>('all')

  // 深链 / 从方法页跳转：?m=method-id 选中对应方法
  useEffect(() => {
    if (validM) setSelId(validM)
  }, [validM])

  const selectMethod = useCallback(
    (id: string) => {
      setSelId(id)
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('m', id)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const timed = useMemo(() => {
    const list = METHODS.filter((m) => m.yearIntroduced != null)
      .filter((m) => kindFilter === 'all' || m.kind === kindFilter)
      .slice()
      .sort((a, b) => (a.yearIntroduced ?? 0) - (b.yearIntroduced ?? 0))
    return list
  }, [kindFilter])

  const years = timed.map((m) => m.yearIntroduced!)
  const yMin = years.length ? Math.min(...years) : 1800
  const yMax = years.length ? Math.max(...years) : 2030
  const span = Math.max(1, yMax - yMin)

  const sel: FoundationalMethod | undefined =
    METHODS.find((m) => m.id === selId) ?? timed[0]
  const nodeName = (id: string) => energyDisplayName(id, locale)

  const relatedControversies = useMemo(() => {
    if (!sel) return []
    const rel = new Set(sel.relatedNodeIds ?? [])
    return CONTROVERSIES.filter((c) => (c.relatedNodeIds ?? []).some((id) => rel.has(id)))
  }, [sel])

  const xOf = (year: number) => ((year - yMin) / span) * 100

  const kinds = useMemo(() => {
    const s = new Set(METHODS.map((m) => m.kind))
    return Array.from(s)
  }, [])
  const pageTerms = useMemo(() => termIdsForSimPath('world'), [])

  return (
    <div>
      <PageHeader
        icon="🌐"
        title="世界图 · 方法时序"
        subtitle="时间轴上的基础物理方法节点：公理年代 → 多学派透镜 → 站内可运行样板，并挂接能量本体。这是「把世界搬进系统」的时空骨架——可无限追加方法，不裁决唯一真理。"
      />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">
          {zh ? '读世界脊梁时' : 'When reading the world backbone'}
        </span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <span className="text-slate-600">
          {zh ? '（悬停看一句人话；与矩阵同词典）' : '(hover for plain language; same glossary as matrix)'}
        </span>
      </p>

      <div className="note mb-5">
        <strong className="text-slate-200">{zh ? '读图：' : 'How to read: '}</strong>
        {zh ? (
          <>
            横轴为方法被广泛引入的大致年代；色点为方法类型。
            点击节点查看 foundations / schools / 样板链接。
            先修丝线图见 <Link to="/taxonomy" className="text-wave underline">方法分类图谱</Link>
            ；能量脊梁见 <Link to="/graph" className="text-wave underline">能量图谱</Link>
            ；方法目录见 <Link to="/methods" className="text-wave underline">基础方法</Link>
            ；争议见 <Link to="/controversies" className="text-wave underline">多解释</Link>。
          </>
        ) : (
          <>
            Horizontal axis is the approximate year a method became widely used; color is method kind.
            Click a node for foundations / schools / sample links.
            Prerequisite silk-map: <Link to="/taxonomy" className="text-wave underline">method taxonomy</Link>
            ; energy backbone: <Link to="/graph" className="text-wave underline">energy graph</Link>
            ; method catalog: <Link to="/methods" className="text-wave underline">foundational methods</Link>
            ; debates: <Link to="/controversies" className="text-wave underline">multi-explanations</Link>.
          </>
        )}
      </div>

      <div className="toolbar mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setKindFilter('all')}
          className={`btn border text-sm ${kindFilter === 'all' ? 'border-wave text-wave' : 'border-edge text-slate-300'}`}
        >
          {zh ? '全部' : 'All'}
        </button>
        {kinds.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKindFilter(k)}
            className={`btn border text-sm ${kindFilter === k ? 'border-wave text-wave' : 'border-edge text-slate-300'}`}
            style={kindFilter === k ? { borderColor: KIND_COLOR[k], color: KIND_COLOR[k] } : undefined}
          >
            {kindText(k)}
          </button>
        ))}
      </div>

      {/* 时间轴 */}
      <div className="card mb-6 overflow-x-auto p-5">
        <div className="mb-2 flex justify-between font-mono text-[10px] text-slate-500">
          <span>{yMin}</span>
          <span>{zh ? '基础方法时序 · 波世界' : 'Foundational methods timeline · WaveWorld'}</span>
          <span>{yMax}</span>
        </div>
        <div className="relative h-36 min-w-[640px]">
          {/* axis */}
          <div className="absolute left-0 right-0 top-1/2 h-px bg-edge" />
          {/* century ticks */}
          {Array.from({ length: Math.floor(yMax / 50) - Math.floor(yMin / 50) + 1 }, (_, i) => {
            const y = Math.ceil(yMin / 50) * 50 + i * 50
            if (y < yMin || y > yMax) return null
            return (
              <div
                key={y}
                className="absolute top-0 h-full w-px bg-edge/50"
                style={{ left: `${xOf(y)}%` }}
              >
                <span className="absolute top-0 -translate-x-1/2 font-mono text-[9px] text-slate-600">{y}</span>
              </div>
            )
          })}
          {/* method dots — staggered rows by kind hash */}
          {timed.map((m, i) => {
            const row = (i % 5) - 2
            const top = 50 + row * 14
            const active = sel?.id === m.id
            const color = KIND_COLOR[m.kind]
            return (
              <button
                key={m.id}
                type="button"
                title={`${m.yearIntroduced} · ${localizedName(m, locale)}`}
                onClick={() => selectMethod(m.id)}
                className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                style={{ left: `${xOf(m.yearIntroduced!)}%`, top: `${top}%` }}
              >
                <span
                  className={`h-3.5 w-3.5 rounded-full border-2 transition-transform ${active ? 'scale-150' : 'hover:scale-125'}`}
                  style={{
                    background: color,
                    borderColor: active ? '#fff' : `${color}99`,
                    boxShadow: active ? `0 0 16px ${color}` : undefined,
                  }}
                />
                {active && (
                  <span className="mt-1 max-w-[7rem] truncate text-center text-[9px] text-white">
                    {m.icon} {localizedName(m, locale)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-500">
          {kinds.map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[k] }} />
              {kindText(k)}
            </span>
          ))}
        </div>
      </div>

      {/* 详情 + 能量连线 */}
      {sel && (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="card p-5 lg:col-span-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-2xl">{sel.icon}</span>
              <h2 className="text-xl font-semibold text-white">{localizedName(sel, locale)}</h2>
              {secondaryName(sel, locale) && (
                <span className="font-mono text-sm text-slate-500">
                  {secondaryName(sel, locale)}
                </span>
              )}
              <ConsensusBadge c={sel.consensus} />
              {sel.yearIntroduced != null && (
                <span className="font-mono text-xs text-slate-400">≈ {sel.yearIntroduced}</span>
              )}
            </div>
            <p className="mb-4 text-sm text-slate-300">
              {pickLocaleString(sel.summary, sel.summaryEn, locale)}
            </p>
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {zh ? '基础方程 / 公理' : 'Foundational equations / axioms'}
            </h3>
            <ul className="mb-4 space-y-0.5 text-xs text-slate-400">
              {sel.foundations.map((f) => (
                <li key={f}>· {methodFoundation(f, locale)}</li>
              ))}
            </ul>
            {sel.schools && sel.schools.length > 0 && (
              <>
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {zh ? '并立实现 / 学派' : 'Parallel implementations / schools'}
                </h3>
                <div className="mb-4 space-y-1">
                  {sel.schools.map((s, i) => (
                    <p key={i} className="text-xs text-slate-400">
                      ▪ {methodSchoolStance(s, locale)}
                      {s.proponents && (
                        <span className="text-slate-500">
                          {' '}
                          — {s.proponents.join(zh ? '、' : ', ')}
                        </span>
                      )}
                    </p>
                  ))}
                </div>
              </>
            )}
            {(sel.simPaths?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-slate-500">
                  {zh ? '嵌套样板：' : 'Nested samples: '}
                </span>
                {sel.simPaths!.map((p) => (
                  <Link
                    key={p}
                    to={`/${p}`}
                    className="btn border border-wave/40 text-xs text-wave hover:bg-wave/10"
                  >
                    {zh ? '打开' : 'Open'} {leafLabel(p)}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4 lg:col-span-2">
            <div className="card p-4">
              <h3 className="mb-2 text-xs font-semibold text-slate-400">
                {zh ? '关联能量本体' : 'Linked energy ontology'}
              </h3>
              {(sel.relatedNodeIds?.length ?? 0) === 0 ? (
                <p className="text-xs text-slate-600">
                  {zh ? '元方法 / 未绑定能量形式' : 'Meta-method / no bound energy form'}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {sel.relatedNodeIds!.map((id) => {
                    const n = NODES.find((x) => x.id === id)
                    return (
                      <Link
                        key={id}
                        to="/graph"
                        className="rounded-lg border border-edge px-2 py-1 text-xs text-slate-300 hover:border-wave"
                        style={{ borderColor: n?.color ? `${n.color}66` : undefined }}
                      >
                        {n?.icon} {nodeName(id)}
                      </Link>
                    )
                  })}
                </div>
              )}
              <Link to="/graph" className="mt-3 inline-block text-[10px] text-wave/80 hover:underline">
                {zh ? '打开能量图谱 →' : 'Open energy graph →'}
              </Link>
            </div>

            <div className="card p-4">
              <h3 className="mb-2 text-xs font-semibold text-slate-400">
                {zh ? '相关争议（多解释）' : 'Related controversies (multi-explanations)'}
              </h3>
              {relatedControversies.length === 0 ? (
                <p className="text-xs text-slate-600">
                  {zh
                    ? '此方法关联能量上暂无登记元争议'
                    : 'No registered meta-controversies on linked energies'}
                </p>
              ) : (
                <ul className="space-y-2">
                  {relatedControversies.map((c) => (
                    <li key={c.id} className="text-xs text-slate-400">
                      <ConsensusBadge c={c.consensus} />{' '}
                      <span className="text-slate-300">
                        {pickLocaleString(c.title, c.titleEn, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link to="/controversies" className="mt-3 inline-block text-[10px] text-wave/80 hover:underline">
                {zh ? '全部争议 →' : 'All controversies →'}
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

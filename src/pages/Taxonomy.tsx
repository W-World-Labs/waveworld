import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { ConsensusBadge } from '../components/ConsensusBadge'
import {
  METHODS,
  childrenOf,
  methodById,
  parallelsOf,
  pathToRoot,
} from '../data/methods/methods'
import {
  METHOD_DEPENDENCIES,
  ancestorIds,
  degreeOf,
  depsOf,
  descendantIds,
  dependentsOf,
  learningPath,
} from '../data/methods/dependencies'
import { KIND_COLOR, KIND_LABEL, KIND_LABEL_EN, KIND_ORDER } from '../data/methods/kindMeta'
import type { FoundationalMethod, MethodKind } from '../data/methods/types'
import { NODES } from '../data/ontology/nodes'
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
import { ModuleTryRun } from '../components/ModuleTryRun'
import { ALL_LEAVES } from '../nav'

type LayoutMode = 'lanes' | 'galaxy'

const VIEW = { w: 960, h: 580, padX: 52, padY: 40, topGutter: 30, bottomGutter: 22 }

type Pos = { x: number; y: number; color: string; r: number }

function layoutLanes(methods: FoundationalMethod[]): {
  pos: Map<string, Pos>
  kindOrder: MethodKind[]
  yMin: number
  yMax: number
  laneW: number
} {
  const present = new Set(methods.map((m) => m.kind))
  const kindOrder = KIND_ORDER.filter((k) => present.has(k))
  const years = methods.map((m) => m.yearIntroduced ?? 2000)
  const yMin = Math.min(...years)
  const yMax = Math.max(...years)
  const span = Math.max(1, yMax - yMin)
  const laneW = (VIEW.w - VIEW.padX * 2) / Math.max(1, kindOrder.length)
  const innerH = VIEW.h - VIEW.padY * 2 - VIEW.topGutter - VIEW.bottomGutter
  const laneCounts = new Map<string, number>()
  const pos = new Map<string, Pos>()

  for (const m of methods) {
    const ki = kindOrder.indexOf(m.kind)
    const year = m.yearIntroduced ?? yMax
    const t = (year - yMin) / span
    const y = VIEW.padY + VIEW.topGutter + t * innerH
    const baseX = VIEW.padX + (ki + 0.5) * laneW
    const key = `${m.kind}:${year}`
    const n = laneCounts.get(key) ?? 0
    laneCounts.set(key, n + 1)
    const deg = degreeOf(m.id)
    pos.set(m.id, {
      x: baseX + (n - 0.5) * 14,
      y,
      color: KIND_COLOR[m.kind],
      r: 4.5 + Math.min(4, deg * 0.55),
    })
  }
  return { pos, kindOrder, yMin, yMax, laneW }
}

/** 星图：半径≈年代（早靠近中心），角向按 kind 扇区 — 更接近 Marble 的「高度+色簇」语感 */
function layoutGalaxy(methods: FoundationalMethod[]): {
  pos: Map<string, Pos>
  kindOrder: MethodKind[]
  yMin: number
  yMax: number
  laneW: number
  cx: number
  cy: number
} {
  const present = new Set(methods.map((m) => m.kind))
  const kindOrder = KIND_ORDER.filter((k) => present.has(k))
  const years = methods.map((m) => m.yearIntroduced ?? 2000)
  const yMin = Math.min(...years)
  const yMax = Math.max(...years)
  const span = Math.max(1, yMax - yMin)
  const cx = VIEW.w / 2
  const cy = VIEW.h / 2 + 8
  const rMin = 48
  const rMax = Math.min(VIEW.w, VIEW.h) * 0.38
  const pos = new Map<string, Pos>()
  const sectorCounts = new Map<string, number>()

  for (const m of methods) {
    const ki = kindOrder.indexOf(m.kind)
    const nKinds = Math.max(1, kindOrder.length)
    const sector = ((ki + 0.5) / nKinds) * Math.PI * 2 - Math.PI / 2
    const year = m.yearIntroduced ?? yMax
    const t = (year - yMin) / span
    const radius = rMin + t * (rMax - rMin)
    const key = m.kind
    const n = sectorCounts.get(key) ?? 0
    sectorCounts.set(key, n + 1)
    const jitter = (n - 1) * 0.07
    const ang = sector + jitter
    const deg = degreeOf(m.id)
    pos.set(m.id, {
      x: cx + Math.cos(ang) * radius,
      y: cy + Math.sin(ang) * radius,
      color: KIND_COLOR[m.kind],
      r: 4.5 + Math.min(4, deg * 0.55),
    })
  }
  return { pos, kindOrder, yMin, yMax, laneW: 0, cx, cy }
}

function edgePath(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  curved: boolean,
): string {
  if (!curved) return `M ${ax} ${ay} L ${bx} ${by}`
  const mx = (ax + bx) / 2
  const my = (ay + by) / 2
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy) || 1
  // 轻微法向弯曲，避免丝线完全重叠
  const ox = (-dy / len) * Math.min(28, len * 0.12)
  const oy = (dx / len) * Math.min(28, len * 0.12)
  return `M ${ax} ${ay} Q ${mx + ox} ${my + oy} ${bx} ${by}`
}

/**
 * 方法分类图谱 · 学习 Marble Skill Taxonomy 的展示语言：
 * 色点=节点（按 kind 上色）· 年代轴/径向高度 · 细线=先修 · 点击追溯学习路径。
 * 数据全部来自 波世界 方法脊梁，不引入第三方 taxonomy 内容。
 */
export function Taxonomy() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const kindText = (k: MethodKind) => pickLocaleString(KIND_LABEL[k], KIND_LABEL_EN[k], locale)
  const leafLabel = (path: string) => {
    const l = ALL_LEAVES.find((x) => x.path === path)
    return l ? pickLocaleString(l.label, l.labelEn, locale) : path
  }
  const methodLabel = (id: string) => {
    const m = methodById(id)
    return m ? localizedName(m, locale) : zh ? '未命名方法' : 'Unnamed method'
  }
  const [searchParams, setSearchParams] = useSearchParams()
  const mParam = searchParams.get('m')
  const validM =
    mParam && METHODS.some((m) => m.id === mParam) ? mParam : null

  const [selId, setSelId] = useState<string | null>(
    () => validM ?? 'method-fdtd',
  )
  const [kindFilter, setKindFilter] = useState<MethodKind | 'all'>('all')
  const [showSoft, setShowSoft] = useState(true)
  const [focusTrail, setFocusTrail] = useState(true)
  const [layout, setLayout] = useState<LayoutMode>('lanes')
  const [spin, setSpin] = useState(false)
  const [hoverId, setHoverId] = useState<string | null>(null)

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

  // 方向键在方法列表中切换（按年代）
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLTextAreaElement) return
      const ordered = METHODS.slice().sort(
        (a, b) => (a.yearIntroduced ?? 0) - (b.yearIntroduced ?? 0),
      )
      const idx = ordered.findIndex((m) => m.id === selId)
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
        const next = ordered[(idx + 1) % ordered.length]
        if (next) {
          ev.preventDefault()
          selectMethod(next.id)
        }
      } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
        const next = ordered[(idx - 1 + ordered.length) % ordered.length]
        if (next) {
          ev.preventDefault()
          selectMethod(next.id)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selId, selectMethod])

  const ancestors = useMemo(
    () => (selId ? ancestorIds(selId) : new Set<string>()),
    [selId],
  )
  const descendants = useMemo(
    () => (selId ? descendantIds(selId) : new Set<string>()),
    [selId],
  )
  const pathIds = useMemo(
    () => (selId ? learningPath(selId) : []),
    [selId],
  )

  const visible = useMemo(() => {
    return METHODS.filter((m) => {
      if (kindFilter !== 'all' && m.kind !== kindFilter) {
        // 聚焦模式下：选中链上的点即使跨 kind 也保留
        if (focusTrail && selId && (m.id === selId || ancestors.has(m.id) || descendants.has(m.id))) {
          return true
        }
        return false
      }
      return true
    })
  }, [kindFilter, focusTrail, selId, ancestors, descendants])

  const visibleIds = useMemo(() => new Set(visible.map((m) => m.id)), [visible])

  const laid = useMemo(() => {
    const list = visible.length ? visible : METHODS
    return layout === 'galaxy' ? layoutGalaxy(list) : layoutLanes(list)
  }, [visible, layout])

  const { pos, kindOrder, yMin, yMax, laneW } = laid
  const galaxy = layout === 'galaxy' ? (laid as ReturnType<typeof layoutGalaxy>) : null

  const edges = useMemo(() => {
    return METHOD_DEPENDENCIES.filter((e) => {
      if (!showSoft && e.strength === 'soft') return false
      return visibleIds.has(e.methodId) && visibleIds.has(e.prerequisiteId)
    })
  }, [showSoft, visibleIds])

  const sel = METHODS.find((m) => m.id === selId) ?? METHODS[0]
  const directPrereqs = sel ? depsOf(sel.id) : []
  const directDeps = sel ? dependentsOf(sel.id) : []

  const kinds = useMemo(() => {
    const s = new Set(METHODS.map((m) => m.kind))
    return KIND_ORDER.filter((k) => s.has(k))
  }, [])

  const yearTicks = useMemo(() => {
    const step = 50
    const start = Math.ceil(yMin / step) * step
    const ticks: number[] = []
    for (let y = start; y <= yMax; y += step) ticks.push(y)
    if (!ticks.includes(yMin)) ticks.unshift(yMin)
    if (!ticks.includes(yMax)) ticks.push(yMax)
    return ticks
  }, [yMin, yMax])

  const yOfYear = (year: number) => {
    const span = Math.max(1, yMax - yMin)
    const t = (year - yMin) / span
    const innerH = VIEW.h - VIEW.padY * 2 - VIEW.topGutter - VIEW.bottomGutter
    return VIEW.padY + VIEW.topGutter + t * innerH
  }

  const edgeHighlight = (from: string, to: string) => {
    if (!selId) return false
    if (from === selId || to === selId) return true
    if (from === selId && ancestors.has(to)) return true
    if (to === selId && descendants.has(from)) return true
    if (ancestors.has(from) && ancestors.has(to)) return true
    if (descendants.has(from) && descendants.has(to)) return true
    // 学习路径相邻
    const i = pathIds.indexOf(from)
    const j = pathIds.indexOf(to)
    if (i >= 0 && j >= 0) return true
    return false
  }

  const nodeDim = (id: string) => {
    if (!focusTrail || !selId) return false
    if (id === selId) return false
    if (ancestors.has(id) || descendants.has(id)) return false
    return true
  }

  const highlightSet = useMemo(() => {
    if (!selId) return new Set<string>()
    return new Set([selId, ...ancestors, ...descendants])
  }, [selId, ancestors, descendants])

  const pageTerms = useMemo(() => termIdsForSimPath('taxonomy'), [])

  return (
    <div>
      <PageHeader
        icon="🧬"
        title="方法分类图谱"
        subtitle="色点=方法类型 · 纵轴/半径=年代 · 丝线=先修关系。点击追溯学习路径；方向键切换节点。"
      />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">
          {zh ? '读方法脊梁时' : 'When reading the method backbone'}
        </span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <span className="text-slate-600">
          {zh ? '（悬停看一句人话；与矩阵同词典）' : '(hover for plain language; same glossary as matrix)'}
        </span>
      </p>

      <div className="note mb-5">
        <strong className="text-slate-200">
          {zh ? '展示语言（灵感）：' : 'Display language (inspired by): '}
        </strong>
        <span className="text-slate-400">
          {' '}
          <a
            href="https://github.com/withmarbleapp/os-taxonomy"
            target="_blank"
            rel="noreferrer"
            className="text-wave underline"
          >
            Marble Skill Taxonomy
          </a>
          {zh ? (
            <>
              {' '}
              （色点 + 年龄高度 + prerequisite 丝线）。本页复用同一手势，节点与边均为站内方法脊梁——
              <strong className="text-slate-300">不引入 Marble 数据或文案</strong>
              （ODbL / CC-BY-SA）。
            </>
          ) : (
            <>
              {' '}
              (dots + age height + prerequisite silk). Same gestures here; nodes and edges are
              WaveWorld method backbone only—
              <strong className="text-slate-300">no Marble data or copy</strong>
              {' '}
              (ODbL / CC-BY-SA).
            </>
          )}
        </span>
        <span className="mt-1 block text-slate-500">
          {zh ? '时序一维 ' : '1D timeline '}
          <Link to="/world" className="text-wave underline">
            {zh ? '世界图' : 'world map'}
          </Link>
          {' · '}
          <Link to="/methods" className="text-wave underline">
            {zh ? '方法目录' : 'method catalog'}
          </Link>
          {' · '}
          <Link to="/graph" className="text-wave underline">
            {zh ? '能量图谱' : 'energy graph'}
          </Link>
        </span>
      </div>

      {/* 学习路径条 */}
      {sel && pathIds.length > 0 && (
        <div className="card mb-4 flex flex-wrap items-center gap-1.5 p-3">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {zh ? '学习路径' : 'Learning path'}
          </span>
          {pathIds.map((id, i) => {
            const m = METHODS.find((x) => x.id === id)
            if (!m) return null
            const active = id === sel.id
            return (
              <span key={id} className="inline-flex items-center gap-1">
                {i > 0 && <span className="text-slate-600">→</span>}
                <button
                  type="button"
                  onClick={() => selectMethod(id)}
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                    active
                      ? 'border-wave bg-wave/15 text-wave'
                      : 'border-edge text-slate-300 hover:border-wave/50'
                  }`}
                  style={!active ? { borderColor: `${KIND_COLOR[m.kind]}66` } : undefined}
                >
                  {m.icon} {localizedName(m, locale)}
                  {m.yearIntroduced != null && (
                    <span className="ml-1 font-mono text-[9px] text-slate-500">
                      {m.yearIntroduced}
                    </span>
                  )}
                </button>
              </span>
            )
          })}
        </div>
      )}

      <div className="toolbar mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setKindFilter('all')}
          className={`btn border text-sm ${kindFilter === 'all' ? 'border-wave text-wave' : 'border-edge text-slate-300'}`}
        >
          {zh ? '全部 kind' : 'All kinds'}
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

        <span className="mx-1 hidden h-4 w-px bg-edge sm:inline-block" />

        <div className="inline-flex rounded-lg border border-edge p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setLayout('lanes')}
            className={`rounded-md px-2 py-1 ${layout === 'lanes' ? 'bg-wave/20 text-wave' : 'text-slate-400'}`}
          >
            {zh ? '泳道' : 'Lanes'}
          </button>
          <button
            type="button"
            onClick={() => setLayout('galaxy')}
            className={`rounded-md px-2 py-1 ${layout === 'galaxy' ? 'bg-wave/20 text-wave' : 'text-slate-400'}`}
          >
            {zh ? '星图' : 'Galaxy'}
          </button>
        </div>

        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={showSoft}
            onChange={(e) => setShowSoft(e.target.checked)}
            className="accent-wave"
          />
          {zh ? '辅助先修' : 'Supporting prerequisites'}
        </label>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={focusTrail}
            onChange={(e) => setFocusTrail(e.target.checked)}
            className="accent-wave"
          />
          {zh ? '聚焦路径' : 'Focus trail'}
        </label>
        {layout === 'galaxy' && (
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={spin}
              onChange={(e) => setSpin(e.target.checked)}
              className="accent-wave"
            />
            {zh ? '慢旋' : 'Slow spin'}
          </label>
        )}

        <span className="ml-auto font-mono text-[10px] text-slate-600">
          {zh
            ? `${visible.length} 点 · ${edges.length} 边 · ←→ 切换`
            : `${visible.length} nodes · ${edges.length} edges · ←→ switch`}
        </span>
      </div>

      <div className="card mb-6 overflow-x-auto p-3 sm:p-4">
        <svg
          viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
          className="mx-auto h-auto w-full max-w-5xl"
          role="img"
          aria-label={zh ? '方法分类图谱' : 'Method taxonomy map'}
          onMouseLeave={() => setHoverId(null)}
        >
          <defs>
            <marker
              id="arrow-dim"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148,163,184,0.35)" />
            </marker>
            <marker
              id="arrow-hi"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(58,214,255,0.9)" />
            </marker>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* 背景层：泳道或同心圆 */}
          {layout === 'lanes' &&
            kindOrder.map((k, i) => (
              <g key={k}>
                <rect
                  x={VIEW.padX + i * laneW}
                  y={VIEW.padY}
                  width={laneW}
                  height={VIEW.h - VIEW.padY * 2}
                  fill={i % 2 === 0 ? 'rgba(139,123,255,0.04)' : 'transparent'}
                />
                <text
                  x={VIEW.padX + (i + 0.5) * laneW}
                  y={VIEW.padY + 14}
                  textAnchor="middle"
                  fill="#64748b"
                  style={{ fontSize: 11 }}
                >
                  {kindText(k)}
                </text>
              </g>
            ))}

          {layout === 'galaxy' && galaxy && (
            <g opacity={0.35}>
              {[0.33, 0.66, 1].map((t) => {
                const r = 48 + t * (Math.min(VIEW.w, VIEW.h) * 0.38 - 48)
                return (
                  <circle
                    key={t}
                    cx={galaxy.cx}
                    cy={galaxy.cy}
                    r={r}
                    fill="none"
                    stroke="rgba(148,163,184,0.2)"
                    strokeDasharray="2 4"
                  />
                )
              })}
              {kindOrder.map((k, i) => {
                const nKinds = Math.max(1, kindOrder.length)
                const ang = ((i + 0.5) / nKinds) * Math.PI * 2 - Math.PI / 2
                const r = Math.min(VIEW.w, VIEW.h) * 0.4
                return (
                  <text
                    key={k}
                    x={galaxy.cx + Math.cos(ang) * r}
                    y={galaxy.cy + Math.sin(ang) * r}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={KIND_COLOR[k]}
                    style={{ fontSize: 10, opacity: 0.7 }}
                  >
                    {kindText(k)}
                  </text>
                )
              })}
            </g>
          )}

          {layout === 'lanes' &&
            yearTicks.map((year) => {
              const y = yOfYear(year)
              return (
                <g key={year}>
                  <line
                    x1={VIEW.padX - 4}
                    x2={VIEW.w - VIEW.padX}
                    y1={y}
                    y2={y}
                    stroke="rgba(148,163,184,0.12)"
                    strokeDasharray="3 4"
                  />
                  <text
                    x={VIEW.padX - 8}
                    y={y + 3}
                    textAnchor="end"
                    fill="#475569"
                    style={{ fontSize: 10, fontFamily: 'ui-monospace, monospace' }}
                  >
                    {year}
                  </text>
                </g>
              )
            })}

          <g
            style={
              layout === 'galaxy' && spin && galaxy
                ? {
                    transformOrigin: `${galaxy.cx}px ${galaxy.cy}px`,
                    animation: 'taxonomy-spin 48s linear infinite',
                  }
                : undefined
            }
          >
            {/* 边：箭头指向先修 */}
            {edges.map((e) => {
              const a = pos.get(e.methodId)
              const b = pos.get(e.prerequisiteId)
              if (!a || !b) return null
              const hi = edgeHighlight(e.methodId, e.prerequisiteId)
              const soft = e.strength === 'soft'
              const dim = focusTrail && selId && !hi
              // 缩短端点，避免箭头扎进圆点
              const dx = b.x - a.x
              const dy = b.y - a.y
              const len = Math.hypot(dx, dy) || 1
              const ux = dx / len
              const uy = dy / len
              const x1 = a.x + ux * (a.r + 2)
              const y1 = a.y + uy * (a.r + 2)
              const x2 = b.x - ux * (b.r + 4)
              const y2 = b.y - uy * (b.r + 4)
              return (
                <path
                  key={`${e.methodId}>${e.prerequisiteId}`}
                  d={edgePath(x1, y1, x2, y2, true)}
                  fill="none"
                  stroke={hi ? 'rgba(58,214,255,0.9)' : 'rgba(148,163,184,0.32)'}
                  strokeWidth={hi ? 2.2 : 1}
                  strokeDasharray={soft ? '5 4' : undefined}
                  opacity={dim ? 0.12 : 1}
                  markerEnd={hi ? 'url(#arrow-hi)' : 'url(#arrow-dim)'}
                >
                  <title>{`${e.strength}: ${pickLocaleString(e.reason, e.reasonEn, locale)}`}</title>
                </path>
              )
            })}

            {/* 节点 */}
            {visible.map((m) => {
              const p = pos.get(m.id)
              if (!p) return null
              const active = sel?.id === m.id
              const onPath = highlightSet.has(m.id)
              const dim = nodeDim(m.id)
              const hovered = hoverId === m.id
              const r = active ? p.r + 3.5 : onPath || hovered ? p.r + 1.5 : p.r
              return (
                <g
                  key={m.id}
                  transform={`translate(${p.x},${p.y})`}
                  className="cursor-pointer"
                  opacity={dim ? 0.18 : 1}
                  onClick={() => selectMethod(m.id)}
                  onMouseEnter={() => setHoverId(m.id)}
                  onMouseLeave={() => setHoverId(null)}
                  filter={active ? 'url(#glow)' : undefined}
                >
                  {(active || hovered) && (
                    <circle
                      r={r + 5}
                      fill="none"
                      stroke={active ? '#fff' : p.color}
                      strokeWidth={1.2}
                      opacity={0.7}
                    >
                      {active && (
                        <animate
                          attributeName="r"
                          values={`${r + 4};${r + 8};${r + 4}`}
                          dur="2.4s"
                          repeatCount="indefinite"
                        />
                      )}
                    </circle>
                  )}
                  <circle
                    r={r}
                    fill={p.color}
                    stroke={active ? '#fff' : `${p.color}bb`}
                    strokeWidth={active ? 2 : 1}
                  />
                  {(active || onPath || hovered) && (
                    <text
                      y={-r - 7}
                      textAnchor="middle"
                      fill="#e2e8f0"
                      style={{ fontSize: 10, pointerEvents: 'none' }}
                    >
                      {m.icon} {localizedName(m, locale)}
                    </text>
                  )}
                  <title>
                    {m.yearIntroduced ?? '—'} · {localizedName(m, locale)}
                    {'\n'}
                    {pickLocaleString(m.summary, m.summaryEn, locale)}
                  </title>
                </g>
              )
            })}
          </g>
        </svg>

        <style>{`
          @keyframes taxonomy-spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>

        <div className="mt-2 flex flex-wrap items-center gap-4 px-1 text-[10px] text-slate-500">
          <span>
            {zh
              ? '实线主要先修 · 虚线辅助先修 · 箭头指向建议先学的方法'
              : 'Solid=main prerequisite · dashed=supporting · arrow → suggested prior learning'}
          </span>
          <span>
            {layout === 'lanes'
              ? zh
                ? '泳道：纵轴早→晚（上→下），横轴 kind'
                : 'Lanes: year early→late (top→bottom), kind on x'
              : zh
                ? '星图：半径早→晚（内→外），扇区 kind'
                : 'Galaxy: radius early→late (in→out), kind sectors'}
          </span>
          <span className="text-slate-600">
            {zh ? '点越大 ≈ 先修图度数越高' : 'Larger dots ≈ higher graph degree'}
          </span>
          {kinds.map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: KIND_COLOR[k] }} />
              {kindText(k)}
            </span>
          ))}
        </div>
      </div>

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
              <span
                className="rounded-full px-2 py-0.5 text-[10px]"
                style={{
                  background: `${KIND_COLOR[sel.kind]}22`,
                  color: KIND_COLOR[sel.kind],
                  border: `1px solid ${KIND_COLOR[sel.kind]}55`,
                }}
              >
                {kindText(sel.kind)}
              </span>
              <span className="font-mono text-[10px] text-slate-600">
                {zh ? '关联度' : 'degree'} {degreeOf(sel.id)}
              </span>
            </div>
            <p className="mb-4 text-sm text-slate-300">
              {pickLocaleString(sel.summary, sel.summaryEn, locale)}
            </p>

            {(sel.parentId || childrenOf(sel.id).length > 0 || parallelsOf(sel.id).length > 0) && (
              <div className="mb-4 rounded-lg border border-edge/80 bg-panel/40 p-3">
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {zh ? '模块嵌套 · 并行解释' : 'Module nesting · parallel views'}
                </h3>
                <p className="mb-2 text-[10px] text-slate-600">
                  {zh
                    ? '父模块可多级（族→算法→步进）；下钻链可逐层点开。深度 '
                    : 'Parents can nest (family→algo→step); drill-down opens each layer. Depth '}
                  {Math.max(0, pathToRoot(sel.id).length - 1)}
                  {pathToRoot(sel.id).length > 2 && (
                    <span className="text-slate-500">
                      {' '}
                      ·{' '}
                      {[...pathToRoot(sel.id)]
                        .reverse()
                        .map((t) => localizedName(t, locale))
                        .join(' → ')}
                    </span>
                  )}
                </p>
                {sel.parentId && (
                  <p className="mb-1 text-xs text-slate-400">
                    {zh ? '父模块：' : 'Parent: '}{' '}
                    <button
                      type="button"
                      className="text-wave hover:underline"
                      onClick={() => selectMethod(sel.parentId!)}
                    >
                      {methodById(sel.parentId)?.icon} {methodLabel(sel.parentId)}
                    </button>
                  </p>
                )}
                {childrenOf(sel.id).length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    <span className="text-[10px] text-slate-500">
                      {zh ? '下钻：' : 'Drill-down: '}
                    </span>
                    {childrenOf(sel.id).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectMethod(c.id)}
                        className={`rounded border px-2 py-0.5 text-[10px] hover:border-wave ${
                          c.parallelGroupId
                            ? 'border-amber-500/40 text-amber-200/90'
                            : 'border-wave/30 text-wave'
                        }`}
                        title={
                          childrenOf(c.id).length > 0
                            ? zh
                              ? `含 ${childrenOf(c.id).length} 个孙模块`
                              : `${childrenOf(c.id).length} grandchild modules`
                            : undefined
                        }
                      >
                        {c.icon} {localizedName(c, locale)}
                        {childrenOf(c.id).length > 0 ? ' ▸' : ''}
                      </button>
                    ))}
                  </div>
                )}
                {parallelsOf(sel.id).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[10px] text-amber-500/80">
                      {zh ? '并行模块：' : 'Parallel modules: '}
                    </span>
                    {parallelsOf(sel.id).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => selectMethod(p.id)}
                        className="rounded border border-amber-500/40 px-2 py-0.5 text-[10px] text-amber-200/90 hover:border-amber-400"
                      >
                        {p.icon} {localizedName(p, locale)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {zh ? '直接先修' : 'Direct prerequisites'}
            </h3>
            {directPrereqs.length === 0 ? (
              <p className="mb-4 text-xs text-slate-600">
                {zh
                  ? '无登记先修（根方法 / 独立透镜）'
                  : 'No registered prereqs (root / independent lens)'}
              </p>
            ) : (
              <ul className="mb-4 space-y-2">
                {directPrereqs.map((e) => {
                  const pre = METHODS.find((m) => m.id === e.prerequisiteId)
                  return (
                    <li key={e.prerequisiteId} className="text-xs text-slate-400">
                      <button
                        type="button"
                        className="text-wave hover:underline"
                        onClick={() => selectMethod(e.prerequisiteId)}
                      >
                        {pre?.icon} {pre ? localizedName(pre, locale) : methodLabel(e.prerequisiteId)}
                      </button>
                      <span
                        className="ml-2 rounded px-1 font-mono text-[9px]"
                        style={{
                          color: e.strength === 'hard' ? '#3ad6ff' : '#94a3b8',
                          border: '1px solid currentColor',
                        }}
                      >
                        {e.strength}
                      </span>
                      <span className="mt-0.5 block text-slate-500">
                        {pickLocaleString(e.reason, e.reasonEn, locale)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}

            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {zh ? '直接后继' : 'Direct dependents'}
            </h3>
            {directDeps.length === 0 ? (
              <p className="mb-4 text-xs text-slate-600">
                {zh ? '暂无登记后继' : 'No registered dependents'}
              </p>
            ) : (
              <ul className="mb-4 space-y-1">
                {directDeps.map((e) => {
                  const d = METHODS.find((m) => m.id === e.methodId)
                  return (
                    <li key={e.methodId} className="text-xs text-slate-400">
                      <button
                        type="button"
                        className="text-wave hover:underline"
                        onClick={() => selectMethod(e.methodId)}
                      >
                        {d?.icon} {d ? localizedName(d, locale) : methodLabel(e.methodId)}
                      </button>
                      <span className="ml-2 text-slate-600">({e.strength})</span>
                      <span className="mt-0.5 block text-slate-500">
                        {pickLocaleString(e.reason, e.reasonEn, locale)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}

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

            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {zh ? '方程与建模依据' : 'Equations and modelling basis'}
            </h3>
            <p className="mb-2 text-xs leading-relaxed text-slate-500">
              {zh ? '这里展示教学说明与学习先修关系，尚未经过形式化证明核验。' : 'These are teaching notes and learning prerequisites; they have not been checked as formal proof dependencies.'}
            </p>
            <ul className="mb-4 space-y-0.5 text-xs text-slate-400">
              {sel.foundations.map((f) => (
                <li key={f}>· {methodFoundation(f, locale)}</li>
              ))}
            </ul>

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

            <ModuleTryRun methodId={sel.id} />
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
                        {n?.icon} {energyDisplayName(id, locale)}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="card p-4 text-xs text-slate-500">
              <p className="mb-2 text-slate-400">
                {zh ? '对照读图' : 'Cross-read'}
              </p>
              <ul className="space-y-1">
                <li>
                  ·{' '}
                  <Link
                    to={`/world?m=${encodeURIComponent(sel.id)}`}
                    className="text-wave underline"
                  >
                    {zh ? '世界图' : 'World map'}
                  </Link>{' '}
                  {zh ? '一维时序' : '1D timeline'}
                </li>
                <li>
                  ·{' '}
                  <Link to="/methods" className="text-wave underline">
                    {zh ? '方法目录' : 'Method catalog'}
                  </Link>{' '}
                  {zh ? '卡片列表' : 'card list'}
                </li>
                <li>
                  · {zh ? 'Marble 交互示例：' : 'Marble UI example: '}
                  <a
                    href="https://withmarble.com/curriculum"
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1 text-wave/80 underline"
                  >
                    withmarble.com/curriculum
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

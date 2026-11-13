import { useMemo, useState } from 'react'
import { ConsensusBadge } from './ConsensusBadge'
import { NODES } from '../data/ontology/nodes'
import { EDGES } from '../data/ontology/edges'
import type { FrontierPhenomenon, Likelihood, MechanismHypothesis } from '../data/ontology/types'
import { energyDisplayName } from '../lib/energyAlias'
import { edgeDisplayName, edgePrinciple, pickLocaleString, useLocale } from '../lib/i18n'

// 三线态汇聚枢纽图（spec §4.1）：
//   实线 = 已确立边（光→三线态、三线态→ROS），颜色沿用节点 color；
//   多虚线 = hypotheses[] 每条一线，从「超声」指向三线态/ROS；
//     likelihood==='leading' 高亮（实色 + 粗 + 标记），其余暗显但全部在场；
//     hover/点击可逐条点亮切换，看清「争议在哪一步」。
// 复用暗色「光谱台」配色与节点 color；升级 Paths.tsx 的链式 chip 为带虚线的枢纽。

const nodeColor = (id?: string) => (id ? NODES.find((n) => n.id === id)?.color ?? '#475569' : '#475569')
const edgeById = new Map(EDGES.map((e) => [e.id, e]))

// 枢纽四个锚点（SVG 坐标），以「三线态枢纽」为视觉中心。
const W = 720
const H = 320
const SLOT = {
  acoustic: { x: 96, y: 250 },          // 超声（左下，争议虚线起点）
  light: { x: 96, y: 90 },              // 可见光（左上，已确立光动力治疗边起点）
  triplet: { x: 360, y: 150 },          // 三线态 T₁ 汇聚枢纽（中央）
  ros: { x: 600, y: 150 },              // 活性氧 ROS（右）
} as const

// 最可能者高亮，其余暗显但全部在场。
const LK_STYLE: Record<
  Likelihood,
  { stroke: string; label: string; labelEn: string; cls: string }
> = {
  leading: { stroke: '#3ad6ff', label: '主流', labelEn: 'Leading', cls: 'text-glow' },
  plausible: { stroke: '#94a3b8', label: '可能', labelEn: 'Plausible', cls: 'text-slate-300' },
  minority: { stroke: '#64748b', label: '少数', labelEn: 'Minority', cls: 'text-slate-500' },
}

/** 假说虚线终点：若该假说路径触及 ROS 则连到 ROS，否则连到三线态枢纽。 */
function hypoTarget(h: MechanismHypothesis): keyof typeof SLOT {
  const touchesRos = (h.steps ?? []).some((s) => s.nodeId === 'chemical-ros')
  return touchesRos ? 'ros' : 'triplet'
}

function NodeChip({
  slot,
  id,
  label,
  symbol,
}: {
  slot: keyof typeof SLOT
  id?: string
  label?: string
  symbol?: string
}) {
  const p = SLOT[slot]
  const color = nodeColor(id)
  const name = label ?? (id ? energyDisplayName(id, 'zh') : '')
  return (
    <g transform={`translate(${p.x}, ${p.y})`}>
      <rect x={-64} y={-22} width={128} height={44} rx={10}
        fill="#0e1322" stroke={color} strokeWidth={1.4} opacity={0.95} />
      <text x={0} y={-2} textAnchor="middle" fill="#e2e8f0" fontSize={13} fontWeight={600}>{name}</text>
      {symbol && <text x={0} y={14} textAnchor="middle" fill={color} fontSize={11} fontFamily="monospace">{symbol}</text>}
    </g>
  )
}

export function PhenomenonHub({ p }: { p: FrontierPhenomenon }) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  // active=null 时全部在场（leading 高亮）；选中某条则只点亮它。
  const [active, setActive] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  const lit = (id: string) => active === id || hover === id
  const anyFocus = active != null || hover != null

  // 已确立实线（光→三线态、三线态→ROS）：读 EDGES 取真实边名/共识。
  const solid = useMemo(() => {
    const links: { from: keyof typeof SLOT; to: keyof typeof SLOT; edgeId: string }[] = [
      { from: 'light', to: 'triplet', edgeId: 'em-to-chemical-photosensitization' },
      { from: 'triplet', to: 'ros', edgeId: 'chemical-triplet-to-ros' },
    ]
    return links.filter((l) => edgeById.has(l.edgeId))
  }, [])

  return (
    <div className="card overflow-hidden p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className="font-semibold text-slate-300">
          {zh ? '三线态汇聚枢纽' : 'Triplet convergence hub'}
        </span>
        <span className="text-slate-500">
          {zh
            ? '实线=已确立边 · 虚线=机理假说（高亮=主流，暗显=全部在场）'
            : 'Solid=established · dashed=hypotheses (highlight=leading, dim=all present)'}
        </span>
        {anyFocus && (
          <button onClick={() => { setActive(null); setHover(null) }}
            className="ml-auto rounded border border-edge px-2 py-0.5 text-slate-400 hover:text-slate-200">
            {zh ? '显示全部' : 'Show all'}
          </button>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img"
        aria-label={zh
          ? '三线态汇聚枢纽图：实线为已确立边，虚线为竞争机理假说'
          : 'Triplet hub: solid established edges, dashed competing hypotheses'}>
        <defs>
          {/* 实线箭头 */}
          <marker id="hub-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#64748b" />
          </marker>
          {/* 高亮虚线箭头 */}
          <marker id="hub-arrow-lead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#3ad6ff" />
          </marker>
        </defs>

        {/* 已确立实线 */}
        {solid.map((l) => {
          const a = SLOT[l.from], b = SLOT[l.to]
          const c = nodeColor(l.to)
          return (
            <line key={l.edgeId} x1={a.x + 64} y1={a.y} x2={b.x - 64} y2={b.y}
              stroke={c} strokeWidth={2.4} markerEnd="url(#hub-arrow)" opacity={anyFocus ? 0.4 : 0.95} />
          )
        })}

        {/* 假说虚线：每条一线，leading 高亮。曲线避免互相重叠（按索引上下弯）。 */}
        {p.hypotheses.map((h, i) => {
          const tgt = hypoTarget(h)
          const a = SLOT.acoustic, b = SLOT[tgt]
          const isLead = h.likelihood === 'leading'
          // 控制点：依索引在 y 方向错开，形成多条不重叠的弧。
          const spread = (i - (p.hypotheses.length - 1) / 2) * 46
          const mx = (a.x + b.x) / 2
          const my = (a.y + b.y) / 2 + spread
          const st = LK_STYLE[h.likelihood]
          const dimmed = anyFocus && !lit(h.id)
          const emphasized = lit(h.id) || (!anyFocus && isLead)
          return (
            <path key={h.id}
              d={`M ${a.x + 64} ${a.y} Q ${mx} ${my} ${b.x - 64} ${b.y}`}
              fill="none"
              stroke={emphasized ? '#3ad6ff' : st.stroke}
              strokeWidth={emphasized ? 2.6 : 1.4}
              strokeDasharray={emphasized ? '8 4' : '4 5'}
              opacity={dimmed ? 0.15 : emphasized ? 0.95 : 0.55}
              markerEnd={emphasized ? 'url(#hub-arrow-lead)' : 'url(#hub-arrow)'}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHover(h.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setActive((v) => (v === h.id ? null : h.id))} />
          )
        })}

        {/* 节点 chip（画在连线之上） */}
        <NodeChip
          slot="light"
          id="em-visible"
          label={zh ? '可见光' : energyDisplayName('em-visible', locale)}
          symbol={zh ? 'hν（光动力治疗）' : 'hν (PDT)'}
        />
        <NodeChip
          slot="acoustic"
          id="acoustic"
          label={zh ? '超声' : energyDisplayName('acoustic', locale)}
          symbol="US (SDT)"
        />
        <NodeChip
          slot="triplet"
          id="chemical-excited-triplet"
          label={energyDisplayName('chemical-excited-triplet', locale)}
          symbol={zh ? 'T₁ 枢纽' : 'T₁ hub'}
        />
        <NodeChip
          slot="ros"
          id="chemical-ros"
          label={energyDisplayName('chemical-ros', locale)}
          symbol="ROS"
        />
      </svg>

      {/* 假说图例 / 切换器：点击点亮对应虚线 */}
      <div className="mt-3 flex flex-wrap gap-2">
        {p.hypotheses.map((h) => {
          const st = LK_STYLE[h.likelihood]
          const sel = active === h.id
          return (
            <button key={h.id}
              onMouseEnter={() => setHover(h.id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => setActive((v) => (v === h.id ? null : h.id))}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition ${
                sel ? 'border-glow bg-glow/10' : 'border-edge hover:border-slate-500'
              }`}>
              <span className="inline-block h-2 w-5 rounded"
                style={{ background: h.likelihood === 'leading' ? '#3ad6ff' : st.stroke, opacity: h.likelihood === 'leading' ? 1 : 0.7 }} />
              <span className={st.cls}>{pickLocaleString(h.name, h.nameEn, locale)}</span>
              {h.likelihood === 'leading' && (
                <span className="rounded bg-glow/15 px-1 text-[10px] text-glow">
                  {pickLocaleString(st.label, st.labelEn, locale)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** 单条假说详情卡：summary + ConsensusBadge + 复用边链接（spec §4.1）。 */
export function HypothesisCard({ h }: { h: MechanismHypothesis }) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const st = LK_STYLE[h.likelihood]
  return (
    <div className="card p-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: h.likelihood === 'leading' ? '#3ad6ff' : st.stroke }} />
        <h4 className="font-semibold text-white">{pickLocaleString(h.name, h.nameEn, locale)}</h4>
        <span className={`rounded px-1.5 py-0.5 text-[10px] ${
          h.likelihood === 'leading' ? 'bg-glow/15 text-glow' : 'bg-edge/60 text-slate-400'
        }`}>{pickLocaleString(st.label, st.labelEn, locale)}</span>
        <ConsensusBadge c={h.consensus} />
      </div>
      <p className="text-sm leading-relaxed text-slate-300">
        {pickLocaleString(h.summary, h.summaryEn, locale)}
      </p>

      {h.consensus.summary && (
        <p className="mt-2 text-xs text-slate-500">
          ⚖ {pickLocaleString(h.consensus.summary, h.consensus.summaryEn, locale)}
        </p>
      )}

      {/* 复用的已确立边链接（reuseEdgeIds） */}
      {h.reuseEdgeIds && h.reuseEdgeIds.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-500">
            {zh ? '复用已确立边' : 'Reuses established edges'}
          </span>
          {h.reuseEdgeIds.map((id) => {
            const e = edgeById.get(id)
            return (
              <span key={id} className="rounded border border-edge px-2 py-0.5 text-[11px] text-slate-300"
                title={e ? edgePrinciple(e, locale) : id}>
                {e ? edgeDisplayName(e, locale) : id}
              </span>
            )
          })}
        </div>
      )}

      {/* 立场（proponents） */}
      {h.consensus.viewpoints?.map((v, i) => (
        <div key={i} className="mt-2 border-l-2 border-edge pl-2 text-xs text-slate-400">
          {pickLocaleString(v.stance, v.stanceEn, locale)}
          {v.proponents && v.proponents.length > 0 && (
            <span className="ml-1 text-slate-600">— {v.proponents.join(zh ? '、' : ', ')}</span>
          )}
        </div>
      ))}
    </div>
  )
}

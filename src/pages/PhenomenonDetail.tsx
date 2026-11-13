import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { ConsensusBadge } from '../components/ConsensusBadge'
import { PhenomenonHub, HypothesisCard } from '../components/PhenomenonHub'
import { PhotosensitizationSim } from '../components/PhotosensitizationSim'
import { safeHttpUrl } from '../lib/safeUrl'
import { PHENOMENA } from '../data/ontology/phenomena'
import { NODES } from '../data/ontology/nodes'
import { EDGES } from '../data/ontology/edges'
import type { FrontierPhenomenon, PhenomenonStep, ResearchInstance } from '../data/ontology/types'
import { termIdsForSimPath } from '../lib/termGlossary'
import { energyDisplayName } from '../lib/energyAlias'
import { edgeDisplayName, edgePrinciple, pickLocaleString, useLocale } from '../lib/i18n'

// 现象详情页（通用，路由 phenomena/:id，spec §4.1 + §5.2 合页）：
//   PageHeader + 主干链 + PhenomenonHub（多虚线枢纽）+ [量化样板间] + 假说卡 + 真实档案（三类分组）+ refs。
// 量化样板间：按 sampleId 解析到对应仿真面板（SAMPLE_PANELS 注册表）——
//   现象不带 sampleId 或未注册 → 不渲染仿真（详情页对其它现象仍通用）。
//   spec §5.2「合页」即此页：SDT（sampleId='photosensitization'）在枢纽图后嵌入三线态→ROS 仿真。
// 显式覆盖：调用方可传 simPanel 覆盖默认面板（如 <PhenomenonDetail simPanel={<自定义/>} />）。

const byId = new Map(NODES.map((n) => [n.id, n]))
const edgeById = new Map(EDGES.map((e) => [e.id, e]))

// sampleId → 量化仿真面板（详情页据此把现象与样板间关联，无需为每个现象单独建页/路由）。
const SAMPLE_PANELS: Record<string, () => ReactNode> = {
  photosensitization: () => <PhotosensitizationSim />,
}

const KIND_META: Record<
  ResearchInstance['kind'],
  { label: string; labelEn: string; icon: string; cls: string }
> = {
  science: { label: '科研', labelEn: 'Science', icon: '🧪', cls: 'text-glow' },
  engineering: { label: '工程', labelEn: 'Engineering', icon: '⚙️', cls: 'text-ember' },
  clinical: { label: '临床', labelEn: 'Clinical', icon: '🏥', cls: 'text-emerald-300' },
}
const KIND_ORDER: ResearchInstance['kind'][] = ['science', 'engineering', 'clinical']

export function PhenomenonDetail({
  id: idProp,
  simPanel,
}: {
  /** 可显式指定现象 id；缺省读路由 :id。 */
  id?: string
  /** 仿真面板覆盖：默认按 sampleId 自动解析；传入则覆盖。仅当现象带 sampleId 时渲染。 */
  simPanel?: ReactNode
} = {}) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const params = useParams()
  const id = idProp ?? params.id
  const p = PHENOMENA.find((x) => x.id === id)
  const pageTerms = useMemo(() => termIdsForSimPath('phenomena'), [])
  if (!p) return <Navigate to="/phenomena" replace />

  // 量化样板间：显式 simPanel 优先，否则按 sampleId 查注册表（无 sampleId/未注册 → 不渲染仿真）。
  const panel = simPanel ?? (p.sampleId ? SAMPLE_PANELS[p.sampleId]?.() : undefined)

  return (
    <div>
      <PageHeader
        kicker={
          zh
            ? `🔬 前沿现象${p.domain ? ` · ${p.domain}` : ''}`
            : `🔬 Frontier phenomenon${p.domainEn || p.domain ? ` · ${pickLocaleString(p.domain ?? '', p.domainEn, locale)}` : ''}`
        }
        icon={p.icon}
        title={p.name}
        titleEn={p.nameEn}
        subtitle={p.summary}
        subtitleEn={p.summaryEn}
      />

      <p className="mb-4 flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">{zh ? '读通路时' : 'When reading pathways'}</span>
        {pageTerms.map((tid) => (
          <TermChip key={tid} id={tid} mode="compact" />
        ))}
        <span className="text-slate-600">
          {zh ? '（悬停看一句人话）' : '(hover for plain language)'}
        </span>
      </p>

      {/* 现象整体共识 */}
      <div className="mb-5 flex flex-wrap items-center justify-center gap-2 text-sm">
        <ConsensusBadge c={p.consensus} />
        {p.consensus.summary && (
          <span className="text-slate-500">
            {pickLocaleString(p.consensus.summary, p.consensus.summaryEn, locale)}
          </span>
        )}
      </div>

      {/* 主干链（汇聚枢纽视角的步骤序列） */}
      <MainChain steps={p.steps} />

      {/* 三线态汇聚枢纽图（多虚线 + 高亮 leading） */}
      <div className="mt-6">
        <PhenomenonHub p={p} />
      </div>

      {/* 量化样板间（仅带 sampleId 且已注册/显式传入的现象）：枢纽图后、机理假说前 */}
      {p.sampleId && panel && (
        <div className="mt-6">{panel}</div>
      )}

      {/* 机理多假说 */}
      <section className="mt-8">
        <SectionTitle>
          {zh
            ? '机理多假说（争议留现象层，不入效率图）'
            : 'Mechanism hypotheses (disputes stay at phenomenon layer, not efficiency graph)'}
        </SectionTitle>
        <div className="grid gap-3 lg:grid-cols-2">
          {p.hypotheses.map((h) => <HypothesisCard key={h.id} h={h} />)}
        </div>
      </section>

      {/* 真实应用档案（按 kind 分组） */}
      <section className="mt-8">
        <SectionTitle>
          {zh ? '真实工程 / 科研 / 临床档案' : 'Real engineering / science / clinical dossiers'}
        </SectionTitle>
        <div className="space-y-5">
          {KIND_ORDER.map((kind) => {
            const items = p.applications.filter((a) => a.kind === kind)
            if (items.length === 0) return null
            const meta = KIND_META[kind]
            return (
              <div key={kind}>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <span aria-hidden="true">{meta.icon}</span>
                  <span className={meta.cls}>
                    {pickLocaleString(meta.label, meta.labelEn, locale)}
                  </span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {items.map((a, i) => <InstanceCard key={i} a={a} />)}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 来源 */}
      {p.refs && p.refs.length > 0 && (
        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-edge pt-3 text-xs">
          <span className="text-slate-500">{zh ? '来源' : 'Sources'}</span>
          {p.refs.map((r, i) => {
            const href = safeHttpUrl(r)
            return href ? (
              <a key={i} href={href} target="_blank" rel="noreferrer" className="text-wave/70 underline">
                {zh ? `参考${i + 1}` : `Ref ${i + 1}`}
              </a>
            ) : null
          })}
        </div>
      )}

      <p className="note">
        {zh ? (
          <>
            数据整理（非研究）：四假说与真实档案按已知常识性内容整理填入；机理争议留现象层，
            争议的「声→三线态」连线<span className="text-slate-400">不进效率图 EDGES</span>
            ，保住路径枚举与蒙特卡洛干净。
          </>
        ) : (
          <>
            Curation note (not original research): hypotheses and dossiers are filled from established
            common knowledge; mechanism disputes stay at the phenomenon layer. Contested
            “acoustic→triplet” links{' '}
            <span className="text-slate-400">do not enter the efficiency graph EDGES</span>, keeping
            path enumeration and Monte Carlo clean.
          </>
        )}
      </p>
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
      <span className="h-3 w-1 rounded bg-wave" aria-hidden="true" />
      {children}
    </h3>
  )
}

/** 主干链：把 steps 渲染成 chip → chip 的链（含枢纽 label 与已确立边名）。 */
function MainChain({ steps }: { steps: FrontierPhenomenon['steps'] }) {
  const { locale } = useLocale()
  return (
    <div className="card p-4">
      <div className="mb-2 text-xs text-slate-500">
        {locale === 'zh' ? '汇聚枢纽视角主干' : 'Convergence-hub main chain'}
      </div>
      <ol className="flex flex-wrap items-center gap-1.5">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-slate-600">→</span>}
            <StepChip s={s} />
          </li>
        ))}
      </ol>
      <ul className="mt-3 space-y-0.5">
        {steps.map((s, i) => s.via && (
          <li key={i} className="text-xs text-slate-500">
            <span className="text-slate-400">{stepTitle(s, locale)}</span>
            {locale === 'zh' ? '：' : ': '}
            {pickLocaleString(s.via, s.viaEn, locale)}
          </li>
        ))}
      </ul>
    </div>
  )
}

function stepTitle(s: PhenomenonStep, locale: 'zh' | 'en' = 'zh'): string {
  if (s.nodeId) return energyDisplayName(s.nodeId, locale)
  if (s.edgeId) {
    const e = edgeById.get(s.edgeId)
    return e ? edgeDisplayName(e, locale) : s.edgeId
  }
  return s.label ?? '—'
}

function StepChip({ s }: { s: PhenomenonStep }) {
  const { locale } = useLocale()
  // 节点步：彩边 chip；边步：细标签（已确立边）；纯 label：枢纽/效应标记。
  if (s.nodeId) {
    const n = byId.get(s.nodeId)
    return (
      <span className="rounded-lg border px-2.5 py-1 text-sm text-slate-200"
        style={{ borderColor: n?.color ?? '#334155' }}>
        {n?.icon} {energyDisplayName(s.nodeId, locale)}{n?.symbol ? ` ${n.symbol}` : ''}
      </span>
    )
  }
  if (s.edgeId) {
    const e = edgeById.get(s.edgeId)
    return (
      <span
        className="rounded border border-edge bg-edge/30 px-2 py-1 text-xs text-slate-400"
        title={e ? edgePrinciple(e, locale) : ''}
      >
        ⟶ {e ? edgeDisplayName(e, locale) : s.edgeId}
      </span>
    )
  }
  return (
    <span className="rounded-lg border border-dashed border-slate-600 px-2.5 py-1 text-sm text-slate-300">
      {pickLocaleString(s.label ?? '—', s.labelEn, locale)}
    </span>
  )
}

function InstanceCard({ a }: { a: ResearchInstance }) {
  const { locale } = useLocale()
  const keys =
    locale === 'en' && a.keyEn && a.keyEn.length === (a.key?.length ?? 0) ? a.keyEn : a.key
  return (
    <div className="rounded-xl border border-edge bg-panel/50 p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h4 className="font-semibold text-white">{pickLocaleString(a.title, a.titleEn, locale)}</h4>
        {a.maturity && (
          <span className="rounded bg-edge/60 px-2 py-0.5 text-[11px] text-slate-400">
            {pickLocaleString(a.maturity, a.maturityEn, locale)}
          </span>
        )}
        {a.org && (
          <span className="text-[11px] text-slate-500">
            {a.org}
            {a.year ? ` · ${a.year}` : ''}
          </span>
        )}
      </div>
      <p className="text-sm leading-relaxed text-slate-300">
        {pickLocaleString(a.detail, a.detailEn, locale)}
      </p>
      {keys && keys.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {keys.map((k) => (
            <span key={k} className="rounded-full bg-edge/60 px-2 py-0.5 text-[11px] text-slate-400">
              {k}
            </span>
          ))}
        </div>
      )}
      {(() => {
        const href = safeHttpUrl(a.ref)
        return href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-[11px] text-wave/70 underline"
          >
            {locale === 'zh' ? '来源' : 'Source'}
          </a>
        ) : null
      })()}
    </div>
  )
}

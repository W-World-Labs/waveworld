import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { ConsensusBadge } from '../components/ConsensusBadge'
import { PHENOMENA } from '../data/ontology/phenomena'
import { termIdsForSimPath } from '../lib/termGlossary'
import { pickLocaleString, useLocale } from '../lib/i18n'

// 前沿现象索引页（spec §4.2）：列出 PHENOMENA（SDT 首张卡），点进 §4.1 详情。
export function Phenomena() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const pageTerms = useMemo(() => termIdsForSimPath('phenomena'), [])

  return (
    <div>
      <PageHeader
        icon="🔬"
        title="前沿现象 / 通路"
        subtitle="被策展的多跳前沿换能通路——不是单条边，而是跨多个节点的科学故事。每个现象并呈多条竞争机理假说（虚线汇聚枢纽），并附真实工程/科研/临床档案。声动力治疗是首例。"
      />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">{zh ? '读通路时' : 'When reading pathways'}</span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <span className="text-slate-600">
          {zh ? '（悬停看一句人话；与矩阵同词典）' : '(hover for plain language; same glossary as matrix)'}
        </span>
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {PHENOMENA.map((p) => (
          <Link
            key={p.id}
            to={`/phenomena/${p.id}`}
            className="card group flex flex-col p-5 transition hover:border-slate-500"
          >
            <div className="mb-2 flex items-center gap-3">
              <span
                className="grid h-11 w-11 place-items-center rounded-xl bg-edge/50 text-2xl"
                aria-hidden="true"
              >
                {p.icon}
              </span>
              <div className="min-w-0">
                <h3 className="truncate font-semibold text-white group-hover:text-glow">
                  {pickLocaleString(p.name, p.nameEn, locale)}
                </h3>
                <div className="mt-0.5 flex items-center gap-2">
                  {p.domain && (
                    <span className="rounded bg-edge/60 px-2 py-0.5 text-[11px] text-slate-400">
                      {pickLocaleString(p.domain, p.domainEn, locale)}
                    </span>
                  )}
                  <ConsensusBadge c={p.consensus} />
                </div>
              </div>
            </div>

            <p className="line-clamp-4 text-sm leading-relaxed text-slate-400">
              {pickLocaleString(p.summary, p.summaryEn, locale)}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span>
                {zh
                  ? `${p.hypotheses.length} 条竞争假说`
                  : `${p.hypotheses.length} competing hypotheses`}
              </span>
              <span className="text-slate-700">·</span>
              <span>
                {zh
                  ? `${p.applications.length} 类真实档案`
                  : `${p.applications.length} real dossiers`}
              </span>
              {p.sampleId && (
                <>
                  <span className="text-slate-700">·</span>
                  <span className="rounded bg-wave/15 px-1.5 py-0.5 text-wave">
                    {zh ? '含量化样板间' : 'with quant sample lab'}
                  </span>
                </>
              )}
              <span className="ml-auto text-glow opacity-0 transition group-hover:opacity-100">
                {zh ? '进入 →' : 'Open →'}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

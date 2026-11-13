import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import { TRANSDUCERS } from '../data/transducers'
import { energyDisplayName } from '../lib/energyAlias'
import { EfficiencyRange } from '../components/EfficiencyRange'
import { termIdsForSimPath } from '../lib/termGlossary'
import { pickLocaleString, useLocale } from '../lib/i18n'

export function Transducers() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const nodeName = (id: string) => energyDisplayName(id, locale)
  const pageTerms = useMemo(() => termIdsForSimPath('transducers'), [])

  return (
    <div>
      <PageHeader
        icon="⚡"
        title="能量换能器百科"
        subtitle="换能器是把一种能量形式转换为另一种的器件。可挂接本体节点；页眉方法叙事说明卡片、效率与图谱如何对应——未入本体的出口（如信息/智能）见争议页。"
      />

      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">
          {zh ? '读换能器效率时' : 'When reading transducer efficiency'}
        </span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <span className="text-slate-600">
          {zh
            ? '（悬停看一句人话；与矩阵/工程目录同词典）'
            : '(hover for plain language; same glossary as matrix / engineering catalog)'}
        </span>
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TRANSDUCERS.map((t) => {
          const title = pickLocaleString(t.name, t.nameEn, locale)
          const fromLabel = t.fromNodeId
            ? nodeName(t.fromNodeId)
            : pickLocaleString(t.from, t.fromEn, locale)
          const toLabel = t.toNodeId
            ? nodeName(t.toNodeId)
            : pickLocaleString(t.to, t.toEn, locale)
          const principle = pickLocaleString(t.principle, t.principleEn, locale)
          const apps =
            locale === 'en' && t.appsEn && t.appsEn.length === t.apps.length ? t.appsEn : t.apps
          const efficiencyText =
            locale === 'en' && t.efficiency.includes('能量→令牌')
              ? 'See energy→token chain'
              : t.efficiency

          return (
            <div key={t.name} className="card p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-2xl">{t.icon}</span>
                <h3 className="font-semibold text-white">{title}</h3>
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded bg-wave/20 px-2 py-0.5 text-wave">{fromLabel}</span>
                <span className="text-slate-500">→</span>
                <span className="rounded bg-glow/20 px-2 py-0.5 text-glow">{toLabel}</span>
              </div>
              {(t.fromNodeId || t.toNodeId) && (
                <div className="mb-3 flex flex-wrap gap-1.5 text-[10px] text-slate-500">
                  <span>{zh ? '本体：' : 'Ontology: '}</span>
                  {t.fromNodeId && (
                    <Link
                      to="/graph"
                      className="rounded border border-edge px-1.5 py-0.5 text-wave/80 hover:border-wave"
                    >
                      {nodeName(t.fromNodeId)}
                    </Link>
                  )}
                  {t.fromNodeId && t.toNodeId && <span>→</span>}
                  {t.toNodeId && (
                    <Link
                      to="/graph"
                      className="rounded border border-edge px-1.5 py-0.5 text-wave/80 hover:border-wave"
                    >
                      {nodeName(t.toNodeId)}
                    </Link>
                  )}
                  {t.fromNodeId && !t.toNodeId && (
                    <span className="text-amber-500/80">
                      {zh
                        ? '→（目标未入本体 · 见争议）'
                        : '→ (target not in ontology · see controversies)'}
                    </span>
                  )}
                </div>
              )}
              <p className="mb-3 text-sm text-slate-300">{principle}</p>
              <EfficiencyRange mode="text" text={efficiencyText} className="mb-3" />
              <div className="flex flex-wrap gap-1.5">
                {apps.map((a) => (
                  <span key={a} className="rounded-full bg-edge/60 px-2 py-0.5 text-xs text-slate-300">
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

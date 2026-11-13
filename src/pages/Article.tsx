import { useMemo } from 'react'
import { PageHeader } from '../components/PageHeader'
import { TermChip } from '../components/TermChip'
import {
  ARTICLE,
  ARTICLE_LEAD,
  ARTICLE_LEAD_EN,
  ARTICLE_TITLE,
  ARTICLE_TITLE_EN,
} from '../data/article'
import { pickLocaleString, useLocale } from '../lib/i18n'
import { termIdsForSimPath } from '../lib/termGlossary'

export function Article() {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const pageTerms = useMemo(() => termIdsForSimPath('article'), [])

  return (
    <div>
      <PageHeader
        icon="📖"
        title={ARTICLE_TITLE}
        titleEn={ARTICLE_TITLE_EN}
        subtitle={ARTICLE_LEAD}
        subtitleEn={ARTICLE_LEAD_EN}
      />
      <p className="mb-6 flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-slate-500">
        <span className="text-slate-400">{zh ? '读文时' : 'When reading'}</span>
        {pageTerms.map((id) => (
          <TermChip key={id} id={id} mode="compact" />
        ))}
        <span className="text-slate-600">
          {zh ? '（悬停看一句人话；与矩阵同词典）' : '(hover for plain language; same glossary as matrix)'}
        </span>
      </p>
      <article className="card mx-auto max-w-3xl space-y-8 p-6 sm:p-10">
        {ARTICLE.map((s) => {
          const heading = pickLocaleString(s.heading, s.headingEn, locale)
          const paras =
            locale === 'en' && s.paragraphsEn?.length === s.paragraphs.length
              ? s.paragraphsEn
              : s.paragraphs
          return (
            <section key={s.heading}>
              <h2 className="mb-3 text-xl font-semibold text-white">{heading}</h2>
              {paras.map((p, i) => (
                <p key={i} className="mb-3 leading-relaxed text-slate-300">
                  {p}
                </p>
              ))}
            </section>
          )
        })}
      </article>
    </div>
  )
}

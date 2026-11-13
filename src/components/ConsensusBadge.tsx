import type { Consensus } from '../data/ontology/types'
import { pickLocaleString, useLocale } from '../lib/i18n'

const STYLE: Record<
  Consensus['status'],
  { label: string; labelEn: string; cls: string }
> = {
  established: {
    label: '公认',
    labelEn: 'Established',
    cls: 'bg-emerald-500/15 text-emerald-300',
  },
  convention: {
    label: '约定',
    labelEn: 'Convention',
    cls: 'bg-sky-500/15 text-sky-300',
  },
  contested: {
    label: '有争议',
    labelEn: 'Contested',
    cls: 'bg-amber-500/15 text-amber-300',
  },
  open: {
    label: '未解',
    labelEn: 'Open',
    cls: 'bg-fuchsia-500/15 text-fuchsia-300',
  },
}

export function ConsensusBadge({ c }: { c: Consensus }) {
  const { locale } = useLocale()
  const s = STYLE[c.status]
  const label = pickLocaleString(s.label, s.labelEn, locale)
  const pending =
    c.confidence === 'medium'
      ? locale === 'en'
        ? '·review'
        : '·待核查'
      : ''
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}
      title={c.summary ?? ''}
    >
      {label}
      {pending}
    </span>
  )
}

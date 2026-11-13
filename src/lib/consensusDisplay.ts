import type { Consensus, Viewpoint } from '../data/ontology/types'
import type { Locale } from './i18n/types'
import { pickLocaleString } from './i18n/display'

/** Locale-aware consensus summary line. */
export function consensusSummary(
  c: Pick<Consensus, 'summary' | 'summaryEn'>,
  locale: Locale = 'zh',
): string | undefined {
  if (!c.summary) return undefined
  return pickLocaleString(c.summary, c.summaryEn, locale)
}

/** Locale-aware viewpoint stance. */
export function viewpointStance(
  v: Pick<Viewpoint, 'stance' | 'stanceEn'>,
  locale: Locale = 'zh',
): string {
  return pickLocaleString(v.stance, v.stanceEn, locale)
}

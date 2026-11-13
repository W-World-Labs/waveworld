import type { LossMechanism } from '../data/ontology/types'
import { LOSS_NAME_EN } from '../data/ontology/loss.nameEn'
import { LOSS_DESC_EN } from '../data/ontology/loss.descEn'
import type { Locale } from './i18n/types'

/**
 * Locale-aware loss-mechanism display name.
 * zh → Chinese `name`; en → LOSS_NAME_EN overlay (source Chinese untouched).
 */
export function lossDisplayName(
  loss: Pick<LossMechanism, 'name'>,
  locale: Locale = 'zh',
): string {
  if (locale !== 'en') return loss.name
  return LOSS_NAME_EN[loss.name]?.trim() || loss.name
}

/**
 * Locale-aware loss-mechanism description.
 * zh → Chinese `desc`; en → LOSS_DESC_EN by name key, else Chinese fallback.
 */
export function lossDisplayDesc(
  loss: Pick<LossMechanism, 'name' | 'desc'>,
  locale: Locale = 'zh',
): string {
  if (locale !== 'en') return loss.desc
  return LOSS_DESC_EN[loss.name]?.trim() || loss.desc
}

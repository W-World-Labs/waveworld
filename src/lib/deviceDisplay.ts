import { DEVICE_NAME_EN } from '../data/ontology/device.nameEn'
import { APP_NAME_EN } from '../data/ontology/app.nameEn'
import type { Locale } from './i18n/types'

/** Locale-aware edge.device[] label. Chinese source untouched. */
export function deviceDisplayName(name: string, locale: Locale = 'zh'): string {
  if (locale !== 'en') return name
  return DEVICE_NAME_EN[name]?.trim() || name
}

/** Locale-aware edge.apps[] tag. Chinese source untouched. */
export function appDisplayName(name: string, locale: Locale = 'zh'): string {
  if (locale !== 'en') return name
  return APP_NAME_EN[name]?.trim() || name
}

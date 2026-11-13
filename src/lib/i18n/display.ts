import type { Locale } from './types'

/** Entity with bilingual name fields (apps, methods, levels, …). */
export type NamedEntity = {
  name: string
  nameEn?: string
}

/**
 * Pick zh primary or en secondary string without overwriting either source.
 * Used by nav (label/labelEn) and free-form shell pairs.
 */
export function pickLocaleString(zh: string, en: string | undefined, locale: Locale): string {
  if (locale === 'en') {
    const t = en?.trim()
    if (t) return t
  }
  return zh
}

/**
 * Primary display name for the active locale.
 * - zh → `name` (Chinese-first primary)
 * - en → `nameEn` when present, else `name`
 *
 * Machine ids are never used here.
 */
export function localizedName(entity: NamedEntity, locale: Locale): string {
  return pickLocaleString(entity.name, entity.nameEn, locale)
}

/**
 * Secondary line: the other language when both exist and differ.
 * UI can show mono subtitle under the primary title.
 */
export function secondaryName(entity: NamedEntity, locale: Locale): string | undefined {
  const en = entity.nameEn?.trim()
  if (!en) return undefined
  if (locale === 'en') {
    return entity.name !== en ? entity.name : undefined
  }
  return en
}

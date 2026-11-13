import { QUANTITY_NOTE_EN } from '../data/ontology/quantity.noteEn'
import type { Locale } from './i18n/types'

/**
 * Locale-aware energy-node quantity note.
 * zh → Chinese note; en → QUANTITY_NOTE_EN overlay (source untouched).
 */
export function quantityNote(
  note: string | undefined,
  locale: Locale = 'zh',
): string | undefined {
  if (!note) return undefined
  if (locale !== 'en') return note
  return QUANTITY_NOTE_EN[note]?.trim() || note
}

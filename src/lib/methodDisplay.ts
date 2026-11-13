import { METHOD_FOUNDATION_EN } from '../data/methods/methods.foundationsEn'
import {
  METHOD_SCHOOL_NOTE_EN,
  METHOD_SCHOOL_STANCE_EN,
} from '../data/methods/methods.schoolsEn'
import type { MethodSchool } from '../data/methods/types'
import type { Locale } from './i18n/types'
import { pickLocaleString } from './i18n/display'

/** Locale-aware method foundation line (Chinese source untouched). */
export function methodFoundation(text: string, locale: Locale = 'zh'): string {
  if (locale !== 'en') return text
  return METHOD_FOUNDATION_EN[text]?.trim() || text
}

/** Locale-aware method school stance. */
export function methodSchoolStance(
  school: Pick<MethodSchool, 'stance' | 'stanceEn'>,
  locale: Locale = 'zh',
): string {
  if (locale !== 'en') return school.stance
  const curated =
    school.stanceEn?.trim() || METHOD_SCHOOL_STANCE_EN[school.stance]?.trim()
  return curated || school.stance
}

/** Locale-aware school note if present. */
export function methodSchoolNote(
  school: Pick<MethodSchool, 'note' | 'noteEn'>,
  locale: Locale = 'zh',
): string | undefined {
  if (!school.note) return undefined
  const noteEn = school.noteEn?.trim() || METHOD_SCHOOL_NOTE_EN[school.note]?.trim()
  return pickLocaleString(school.note, noteEn, locale)
}

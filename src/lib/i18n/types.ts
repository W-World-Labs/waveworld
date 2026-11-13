/** Supported UI locales. Default is Chinese-first. */
export type Locale = 'zh' | 'en'

export const LOCALES: readonly Locale[] = ['zh', 'en'] as const

export const DEFAULT_LOCALE: Locale = 'zh'

export const LOCALE_STORAGE_KEY = 'waveworld-locale'

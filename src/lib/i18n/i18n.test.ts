import { describe, expect, it } from 'vitest'
import { localizedName, pickLocaleString, secondaryName } from './display'
import { shellMessage } from './messages'
import { DEFAULT_LOCALE, LOCALES } from './types'
import { ALL_LEAVES, DOMAINS } from '../../nav'
import { PAGE_HEADERS, pageHeaderForRoute } from './pageHeaders'
import { KIND_LABEL, KIND_LABEL_EN, KIND_ORDER } from '../../data/methods/kindMeta'
import { METHOD_SUMMARIES_EN } from '../../data/methods/methods.summariesEn'
import { METHODS } from '../../data/methods/methods'
import { APPLICATIONS } from '../../data/applications/applications'
import { APPLICATION_LEVEL_SUMMARIES_EN } from '../../data/applications/applications.levelSummariesEn'
import { CONTROL_HINTS_EN } from '../controlHints.en'
import { controlHintsForSim } from '../simMethodNarrative'

describe('i18n display', () => {
  const both = { name: '光伏发电', nameEn: 'Photovoltaic power' }
  const zhOnly = { name: '仅中文项' }

  it('localizedName prefers Chinese for zh', () => {
    expect(localizedName(both, 'zh')).toBe('光伏发电')
    expect(localizedName(zhOnly, 'zh')).toBe('仅中文项')
  })

  it('localizedName prefers nameEn for en when present', () => {
    expect(localizedName(both, 'en')).toBe('Photovoltaic power')
    expect(localizedName(zhOnly, 'en')).toBe('仅中文项')
  })

  it('secondaryName shows the other language when both differ', () => {
    expect(secondaryName(both, 'zh')).toBe('Photovoltaic power')
    expect(secondaryName(both, 'en')).toBe('光伏发电')
    expect(secondaryName(zhOnly, 'zh')).toBeUndefined()
    expect(secondaryName(zhOnly, 'en')).toBeUndefined()
  })

  it('pickLocaleString mirrors localizedName for free-form pairs', () => {
    expect(pickLocaleString('地图', 'Atlas', 'en')).toBe('Atlas')
    expect(pickLocaleString('地图', 'Atlas', 'zh')).toBe('地图')
    expect(pickLocaleString('地图', undefined, 'en')).toBe('地图')
  })

  it('shell messages exist for every locale key', () => {
    for (const loc of LOCALES) {
      expect(shellMessage(loc, 'brandTitle').length).toBeGreaterThan(1)
      expect(shellMessage(loc, 'footer').length).toBeGreaterThan(4)
      expect(shellMessage(loc, 'homeTitle').length).toBeGreaterThan(1)
    }
  })

  it('default locale is Chinese-first', () => {
    expect(DEFAULT_LOCALE).toBe('zh')
  })

  it('nav domains and leaves carry bilingual labels', () => {
    for (const d of DOMAINS) {
      expect(d.labelEn.trim().length).toBeGreaterThan(0)
      expect(d.blurbEn.trim().length).toBeGreaterThan(8)
      for (const f of d.facets) {
        expect(f.labelEn.trim().length).toBeGreaterThan(0)
        for (const it of f.items) {
          expect(it.labelEn.trim().length).toBeGreaterThan(0)
        }
      }
    }
    expect(ALL_LEAVES.every((l) => l.labelEn.trim().length > 0)).toBe(true)
  })

  it('page header registry covers sim leaves with English titles', () => {
    const simLeaves = ALL_LEAVES.filter((l) => l.domainKey === 'sim')
    const missing = simLeaves.filter((l) => !PAGE_HEADERS[l.path]?.titleEn)
    expect(missing.map((l) => l.path), `missing pageHeaders: ${missing.map((l) => l.path).join()}`).toHaveLength(0)
    expect(pageHeaderForRoute('fdtd')?.titleEn).toMatch(/FDTD|Maxwell/i)
    expect(pageHeaderForRoute('phenomena/sdt')?.titleEn).toBeTruthy()
  })

  it('spectrum routes have English subtitles in pageHeaders', () => {
    for (const path of ['sound', 'vibration', 'electromagnetic'] as const) {
      const h = pageHeaderForRoute(path)
      expect(h?.titleEn?.length).toBeGreaterThan(2)
      expect(h?.subtitleEn?.length).toBeGreaterThan(12)
    }
  })
})

describe('i18n method labels & summaries', () => {
  it('every MethodKind has bilingual kind labels', () => {
    for (const k of KIND_ORDER) {
      expect(KIND_LABEL[k].length).toBeGreaterThan(0)
      expect(KIND_LABEL_EN[k].length).toBeGreaterThan(0)
    }
  })

  it('methods with simPaths carry summaryEn after merge', () => {
    const withSim = METHODS.filter((m) => (m.simPaths?.length ?? 0) > 0)
    expect(withSim.length).toBeGreaterThan(50)
    const missing = withSim.filter((m) => !m.summaryEn?.trim())
    expect(
      missing.map((m) => m.id),
      `missing summaryEn: ${missing.map((m) => m.id).slice(0, 8).join()}`,
    ).toHaveLength(0)
  })

  it('summaryEn map covers sim methods plus app-referenced research methods', () => {
    expect(Object.keys(METHOD_SUMMARIES_EN).length).toBeGreaterThan(250)
    const withEn = METHODS.filter((m) => m.summaryEn?.trim())
    expect(withEn.length).toBe(Object.keys(METHOD_SUMMARIES_EN).length)
  })
})


describe('i18n control hints', () => {
  it('EN map length matches zh CONTROL_HINTS per path', () => {
    for (const path of Object.keys(CONTROL_HINTS_EN)) {
      const zh = controlHintsForSim(path)
      expect(zh.length).toBe(CONTROL_HINTS_EN[path].length)
      expect(zh.every((h) => h.controlEn && h.noteEn)).toBe(true)
    }
    expect(Object.keys(CONTROL_HINTS_EN).length).toBeGreaterThan(40)
  })
})

describe('i18n application level summaries', () => {
  it('merged levels with known ids carry summaryEn', () => {
    expect(Object.keys(APPLICATION_LEVEL_SUMMARIES_EN).length).toBeGreaterThan(100)
    let n = 0
    const walk = (levels: typeof APPLICATIONS[0]['levels']) => {
      for (const lv of levels) {
        if (APPLICATION_LEVEL_SUMMARIES_EN[lv.id]) {
          expect(lv.summaryEn?.trim().length).toBeGreaterThan(8)
          n++
        }
        if (lv.children) walk(lv.children)
      }
    }
    for (const app of APPLICATIONS) walk(app.levels)
    expect(n).toBe(Object.keys(APPLICATION_LEVEL_SUMMARIES_EN).length)
  })
})

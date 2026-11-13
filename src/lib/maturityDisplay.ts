import type { Locale } from './i18n/types'

/**
 * Locale-aware display for free-text maturity labels on edges/methods/apps.
 * Does not rewrite stored Chinese maturity strings — only maps for UI.
 */
function translateMaturityPhrases(s: string): string {
  // Longer / more specific first so shorter tokens do not eat them.
  let out = s
    .replace(/全球导航卫星系统/g, 'GNSS')
    .replace(/小批量商用/g, 'small-batch commercial')
    .replace(/早期商用/g, 'early commercial')
    .replace(/商用早期/g, 'early commercial')
    .replace(/成熟商用/g, 'mature commercial')
    .replace(/骨干网商用/g, 'backbone commercial')
    .replace(/航天商用/g, 'space commercial')
    .replace(/临床商用/g, 'clinical commercial')
    .replace(/商用主力/g, 'commercial mainline')
    .replace(/工程标准/g, 'engineering standard')
    .replace(/运动控制/g, 'motion control')
    .replace(/时频基准/g, 'time-frequency reference')
    .replace(/量子计算/g, 'quantum computing')
    .replace(/量子与计量/g, 'quantum & metrology')
    .replace(/光钟/g, 'optical clock')
    .replace(/加速器/g, 'accelerator')
    .replace(/在轨主流电推进/g, 'on-orbit mainline electric propulsion')
    .replace(/在轨/g, 'on-orbit')
    .replace(/电推进/g, 'electric propulsion')
    .replace(/功率级/g, 'power-class')
    .replace(/堆概念/g, 'reactor concept')
    .replace(/微功率/g, 'micropower')
    .replace(/小众/g, 'niche')
    .replace(/特种/g, 'specialty')
    .replace(/转化/g, 'translation')
    .replace(/标配/g, 'standard')
    .replace(/试点/g, 'pilot')
    .replace(/示范/g, 'demo')
    .replace(/原型/g, 'prototype')
    .replace(/实验室/g, 'lab')
    .replace(/实验/g, 'experimental')
    .replace(/研究/g, 'research')
    .replace(/基础/g, 'basic')
    .replace(/前沿/g, 'frontier')
    .replace(/理论/g, 'theory')
    .replace(/商用/g, 'commercial')
    .replace(/早期/g, 'early')
    .replace(/临床前/g, 'preclinical')
    .replace(/临床/g, 'clinical')
    .replace(/科研/g, 'R&D')
    .replace(/教学/g, 'teaching')
    .replace(/工业/g, 'industrial')
    .replace(/科学/g, 'scientific')
    .replace(/已确立/g, 'established')
    .replace(/量产/g, 'mass production')
    .replace(/成熟/g, 'mature')
    .replace(/传感/g, 'sensing')
    .replace(/–|—/g, '–')
  // Spacing around CJK/Latin junctions left after partial maps
  out = out
    .replace(/([a-zA-Z0-9)])([\u4e00-\u9fff])/g, '$1 $2')
    .replace(/([\u4e00-\u9fff])([a-zA-Z(])/g, '$1 $2')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/(commercial)(early|mainline|clinical)/gi, '$1 $2')
    .replace(/(computing)(commercial)/gi, '$1 $2')
    .replace(/(research)(frontier|commercial)/gi, '$1 $2')
    .replace(/(lab)(standard)/gi, '$1 $2')
    .replace(/(demo)(specialty|research|reactor)/gi, '$1 $2')
    .replace(/(experimental)(niche|research|demo)/gi, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  return out
}

export function maturityLabel(raw: string | undefined, locale: Locale = 'zh'): string {
  if (!raw) return ''
  if (locale !== 'en') return raw
  const s = raw.trim()
  // Already mostly Latin
  if (!/[\u4e00-\u9fff]/.test(s)) return s

  // Mixed tiers (research + demo/commercial/clinical): phrase-map the whole string.
  if (
    /实验|研究|基础|前沿|理论|lab|research/i.test(s) &&
    /示范|demo|原型|商用|临床|试点|标配/.test(s)
  ) {
    return translateMaturityPhrases(s)
  }
  if (/实验|研究|基础|前沿|理论|lab|research/i.test(s)) {
    if (/实验室/.test(s)) return 'Lab / experimental'
    if (/临床前/.test(s)) return 'Preclinical'
    if (/量子/.test(s)) return translateMaturityPhrases(s)
    return 'Experimental / research'
  }
  if (/示范|demo|原型|prototype|小批量|早期商用|emerging|试点/i.test(s)) {
    if (/[\u4e00-\u9fff]/.test(s) && s.length > 6) return translateMaturityPhrases(s)
    return 'Demo / prototype'
  }
  if (/商用|commercial|mature|成熟|established|临床|量产|growth|航天|骨干/i.test(s)) {
    if (/[\u4e00-\u9fff]/.test(s) && s.length > 4) return translateMaturityPhrases(s)
    if (/临床/.test(s)) return 'Commercial / clinical'
    return 'Mature / commercial'
  }
  // Fallback: phrase map whatever CJK remains
  const mapped = translateMaturityPhrases(s)
  return mapped
}

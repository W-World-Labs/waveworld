import type { Locale } from './types'

/** Shell / chrome strings only — content entities use name/nameEn fields. */
export type ShellMessageKey =
  | 'brandTitle'
  | 'brandSubtitle'
  | 'loading'
  | 'footer'
  | 'langZh'
  | 'langEn'
  | 'langSwitchAria'
  | 'openApp'
  | 'layers'
  | 'depth'
  | 'homeKicker'
  | 'homeTitle'
  | 'homeTitleSub'
  | 'homeLead'
  | 'homeLeadAccent1'
  | 'homeLeadMid'
  | 'homeLeadAccent2'
  | 'homeLeadTail'
  | 'statModels'
  | 'statEntries'
  | 'statWebgpu'
  | 'statFrontend'
  | 'searchAria'
  | 'menuAria'
  | 'homeSectionEntries'
  | 'homeSectionEntriesSub'
  | 'homeSectionFeatured'
  | 'homeSectionFeaturedSub'
  | 'homeClosing'
  | 'homeClosingCta'
  | 'homeAccel'
  | 'homeEnterHub'
  | 'domainTipAtlas'
  | 'domainTipSim'
  | 'domainTipApps'

const SHELL: Record<Locale, Record<ShellMessageKey, string>> = {
  zh: {
    brandTitle: '波谱宇宙',
    brandSubtitle: '波世界 · 黑盒智能',
    loading: '加载中…',
    footer: '世界是一个巨大的换能器 · W Intelligence Lab',
    langZh: '中',
    langEn: 'EN',
    langSwitchAria: '界面语言',
    openApp: '打开下钻 →',
    layers: '层',
    depth: '深',
    homeKicker: '黑箱智能 · 科学仿真操作台',
    homeTitle: '波世界',
    homeTitleSub: '波 谱 宇 宙',
    homeLead: '世界是一个巨大的',
    homeLeadAccent1: '换能器',
    homeLeadMid: '。先用地图认清能量怎么转，再在浏览器里跑仿真对拍——',
    homeLeadAccent2: '能量形式 × 基础方法',
    homeLeadTail: '两条脊梁，从光波天线到分子与心电，零安装。',
    statModels: '模型',
    statEntries: '一级入口',
    statWebgpu: '浏览器加速内核',
    statFrontend: '纯前端 · 零安装',
    searchAria: '搜索（命令面板）',
    menuAria: '菜单',
    homeSectionEntries: '三个入口',
    homeSectionEntriesSub:
      '地图认路 → 仿真动手 → 应用速查。不知道从哪点：先地图，想跑模型点仿真，查工程点应用',
    homeSectionFeatured: '精选 · 可计算化',
    homeSectionFeaturedSub:
      '光学标杆、时域电磁、分子动力学等——原属超算的核，现在浏览器里直接调、直接看',
    homeClosing:
      '商业仿真软件卖的是封装、网格与 license——算法本身多是公开的教科书方法。这里用浏览器加速重做公认内核与经典算例：打开就能跑、能调、能分享，不必装桌面套件。',
    homeClosingCta: '走进仿真',
    homeAccel: '加速',
    homeEnterHub: '进入枢纽',
    domainTipAtlas:
      '建议顺序：世界图认全局 → 方法图谱选路径 → 矩阵/路径查能量转换 → 再进仿真。',
    domainTipSim:
      '下方按分面浏览；带「加速」标记的可在浏览器内加速跑。不确定从哪开始时，先光学实验场或时域电磁。',
    domainTipApps:
      '按工程目标查换能器与传感；应用档案讲「要解决什么」；能量→令牌链看跨域叙事。',
  },
  en: {
    brandTitle: 'Wave Spectrum',
    brandSubtitle: 'WaveWorld · black-box intelligence',
    loading: 'Loading…',
    footer: 'The world is a vast transducer · W Intelligence Lab',
    langZh: '中',
    langEn: 'EN',
    langSwitchAria: 'Interface language',
    openApp: 'Open drill-down →',
    layers: 'layers',
    depth: 'depth',
    homeKicker: 'Black-box intelligence · science sim console',
    homeTitle: 'WaveWorld',
    homeTitleSub: 'W A V E   S P E C T R U M',
    homeLead: 'The world is a vast ',
    homeLeadAccent1: 'transducer',
    homeLeadMid: '. Map how energy converts, then run sims in the browser—',
    homeLeadAccent2: 'energy forms × foundational methods',
    homeLeadTail: ' as two spines, from waves and antennas to molecules and ECG, zero install.',
    statModels: 'models',
    statEntries: 'top entries',
    statWebgpu: 'browser GPU kernels',
    statFrontend: 'pure frontend · zero install',
    searchAria: 'Search (command palette)',
    menuAria: 'Menu',
    homeSectionEntries: 'Three entries',
    homeSectionEntriesSub:
      'Atlas to orient → Sims to run → Apps to look up. Lost? Start with Atlas; run models under Sims; engineering under Apps.',
    homeSectionFeatured: 'Featured · computable',
    homeSectionFeaturedSub:
      'Optics benchmarks, FDTD, MD, and more—kernels once reserved for supercomputers, now tuned and watched in the browser.',
    homeClosing:
      'Commercial sim packages sell packaging, meshing, and licenses—the algorithms themselves are often textbook methods. Here we re-implement established kernels and classic cases with browser acceleration: open, run, tune, share—no desktop suite install.',
    homeClosingCta: 'Enter sims',
    homeAccel: 'Accel',
    homeEnterHub: 'Open hub',
    domainTipAtlas:
      'Suggested order: world map for the whole → method taxonomy for paths → matrix/paths for conversion → then sims.',
    domainTipSim:
      'Browse by facet below; “Accel” marks browser-accelerated runs. Unsure where to start? Try the optics lab or FDTD.',
    domainTipApps:
      'Look up transducers and sensing by engineering goal; app profiles answer “what problem”; energy→token chain for cross-domain narrative.',
  },
}

export function shellMessage(locale: Locale, key: ShellMessageKey): string {
  return SHELL[locale][key] ?? SHELL.zh[key]
}

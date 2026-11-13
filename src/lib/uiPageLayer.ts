/**
 * Site navigation areas. All simulation modules share one surface regardless
 * of solver, execution location, numerical dimension or implementation maturity.
 */

export type PageSurface =
  | 'home'
  | 'knowledge' // atlas maps, methods, matrix, graph, controversies
  | 'simulation'
  | 'apps' // application profiles / engineering narrative
  | 'ops' // batch jobs, my projects

export type SurfaceMeta = {
  id: PageSurface
  labelZh: string
  labelEn: string
  shortZh: string
  shortEn: string
  /** Tailwind-ish tone classes for chips */
  chip: string
  /** Accent hex for thin rules */
  accent: string
  hintZh: string
  hintEn: string
  /** Primary entry path for this surface */
  hubPath: string
}

export const SURFACE_META: Record<PageSurface, SurfaceMeta> = {
  home: {
    id: 'home',
    labelZh: '总览',
    labelEn: 'Home',
    shortZh: '总览',
    shortEn: 'Home',
    chip: 'border-slate-500/40 bg-slate-500/15 text-slate-200',
    accent: '#94a3b8',
    hintZh: '三条入口：认路 · 动手 · 工程',
    hintEn: 'Three doors: orient · play · ship',
    hubPath: '/',
  },
  knowledge: {
    id: 'knowledge',
    labelZh: '原理与方法',
    labelEn: 'Principles and methods',
    shortZh: '知识',
    shortEn: 'Know',
    chip: 'border-violet-400/40 bg-violet-500/15 text-violet-100',
    accent: '#8b7bff',
    hintZh: '世界图 · 方法 · 矩阵 · 争议',
    hintEn: 'Map · methods · matrix · debates',
    hubPath: '/d/atlas',
  },
  simulation: {
    id: 'simulation',
    labelZh: '仿真与计算',
    labelEn: 'Simulation and computation',
    shortZh: '仿真与计算',
    shortEn: 'Simulation',
    chip: 'border-cyan-400/40 bg-cyan-500/15 text-cyan-100',
    accent: '#22d3ee',
    hintZh: '模型与数据 · 计算 · 结果与回放',
    hintEn: 'Models and data · computation · results and replay',
    hubPath: '/d/sim',
  },
  apps: {
    id: 'apps',
    labelZh: '应用叙事',
    labelEn: 'Applications',
    shortZh: '应用',
    shortEn: 'Apps',
    chip: 'border-amber-400/40 bg-amber-500/15 text-amber-100',
    accent: '#fbbf24',
    hintZh: '档案 · 换能 · 能链',
    hintEn: 'Profiles · transducers · chains',
    hubPath: '/d/apps',
  },
  ops: {
    id: 'ops',
    labelZh: '计算任务',
    labelEn: 'Compute jobs',
    shortZh: '批算',
    shortEn: 'Ops',
    chip: 'border-fuchsia-400/40 bg-fuchsia-500/15 text-fuchsia-100',
    accent: '#e879f9',
    hintZh: '任务板 · 我的项目',
    hintEn: 'Jobs · my projects',
    hubPath: '/batch-jobs',
  },
}

const KNOWLEDGE_PATHS = new Set([
  'world',
  'taxonomy',
  'methods',
  'method-depth',
  'graph',
  'matrix',
  'paths',
  'path-experiments',
  'phenomena',
  'controversies',
])

const APPS_PATHS = new Set([
  'apps',
  'transducers',
  'sensing',
  'node-budget',
  'converter',
  'ai-chain',
  'article',
])

const OPS_PATHS = new Set(['batch-jobs', 'my-projects', 'comsol', 'ansys', 'abaqus', 'opticstudio', 'dymola', 'star-ccm', 'cst'])

export function resolvePageSurface(pathname: string): PageSurface {
  const raw = pathname.replace(/\/$/, '') || '/'
  if (raw === '/' || raw === '') return 'home'

  const seg = raw.replace(/^\//, '').split('/')[0] ?? ''
  if (seg === 'd') {
    const key = raw.split('/')[2] ?? raw.split('/')[1]
    if (key === 'atlas') return 'knowledge'
    if (key === 'sim') return 'simulation'
    if (key === 'apps') return 'apps'
    return 'home'
  }

  if (OPS_PATHS.has(seg)) return 'ops'
  if (KNOWLEDGE_PATHS.has(seg)) return 'knowledge'
  if (APPS_PATHS.has(seg)) return 'apps'
  if (seg && seg !== 'd') return 'simulation'
  return 'home'
}

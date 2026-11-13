import type { MethodKind } from './types'

/** 方法 kind 的展示色（世界图 / 分类图谱 / 目录共用）。 */
export const KIND_COLOR: Record<MethodKind, string> = {
  wave: '#3ad6ff',
  particle: '#2dd4bf',
  continuum: '#38bdf8',
  statistical: '#a78bfa',
  circuit: '#fbbf24',
  imaging: '#fb7185',
  bio: '#ff9a4c',
  sensing: '#34d399',
  meta: '#8b7bff',
}

/** Chinese primary labels (zh locale). */
export const KIND_LABEL: Record<MethodKind, string> = {
  wave: '波动·场',
  particle: '粒子',
  continuum: '连续介质',
  statistical: '统计',
  circuit: '电路',
  imaging: '成像',
  bio: '生物电',
  sensing: '探测',
  meta: '元方法',
}

/** English labels for i18n — does not overwrite KIND_LABEL. */
export const KIND_LABEL_EN: Record<MethodKind, string> = {
  wave: 'Wave · field',
  particle: 'Particle',
  continuum: 'Continuum',
  statistical: 'Statistical',
  circuit: 'Circuit',
  imaging: 'Imaging',
  bio: 'Bioelectric',
  sensing: 'Sensing',
  meta: 'Meta',
}

/** 稳定泳道 / 图例顺序 */
export const KIND_ORDER = Object.keys(KIND_LABEL) as MethodKind[]

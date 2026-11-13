import type { ApplicationLevel, ApplicationProfile, ApplicationCategory } from './types'
import { APPLICATIONS as RAW } from './applications.data'
import { APPLICATION_ASSEMBLY_NOTE_EN } from './applications.assemblyNoteEn'
import { APPLICATION_BLURBS_EN } from './applications.blurbsEn'
import { APPLICATION_FAMILY_ROLE_EN } from './applications.familyRoleEn'
import { APPLICATION_LEVEL_NAME_EN } from './applications.levelNameEn'
import { APPLICATION_LEVEL_SUMMARIES_EN } from './applications.levelSummariesEn'
import { methodById } from '../methods/methods'
import { EDGES } from '../ontology/edges'
import { NODES } from '../ontology/nodes'

const edgeIds = new Set(EDGES.map((e) => e.id))
const nodeIds = new Set(NODES.map((n) => n.id))

function walkLevels(levels: ApplicationLevel[], visit: (lv: ApplicationLevel, depth: number) => void, depth = 0) {
  for (const lv of levels) {
    visit(lv, depth)
    if (lv.children?.length) walkLevels(lv.children, visit, depth + 1)
  }
}

function validate(list: ApplicationProfile[]): ApplicationProfile[] {
  const seen = new Set<string>()
  for (const app of list) {
    if (seen.has(app.id)) throw new Error(`duplicate application id: ${app.id}`)
    seen.add(app.id)
    if (!app.levels?.length) throw new Error(`application ${app.id}: empty levels`)
    walkLevels(app.levels, (lv) => {
      for (const mid of lv.methodIds ?? []) {
        if (!methodById(mid)) throw new Error(`app ${app.id} level ${lv.id}: unknown method ${mid}`)
      }
      for (const eid of lv.edgeIds ?? []) {
        if (!edgeIds.has(eid)) throw new Error(`app ${app.id} level ${lv.id}: unknown edge ${eid}`)
      }
      for (const nid of lv.energyNodeIds ?? []) {
        if (!nodeIds.has(nid)) throw new Error(`app ${app.id} level ${lv.id}: unknown node ${nid}`)
      }
    })
  }
  return list
}

/** Merge English level names/summaries without overwriting Chinese source fields. */
function mapLevelsEn(levels: ApplicationLevel[]): ApplicationLevel[] {
  return levels.map((lv) => {
    const summaryEn = APPLICATION_LEVEL_SUMMARIES_EN[lv.id]
    const nameEn = lv.nameEn ?? APPLICATION_LEVEL_NAME_EN[lv.id]
    const children = lv.children?.length ? mapLevelsEn(lv.children) : lv.children
    return {
      ...lv,
      ...(nameEn ? { nameEn } : {}),
      ...(summaryEn ? { summaryEn } : {}),
      ...(children ? { children } : {}),
    }
  })
}

function withI18n(list: ApplicationProfile[]): ApplicationProfile[] {
  return list.map((app) => {
    const blurbEn = APPLICATION_BLURBS_EN[app.id]
    const familyRoleEn =
      app.familyRole != null ? APPLICATION_FAMILY_ROLE_EN[app.familyRole] : undefined
    const assemblyNoteEn = APPLICATION_ASSEMBLY_NOTE_EN[app.id]
    return {
      ...app,
      ...(blurbEn ? { blurbEn } : {}),
      ...(familyRoleEn ? { familyRoleEn } : {}),
      ...(assemblyNoteEn ? { assemblyNoteEn } : {}),
      levels: mapLevelsEn(app.levels),
    }
  })
}

export const APPLICATIONS: ApplicationProfile[] = withI18n(validate(RAW))

export function applicationById(id: string): ApplicationProfile | undefined {
  return APPLICATIONS.find((a) => a.id === id)
}

export function applicationsByCategory(cat: ApplicationCategory): ApplicationProfile[] {
  return APPLICATIONS.filter((a) => a.category === cat)
}

/** 同应用族的其它变体（换源/换汇），不含自身。 */
export function familyVariants(app: ApplicationProfile): ApplicationProfile[] {
  if (!app.familyId) return []
  return APPLICATIONS.filter((a) => a.familyId === app.familyId && a.id !== app.id)
}

/** 按 familyId 分组（无族的单独成组）。 */
export function applicationsGroupedByFamily(): {
  familyId: string | null
  label: string
  labelEn?: string
  apps: ApplicationProfile[]
}[] {
  const map = new Map<string | null, ApplicationProfile[]>()
  for (const a of APPLICATIONS) {
    const k = a.familyId ?? null
    const list = map.get(k) ?? []
    list.push(a)
    map.set(k, list)
  }
  const FAMILY_LABEL: Record<string, string> = {
    'family-photovoltaic-stack': '光伏栈 · 换辐射源',
    'family-thermoelectric': '热电耦合 · 正/逆过程',
    'family-optoelectronic-junction': '光电结 · 光↔电',
    'family-steg': '太阳热电 · 光热+塞贝克嵌套',
    'family-hydro-power': '水力发电 · 水头驱动',
    'family-mhd-generator': '磁流体 · 无轴直转电',
    'family-photoacoustic': '光声 · 光致热弹探测',
    'family-ice-thermal-mechanical': '内燃热机 · 化学→机械→电',
    'family-salinity-gradient': '盐差发电 · 渗透/浓度㶲',
    'family-thermionic-converter': '热离子 · 热电子发射',
    'family-orc-rankine': '有机朗肯循环/卡林纳 · 余热朗肯族',
    'family-nuclear-betavoltaic': '核伏特 · α/β 直接生电',
    'family-electric-propulsion': '电推进 · 电→喷气动能',
    'family-optical-instrument': '光学仪器 · 色散/干涉/滤波',
    'family-rf-link': '射频 链路 · 匹配/电压驻波比/天线',
    'family-fiber-optic': '光纤链路 · 数值孔径/衰减/通信',
    'family-control': '运动控制 · 比例积分微分/伺服整定',
    'family-inertial': '惯性传感 · 陀螺/惯导',
    'family-fusion': '聚变 · 托卡马克/劳森',
    'family-superconducting': '超导 · 高 Q 腔/结/量子比特/超导量子干涉器件',
    'family-heat-transfer': '传热 · 导热/对流 Nu–Re–Pr',
    'family-mri-sensing': '磁共振成像/核磁共振 · 拉比脉冲与自旋传感',
    'family-quantum-control': '量子控制 · 拉姆齐/原子钟',
  }
  const FAMILY_LABEL_EN: Record<string, string> = {
    'family-photovoltaic-stack': 'PV stack · swap radiation source',
    'family-thermoelectric': 'Thermoelectric · forward / reverse',
    'family-optoelectronic-junction': 'Optoelectronic junction · light ↔ electricity',
    'family-steg': 'Solar thermoelectric · photothermal + Seebeck',
    'family-hydro-power': 'Hydropower · head-driven',
    'family-mhd-generator': 'MHD · shaftless direct electricity',
    'family-photoacoustic': 'Photoacoustic · photothermoelastic sensing',
    'family-ice-thermal-mechanical': 'ICE thermal · chemical → mechanical → electrical',
    'family-salinity-gradient': 'Salinity-gradient power · osmotic / concentration exergy',
    'family-thermionic-converter': 'Thermionic · thermal electron emission',
    'family-orc-rankine': 'ORC / Kalina · waste-heat Rankine family',
    'family-nuclear-betavoltaic': 'Nuclear voltaic · α/β direct electricity',
    'family-electric-propulsion': 'Electric propulsion · electricity → jet KE',
    'family-optical-instrument': 'Optical instruments · dispersion / interference / filter',
    'family-rf-link': 'RF link · matching / VSWR / antenna',
    'family-fiber-optic': 'Fiber link · NA / attenuation / comms',
    'family-control': 'Motion control · PID / servo tuning',
    'family-inertial': 'Inertial sensing · gyro / INS',
    'family-fusion': 'Fusion · tokamak / Lawson',
    'family-superconducting': 'Superconducting · high-Q cavity / junctions / qubits / SQUID',
    'family-heat-transfer': 'Heat transfer · conduction / convection Nu–Re–Pr',
    'family-mri-sensing': 'MRI / NMR · Rabi pulses & spin sensing',
    'family-quantum-control': 'Quantum control · Ramsey / atomic clocks',
  }
  return [...map.entries()].map(([familyId, apps]) => ({
    familyId,
    label: familyId ? FAMILY_LABEL[familyId] ?? familyId : '其它应用',
    labelEn: familyId ? FAMILY_LABEL_EN[familyId] ?? familyId : 'Other apps',
    apps,
  }))
}

/** 扁平化一层列表（含 depth），供目录/检索。 */
export function flattenLevels(app: ApplicationProfile): { level: ApplicationLevel; depth: number; path: string[] }[] {
  const out: { level: ApplicationLevel; depth: number; path: string[] }[] = []
  const rec = (levels: ApplicationLevel[], depth: number, path: string[]) => {
    for (const lv of levels) {
      const p = [...path, lv.id]
      out.push({ level: lv, depth, path: p })
      if (lv.children?.length) rec(lv.children, depth + 1, p)
    }
  }
  rec(app.levels, 0, [])
  return out
}

/** 沿 id 路径取节点（path 为 level id 链）。 */
export function levelAtPath(app: ApplicationProfile, path: string[]): ApplicationLevel | undefined {
  let cur: ApplicationLevel[] | undefined = app.levels
  let found: ApplicationLevel | undefined
  for (const id of path) {
    found = cur?.find((l) => l.id === id)
    if (!found) return undefined
    cur = found.children
  }
  return found
}

export type { ApplicationProfile, ApplicationLevel, ApplicationCategory }

// src/lib/sim/materials.ts
// 真实材料库：薄导入 src/data/materials/materials.data.json 静态资源（真实力场参数+引证），
// 提供类型化查询与 LJ 标度。仿能量本体 edges.data.json/conversions.json 模式（数据与代码分离）。
import raw from '../../data/materials/materials.data.json'
import {
  MATERIAL_CATEGORY_LABEL_EN,
  MATERIAL_FORCEFIELD_EN,
  MATERIAL_NAME_EN,
  MATERIAL_NOTES_EN,
} from '../../data/materials/materials.nameEn'
import { makeScale, type DerivedScale, KB_KJ_PER_MOL_K } from './units'

export { KB_KJ_PER_MOL_K }

export type Fidelity = 'quantitative' | 'qualitative'

export interface Material {
  name: string
  /** English display name; Chinese `name` remains source / lookup key. */
  nameEn?: string
  formula?: string
  sigma_nm: number
  epsilon_kJmol: number
  epsilon_over_kB_K: number
  charge_e: number
  mass_amu: number
  forcefield: string
  /** English force-field label; Chinese `forcefield` remains source of truth. */
  forcefieldEn?: string
  source: string
  fidelity: Fidelity
  notes?: string
  /** English notes; Chinese `notes` remains source of truth. */
  notesEn?: string
  category: string      // 所属类别 key
  categoryLabel: string // 类别中文标签
  categoryLabelEn?: string
}

interface RawCat { key: string; label: string; materials: Omit<Material, 'category' | 'categoryLabel'>[] }
interface RawData { version: string; note: string; categories: RawCat[] }

/** 最小结构校验：categories 数组 + 每条 material 的关键数字/字符串字段。坏数据 throw。 */
function validateMaterialsData(data: unknown): RawData {
  if (!data || typeof data !== 'object') {
    throw new Error('materials.data.json: expected object')
  }
  const d = data as Partial<RawData>
  if (!Array.isArray(d.categories)) {
    throw new Error('materials.data.json: categories must be an array')
  }
  for (const c of d.categories) {
    if (!c || typeof c.key !== 'string' || typeof c.label !== 'string' || !Array.isArray(c.materials)) {
      const key = c && typeof c === 'object' && 'key' in c ? String((c as { key: unknown }).key) : '?'
      throw new Error(`materials.data.json: invalid category key=${key}`)
    }
    for (const m of c.materials) {
      if (
        !m || typeof m.name !== 'string'
        || typeof m.sigma_nm !== 'number'
        || typeof m.epsilon_kJmol !== 'number'
        || typeof m.epsilon_over_kB_K !== 'number'
        || typeof m.charge_e !== 'number'
        || typeof m.mass_amu !== 'number'
        || typeof m.forcefield !== 'string'
        || typeof m.source !== 'string'
        || (m.fidelity !== 'quantitative' && m.fidelity !== 'qualitative')
      ) {
        const name = m && typeof m === 'object' && 'name' in m ? String((m as { name: unknown }).name) : '?'
        throw new Error(`materials.data.json: invalid material name=${name} in category ${c.key}`)
      }
    }
  }
  return d as RawData
}

const data = validateMaterialsData(raw)

/** 扁平化全部材料（带类别信息 + 可选 nameEn / forcefieldEn）。 */
export const MATERIALS: Material[] = data.categories.flatMap((c) =>
  c.materials.map((m) => {
    const nameEn = MATERIAL_NAME_EN[m.name]
    const categoryLabelEn = MATERIAL_CATEGORY_LABEL_EN[c.key]
    const forcefieldEn = MATERIAL_FORCEFIELD_EN[m.forcefield]
    const notesEn = MATERIAL_NOTES_EN[m.name]
    return {
      formula: undefined,
      notes: undefined,
      ...m,
      ...(nameEn ? { nameEn } : {}),
      ...(forcefieldEn ? { forcefieldEn } : {}),
      ...(notesEn ? { notesEn } : {}),
      category: c.key,
      categoryLabel: c.label,
      ...(categoryLabelEn ? { categoryLabelEn } : {}),
    }
  }),
)

export const MATERIAL_CATEGORIES = data.categories.map((c) => ({
  key: c.key,
  label: c.label,
  labelEn: MATERIAL_CATEGORY_LABEL_EN[c.key],
}))

/** 按名查材料（精确，找不到返回 undefined）。 */
export function findMaterial(name: string): Material | undefined {
  return MATERIALS.find((m) => m.name === name)
}

/** Locale-aware material display name (lookup key stays Chinese `name`). */
export function materialDisplayName(
  m: Pick<Material, 'name' | 'nameEn'>,
  locale: 'zh' | 'en' = 'zh',
): string {
  if (locale !== 'en') return m.name
  return m.nameEn?.trim() || MATERIAL_NAME_EN[m.name]?.trim() || m.name
}

/** Locale-aware force-field label (Chinese `forcefield` stays source of truth). */
export function materialForcefieldLabel(
  m: Pick<Material, 'forcefield' | 'forcefieldEn'>,
  locale: 'zh' | 'en' = 'zh',
): string {
  if (locale !== 'en') return m.forcefield
  return m.forcefieldEn?.trim() || MATERIAL_FORCEFIELD_EN[m.forcefield]?.trim() || m.forcefield
}

/** 材料 → LJ 标度（用于 reduced↔SI 换算）。带 LJ 的位点才有意义；σ/ε=0 的纯电荷位点回退到 1。 */
export function materialScale(m: Material): DerivedScale {
  return makeScale({
    sigma_nm: m.sigma_nm > 0 ? m.sigma_nm : 1,
    epsilon_kJmol: m.epsilon_kJmol > 0 ? m.epsilon_kJmol : 1,
    mass_amu: m.mass_amu > 0 ? m.mass_amu : 1,
  })
}

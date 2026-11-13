import db from './conversions.json'
import { CONVERSION_MATERIAL_NAME_EN } from './conversions.materialsEn'
import { ENERGY_SUBTYPE_EN } from './conversions.subtypesEn'

export interface Material {
  name: string
  /** English display name; Chinese `name` remains source of truth. */
  nameEn?: string
  cost_range?: string
  efficiency?: string
  maturity?: string
}

export interface ConversionMethod {
  id: string
  name: string
  nameEn?: string
  description: string
  descriptionEn?: string
  principle: string
  principleEn?: string
  efficiency_range: string
  status: string
  materials?: Material[]
  applications?: string[]
  applicationsEn?: string[]
  references?: string[]
}

export interface EnergySubtype {
  name: string
  nameEn?: string
  description: string
  descriptionEn?: string
  examples: string[]
  examplesEn?: string[]
}

export interface EnergyType {
  name: string
  nameEn?: string
  description: string
  descriptionEn?: string
  icon: string
  color: string
  subtypes?: Record<string, EnergySubtype>
}

/** Progressive EN for conversions.json energy_types (Chinese name/description stay source). */
const ENERGY_TYPE_EN: Readonly<
  Record<string, { nameEn: string; descriptionEn: string }>
> = {
  electromagnetic: {
    nameEn: 'Electromagnetic energy',
    descriptionEn: 'Light, radiation, electromagnetic waves',
  },
  mechanical: {
    nameEn: 'Mechanical energy',
    descriptionEn: 'Motion, vibration, pressure',
  },
  thermal: {
    nameEn: 'Thermal energy',
    descriptionEn: 'Temperature, heat, temperature difference',
  },
  chemical: {
    nameEn: 'Chemical energy',
    descriptionEn: 'Fuels, batteries, hydrogen energy',
  },
  electrical: {
    nameEn: 'Electrical energy',
    descriptionEn: 'Current, voltage, charge',
  },
  acoustic: {
    nameEn: 'Acoustic energy',
    descriptionEn: 'Sound, ultrasound, vibration in media',
  },
}

function withSubtypeEn(
  energyKey: string,
  subtypes: EnergyType['subtypes'],
): EnergyType['subtypes'] {
  if (!subtypes) return subtypes
  const out: Record<string, EnergySubtype> = {}
  for (const [sk, st] of Object.entries(subtypes)) {
    const en = ENERGY_SUBTYPE_EN[`${energyKey}/${sk}`]
    if (!en) {
      out[sk] = st
      continue
    }
    out[sk] = {
      ...st,
      nameEn: st.nameEn ?? en.nameEn,
      descriptionEn: st.descriptionEn ?? en.descriptionEn,
      examplesEn: st.examplesEn ?? [...en.examplesEn],
    }
  }
  return out
}

const ENERGY_TYPES: Record<string, EnergyType> = Object.fromEntries(
  Object.entries(db.energy_types as unknown as Record<string, EnergyType>).map(
    ([key, et]) => {
      const en = ENERGY_TYPE_EN[key]
      const subtypes = withSubtypeEn(key, et.subtypes)
      return [
        key,
        {
          ...et,
          ...(en
            ? {
                nameEn: et.nameEn ?? en.nameEn,
                descriptionEn: et.descriptionEn ?? en.descriptionEn,
              }
            : {}),
          ...(subtypes ? { subtypes } : {}),
        },
      ]
    },
  ),
)
const rawMethods = db.conversion_methods as unknown as Record<string, ConversionMethod[]>

/** Merge material nameEn without overwriting Chinese names. */
function withMaterialEn(methods: ConversionMethod[]): ConversionMethod[] {
  return methods.map((m) => {
    if (!m.materials?.length) return m
    return {
      ...m,
      materials: m.materials.map((mat) => {
        const nameEn = mat.nameEn ?? CONVERSION_MATERIAL_NAME_EN[mat.name]
        return nameEn ? { ...mat, nameEn } : mat
      }),
    }
  })
}

const METHODS: Record<string, ConversionMethod[]> = Object.fromEntries(
  Object.entries(rawMethods).map(([k, list]) => [k, withMaterialEn(list)]),
)

// 加载时校验 energy_types 条目具备 name/icon/color——坏数据直接 throw（对拍护栏）。
for (const [key, et] of Object.entries(ENERGY_TYPES)) {
  if (!et || typeof et.name !== 'string' || typeof et.icon !== 'string' || typeof et.color !== 'string') {
    throw new Error(`conversions.json energy_types.${key}: missing required name/icon/color`)
  }
}

export const ENERGY_KEYS = Object.keys(ENERGY_TYPES)

export function energyType(key: string): EnergyType | undefined {
  return ENERGY_TYPES[key]
}

export function methodsFor(from: string, to: string): ConversionMethod[] {
  return METHODS[`${from}_to_${to}`] ?? []
}

// 所有存在转换方法的 (from,to) 对
export function availablePairs(): Array<{ from: string; to: string; count: number }> {
  return Object.entries(METHODS).map(([k, v]) => {
    const [from, to] = k.split('_to_')
    return { from, to, count: v.length }
  })
}

export const STATUS_LABEL: Record<string, { label: string; labelEn?: string; color: string }> = {
  mature: { label: '成熟', labelEn: 'Mature', color: '#69db7c' },
  emerging: { label: '新兴', labelEn: 'Emerging', color: '#ffd43b' },
  research: { label: '研究中', labelEn: 'Research', color: '#ff8787' },
}

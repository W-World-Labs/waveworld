// F3 理想换能器两原语 + F5 键合图组件词汇/Modelica OOP 模式。
// 采纳来源（deep-research wf_f4ad4c5c-d8b，high-confidence 3-0）：
//  - F3 任何能量换能器 = 两种理想二端口原语之一：
//      * transformer（变压器/齿轮）：across→across，through→through（同构型缩放）；
//      * gyrator（回转器）：across→through（跨域耦合，把一域的 effort 接到另一域的 flow）。
//    源：MIT 2.14《Two-Port Energy Transducing Elements》(Rowell & Wormley)。理想 = 无损 + 代数（静）关系。
//  - F5 键合图组件词汇：储能(storage) / 能量路由(routing=Dirac) / 耗散(dissipative) / 源(source)，
//    配合 Modelica 面向对象实现（继承 + 组合连接子）。源：arXiv:2008.04091 (Lohmayer et al., EPHS)。

import type { EnergyDomain } from './domains'

/** 理想换能器二端口原语（F3）。 */
export type TransducerPrimitive = 'transformer' | 'gyrator'

export const PRIMITIVE_LABEL: Record<TransducerPrimitive, string> = {
  transformer: '变压器(同构缩放：across→across / through→through)',
  gyrator: '回转器(跨域耦合：across→through)',
}

/** 键合图组件角色（F5）。储能/路由/耗散 是 Lohmayer EPHS 的三基本类，加源/换能器/汇。 */
export type ComponentRole =
  | 'source'       // 源：外界注入能量（电压源/力源/热源）
  | 'storage'      // 储能：I(惯)/C(容) 储存动/势能
  | 'routing'      // 能量路由：Dirac 结构（0-结共 effort / 1-结共 flow），保功率分配
  | 'dissipative'  // 耗散：R 元件，不可逆熵产
  | 'transducer'   // 换能器：transformer/gyrator（跨域二端口）
  | 'sink'         // 汇：能量终点/负载

export const COMPONENT_ROLE_LABEL: Record<ComponentRole, string> = {
  source: '源', storage: '储能', routing: '能量路由(Dirac)', dissipative: '耗散', transducer: '换能器', sink: '汇',
}

/** 理想二端口原语契约：in 域 → out 域，及跨域关系。 */
export interface PrimitiveSpec {
  primitive: TransducerPrimitive
  fromDomain: EnergyDomain
  toDomain: EnergyDomain
  /** 跨域缩放比（变压器：effort 比；回转器：effort↔flow 跨连比）。无具体参数时为 null。 */
  ratio: number | null
  /** 同域（如变压器升压、齿轮箱）还是跨域（如电机/热电）。 */
  crossDomain: boolean
}

/** 判定一对 from→to 域用哪种原语表达。
 *  - 同域缩放 → transformer（理想无损，如变压器/齿轮/流体变压器）。
 *  - 跨域 → 默认 gyrator（电机:电↔机 effort-flow 跨连；热电:热↔电）；少数跨域也是 transformer
 *    （如电→声 压电换能器在某些键合图约定下按 transformer）。此处给保守默认，device 级可覆盖。 */
export function classifyPrimitive(fromDomain: EnergyDomain, toDomain: EnergyDomain): TransducerPrimitive {
  if (fromDomain === toDomain) return 'transformer'
  // 跨域默认回转器（多数机电/热电换能器本质是 gyrator）
  return 'gyrator'
}

/** 构造二端口原语 spec（ratio 缺省 null，待器件参数接入）。 */
export function primitiveSpec(fromDomain: EnergyDomain, toDomain: EnergyDomain, ratio: number | null = null): PrimitiveSpec {
  return {
    primitive: classifyPrimitive(fromDomain, toDomain),
    fromDomain, toDomain, ratio,
    crossDomain: fromDomain !== toDomain,
  }
}

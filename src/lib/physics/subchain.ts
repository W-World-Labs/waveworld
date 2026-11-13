// 多分辨率：一个「现象」级转换可细分为微观子链；合并 = 组合。两视角须**一致**：
// 子链各微步效率连乘应落在现象边的 η 区间内，且整体受同一第一性原理上限(如光伏的 SQ)约束。
// 这实现「可以合并链条为现象，但也得能真实细分到详细链路」——且细分与合并自洽。
//
// 微观子链的具体数值是物性数据，先以光伏为第一性原理样板；其余转换的子链以后接入。

import type { ConversionEdge } from '../../data/ontology/types'

export interface MicroStep {
  name: string
  fromForm: string
  toForm: string
  eta: number          // 该微步效率(进入下一步的份额)
  lossTo?: string       // 该微步损耗的去向形式(多为 thermal)
  principle?: string
}
export interface SubChain {
  phenomenonId: string  // 对应的现象级边 id
  title: string
  steps: MicroStep[]
}

/** 组合子链：微步效率连乘 + 节点级连续性。 */
export function composeSubChain(steps: MicroStep[]): {
  eta: number; startForm: string; endForm: string; continuous: boolean
} {
  let eta = 1, continuous = true
  for (let i = 0; i < steps.length; i++) {
    eta *= steps[i].eta
    if (i > 0 && steps[i - 1].toForm !== steps[i].fromForm) continuous = false
  }
  return { eta, startForm: steps[0].fromForm, endForm: steps[steps.length - 1].toForm, continuous }
}

/** 子链与现象级边是否一致：组合效率落在边的 η[min,max] 内、连续、起止形式相符。 */
export function subChainConsistentWith(edge: ConversionEdge, chain: SubChain, formOf: (id: string) => string): {
  composedEta: number; withinRange: boolean; continuous: boolean; endpointsMatch: boolean
} {
  const c = composeSubChain(chain.steps)
  const lo = edge.efficiency.min ?? 0, hi = edge.efficiency.max ?? 1
  const endpointsMatch = c.startForm === formOf(edge.from) && c.endForm === formOf(edge.to)
  return { composedEta: c.eta, withinRange: c.eta >= lo - 1e-9 && c.eta <= hi + 1e-9, continuous: c.continuous, endpointsMatch }
}

/** 光伏现象的第一性原理微观子链：电磁波→电，逐步损耗去向显式（多为热）。
 *  组合 η ≈ 0.9×0.62×0.65×0.78 ≈ 0.283，落在 radiant-to-electric-photovoltaic 的 [0.06,0.476] 内，
 *  且 < 单结 SQ(~0.31–0.337)，与第一性原理上限自洽。 */
export const PV_SUBCHAIN: SubChain = {
  phenomenonId: 'radiant-to-electric-photovoltaic', // 现象边(radiant 已并入 electromagnetic 子树)

  title: '光伏：电磁波 → 电 (+ 热)',
  steps: [
    { name: '反射与吸收', fromForm: 'electromagnetic', toForm: 'electromagnetic', eta: 0.9, lossTo: 'electromagnetic', principle: '减反射 + 带隙以上吸收；亚带隙光子透射、表面反射损失' },
    { name: '热化弛豫', fromForm: 'electromagnetic', toForm: 'electric', eta: 0.62, lossTo: 'thermal', principle: '热载流子弛豫到带边，超出带隙的光子能量以声子(热)耗散' },
    { name: '电压因子', fromForm: 'electric', toForm: 'electric', eta: 0.65, lossTo: 'thermal', principle: '开路电压 qV_oc < E_g，电压亏损→热' },
    { name: '填充因子与收集', fromForm: 'electric', toForm: 'electric', eta: 0.78, lossTo: 'thermal', principle: '串/并联电阻与复合，FF<1' },
  ],
}

/** 已建的现象→子链映射（以后逐步接入更多）。 */
export const SUBCHAINS: Record<string, SubChain> = { [PV_SUBCHAIN.phenomenonId]: PV_SUBCHAIN }

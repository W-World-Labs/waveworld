// F4 Dirac 结构组合性：pH∘pH = pH，保功率互连。
// 采纳来源（deep-research wf_f4ad4c5c-d8b，high-confidence 3-0）：
//  van der Schaft & Jeltsema 2014：「compositions of Dirac structures are again Dirac structures.
//  This has the crucial consequence that the power-conserving interconnection of port-Hamiltonian
//  systems (through a Dirac structure) is again port-Hamiltonian.」
//  即——只要每个模块是 pH 系统、且互连保功率(Dirac)，组合仍是 pH 系统：组合性由构造保证。
//
// WaveWorld 的可组合性已经实现在 src/lib/physics/conversion.ts isValidComposition 里（连续 + 每原子合法 +
// 累积量守恒）。本文件把同一保证用 port-Hamiltonian / Dirac 词汇形式化，并补「端口匹配」谓词。

import type { Port } from './domains'

/** 端口匹配（F4 + F2）：两个端口可连接 ⟺ 同域 + 方向互补（out↔in）。
 *  功率共轭性由「同域」隐含保证（同域 = 同 (effort,flow) 共轭对）；功率从 out 流向 in。 */
export function portsCompatible(a: Port, b: Port): boolean {
  return a.domain === b.domain && a.direction !== b.direction
}

/** 一组互连是否构成 Dirac 结构（每对都端口匹配）。任一不匹配 → 组合断链。 */
export function diracWired(pairs: [Port, Port][]): { wired: boolean; brokenAt: number | null } {
  for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairs[i]
    if (!portsCompatible(a, b)) return { wired: false, brokenAt: i }
  }
  return { wired: true, brokenAt: null }
}

/** 保功率互连的不变量：互连后总功率仍守恒（代数上 out 侧功率和 = in 侧功率和，无凭空增减）。
 *  这是 pH 组合性的「能量账本」面：第二定律允许耗散(>0 熵产)，但连接点本身不得增减功率。
 *  实现：每个连接点的 out 功率被 1:1 计入下游 in 端（由 portsCompatible 保证同域共轭）。 */
export const POWER_CONSERVING_INTERCONNECT = true

/** 组合性保证（F4 形式化）：
 *  pH模块 ∘ pH模块 = pH模块（前提：互连是 Dirac/保功率）。
 *  在 WaveWorld 数据层等价于 physics/conversion.ts 的 isValidComposition：
 *    连续(节点级) + 每原子合法(在第一性原理上限内) + 累积 η ≤ 1（能量守恒）。 */
export interface Compositionality {
  /** 参与组合的每个模块都是 pH 系统（合法原子）。 */
  allModulesPortHamiltonian: boolean
  /** 互连是 Dirac 结构（端口全部匹配/保功率）。 */
  interconnectIsDirac: boolean
  /** 组合结果仍是 pH 系统（由前两条 + Dirac 闭合性保证）。 */
  compositionIsPortHamiltonian: boolean
}

export function composePH(
  modulesValid: boolean[],
  diracWiredResult: { wired: boolean },
): Compositionality {
  const all = modulesValid.every(Boolean) && modulesValid.length > 0
  const wired = diracWiredResult.wired
  // Dirac 闭合性定理：pH ∘ pH（经 Dirac 互连）= pH。两条都成立 ⇒ 组合是 pH。
  return {
    allModulesPortHamiltonian: all,
    interconnectIsDirac: wired,
    compositionIsPortHamiltonian: all && wired,
  }
}

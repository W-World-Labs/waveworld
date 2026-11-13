// src/lib/sim/params.ts
// 框架级「带来源参数」：物理量不裸写常数，而携带来源/单位/能量本体引用，
// 实现「参数对齐 + 与能量本体双向引用」（仿真计算取 .value，页面/本体用元数据）。
// 北极星见 WaveWorld WebGPU 仿真框架愿景。

export interface ParameterSource<T = number> {
  /** 数值（约化或物理单位）。仿真计算只读此字段。 */
  value: T
  /** 单位字符串（约化量填 '约化' 或 ''）。 */
  unit: string
  /** 来源/引证：文献、调研、手册出处。 */
  source: string
  /** 能量本体节点/边引用 id（如 'node:chemical' / 'edge:chemical-electrical'），可省。 */
  ontologyRef?: string
}

/** 构造带来源参数。 */
export function param<T = number>(value: T, unit: string, source: string, ontologyRef?: string): ParameterSource<T> {
  return { value, unit, source, ontologyRef }
}

import type { Consensus } from '../ontology/types'

/**
 * 基础技术方法节点（Foundational Method）。
 * 波世界 的第二脊梁：能量形式是「世界由什么构成」；
 * 方法是「用什么透镜/算法认识与计算这个世界」。
 * 多实现并存：同一方法可有多学派变体；同一现象可挂多种方法。
 * 嵌套：parentId 指向更粗一级方法，子节点为一层一层细分的算法单元。
 */
export type MethodKind =
  | 'wave'           // 波动 / 场离散
  | 'particle'       // 粒子 / 分子
  | 'continuum'      // 连续介质 PDE
  | 'statistical'    // 统计 / MC
  | 'circuit'        // 集总电路
  | 'imaging'        // 成像 / 扫描探针
  | 'bio'            // 生物电 / 生理信号
  | 'sensing'        // 探测 / 定位
  | 'meta'           // 元方法（路径搜索、对拍、换能链）

export interface MethodSchool {
  stance: string
  /** English stance; Chinese `stance` remains source of truth. */
  stanceEn?: string
  proponents?: string[]
  note?: string
  noteEn?: string
}

/**
 * 模块在「世界计算图谱」中的角色：
 * - family：可下钻的方法族 / 现象槽位
 * - algorithm：可组装的算法模块（公式+步进）
 * - step：更细的原子步骤（力、积分半步、边界…）
 * - parallel-variant：同一现象/同一槽位的并行解释或并立实现（多学科不裁决）
 */
export type MethodModuleRole = 'family' | 'algorithm' | 'step' | 'parallel-variant'

export interface FoundationalMethod {
  id: string
  name: string
  nameEn?: string
  icon?: string
  kind: MethodKind
  /** Chinese primary summary */
  summary: string
  /** English summary for i18n; zh keeps `summary` */
  summaryEn?: string
  /** 方程与建模依据的教学说明；不是形式化命题或已核验的证明依赖。 */
  foundations: string[]
  /** 可选：多学派/多近似（散文登记；并行模块优先用 parallelGroupId 节点） */
  schools?: MethodSchool[]
  /** 方法被广泛引入的大致年代（时序图谱锚点） */
  yearIntroduced?: number
  /** 本站可运行样板路由 path（nav 叶子，无前导 /） */
  simPaths?: string[]
  /** 关联能量本体节点 id */
  relatedNodeIds?: string[]
  /**
   * 父方法 id：算法细分时指向更粗一级节点。
   * 根方法省略；校验要求 parent 存在且无环。
   */
  parentId?: string
  /**
   * 并行组 id：共享此 id 的节点是同一现象/算法槽位上的并立模块
   * （不同学科解释、不同数值路径），不互为父子、不裁决唯一真理。
   */
  parallelGroupId?: string
  /** 模块角色；缺省时由 parent/parallel 推断展示 */
  role?: MethodModuleRole
  consensus: Consensus
}

/**
 * 方法先修边：methodId 依赖 prerequisiteId（要掌握前者，宜先会后者）。
 * 本站整理的学习建议，不表示数学证明、物理耦合或实验验证。
 * hard / soft 仅表示先修建议的强弱；相关证据规范见 docs/knowledge-db.md。
 */
export type DependencyStrength = 'hard' | 'soft'

export interface MethodDependency {
  methodId: string
  prerequisiteId: string
  strength: DependencyStrength
  reason: string
  /** English reason; Chinese `reason` remains source of truth. */
  reasonEn?: string
}

export function isFoundationalMethod(x: unknown): x is FoundationalMethod {
  const m = x as FoundationalMethod
  return !!m && typeof m.id === 'string' && typeof m.name === 'string'
    && typeof m.summary === 'string' && Array.isArray(m.foundations)
    && typeof m.kind === 'string' && !!m.consensus
}

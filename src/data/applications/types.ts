/**
 * 应用档案（Application Profile）：真实工程/产品入口。
 * 与能量边、基础方法并列——用户从应用下钻到转换路径，再下钻到算法原子。
 * 树形 levels 支持「无限分级」：每一层挂 edgeIds + methodIds，children 再深一层。
 */

export type ApplicationCategory =
  | 'energy'      // 能源转换 / 发电
  | 'sensing'     // 传感 / 探测
  | 'imaging'     // 成像
  | 'compute'     // 算力 / 信息
  | 'life'        // 生命 / 医疗
  | 'device'      // 通用器件

export interface ApplicationLevel {
  id: string
  name: string
  nameEn?: string
  /** 本层在讲什么（中文主字段） */
  summary: string
  /** English level summary for i18n */
  summaryEn?: string
  /** 本层涉及的能量节点 id */
  energyNodeIds?: string[]
  /** 本层挂接的转换边 id（路径/机理） */
  edgeIds?: string[]
  /** 本层挂接的基础方法 id（算法/透镜） */
  methodIds?: string[]
  /** 可动手的仿真路由 path（无前导 /） */
  simPaths?: string[]
  /** 更深一层 */
  children?: ApplicationLevel[]
}

/**
 * 应用族：同一物理栈换源/换汇得到的并立产品。
 * 例 family-photovoltaic-stack：太阳光 PV · 热光伏 TPV ·（再换汇可接到热电）
 * 例 family-thermoelectric：塞贝克发电 · 珀尔帖制冷（正/逆过程）
 */
export interface ApplicationProfile {
  id: string
  name: string
  nameEn?: string
  icon: string
  category: ApplicationCategory
  /** 一句话卖点（中文主字段） */
  blurb: string
  /** English blurb for i18n; zh keeps `blurb` */
  blurbEn?: string
  /** 顶层目标：从什么能量到什么能量 */
  goal: { from: string; to: string }
  /**
   * 应用族 id：相同 familyId 的档案互为「换源/换汇」变体，UI 互相跳转。
   * 深层 methodIds 可复用；表层 edgeIds / goal 不同。
   */
  familyId?: string
  /** 在族内的角色标签，如「太阳源」「黑体辐射源」「逆过程制冷」 */
  familyRole?: string
  /** English family-role chip; Chinese `familyRole` stays source of truth. */
  familyRoleEn?: string
  /**
   * 组装说明：相对族内基准换了什么源/汇、哪一层仍共享。
   * 体现「无限嵌套乱组装」——不是新物理学，是接口重接。
   */
  assemblyNote?: string
  /** English assembly note; Chinese `assemblyNote` stays source of truth. */
  assemblyNoteEn?: string
  /** 可下钻的层级树（根下直接 children） */
  levels: ApplicationLevel[]
  /** 可选：真实产品锚点 */
  products?: {
    vendor?: string
    vendorEn?: string
    model: string
    modelEn?: string
    spec?: string
    specEn?: string
  }[]
  maturity?: string
}

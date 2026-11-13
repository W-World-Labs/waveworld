// F1 六域能量 taxonomy + F2 port-Hamiltonian 端口形式化。
// 采纳来源（deep-research wf_f4ad4c5c-d8b，high-confidence 3-0 裁决）：
//  - F1 Middelhoek/NAP 六域分类：mechanical/thermal/electrical/magnetic/radiant/chemical，
//    按「输入(主)能量域 → 输出(副)能量域」的 6×6 转换矩阵组织传感器/换能器。
//    源：NAP《Expanding the Vision of Sensor Materials》App.C；Middelhoek & Audet 1989。
//  - F2 port-based / port-Hamiltonian：每个能量端口由共轭 (effort e, flow f) 对刻划，乘积 = 功率 P=e·f；
//    端口按「功率共轭性」匹配。源：van der Schaft & Jeltsema 2014；MIT 2.14。
// WaveWorld 在六域之外另扩展 acoustic/nuclear/gravitational/mass（声=机械波、核/质能/引力为现代扩展），
// 用 EXTENDED_DOMAINS 单列，不污染经典六域命名空间。

/** 经典六域（F1）。 */
export type CoreDomain =
  | 'mechanical' | 'thermal' | 'electrical' | 'magnetic' | 'radiant' | 'chemical'

/** WaveWorld 扩展域（六域之外的现代补充）。 */
export type ExtendedDomain = 'acoustic' | 'nuclear' | 'gravitational' | 'mass'

export type EnergyDomain = CoreDomain | ExtendedDomain

export const CORE_DOMAINS: CoreDomain[] =
  ['mechanical', 'thermal', 'electrical', 'magnetic', 'radiant', 'chemical']
export const EXTENDED_DOMAINS: ExtendedDomain[] =
  ['acoustic', 'nuclear', 'gravitational', 'mass']
export const ALL_DOMAINS: EnergyDomain[] = [...CORE_DOMAINS, ...EXTENDED_DOMAINS]

/** 把 WaveWorld 顶层能量形式 id 映射到能量域（F1 对齐）。
 *  radiant 已并入 electromagnetic 子树，统一映射 radiant；magnetic 是六域之一，
 *  WaveWorld 现有形式未单列磁能（缺口，见 EXTENSION_NOTES）——磁场能多经电感耦合归 electrical/electromagnetic。*/
export const FORM_TO_DOMAIN: Record<string, EnergyDomain> = {
  mechanical: 'mechanical',
  acoustic: 'acoustic',          // 声=机械波（扩展域，键合图按机械/流体处理）
  thermal: 'thermal',
  electric: 'electrical',
  electromagnetic: 'radiant',    // EM 波视角 = radiant 域
  radiant: 'radiant',
  chemical: 'chemical',
  nuclear: 'nuclear',
  gravitational: 'gravitational',
  mass: 'mass',
}

export const DOMAIN_LABEL: Record<EnergyDomain, string> = {
  mechanical: '机械', thermal: '热', electrical: '电', magnetic: '磁',
  radiant: '辐射', chemical: '化学', acoustic: '声', nuclear: '核',
  gravitational: '引力', mass: '质能',
}

/** WaveWorld 现有形式覆盖的缺口说明（供后续数据接入）。 */
export const EXTENSION_NOTES: string[] = [
  '六域中的 magnetic 域在 WaveWorld 现有顶层形式里未单列——磁场能通常经电感/变压器耦合到 electrical，故按 electrical/electromagnetic 计；若需独立磁路建模(继电器/磁存储)应补 magnetic 形式。',
]

/** 节点形式 → 能量域；未登记回落 'electrical'（仅占位，调用方应保证已登记）。 */
export function domainOf(formId: string): EnergyDomain {
  return FORM_TO_DOMAIN[formId] ?? 'electrical'
}

// ===== F2 端口：共轭 (effort, flow) 对，功率 = effort·flow =====

/** 端口变量：一个共轭量（effort 或 flow），沿用 ontology Quantity 的单位/范围语义。 */
export interface PortVariable {
  name: string                   // 量名：电压 / 电流 / 温度 / 熵流 …
  symbol: string                 // V / I / T / Ṡ …
  unit: string                   // SI 单位字符串
}

/** 能量端口的域变量契约（F2）：effort·flow = power。
 *  来自键合图经典 (e,f) 共轭对：电气(V,I)、机械平动(F,v)、机械转动(τ,ω)、
 *  热(T,Ṡ)、磁(MMF,dΦ/dt)、化学(μ,ṅ)、辐射(T_rad,熵/光子流)。 */
export interface DomainPortVars {
  domain: EnergyDomain
  effort: PortVariable
  flow: PortVariable
  /** 功率 = effort·flow 的符号式（注释用，不强制求值）。 */
  powerExpr: string
}

export const DOMAIN_PORT_VARS: Record<EnergyDomain, DomainPortVars> = {
  electrical: { domain: 'electrical', effort: { name: '电压', symbol: 'u', unit: 'V' }, flow: { name: '电流', symbol: 'i', unit: 'A' }, powerExpr: 'P = u·i' },
  mechanical: { domain: 'mechanical', effort: { name: '力', symbol: 'F', unit: 'N' }, flow: { name: '速度', symbol: 'v', unit: 'm/s' }, powerExpr: 'P = F·v' },
  thermal: { domain: 'thermal', effort: { name: '温度', symbol: 'T', unit: 'K' }, flow: { name: '熵流', symbol: 'Sdot', unit: 'W/K' }, powerExpr: 'P = T·Ṡ' },
  magnetic: { domain: 'magnetic', effort: { name: '磁通势', symbol: 'F_m', unit: 'A' }, flow: { name: '磁通变化率', symbol: 'Phidot', unit: 'Wb/s' }, powerExpr: 'P = F_m·Φ̇' },
  radiant: { domain: 'radiant', effort: { name: '辐射温度', symbol: 'T_rad', unit: 'K' }, flow: { name: '熵辐射流', symbol: 'Sdot', unit: 'W/K' }, powerExpr: 'P = T_rad·Ṡ (Petela 口径)' },
  chemical: { domain: 'chemical', effort: { name: '化学势', symbol: 'mu', unit: 'J/mol' }, flow: { name: '摩尔流', symbol: 'ndot', unit: 'mol/s' }, powerExpr: 'P = μ·ṅ' },
  acoustic: { domain: 'acoustic', effort: { name: '声压', symbol: 'p', unit: 'Pa' }, flow: { name: '体积速度', symbol: 'U', unit: 'm^3/s' }, powerExpr: 'P = p·U' },
  nuclear: { domain: 'nuclear', effort: { name: '结合能', symbol: 'E_b', unit: 'J' }, flow: { name: '反应率', symbol: 'rdot', unit: '/s' }, powerExpr: 'P = E_b·ṙ' },
  gravitational: { domain: 'gravitational', effort: { name: '引力势', symbol: 'Phi', unit: 'J/kg' }, flow: { name: '质量流', symbol: 'mdot', unit: 'kg/s' }, powerExpr: 'P = Φ·ṁ' },
  mass: { domain: 'mass', effort: { name: '质能', symbol: 'E_0', unit: 'J' }, flow: { name: '湮灭率', symbol: 'rdot', unit: '/s' }, powerExpr: 'P = mc²·ṙ' },
}

/** 一个具体端口：域 + 方向（输入/输出）+ 端口变量。 */
export interface Port {
  domain: EnergyDomain
  direction: 'in' | 'out'
  effort: PortVariable
  flow: PortVariable
}

/** 构造某域的端口（自动填入该域的共轭变量）。 */
export function port(domain: EnergyDomain, direction: 'in' | 'out'): Port {
  const v = DOMAIN_PORT_VARS[domain]
  return { domain, direction, effort: v.effort, flow: v.flow }
}

// ===== F1 6×6 转换矩阵：边的域间单元（命名空间）=====

/** 一条转换边在六域矩阵中的单元：fromDomain(行) → toDomain(列)。 */
export interface DomainCell {
  from: EnergyDomain
  to: EnergyDomain
  /** 矩阵单元键，如 'electrical->thermal'。自环(同域)合法（如变压器升压、齿轮箱）。 */
  key: string
  self: boolean
}

/** 把一条 from→to 边归入域矩阵单元。 */
export function domainCell(fromForm: string, toForm: string): DomainCell {
  const f = domainOf(fromForm), t = domainOf(toForm)
  return { from: f, to: t, key: `${f}->${t}`, self: f === t }
}

/** 「自生型 vs 调制型」正交维度（F1）：自生型换能器从被测域**汲取**输出能量（发电型），
 *  调制型用被测域**调制**外部电源（需外加能源）。来自 Middelhoek。 */
export type ExcitationMode = 'self-generating' | 'modulating'

/** 经典六域 → 是否存在自生型换能器的经验标注（供分类参考；非硬约束）。 */
export const SELF_GENERATING_CAPABLE: Record<CoreDomain, boolean> = {
  mechanical: true,   // 压电/电磁感应发电
  thermal: true,      // 热电/热离子
  electrical: true,
  magnetic: false,    // 多为调制型（霍尔/磁阻需外加电源）
  radiant: true,      // 光伏
  chemical: true,     // 伽伐尼/燃料电池
}

// 第一性原理理论上限目录（闭式）。每个上限既给可被 src/lib/formula.ts 求值的 expr + 工作算例，
// 又给纯计算函数。expr 全部在求值器文法内（+ - * / ^、一元负号、括号、sqrt/ln/exp/... 单参函数、
// 常数 pi/e、"lhs=rhs" 取 rhs）。常数与物性作为 sample 变量传入。
//
// 来源：first-principles-limits 推导+对抗式核验工作流（2026-06）。canonical 测试向量见 limits.test.ts。
// 注意区分 kind：'ceiling'=效率/速率上界(carnot/betz/sq/margolus-levitin/bremermann，实际不应超过)；
// 'floor'=能量/耗散下界(landauer，实际不应更省)；'identity'=定义式(单光子能/可逆电压/热中性电压等)；
// 'exergy-factor'=㶲品位因子。

import { evalExpr } from '../formula'

export interface PhysicsLimit {
  name: string
  governingLaw: string
  kind: 'ceiling' | 'floor' | 'identity' | 'exergy-factor'
  closedForm: boolean
  expr?: string
  vars: Record<string, string>
  sample: Record<string, number>
  expected: number
  tol: number
  boundsEdgeClasses: string[]
  note?: string
}

/** 闭式上限目录（与测试断言一一对应）。 */
export const PHYSICS_LIMITS: PhysicsLimit[] = [
  // ===== A. 热机 =====
  { name: 'carnot-efficiency', governingLaw: '第二定律(卡诺定理)', kind: 'ceiling', closedForm: true,
    expr: 'eta = 1 - Tc / Th', vars: { Tc: '冷源温度 K', Th: '热源温度 K' },
    sample: { Tc: 300, Th: 900 }, expected: 0.6666666666666667, tol: 1e-9,
    boundsEdgeClasses: ['thermal->mechanical', 'thermal->electric'] },
  { name: 'curzon-ahlborn-maxpower', governingLaw: '内可逆热机最大功率(柯曾–阿尔本)', kind: 'ceiling', closedForm: true,
    expr: 'eta = 1 - sqrt(Tc / Th)', vars: { Tc: '冷源温度 K', Th: '热源温度 K' },
    sample: { Tc: 300, Th: 900 }, expected: 0.42264973081037427, tol: 1e-9,
    boundsEdgeClasses: ['thermal->mechanical'], note: '额定功率点效率(<卡诺)' },
  { name: 'otto-cycle', governingLaw: '理想奥托循环(气体状态方程)', kind: 'ceiling', closedForm: true,
    expr: 'eta = 1 - r ^ (1 - gamma)', vars: { r: '压缩比', gamma: '比热比' },
    sample: { r: 8, gamma: 1.4 }, expected: 0.5647247183519378, tol: 1e-9,
    boundsEdgeClasses: ['thermal->mechanical'] },
  { name: 'brayton-cycle', governingLaw: '理想布雷顿循环', kind: 'ceiling', closedForm: true,
    expr: 'eta = 1 - rp ^ ((1 - gamma) / gamma)', vars: { rp: '压比', gamma: '比热比' },
    sample: { rp: 10, gamma: 1.4 }, expected: 0.4820525320768788, tol: 1e-9,
    boundsEdgeClasses: ['thermal->mechanical'] },
  { name: 'stirling-ericsson-regenerative', governingLaw: '理想回热斯特林/埃里克森 = 卡诺', kind: 'ceiling', closedForm: true,
    expr: 'eta = 1 - Tc / Th', vars: { Tc: '冷源温度 K', Th: '热源温度 K' },
    sample: { Tc: 300, Th: 900 }, expected: 0.6666666666666667, tol: 1e-9,
    boundsEdgeClasses: ['thermal->mechanical'] },

  // ===== B. 辐射→功 / 辐射㶲 =====
  { name: 'landsberg-radiation-to-work', governingLaw: '黑体光子气能量-熵关系(兰兹伯格)', kind: 'ceiling', closedForm: true,
    expr: 'eta = 1 - (4/3)*(T0/Ts) + (1/3)*(T0/Ts)^4', vars: { Ts: '辐射源温度 K', T0: '环境温度 K' },
    sample: { Ts: 5778, T0: 298 }, expected: 0.9312357725873527, tol: 1e-9,
    boundsEdgeClasses: ['radiant->mechanical', 'radiant->electric', 'electromagnetic->electric'] },
  { name: 'petela-radiation-exergy', governingLaw: '辐射㶲(佩特拉，同兰兹伯格 代数式)', kind: 'exergy-factor', closedForm: true,
    expr: 'phi = 1 - (4/3)*(T0/T) + (1/3)*(T0/T)^4', vars: { T: '辐射源温度 K', T0: '环境温度 K' },
    sample: { T: 5778, T0: 298 }, expected: 0.9312357725873527, tol: 1e-9,
    boundsEdgeClasses: ['radiant', 'electromagnetic'] },

  // ===== C. Betz 流体动能 =====
  { name: 'betz-coefficient-max', governingLaw: '一维动量盘(致动盘)守恒', kind: 'ceiling', closedForm: true,
    expr: 'Cp_max = 16 / 27', vars: {}, sample: {}, expected: 0.5925925925925926, tol: 1e-9,
    boundsEdgeClasses: ['mechanical->mechanical', 'mechanical->electric'], note: '仅开放无导管流；导管/潮流栅栏上限更高' },
  { name: 'betz-cp-of-induction', governingLaw: 'Cp=4a(1−a)²，a=1/3 极大', kind: 'ceiling', closedForm: true,
    expr: 'Cp = 4 * a * (1 - a) ^ 2', vars: { a: '轴向诱导因子' },
    sample: { a: 0.3333333333333333 }, expected: 0.5925925925925927, tol: 1e-9,
    boundsEdgeClasses: ['mechanical->mechanical'], note: 'a=1/2 时 Cp=0.5(动量理论有效边界)；a=1 平凡根' },

  // ===== D. Landauer / 量子计算极限（地板）=====
  { name: 'landauer-erasure-floor', governingLaw: '兰道尔原理(信息熵↔热力学熵)', kind: 'floor', closedForm: true,
    expr: 'E = k * T * ln(2)', vars: { k: '玻尔兹曼常数 J/K', T: '温度 K' },
    sample: { k: 1.380649e-23, T: 300 }, expected: 2.870978885078724e-21, tol: 1e-9,
    boundsEdgeClasses: ['electric->information'], note: '擦除 1 比特最少排热(地板，非天花板)' },
  { name: 'margolus-levitin-rate', governingLaw: '马戈勒斯–列维京 量子演化速率', kind: 'ceiling', closedForm: true,
    expr: 'nu_max = 2 * E / (pi * hbar)', vars: { E: '能量 J', hbar: '约化普朗克 J·s' },
    sample: { E: 1, hbar: 1.0545718176461565e-34 }, expected: 6.036760718568607e33, tol: 1e27,
    boundsEdgeClasses: ['electric->information'] },
  { name: 'bremermann-mass-bandwidth', governingLaw: '布雷默曼 界 = 马戈勒斯–列维京 × (E=mc²) ÷ 兰道尔', kind: 'ceiling', closedForm: true,
    expr: 'R_max = c^2 / (pi * hbar * ln(2))', vars: { c: '光速 m/s', hbar: '约化普朗克 J·s' },
    sample: { c: 299792458, hbar: 1.0545718176461565e-34 }, expected: 3.913721436640331e50, tol: 1e44,
    boundsEdgeClasses: ['mass->information'], note: '≈3.91e50 bit/(kg·s)' },

  // ===== E. 热电 / 热离子 =====
  { name: 'thermoelectric-zt-efficiency', governingLaw: '卡诺 × ZT 修正(约飞/戈德斯米德)', kind: 'ceiling', closedForm: true,
    expr: 'eta = (1 - Tc/Th) * (sqrt(1 + ZT) - 1) / (sqrt(1 + ZT) + Tc/Th)',
    vars: { ZT: '热电优值', Tc: '冷端 K', Th: '热端 K' },
    sample: { ZT: 1, Th: 600, Tc: 300 }, expected: 0.10819418755438785, tol: 1e-9,
    boundsEdgeClasses: ['thermal->electric'] },
  { name: 'thermionic-carnot-bound', governingLaw: '热离子绝对上界 = 卡诺', kind: 'ceiling', closedForm: true,
    expr: 'eta = 1 - Tc/Th', vars: { Tc: '冷端 K', Th: '热端 K' },
    sample: { Tc: 300, Th: 1500 }, expected: 0.8, tol: 1e-12,
    boundsEdgeClasses: ['thermal->electric'] },

  // ===== F. 电化学（不走卡诺，可合法超同温热机）=====
  { name: 'nernst-reversible-emf', governingLaw: '最大可逆电功 = −ΔG', kind: 'identity', closedForm: true,
    expr: 'E = -dG/(n*F)', vars: { dG: '吉布斯自由能变 J/mol', n: '电子数', F: '法拉第常数 C/mol' },
    sample: { dG: -237000, n: 2, F: 96485 }, expected: 1.2281701818935586, tol: 1e-3,
    boundsEdgeClasses: ['chemical->electric'] },
  { name: 'fuelcell-max-efficiency', governingLaw: '燃料电池热力学上限 ΔG/ΔH', kind: 'ceiling', closedForm: true,
    expr: 'eta = dG/dH', vars: { dG: '吉布斯自由能变', dH: '反应焓变' },
    sample: { dG: -237000, dH: -286000 }, expected: 0.8286713286713288, tol: 2e-3,
    boundsEdgeClasses: ['chemical->electric'] },
  { name: 'fuelcell-max-efficiency-temperature', governingLaw: 'η_max = 1 − TΔS/ΔH', kind: 'ceiling', closedForm: true,
    expr: 'eta = (dH - T*dS)/dH', vars: { dH: '反应焓变 J/mol', dS: '熵变 J/mol/K', T: '温度 K' },
    sample: { dH: -285800, dS: -163.3, T: 298.15 }, expected: 0.8296434744576627, tol: 2e-3,
    boundsEdgeClasses: ['chemical->electric'] },
  { name: 'electrolysis-thermoneutral-voltage', governingLaw: '热中性电压 E_tn = ΔH/(nF)', kind: 'identity', closedForm: true,
    expr: 'E_tn = dH/(n*F)', vars: { dH: '反应焓变 J/mol', n: '电子数', F: '法拉第常数' },
    sample: { dH: 285800, n: 2, F: 96485 }, expected: 1.481059232004975, tol: 1e-3,
    boundsEdgeClasses: ['electric->chemical'] },
  { name: 'chemical-gibbs-exergy-factor', governingLaw: '化学㶲 ≈ |ΔG|/|ΔH|', kind: 'exergy-factor', closedForm: true,
    expr: 'phi = abs(dG)/abs(dH)', vars: { dG: '吉布斯自由能变', dH: '反应焓变' },
    sample: { dG: -237100, dH: -285800 }, expected: 0.8296, tol: 1e-3,
    boundsEdgeClasses: ['chemical'] },

  // ===== G. 工作品位 / 统一第二定律界 =====
  { name: 'work-grade-exergy-factor', governingLaw: '有序功能量 = 纯㶲', kind: 'exergy-factor', closedForm: true,
    expr: 'phi = 1', vars: {}, sample: {}, expected: 1, tol: 1e-12,
    boundsEdgeClasses: ['electric', 'mechanical', 'acoustic', 'nuclear', 'mass', 'gravitational'] },
  { name: 'thermal-carnot-exergy-factor', governingLaw: '热㶲 = 卡诺因子', kind: 'exergy-factor', closedForm: true,
    expr: 'phi = 1 - T0/T', vars: { T: '热源温度 K', T0: '环境温度 K' },
    sample: { T: 500, T0: 298.15 }, expected: 0.4037, tol: 1e-3, boundsEdgeClasses: ['thermal'] },
  { name: 'radiant-petela-landsberg-efficiency', governingLaw: '辐射㶲(佩特拉/兰兹伯格)', kind: 'exergy-factor', closedForm: true,
    expr: 'psi = 1 - (4/3)*(T0/T) + (1/3)*(T0/T)^4', vars: { T: '源温度 K', T0: '环境温度 K' },
    sample: { T: 5778, T0: 298.15 }, expected: 0.9312, tol: 1e-3, boundsEdgeClasses: ['radiant', 'electromagnetic'] },
  { name: 'unified-second-law-eta-bound', governingLaw: '统一界 ε=η·φ_to/φ_from ≤ 1', kind: 'ceiling', closedForm: true,
    expr: 'eta_max = phi_from / phi_to', vars: { phi_from: '源㶲因子', phi_to: '目标㶲因子' },
    sample: { phi_from: 0.5, phi_to: 1 }, expected: 0.5, tol: 1e-12,
    boundsEdgeClasses: ['*'], note: '降级边(φ_to<φ_from)调用侧 clamp 到 1' },
  { name: 'carnot-as-unified-special-case', governingLaw: '卡诺是统一界特例', kind: 'ceiling', closedForm: true,
    expr: 'eta_max = 1 - T0 / Th', vars: { T0: '环境温度 K', Th: '热源温度 K' },
    sample: { T0: 298.15, Th: 800 }, expected: 0.6273125, tol: 1e-9, boundsEdgeClasses: ['thermal->electric', 'thermal->mechanical'] },
  { name: 'exergy-efficiency-per-edge', governingLaw: '边㶲效率 ε=η·φ_to/φ_from', kind: 'identity', closedForm: true,
    expr: 'eps = eta * phi_to / phi_from', vars: { eta: '能量效率', phi_to: '目标㶲因子', phi_from: '源㶲因子' },
    sample: { eta: 0.4, phi_to: 1, phi_from: 0.5 }, expected: 0.8, tol: 1e-12, boundsEdgeClasses: ['*'] },
  { name: 'gouy-stodola-destroyed-exergy', governingLaw: '古伊–斯托多拉 损㶲 = T0·σ_gen', kind: 'identity', closedForm: true,
    expr: 'exergy_destroyed = T0 * sigma_gen', vars: { T0: '环境温度 K', sigma_gen: '熵产 W/K' },
    sample: { T0: 298.15, sigma_gen: 10 }, expected: 2981.5, tol: 1e-9, boundsEdgeClasses: ['*'] },
  { name: 'path-exergy-telescope', governingLaw: '路径㶲望远镜 ∏ε=(∏η)φ_end/φ_start', kind: 'identity', closedForm: true,
    expr: 'eps_path = eta_prod * phi_end / phi_start', vars: { eta_prod: '∏η', phi_end: '终态㶲因子', phi_start: '初态㶲因子' },
    sample: { eta_prod: 0.27, phi_end: 1, phi_start: 1 }, expected: 0.27, tol: 1e-12, boundsEdgeClasses: ['*'] },
  { name: 'carnot-cop-exergy-port', governingLaw: '搬运型性能系数卡诺上界 Th/(Th−Tc)', kind: 'ceiling', closedForm: true,
    expr: 'COP_max = Th / (Th - Tc)', vars: { Th: '高温 K', Tc: '低温 K' },
    sample: { Th: 318.15, Tc: 298.15 }, expected: 15.9075, tol: 1e-4, boundsEdgeClasses: ['transport'] },

  // ===== H. 光化学 / 量子能量学 =====
  { name: 'single-photon-energy', governingLaw: '普朗克–爱因斯坦 E=hf=hc/λ', kind: 'identity', closedForm: true,
    expr: 'E_photon = h * c / lambda', vars: { h: '普朗克 J·s', c: '光速 m/s', lambda: '波长 m' },
    sample: { h: 6.62607015e-34, c: 299792458, lambda: 5e-7 }, expected: 3.972891714297857e-19, tol: 1e-6,
    boundsEdgeClasses: ['electromagnetic->chemical', 'radiant->chemical'] },
  { name: 'quantum-yield-energy-efficiency', governingLaw: '能量效率 = 量子产率 × 斯托克斯比', kind: 'ceiling', closedForm: true,
    expr: 'eta_emit = PLQY * lambda_abs / lambda_em', vars: { PLQY: '光子量子产率', lambda_abs: '吸收波长 m', lambda_em: '发射波长 m' },
    sample: { PLQY: 0.9, lambda_abs: 4.5e-7, lambda_em: 5e-7 }, expected: 0.81, tol: 1e-9,
    boundsEdgeClasses: ['electromagnetic->radiant', 'radiant->electromagnetic'] },
  { name: 'triplet-sensitization-storage', governingLaw: '三线态存储 η = Φ_T·E_T1/E_photon', kind: 'ceiling', closedForm: true,
    expr: 'eta_store = Phi_T * E_T1 / E_photon', vars: { Phi_T: '三线态量子产率', E_T1: 'T1 能量 eV', E_photon: '光子能量 eV' },
    sample: { Phi_T: 0.7, E_T1: 1.5, E_photon: 2.48 }, expected: 0.4233870967741935, tol: 1e-9,
    boundsEdgeClasses: ['electromagnetic->chemical'] },
  { name: 'photosynthesis-first-principles-ceiling', governingLaw: '可用光子能量份额×量子需求(固碳前)', kind: 'ceiling', closedForm: true,
    expr: 'eta = f_PAR * f_abs * (E_glucose_per_CO2 / (n_photon * E_photon_mol))',
    vars: { f_PAR: 'PAR 占全谱份额', f_abs: '吸收份额', E_glucose_per_CO2: '每固定 CO2 储能 kJ', n_photon: '每 CO2 光子需求', E_photon_mol: '每摩尔光子能量 kJ' },
    sample: { f_PAR: 0.487, f_abs: 0.8, E_glucose_per_CO2: 478.6667, n_photon: 8, E_photon_mol: 175.92142 },
    expected: 0.1325084, tol: 1e-4,
    boundsEdgeClasses: ['electromagnetic->chemical', 'radiant->chemical'], note: '≈13.25% 固碳前/不含呼吸；教科书 ~4.6%(C3)/6%(C4) 是再扣光呼吸/暗呼吸后' },
]

// ===== 集成用纯函数（复用 expr，保证与目录/测试一致）=====
export const carnotEfficiency = (Tc: number, Th: number) => evalExpr('1 - Tc/Th', { Tc, Th })
export const curzonAhlborn = (Tc: number, Th: number) => evalExpr('1 - sqrt(Tc/Th)', { Tc, Th })
export const thermoelectricEfficiency = (ZT: number, Tc: number, Th: number) =>
  evalExpr('(1 - Tc/Th) * (sqrt(1+ZT) - 1) / (sqrt(1+ZT) + Tc/Th)', { ZT, Tc, Th })
/** 热㶲因子 φ=1−T0/T（T≤T0 取 0）。 */
export const thermalCarnotExergy = (T: number, T0: number) =>
  T > T0 ? evalExpr('1 - T0/T', { T, T0 }) : 0
/** 辐射㶲因子 佩特拉/兰兹伯格 ψ。 */
export const petelaExergy = (T: number, T0: number) =>
  T > T0 ? Math.max(0, evalExpr('1 - (4/3)*(T0/T) + (1/3)*(T0/T)^4', { T, T0 })) : 0
/** Landauer 擦除能量地板 kT ln2。 */
export const landauerFloor = (k: number, T: number) => evalExpr('k * T * ln(2)', { k, T })
/** 统一第二定律 η 上界（含降级 clamp 到 1）。 */
export const unifiedEtaBound = (phiFrom: number, phiTo: number) =>
  phiTo > 0 ? Math.min(1, phiFrom / phiTo) : 1
export const BETZ_MAX = 16 / 27

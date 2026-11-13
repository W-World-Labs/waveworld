import { isEnergyNode, type EnergyNode } from './types'
import { ELECTROMAGNETIC } from '../spectrum'
import subforms from './nodes.subforms.json'
import { NODE_NAME_EN } from './nodes.nameEn'
import { NODE_DESC_EN } from './nodes.descEn'

function withLocaleFields(n: EnergyNode): EnergyNode {
  const nameEn = n.nameEn ?? NODE_NAME_EN[n.id]
  const descEn = n.descEn ?? NODE_DESC_EN[n.id]
  let out = n
  if (nameEn) out = { ...out, nameEn }
  if (descEn) out = { ...out, descEn }
  return out
}

// 顶层 10 + 电磁/电子形态（手写样板）；8 大类子形态由研究工作流产出，见 nodes.subforms.json。
const BASE_NODES: EnergyNode[] = [
  // ===== 顶层 =====
  {
    id: 'electromagnetic', name: '电磁能', symbol: 'E_em', icon: '📡', color: '#748ffc',
    desc: '电场与磁场耦合振荡携带的能量，横跨 19 个数量级频率。',
    quantities: [
      { symbol: 'f', unit: 'Hz', min: 3, max: 3e22, log: true, note: '无线电→伽马' },
      { symbol: 'λ', unit: 'm', min: 1e-14, max: 1e8, log: true },
      { symbol: 'E_photon', unit: 'J', note: '单光子能量 E=hf' },
    ],
    spectrum: ELECTROMAGNETIC.bands,
    consensus: { status: 'established' },
    refs: ['https://en.wikipedia.org/wiki/Electromagnetic_spectrum'],
  },
  {
    id: 'electric', name: '电能', symbol: 'E_e', icon: '⚡', color: '#ffd43b',
    desc: '电荷在电场中的能量，及电流做功的能力。',
    quantities: [
      { symbol: 'u_E', unit: 'J/m^3', note: '电场能密度 u=½εE²' },
      { symbol: 'P', unit: 'W', note: '电功率 P=UI' },
    ],
    consensus: {
      status: 'convention',
      summary: '电路能量储存/流动的位置存在经典争议（坡印廷矢量）。',
      summaryEn:
        'Classic dispute over where circuit energy is stored/flows (Poynting vector).',
      viewpoints: [
        {
          stance:
            '能量经电池外的电磁场（真空/绝缘层）从源流向负载，不走导线内部；无损直流导体内通量为零。',
          stanceEn:
            'Energy flows from source to load through the EM field outside the battery (vacuum/insulation), not inside the wires; ideal DC conductors carry zero Poynting flux.',
          proponents: ['坡印廷', 'Morris & Styer (2012)'],
          source: 'AJP 80(6):552 (2012)',
        },
        {
          stance:
            '能流位置非唯一：给坡印廷矢量加无散度项可搬动表观能流而不改变总能量；存在把能流放进导体内的替代式。',
          stanceEn:
            'Energy-flow location is non-unique: adding a divergence-free term to the Poynting vector relocates apparent flow without changing total energy; alternatives put flow inside conductors.',
          proponents: ['亥维赛 (1892)', '斯莱皮安', 'Moree & Leijon (2022)'],
          source: 'AIP Advances 12,085219 (2022)',
        },
      ],
    },
  },
  { id: 'mechanical', name: '机械能', symbol: 'E_mech', icon: '⚙️', color: '#69db7c', desc: '动能与势能的总和。', quantities: [{ symbol: 'E_k', unit: 'J', note: '½mv²' }], consensus: { status: 'established' } },
  { id: 'thermal', name: '热能', symbol: 'E_th', icon: '🌡️', color: '#ff8787', desc: '微观粒子无规运动的内能。',
    quantities: [
      { symbol: 'U', unit: 'J', note: '内能（第一定律的"量"）' },
      { symbol: 'T', unit: 'K', min: 300, max: 1800, note: '绝对温度决定㶲品位：可用功因子 φ=1−T₀/T（T₀≈298K）。室温废热 φ→0、燃烧高温 φ→~0.85——故热能是低品位能量，不能与电能等量齐观' },
    ],
    consensus: {
      status: 'convention',
      confidence: 'medium',
      summary: 'heat/internal energy/thermal energy 定义常被混用；heat 是传递中的能量而非储存形式。',
      summaryEn:
        '“Heat”, internal energy, and thermal energy are often conflated; heat is energy in transfer, not a stored form.',
      viewpoints: [
        {
          stance: 'heat 指传递中的能量，不应作为储存形式。',
          stanceEn: 'Heat means energy in transfer and should not be treated as a stored form.',
          source: 'https://en.wikipedia.org/wiki/Thermal_energy',
        },
      ],
    },
  },
  { id: 'chemical', name: '化学能', symbol: 'E_chem', icon: '🧪', color: '#da77f2', desc: '化学键中储存的能量。',
    quantities: [
      { symbol: 'ΔH', unit: 'J/mol', note: '反应焓（总热效应/第一定律的"量"）' },
      { symbol: 'ΔG', unit: 'J/mol', note: '吉布斯自由能=最大可逆非体积功；化学㶲≈|ΔG| 而非 ΔH，决定自发性、平衡与做功能力' },
    ],
    consensus: { status: 'established' } },
  { id: 'nuclear', name: '核能', symbol: 'E_nuc', icon: '☢️', color: '#f783ac', desc: '原子核结合能的释放。', quantities: [{ symbol: 'E_b', unit: 'J', note: '结合能' }], consensus: { status: 'established' } },
  { id: 'acoustic', name: '声能/机械波', symbol: 'E_ac', icon: '🔊', color: '#3bc9db', desc: '介质中压缩稀疏传递的机械波能量。', quantities: [{ symbol: 'f', unit: 'Hz', min: 1, max: 1e9, log: true }], consensus: { status: 'established' } },
  { id: 'radiant', parent: 'electromagnetic', name: '辐射能', symbol: 'E_rad', icon: '☀️', color: '#ffa94d', desc: '电磁辐射携带的能量（电磁能的子形态：按"辐射"语义聚合，消除与 electromagnetic 的重复建模）。',
    quantities: [{ symbol: 'I', unit: 'W/m^2', note: '辐照度' }],
    consensus: {
      status: 'convention',
      confidence: 'medium',
      summary: '辐射能/光能/电磁能高度重叠，是否单列属约定。',
      summaryEn:
        'Radiant / light / electromagnetic energy heavily overlap; listing radiant separately is a convention.',
    },
  },
  { id: 'gravitational', name: '引力能', symbol: 'E_g', icon: '🌍', color: '#a5d8ff', desc: '引力场中的势能与引力波能量。',
    quantities: [{ symbol: 'U_g', unit: 'J', note: '引力势能 -GMm/r' }],
    consensus: {
      status: 'open',
      summary: '引力场能量不可定域化；膨胀宇宙中全局守恒有争议。',
      summaryEn:
        'Gravitational-field energy cannot be localized; global conservation in an expanding universe is contested.',
      viewpoints: [
        {
          stance:
            '自然条件下可证不存在引力应力-能量张量，引力能必然非局部、无局部密度；只有赝张量或准局部/渐近定义。',
          stanceEn:
            'Under natural conditions no gravitational stress–energy tensor exists; gravitational energy is non-local with no local density—only pseudotensors or quasi-local/asymptotic definitions.',
          proponents: ['Curiel (2019)', 'Einstein', 'Landau-Lifshitz', 'Penrose', 'ADM/Bondi'],
          source: 'arXiv:1808.08998',
        },
        {
          stance:
            '膨胀破坏时间平移对称性(Noether)，光子红移、暗能量密度恒定，全局能量守恒微妙/不成立；"用 SR 投影恢复守恒"的修复被否决。',
          stanceEn:
            'Expansion breaks time-translation symmetry (Noether); photon redshift and constant dark-energy density make global energy conservation subtle/invalid; “recover conservation via SR projection” fixes are rejected.',
          proponents: ['Carroll'],
          source: 'arXiv:physics/0511178 (反方，已否决)',
        },
      ],
    },
  },
  { id: 'mass', name: '质能', symbol: 'E_0', icon: '⚛️', color: '#b197fc', desc: '静止质量等价的能量 E=mc²，及真空能。',
    quantities: [{ symbol: 'E_0', unit: 'J', note: 'mc²' }],
    consensus: {
      status: 'open',
      confidence: 'medium',
      summary: '真空能/零点能是否实在未解（宇宙学常数问题）。',
      summaryEn:
        'Whether vacuum/zero-point energy is “real” remains open (cosmological constant problem).',
      viewpoints: [
        {
          stance:
            '卡西米尔力可不借助真空/零点能算出（电荷电流间相对论量子力，α→0 消失），不构成真空能实在的证据。',
          stanceEn:
            'Casimir forces can be computed without vacuum/ZPE (relativistic quantum forces between charges/currents; vanish as α→0)—not evidence that vacuum energy is ontologically real.',
          proponents: ['Jaffe (2005)'],
          source: 'Phys Rev D 72,021301 (2005)',
        },
      ],
    },
  },

  // ===== electromagnetic 子形态（7 频段）=====
  { id: 'em-radio', parent: 'electromagnetic', name: '无线电波', color: '#ff6b6b', desc: '波长最长、能量最低，可远距离传播。', quantities: [{ symbol: 'f', unit: 'Hz', max: 3e8, log: true }], consensus: { status: 'established' } },
  { id: 'em-micro', parent: 'electromagnetic', name: '微波', color: '#ffa94d', desc: '方向性强，可被水分子吸收生热。', quantities: [{ symbol: 'f', unit: 'Hz', min: 3e8, max: 3e11, log: true }], consensus: { status: 'established' } },
  { id: 'em-ir', parent: 'electromagnetic', name: '红外线', color: '#ffd43b', desc: '热辐射主要波段。', quantities: [{ symbol: 'f', unit: 'Hz', min: 3e11, max: 4.3e14, log: true }], consensus: { status: 'established' } },
  { id: 'em-visible', parent: 'electromagnetic', name: '可见光', color: '#69db7c', desc: '人眼可感知的极窄窗口。', quantities: [{ symbol: 'λ', unit: 'm', min: 4e-7, max: 7e-7 }], consensus: { status: 'established' } },
  { id: 'em-uv', parent: 'electromagnetic', name: '紫外线', color: '#4dabf7', desc: '能量足以破坏化学键。', quantities: [{ symbol: 'f', unit: 'Hz', min: 7.5e14, max: 3e16, log: true }], consensus: { status: 'established' } },
  { id: 'em-xray', parent: 'electromagnetic', name: 'X 射线', color: '#748ffc', desc: '强穿透力。', quantities: [{ symbol: 'f', unit: 'Hz', min: 3e16, max: 3e19, log: true }], consensus: { status: 'established' } },
  { id: 'em-gamma', parent: 'electromagnetic', name: '伽马射线', color: '#da77f2', desc: '能量最高，来自核反应与宇宙极端事件。', quantities: [{ symbol: 'f', unit: 'Hz', min: 3e19, log: true }], consensus: { status: 'established' } },

  // ===== electric 子形态 =====
  { id: 'el-static', parent: 'electric', name: '静电能', desc: '静止电荷在电场中的势能。', quantities: [{ symbol: 'W', unit: 'J', note: '½QV' }], consensus: { status: 'established' } },
  { id: 'el-current', parent: 'electric', name: '电流电能', desc: '运动电荷做功的能力。', quantities: [{ symbol: 'P', unit: 'W', note: 'UI' }], consensus: { status: 'established' } },
  { id: 'el-field', parent: 'electric', name: '电场能', desc: '储存在电场中的能量。', quantities: [{ symbol: 'u_E', unit: 'J/m^3', note: '½εE²' }], consensus: { status: 'established' } },

  // ===== chemical 子形态（前沿现象/通路：三线态枢纽 + 活性氧）=====
  { id: 'chemical-excited-triplet', parent: 'chemical', name: '三线态激发态', symbol: 'T₁',
    desc: '敏化剂分子的亚稳电子激发态（自旋三重态）。光（光动力治疗）与超声（声动力治疗）都能把敏化剂抬到此态，'
        + '它再把能量/电子交给基态三重态氧 ³O₂ 生成 活性氧——是 光动力治疗/声动力治疗 共享的汇聚枢纽。',
    quantities: [
      { symbol: 'ΔE_T', unit: 'eV', min: 0.98, max: 1.6, note: 'T₁–S₀ 能隙；须 >0.98 eV 才能能量转移给 ³O₂ 生成 ¹O₂（有效敏化剂如卟啉/二氢卟吩 E_T≈1.4–1.6 eV）' },
      { symbol: 'τ_T', unit: 's', min: 1e-6, max: 1e-3, log: true, note: '三线态寿命（µs–ms）' },
      { symbol: 'Φ_T', unit: '1', min: 0.2, max: 0.9, note: '三线态量子产率' },
    ],
    consensus: { status: 'established' } },

  { id: 'chemical-ros', parent: 'chemical', name: '活性氧', symbol: '活性氧',
    desc: '反应性氧物种：单线态氧 ¹O₂（II型 能量转移）、超氧 O₂·⁻、羟基 ·OH（I型 电子/氢转移）、'
        + 'H₂O₂。寿命极短（¹O₂ 在细胞内 ~µs），故作用高度局域。光动力/声动力/声化学的共同终产物。',
    quantities: [
      { symbol: 'Φ_Δ', unit: '1', min: 0.1, max: 0.8, note: '单线态氧量子产率' },
      { symbol: 'τ_Δ', unit: 's', min: 1e-7, max: 1e-5, log: true, note: '¹O₂ 寿命（细胞内 ~µs）' },
    ],
    consensus: { status: 'established' } },
]

// 子形态 JSON 加载时 isEnergyNode 结构校验——坏数据直接 throw（对拍护栏）。
const SUBFORMS: EnergyNode[] = (subforms as unknown[]).map((n, i) => {
  if (!isEnergyNode(n)) {
    const id = n && typeof n === 'object' && 'id' in n ? String((n as { id: unknown }).id) : '?'
    throw new Error(`nodes.subforms.json[${i}] id=${id}: invalid EnergyNode`)
  }
  return withLocaleFields(n)
})

export const NODES: EnergyNode[] = [...BASE_NODES, ...SUBFORMS].map(withLocaleFields)

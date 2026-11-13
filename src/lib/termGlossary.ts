/**
 * 术语字典（KUX 靶 D）：全文统一人话，避免各页自造 title。
 * 仅展示层；不改物理计算。
 * label/plainZh/detail 为中文主字段；*En 为 i18n 英文，不覆盖中文。
 */

export type TermId =
  | 'exergy'
  | 'phi'
  | 'eta'
  | 'cop'
  | 'transport'
  | 'conversion'
  | 'pue'
  | 'first-law'
  | 'second-law'
  | 'carnot-limit'
  | 'energy-ledger'
  | 'robust-mean'
  | 'cfl'
  | 'zt'
  | 'snr'
  | 'fill-factor'
  | 'quantum-yield'
  | 'wall-plug'
  | 'cfl-stability'

export interface TermDef {
  id: TermId
  /** 界面短标签（中文） */
  label: string
  labelEn?: string
  /** 一句人话（主解释，中文） */
  plainZh: string
  plainEn?: string
  /** 可选更长补充（中文） */
  detail?: string
  detailEn?: string
}

/** 单一真相源：Paths / AiChain / Matrix 等共用。 */
export const TERM_GLOSSARY: Readonly<Record<TermId, TermDef>> = {
  exergy: {
    id: 'exergy',
    label: '可用功(㶲)',
    labelEn: 'Exergy',
    plainZh: '能量里真正能拿来做有用功的那部分；焦耳相同，品位不同，能做的事差很多。',
    plainEn:
      'The part of energy that can still do useful work; same joules, different grade, very different capability.',
    detail: '电能/机械能几乎全是㶲；室温废热几乎没有㶲。',
    detailEn: 'Electricity/mechanical energy is nearly all exergy; room-temperature waste heat has almost none.',
  },
  phi: {
    id: 'phi',
    label: '品位 φ',
    labelEn: 'Grade φ',
    plainZh: '「一焦耳里有多少是可用功」的因子，约 0～1。φ≈1 为高品位，φ→0 为低品位废热。',
    plainEn:
      'Share of a joule that is useful work, ~0–1. φ≈1 is high grade; φ→0 is low-grade waste heat.',
    detail: '热能常用 φ≈1−T₀/T（T₀ 环境温度）。',
    detailEn: 'For heat, often φ≈1−T₀/T (T₀ ambient).',
  },
  eta: {
    id: 'eta',
    label: '效率 η',
    labelEn: 'Efficiency η',
    plainZh: '有用输出能量 ÷ 输入能量，真实转换时 ≤100%（第一定律）。',
    plainEn: 'Useful output energy ÷ input energy; real conversion ≤100% (first law).',
  },
  cop: {
    id: 'cop',
    label: '性能系数',
    labelEn: 'COP',
    plainZh: '性能系数（COP）：搬运的热量（或冷量）÷ 耗电。可以大于 1，因为在搬环境里的热，不是凭空造能。',
    plainEn:
      'Coefficient of performance: heat (or cooling) moved ÷ electrical work. Can exceed 1 because it moves ambient heat, not creating energy from nothing.',
    detail: '在「转换效率链」里，这类跳按 100% 封顶计，避免性能系数被当成 η 连乘。',
    detailEn: 'In conversion-η chains, these hops are capped at 100% so COP is not multiplied as if it were η.',
  },
  transport: {
    id: 'transport',
    label: '搬运/能效型',
    labelEn: 'Transport / COP-type',
    plainZh: '热泵、制冷机等：主要在搬运环境能量，用 COP 衡量，不是单纯的 η 转换。',
    plainEn: 'Heat pumps, chillers, etc.: mainly move ambient energy; measured by COP, not plain η conversion.',
  },
  conversion: {
    id: 'conversion',
    label: '能量转换',
    labelEn: 'Energy conversion',
    plainZh: '一种形式真正变成另一种（如光→电）；效率 η 通常 ≤1。',
    plainEn: 'One form truly becomes another (e.g. light→electric); η is usually ≤1.',
  },
  pue: {
    id: 'pue',
    label: '电能利用效率',
    labelEn: 'PUE',
    plainZh: '数据中心电能利用效率（PUE）：总用电 ÷ IT 设备用电。1.0 为理想；越高说明制冷/配电浪费越多。',
    plainEn:
      'Power usage effectiveness: facility power ÷ IT power. 1.0 is ideal; higher means more cooling/distribution waste.',
  },
  'first-law': {
    id: 'first-law',
    label: '第一定律',
    labelEn: 'First law',
    plainZh: '能量守恒：投入 = 有用产物 + 损耗（常变为热）。',
    plainEn: 'Energy conservation: input = useful product + losses (often heat).',
  },
  'second-law': {
    id: 'second-law',
    label: '第二定律',
    labelEn: 'Second law',
    plainZh: '可用功只会减少或不变；「能量还在」不等于「还能做多少功」。',
    plainEn: 'Useful work only falls or stays; “energy is still there” ≠ “how much work remains.”',
  },
  'carnot-limit': {
    id: 'carnot-limit',
    label: '卡诺/理论上限',
    labelEn: 'Carnot / theoretical limit',
    plainZh: '由基本定律算出的效率天花板（如卡诺 η=1−Tc/Th），不是产品手册查表。',
    plainEn:
      'Efficiency ceiling from fundamental law (e.g. Carnot η=1−Tc/Th)—not a product datasheet lookup.',
    detail: '真实机器只能逼近、不能超过；冷热源温差越大，上限越高。',
    detailEn: 'Real machines only approach, never exceed; larger hot–cold ΔT raises the ceiling.',
  },
  'energy-ledger': {
    id: 'energy-ledger',
    label: '能量账',
    labelEn: 'Energy ledger',
    plainZh: '假设投入 100 份能量，沿路径看每跳还剩多少、最后产物与变热损耗各多少。',
    plainEn:
      'Assume 100 units in; along the path see what remains each hop, and how much ends as product vs heat loss.',
  },
  'robust-mean': {
    id: 'robust-mean',
    label: '稳健均值',
    labelEn: 'Robust mean',
    plainZh: '在效率区间内随机抽样多次后的平均累积效率，反映「不那么乐观」时的表现。',
    plainEn:
      'Mean cumulative η after sampling the efficiency range many times—performance when not always optimistic.',
  },
  cfl: {
    id: 'cfl',
    label: '库朗条件',
    labelEn: 'CFL condition',
    plainZh: '时间步与网格间距必须匹配的稳定性条件；步长太大，波动/电磁仿真会数值爆炸。',
    plainEn:
      'Stability condition matching time step to grid spacing; too large a step and wave/EM sims blow up numerically.',
    detail: '库朗–弗里德里希斯–列维（CFL）：信息一步不能跨过太多格子。',
    detailEn: 'Courant–Friedrichs–Lewy (CFL): information must not jump too many cells per step.',
  },
  'cfl-stability': {
    id: 'cfl-stability',
    label: '库朗稳定性',
    labelEn: 'CFL stability',
    plainZh: '时间步与网格间距必须匹配；步长太大，波动/电磁仿真会数值爆炸。',
    plainEn:
      'Time step must match grid spacing; too large a step and wave/EM sims explode numerically.',
    detail: '与「库朗条件」同义，仿真页控件旁可用。',
    detailEn: 'Synonym of “CFL condition”; use near sim controls.',
  },
  zt: {
    id: 'zt',
    label: '热电优值',
    labelEn: 'Figure of merit ZT',
    plainZh: '热电材料好不好的无量纲指标：塞贝克系数、电导与导热的折中；热电优值越高，温差发电/制冷越有戏。',
    plainEn:
      'Dimensionless quality of TE materials: tradeoff of Seebeck, conductivity, and thermal conductivity; higher ZT helps generation/cooling.',
    detail: 'ZT=α²σT/κ。室温商用材料多在 1 附近；更高热电优值是研究目标。',
    detailEn: 'ZT=α²σT/κ. Room-temp commercial materials often near 1; higher ZT is a research goal.',
  },
  snr: {
    id: 'snr',
    label: '信噪比',
    labelEn: 'SNR',
    plainZh: '有用信号功率相对噪声有多强；越高，通信越稳、传感越准。',
    plainEn: 'Useful signal power vs noise; higher means stabler links and sharper sensing.',
    detail: '常写 dB：10 log10(Ps/Pn)。链路容量与误码都跟它有关。',
    detailEn: 'Often in dB: 10 log10(Ps/Pn). Capacity and BER both depend on it.',
  },
  'fill-factor': {
    id: 'fill-factor',
    label: '填充因子',
    labelEn: 'Fill factor',
    plainZh: '太阳能电池 I–V 曲线「矩形度」：最大功率点相对开路电压×短路电流的比例，越接近 1 越好。',
    plainEn:
      '“Rectangularity” of a solar-cell I–V curve: Pmax relative to Voc×Isc; closer to 1 is better.',
    detail: '与短路电流、开路电压一起决定光伏总效率。',
    detailEn: 'Together with Isc and Voc it sets overall PV efficiency.',
  },
  'quantum-yield': {
    id: 'quantum-yield',
    label: '量子产率',
    labelEn: 'Quantum yield',
    plainZh: '平均每个被吸收的光子引发多少次目标事件（发光、反应、载流子）；≤1 时表示有损耗通道。',
    plainEn:
      'Average target events (light, reaction, carriers) per absorbed photon; ≤1 means loss channels exist.',
    detail: '光化学、荧光、光动力里常见：产率高≠能量效率一定高。',
    detailEn: 'Common in photochemistry/fluorescence/PDT: high yield ≠ high energy efficiency.',
  },
  'wall-plug': {
    id: 'wall-plug',
    label: '壁塞效率',
    labelEn: 'Wall-plug efficiency',
    plainZh: '插座电功率最终有多少变成有用光/输出；激光器、LED 常用，计入驱动与热损耗。',
    plainEn:
      'Share of socket electrical power that becomes useful light/output; common for lasers/LEDs, includes drive and heat loss.',
    detail: '比「芯片内量子效率」更贴近用户账单上的电。',
    detailEn: 'Closer to the user’s electricity bill than on-chip quantum efficiency alone.',
  },
}

export function getTerm(id: TermId): TermDef {
  return TERM_GLOSSARY[id]
}

export function termTitle(id: TermId, locale: 'zh' | 'en' = 'zh'): string {
  const t = TERM_GLOSSARY[id]
  if (locale === 'en') {
    const plain = t.plainEn ?? t.plainZh
    const detail = t.detailEn ?? t.detail
    return detail ? `${plain} ${detail}` : plain
  }
  return t.detail ? `${t.plainZh} ${t.detail}` : t.plainZh
}

/**
 * 仿真/知识页路径 → 本页值得先懂的术语（KUX 靶 D 挂接）。
 * 未知 path 返回通用效率词，避免空条。
 */
export function termIdsForSimPath(path: string): readonly TermId[] {
  const p = path.replace(/^\//, '').split('/')[0] ?? ''
  switch (p) {
    case 'fdtd':
    case 'emwave3d':
    case 'ripple':
    case 'optics-lab':
      return ['cfl', 'eta', 'energy-ledger']
    case 'md':
    case 'particles':
    case 'ising':
      return ['eta', 'first-law']
    case 'fluid':
    case 'windtunnel':
      // CFD teaching/eng — numerical stability, not Carnot efficiency chain
      return ['cfl', 'cfl-stability']
    case 'convection':
    case 'sim':
    case 'heaterfc':
      return ['eta', 'first-law']
    case 'rlc':
    case 'faraday':
    case 'mutual':
    case 'transient':
    case 'smith':
      return ['eta', 'energy-ledger', 'first-law']
    case 'ai-chain':
      return ['pue', 'eta', 'energy-ledger', 'wall-plug']
    case 'paths':
    case 'matrix':
    case 'graph':
    case 'converter':
    case 'transducers':
    case 'sensing':
    case 'node-budget':
    case 'apps':
      return ['eta', 'cop', 'exergy', 'phi', 'carnot-limit', 'transport']
    case 'world':
    case 'taxonomy':
    case 'methods':
    case 'phenomena':
    case 'controversies':
    case 'article':
      return ['eta', 'exergy', 'conversion', 'second-law']
    case 'display':
    case 'laser':
      return ['wall-plug', 'quantum-yield', 'eta', 'fill-factor']
    case 'electromagnetic':
    case 'sound':
    case 'vibration':
      return ['snr', 'eta', 'energy-ledger']
    case 'radar':
    case 'antennas':
    case 'antennapattern':
    case 'antenna3d':
    case 'phasedarray':
    case 'nljd':
    case 'localization':
    case 'tdoa':
      return ['snr', 'eta']
    case 'ultrasound':
    case 'ecg':
    case 'eeg':
    case 'emg':
    case 'neuron':
    case 'biopipeline':
      return ['snr', 'eta']
    case 'stm':
    case 'afm':
      return ['snr', 'eta', 'quantum-yield']
    default:
      return ['eta', 'exergy']
  }
}

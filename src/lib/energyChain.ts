// 能量 → Token 全链路计算。
// 纯函数，移植自旧版 server.py 的 _compute_chain，浏览器端实时计算。

export interface PowerSource {
  name: string
  nameEn?: string
  gen_eff: number // 发电效率
  carbon: number // g CO2 / kWh
  cost_cn: number // ¥ / kWh 参考电价
}

export interface GpuSpec {
  name: string
  nameEn?: string
  tdp_w: number
  tps: number // tokens / s
}

export interface ModelQuality {
  name: string
  nameEn?: string
  quality: number // 有效解题能力系数
}

export const POWER_SOURCES: Record<string, PowerSource> = {
  nuclear: {
    name: '核电站（压水堆）',
    nameEn: 'Nuclear plant (PWR)',
    gen_eff: 0.36,
    carbon: 12,
    cost_cn: 0.35,
  },
  'gas-combined': {
    name: '天然气联合循环',
    nameEn: 'Natural-gas combined cycle',
    gen_eff: 0.6,
    carbon: 350,
    cost_cn: 0.55,
  },
  coal: {
    name: '超超临界煤电',
    nameEn: 'Ultra-supercritical coal',
    gen_eff: 0.4,
    carbon: 820,
    cost_cn: 0.4,
  },
  solar: { name: '光伏电站', nameEn: 'Solar PV plant', gen_eff: 0.22, carbon: 40, cost_cn: 0.3 },
  wind: { name: '风力发电', nameEn: 'Wind power', gen_eff: 0.45, carbon: 11, cost_cn: 0.28 },
  hydro: { name: '水力发电', nameEn: 'Hydropower', gen_eff: 0.9, carbon: 24, cost_cn: 0.25 },
}

export const GPU_SPECS: Record<string, GpuSpec> = {
  h100: { name: '训练卡 H100（SXM5）', nameEn: 'H100 SXM5 trainer', tdp_w: 700, tps: 2000 },
  a100: { name: '加速卡 A100（PCIe）', nameEn: 'A100 PCIe accelerator', tdp_w: 400, tps: 1200 },
  v100: { name: '加速卡 V100（SXM2）', nameEn: 'V100 SXM2 accelerator', tdp_w: 300, tps: 800 },
  rtx4090: {
    name: '消费级 4090 加速卡',
    nameEn: 'Consumer RTX 4090',
    tdp_w: 450,
    tps: 500,
  },
  rtx3090: {
    name: '消费级 3090 加速卡',
    nameEn: 'Consumer RTX 3090',
    tdp_w: 350,
    tps: 300,
  },
}

export const MODEL_QUALITY: Record<string, ModelQuality> = {
  frontier: {
    name: '前沿大模型（旗舰闭源级）',
    nameEn: 'Frontier LLM (flagship closed)',
    quality: 0.9,
  },
  mid: {
    name: '中型开源模型（约 70B 级）',
    nameEn: 'Mid open model (~70B)',
    quality: 0.65,
  },
  small: { name: '小型高速模型', nameEn: 'Small fast model', quality: 0.4 },
  poor: { name: '低质量微调模型', nameEn: 'Low-quality fine-tune', quality: 0.15 },
}

// 固定损耗常数
export const GRID_EFF = 0.99 // 升压变压器
export const TRANS_EFF = 0.94 // 长途输电线
export const GPU_COMP_EFF = 0.85 // 芯片功耗 → 实际算力
export const INFER_EFF = 0.92 // 推理引擎利用率

const round = (x: number, n: number) => {
  const p = 10 ** n
  return Math.round(x * p) / p
}

export interface ChainInput {
  power_source: string
  pue: number
  gpu_key: string
  gpu_count: number
  elec_price: number
  model_quality: string
}

export interface ChainResult {
  input: {
    power_source: string
    power_source_name: string
    pue: number
    gpu: string
    gpu_count: number
    model_quality_key: string
    model_quality_name: string
    model_quality_factor: number
    elec_price_cny_kwh: number
  }
  stages: {
    raw_input: number
    after_gen: number
    after_grid: number
    after_trans: number
    after_dc: number
    after_gpu: number
    after_infer: number
    effective: number
  }
  stage_pct: {
    gen_efficiency: number
    grid_eff: number
    trans_eff: number
    dc_eff: number
    gpu_compute_eff: number
    infer_eff: number
    model_quality_pct: number
    total_from_raw: number
    effective_from_raw: number
  }
  token_economics: {
    wall_watts: number
    total_tps: number
    j_per_token: number
    kwh_per_1m_tok: number
    cost_cny_per_1m: number
    tokens_per_kwh: number
    daily_cost_cny: number
    carbon_g_per_1m_tok: number
  }
  analogy_per_1k_tokens: {
    uranium_ug: number
    coal_mg: number
    water_drop_m: number
    phone_charge_pct: number
  }
  source_compare: Array<{
    key: string
    name: string
    nameEn?: string
    gen_eff_pct: number
    cost_cn: number
    carbon_g_kwh: number
    tokens_million_per_month: number
    carbon_per_1m_tok_g: number
    is_selected: boolean
  }>
}

export function computeChain(req: ChainInput): ChainResult {
  const src = POWER_SOURCES[req.power_source]
  const gpu = GPU_SPECS[req.gpu_key]
  const mq = MODEL_QUALITY[req.model_quality]
  if (!src || !gpu || !mq) throw new Error('未知的电源 / GPU / 模型质量')

  const { pue, gpu_count, elec_price } = req
  if (!Number.isFinite(pue) || pue < 1) {
    throw new Error(`无效 pue: 须为有限数且 ≥ 1，收到 ${pue}`)
  }
  if (!Number.isFinite(gpu_count) || !Number.isInteger(gpu_count) || gpu_count < 1) {
    throw new Error(`无效 gpu_count: 须为 ≥ 1 的有限整数，收到 ${gpu_count}`)
  }
  if (!Number.isFinite(elec_price) || elec_price < 0) {
    throw new Error(`无效 elec_price: 须为有限数且 ≥ 0，收到 ${elec_price}`)
  }

  const dc_eff = 1.0 / pue

  const after_gen = src.gen_eff
  const after_grid = after_gen * GRID_EFF
  const after_trans = after_grid * TRANS_EFF
  const after_dc = after_trans * dc_eff
  const after_gpu = after_dc * GPU_COMP_EFF
  const after_infer = after_gpu * INFER_EFF
  const effective = after_infer * mq.quality

  const wall_watts = gpu.tdp_w * req.gpu_count
  const total_tps = gpu.tps * req.gpu_count
  const j_per_token = wall_watts / total_tps
  const kwh_per_1m_tok = (j_per_token * 1_000_000) / 3_600_000
  const cost_per_1m_tok = kwh_per_1m_tok * req.elec_price
  const tokens_per_kwh = 3_600_000 / j_per_token
  const daily_cost_cny = (wall_watts / 1000) * 24 * req.elec_price
  const carbon_per_1m_tok = kwh_per_1m_tok * src.carbon

  const joules_1k = j_per_token * 1000
  const analogy = {
    uranium_ug: (joules_1k / (8.5e13 * 0.36)) * 1e12,
    coal_mg: (joules_1k / (2.93e7 * 0.4)) * 1e6,
    water_drop_m: joules_1k / 9.8,
    phone_charge_pct: (joules_1k / 14400) * 100,
  }

  const BUDGET = 10_000
  const source_compare = Object.entries(POWER_SOURCES).map(([key, s]) => {
    const kwh_month = BUDGET / s.cost_cn
    const tok_million = (kwh_month * tokens_per_kwh) / 1e6
    const co2_1m = kwh_per_1m_tok * s.carbon
    return {
      key,
      name: s.name,
      nameEn: s.nameEn,
      gen_eff_pct: round(s.gen_eff * 100, 1),
      cost_cn: s.cost_cn,
      carbon_g_kwh: s.carbon,
      tokens_million_per_month: round(tok_million, 2),
      carbon_per_1m_tok_g: round(co2_1m, 2),
      is_selected: key === req.power_source,
    }
  })

  return {
    input: {
      power_source: req.power_source,
      power_source_name: src.name,
      pue: req.pue,
      gpu: gpu.name,
      gpu_count: req.gpu_count,
      model_quality_key: req.model_quality,
      model_quality_name: mq.name,
      model_quality_factor: mq.quality,
      elec_price_cny_kwh: req.elec_price,
    },
    stages: {
      raw_input: 1.0,
      after_gen: round(after_gen, 4),
      after_grid: round(after_grid, 4),
      after_trans: round(after_trans, 4),
      after_dc: round(after_dc, 4),
      after_gpu: round(after_gpu, 4),
      after_infer: round(after_infer, 4),
      effective: round(effective, 4),
    },
    stage_pct: {
      gen_efficiency: round(src.gen_eff * 100, 1),
      grid_eff: round(GRID_EFF * 100, 1),
      trans_eff: round(TRANS_EFF * 100, 1),
      dc_eff: round(dc_eff * 100, 1),
      gpu_compute_eff: round(GPU_COMP_EFF * 100, 1),
      infer_eff: round(INFER_EFF * 100, 1),
      model_quality_pct: round(mq.quality * 100, 1),
      total_from_raw: round(after_infer * 100, 2),
      effective_from_raw: round(effective * 100, 2),
    },
    token_economics: {
      wall_watts,
      total_tps,
      j_per_token: round(j_per_token, 4),
      kwh_per_1m_tok: round(kwh_per_1m_tok, 4),
      cost_cny_per_1m: round(cost_per_1m_tok, 4),
      tokens_per_kwh: Math.round(tokens_per_kwh),
      daily_cost_cny: round(daily_cost_cny, 2),
      carbon_g_per_1m_tok: round(carbon_per_1m_tok, 2),
    },
    analogy_per_1k_tokens: {
      uranium_ug: round(analogy.uranium_ug, 6),
      coal_mg: round(analogy.coal_mg, 6),
      water_drop_m: round(analogy.water_drop_m, 6),
      phone_charge_pct: round(analogy.phone_charge_pct, 6),
    },
    source_compare,
  }
}

export const DEFAULT_INPUT: ChainInput = {
  power_source: 'gas-combined',
  pue: 1.2,
  gpu_key: 'h100',
  gpu_count: 8,
  elec_price: 0.65,
  model_quality: 'frontier',
}

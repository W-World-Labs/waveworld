import { describe, it, expect } from 'vitest'
import { computeChain, type ChainInput } from './energyChain'

// 黄金值来自旧版 server.py 的 _compute_chain，确保移植到 TS 后逐字段一致。
const golden: Array<{ in: ChainInput; out: Record<string, number> }> = [
  {
    in: { power_source: 'gas-combined', pue: 1.2, gpu_key: 'h100', gpu_count: 8, elec_price: 0.65, model_quality: 'frontier' },
    out: { after_infer: 0.3639, effective: 0.3275, total_from_raw: 36.39, effective_from_raw: 32.75, j_per_token: 0.35, kwh_per_1m_tok: 0.0972, cost_cny_per_1m: 0.0632, tokens_per_kwh: 10285714, daily_cost_cny: 87.36, carbon_g_per_1m_tok: 34.03 },
  },
  {
    in: { power_source: 'nuclear', pue: 1.1, gpu_key: 'h100', gpu_count: 8, elec_price: 0.35, model_quality: 'frontier' },
    out: { after_infer: 0.2382, effective: 0.2143, total_from_raw: 23.82, effective_from_raw: 21.43, j_per_token: 0.35, kwh_per_1m_tok: 0.0972, cost_cny_per_1m: 0.034, tokens_per_kwh: 10285714, daily_cost_cny: 47.04, carbon_g_per_1m_tok: 1.17 },
  },
  {
    in: { power_source: 'coal', pue: 1.5, gpu_key: 'a100', gpu_count: 16, elec_price: 0.4, model_quality: 'mid' },
    out: { after_infer: 0.1941, effective: 0.1261, total_from_raw: 19.41, effective_from_raw: 12.61, j_per_token: 0.3333, kwh_per_1m_tok: 0.0926, cost_cny_per_1m: 0.037, tokens_per_kwh: 10800000, daily_cost_cny: 61.44, carbon_g_per_1m_tok: 75.93 },
  },
  {
    in: { power_source: 'solar', pue: 2.0, gpu_key: 'rtx4090', gpu_count: 1, elec_price: 0.3, model_quality: 'poor' },
    out: { after_infer: 0.0801, effective: 0.012, total_from_raw: 8.01, effective_from_raw: 1.2, j_per_token: 0.9, kwh_per_1m_tok: 0.25, cost_cny_per_1m: 0.075, tokens_per_kwh: 4000000, daily_cost_cny: 3.24, carbon_g_per_1m_tok: 10.0 },
  },
  {
    in: { power_source: 'hydro', pue: 1.2, gpu_key: 'v100', gpu_count: 32, elec_price: 0.25, model_quality: 'small' },
    out: { after_infer: 0.5458, effective: 0.2183, total_from_raw: 54.58, effective_from_raw: 21.83, j_per_token: 0.375, kwh_per_1m_tok: 0.1042, cost_cny_per_1m: 0.026, tokens_per_kwh: 9600000, daily_cost_cny: 57.6, carbon_g_per_1m_tok: 2.5 },
  },
]

describe('computeChain — 对齐旧 server.py 黄金值', () => {
  for (const g of golden) {
    it(`${g.in.power_source} / ${g.in.gpu_key}×${g.in.gpu_count} / ${g.in.model_quality}`, () => {
      const r = computeChain(g.in)
      expect(r.stages.after_infer).toBe(g.out.after_infer)
      expect(r.stages.effective).toBe(g.out.effective)
      expect(r.stage_pct.total_from_raw).toBe(g.out.total_from_raw)
      expect(r.stage_pct.effective_from_raw).toBe(g.out.effective_from_raw)
      expect(r.token_economics.j_per_token).toBe(g.out.j_per_token)
      expect(r.token_economics.kwh_per_1m_tok).toBe(g.out.kwh_per_1m_tok)
      expect(r.token_economics.cost_cny_per_1m).toBe(g.out.cost_cny_per_1m)
      expect(r.token_economics.tokens_per_kwh).toBe(g.out.tokens_per_kwh)
      expect(r.token_economics.daily_cost_cny).toBe(g.out.daily_cost_cny)
      expect(r.token_economics.carbon_g_per_1m_tok).toBe(g.out.carbon_g_per_1m_tok)
    })
  }

  it('source_compare 覆盖全部 6 个电源且标记选中项', () => {
    const r = computeChain(golden[0].in)
    expect(r.source_compare).toHaveLength(6)
    expect(r.source_compare.filter((s) => s.is_selected)).toHaveLength(1)
  })

  it('未知输入抛错', () => {
    expect(() => computeChain({ ...golden[0].in, gpu_key: 'nope' })).toThrow()
  })

  describe('非法数值输入抛错', () => {
    const base = golden[0].in

    it('pue < 1 或非有限', () => {
      expect(() => computeChain({ ...base, pue: 0.5 })).toThrow(/pue/)
      expect(() => computeChain({ ...base, pue: 0 })).toThrow(/pue/)
      expect(() => computeChain({ ...base, pue: NaN })).toThrow(/pue/)
      expect(() => computeChain({ ...base, pue: Infinity })).toThrow(/pue/)
    })

    it('gpu_count 非 ≥1 整数', () => {
      expect(() => computeChain({ ...base, gpu_count: 0 })).toThrow(/gpu_count/)
      expect(() => computeChain({ ...base, gpu_count: -1 })).toThrow(/gpu_count/)
      expect(() => computeChain({ ...base, gpu_count: 1.5 })).toThrow(/gpu_count/)
      expect(() => computeChain({ ...base, gpu_count: NaN })).toThrow(/gpu_count/)
      expect(() => computeChain({ ...base, gpu_count: Infinity })).toThrow(/gpu_count/)
    })

    it('elec_price < 0 或非有限', () => {
      expect(() => computeChain({ ...base, elec_price: -0.1 })).toThrow(/elec_price/)
      expect(() => computeChain({ ...base, elec_price: NaN })).toThrow(/elec_price/)
      expect(() => computeChain({ ...base, elec_price: Infinity })).toThrow(/elec_price/)
    })

    it('边界合法值通过：pue=1、gpu_count=1、elec_price=0', () => {
      expect(() => computeChain({ ...base, pue: 1, gpu_count: 1, elec_price: 0 })).not.toThrow()
    })
  })
})

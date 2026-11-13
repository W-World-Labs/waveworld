import { describe, it, expect } from 'vitest'
import {
  META_PATH_DIJKSTRA_ID,
  META_PATH_PARENT,
  META_PUE_ID,
  META_TOKEN_PARENT,
  META_TOKEN_THROUGHPUT_ID,
  runEnergyTokenChainSample,
  runPathDijkstraSample,
  runPathEffProductSample,
  runPathMcSample,
  runPathSearchSample,
  runPueSample,
  runSamplePathDirect,
  runTokenStageMonotoneSample,
  runTokenThroughputSample,
} from './meta-algos'
import { methodById } from '../../data/methods/methods'
import { DEFAULT_INPUT, POWER_SOURCES } from '../energyChain'

describe('META · 路径效率 (method-path-efficiency)', () => {
  it('元方法登记存在', () => {
    const m = methodById(META_PATH_PARENT)
    expect(m).toBeDefined()
    expect(m!.id).toBe('method-path-efficiency')
    expect(m!.kind).toBe('meta')
  })

  it('路径搜索：存在路径、hop 数 ≥1、效率=连乘', () => {
    const r = runPathSearchSample('chemical', 'electric')
    expect(r.pathCount).toBeGreaterThan(0)
    expect(r.best).not.toBeNull()
    expect(r.hopCount).toBeGreaterThanOrEqual(1)
    expect(r.hopCount).toBeLessThanOrEqual(4)
    expect(r.totalEff).toBeGreaterThan(0)
    expect(r.totalEff).toBeLessThanOrEqual(1)
    expect(r.productMatches).toBe(true)
    expect(r.best!.hops[0].from).toBe('chemical')
    expect(r.best!.hops[r.best!.hops.length - 1].to).toBe('electric')
  })

  it('效率连乘：product 匹配、全部 ≤1、降序', () => {
    const r = runPathEffProductSample('nuclear', 'mechanical')
    expect(r.paths.length).toBeGreaterThan(0)
    expect(r.allProductMatch).toBe(true)
    expect(r.allEffLeq1).toBe(true)
    expect(r.sortedDesc).toBe(true)
    for (const p of r.paths) {
      expect(p.totalEff).toBeGreaterThan(0)
      expect(p.totalEff).toBeLessThanOrEqual(1)
    }
  })

  it('MC 路径效率：均值 ∈[0,1]、分位有序、逼近中点连乘', () => {
    const r = runPathMcSample('chemical', 'electric', 6000, 17)
    expect(r.pathCount).toBeGreaterThan(0)
    expect(r.stats).toHaveLength(r.pathCount)
    expect(r.meansInBounds).toBe(true)
    expect(r.bestMean).toBeGreaterThan(0)
    expect(r.bestMean).toBeLessThanOrEqual(1)
    for (let i = 0; i < r.stats.length; i++) {
      // 大 N 下均值应接近 hop 中点连乘（容差 0.05）
      expect(r.stats[i].mean).toBeCloseTo(r.analyticMidProduct[i], 1)
    }
  })

  it('samplePath 直接抽样：两跳中点连乘', () => {
    const hops = [
      { min: 0.2, max: 0.4 },
      { min: 0.6, max: 1.0 },
    ]
    const s = runSamplePathDirect(hops, 20000, 7)
    expect(s.mean).toBeCloseTo(0.3 * 0.8, 2)
    expect(s.p10).toBeLessThan(s.p50)
    expect(s.p50).toBeLessThan(s.p90)
    expect(s.min).toBeGreaterThanOrEqual(0)
    expect(s.max).toBeLessThanOrEqual(1 + 1e-9)
  })

  it('Dijkstra −log η：找到路径且与 DFS 最优对拍', () => {
    const r = runPathDijkstraSample('chemical', 'electric')
    expect(r.methodId).toBe(META_PATH_DIJKSTRA_ID)
    expect(r.found).toBe(true)
    expect(r.hopCount).toBeGreaterThanOrEqual(1)
    expect(r.totalEff).toBeGreaterThan(0)
    expect(r.totalEff).toBeLessThanOrEqual(1)
    expect(r.totalWeight).toBeGreaterThanOrEqual(0)
    expect(r.matchesDfsBest).toBe(true)
    expect(methodById(META_PATH_DIJKSTRA_ID)).toBeDefined()
  })
})

describe('META · 能量→Token 链 (method-energy-token-chain)', () => {
  it('元方法登记存在，且依赖路径效率', () => {
    const m = methodById(META_TOKEN_PARENT)
    expect(m).toBeDefined()
    expect(m!.id).toBe('method-energy-token-chain')
    expect(m!.kind).toBe('meta')
    // path-efficiency 是其 prerequisite（methods 图上祖先链在 methods.test 已覆盖）
    expect(methodById(META_PATH_PARENT)).toBeDefined()
  })

  it('computeChain：有效效率 ≤ after_infer，stage 连乘对齐', () => {
    const r = runEnergyTokenChainSample()
    expect(r.effective).toBeGreaterThan(0)
    expect(r.effective).toBeLessThanOrEqual(1)
    expect(r.afterInfer).toBeGreaterThan(0)
    expect(r.afterInfer).toBeLessThanOrEqual(1)
    expect(r.effectiveLeqAfterInfer).toBe(true)
    // stageProduct 与 after_infer 一致（四位舍入）
    expect(r.afterInfer).toBeCloseTo(r.stageProduct, 3)
    expect(r.jPerToken).toBeGreaterThan(0)
    expect(r.result.token_economics.tokens_per_kwh).toBeGreaterThan(0)
  })

  it('阶段效率单调非增 + 有效 < 原始', () => {
    const r = runTokenStageMonotoneSample()
    expect(r.monotone).toBe(true)
    expect(r.stages[0]).toBe(1)
    expect(r.stages[r.stages.length - 1]).toBeLessThan(1)
    expect(r.effectiveFromRaw).toBeLessThanOrEqual(r.totalFromRaw)
    expect(r.totalFromRaw).toBeLessThan(100)
  })

  it('不同电源 gen_eff 影响有效效率（核电 < 联合循环）', () => {
    const gas = runEnergyTokenChainSample({
      ...DEFAULT_INPUT,
      power_source: 'gas-combined',
    })
    const nuclear = runEnergyTokenChainSample({
      ...DEFAULT_INPUT,
      power_source: 'nuclear',
    })
    expect(POWER_SOURCES['gas-combined'].gen_eff).toBeGreaterThan(
      POWER_SOURCES.nuclear.gen_eff,
    )
    expect(gas.effective).toBeGreaterThan(nuclear.effective)
  })

  it('PUE 因子：η_dc = 1/PUE', () => {
    expect(META_PUE_ID).toBe('method-algo-pue-factor')
    expect(methodById(META_PUE_ID)?.parentId).toBe(META_TOKEN_PARENT)
    const r = runPueSample(1.25)
    expect(r.methodId).toBe(META_PUE_ID)
    expect(r.familyId).toBe(META_TOKEN_PARENT)
    expect(r.dcEff).toBeCloseTo(0.8, 12)
    expect(r.idealEff).toBe(1)
    expect(r.worseThanIdeal).toBe(true)
    expect(runPueSample(1).dcEff).toBe(1)
    expect(() => runPueSample(0.9)).toThrow(/pue/)
  })

  it('Token 吞吐 tokens/J = tps/W', () => {
    expect(META_TOKEN_THROUGHPUT_ID).toBe('method-algo-token-throughput')
    expect(methodById(META_TOKEN_THROUGHPUT_ID)?.parentId).toBe(META_TOKEN_PARENT)
    const r = runTokenThroughputSample()
    expect(r.methodId).toBe(META_TOKEN_THROUGHPUT_ID)
    expect(r.familyId).toBe(META_TOKEN_PARENT)
    expect(r.tokensPerJoule).toBeGreaterThan(0)
    expect(r.matchesTpsOverW).toBe(true)
    expect(r.matchesKwh).toBe(true)
    expect(r.jPerToken).toBeGreaterThan(0)
  })
})

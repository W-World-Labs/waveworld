import { describe, it, expect } from 'vitest'
import {
  SDT_PARALLEL_GROUP,
  SDT_VARIANT_METHOD_IDS,
  compareSdtParallels,
  runSdtVariant,
  sdtParallelCount,
  type SdtVariantId,
} from './photo-algos'
import { methodById, parallelGroup, parallelsOf } from '../../data/methods/methods'

describe('SDT 并行机理模块', () => {
  it('并行组 ≥3 个假说节点', () => {
    expect(sdtParallelCount()).toBeGreaterThanOrEqual(3)
    const g = parallelGroup(SDT_PARALLEL_GROUP)
    expect(g.every((m) => m.role === 'parallel-variant' || m.parallelGroupId === SDT_PARALLEL_GROUP)).toBe(true)
    for (const id of Object.values(SDT_VARIANT_METHOD_IDS)) {
      expect(methodById(id)?.parentId).toBe('method-photosensitization-kinetics')
    }
  })

  it('各假说稳态可计算且分支归一', () => {
    for (const id of Object.keys(SDT_VARIANT_METHOD_IDS) as SdtVariantId[]) {
      const r = runSdtVariant(id)
      expect(r.phiTss).toBeGreaterThan(0)
      expect(r.phiTss).toBeLessThan(1)
      expect(r.genRateSinglet).toBeGreaterThan(0)
      const sum = r.branches.typeI + r.branches.typeII + r.branches.deactivation
      expect(sum).toBeCloseTo(1, 10)
    }
  })

  it('并行透镜产生可区分的 ¹O2 生成率（非全相同）', () => {
    const c = compareSdtParallels()
    const vals = Object.values(c)
    expect(vals.every((v) => Number.isFinite(v) && v > 0)).toBe(true)
    const uniq = new Set(vals.map((v) => v.toFixed(6)))
    expect(uniq.size).toBeGreaterThan(1)
  })

  it('parallelsOf 对称', () => {
    const peers = parallelsOf('method-variant-sdt-cavitation')
    expect(peers.length).toBeGreaterThanOrEqual(2)
    expect(peers.every((p) => p.parallelGroupId === SDT_PARALLEL_GROUP)).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import {
  ANTENNA_ARRAY_FACTOR_ID,
  ANTENNA_FRIIS_ID,
  ANTENNA_L2_METHOD_IDS,
  ANTENNA_L2_PARENT,
  ANTENNA_PATTERN_ID,
  ANTENNA_PATTERN_VIEW_ID,
  antennaChildCount,
  freeSpacePathLoss,
  runCatalogWavelengthSample,
  runDirectivitySample,
  runFriisVsDistanceSample,
  runPatternPeakSample,
} from './antenna-l2-algos'
import { methodById } from '../../data/methods/methods'

describe('天线 L2 · 方向性 / 方向图 / Friis', () => {
  it('方法 id 常量对齐 method-array-beamforming 子模块', () => {
    expect(ANTENNA_L2_PARENT).toBe('method-array-beamforming')
    expect(ANTENNA_ARRAY_FACTOR_ID).toBe('method-algo-array-factor')
    expect(ANTENNA_PATTERN_ID).toBe('method-algo-array-pattern')
    expect(ANTENNA_FRIIS_ID).toBe('method-algo-friis-link')
    expect(ANTENNA_PATTERN_VIEW_ID).toBe('method-algo-array-pattern-view')
    expect(ANTENNA_L2_METHOD_IDS).toHaveLength(4)
    expect(antennaChildCount()).toBeGreaterThanOrEqual(3)
    for (const id of ANTENNA_L2_METHOD_IDS) {
      const m = methodById(id)
      expect(m, id).toBeDefined()
      expect(m!.parentId).toBe(ANTENNA_L2_PARENT)
    }
  })

  it('runDirectivitySample：iso < dip < dir，dipole≈2.15 dBi', () => {
    const r = runDirectivitySample()
    expect(r.methodId).toBe(ANTENNA_PATTERN_ID)
    expect(r.ordered).toBe(true)
    expect(r.iso).toBeCloseTo(0, 9)
    expect(r.dip).toBeCloseTo(2.15, 2)
    expect(r.dir).toBeGreaterThan(r.dip)
  })

  it('runPatternPeakSample：dipole/directional 峰值与零点', () => {
    const r = runPatternPeakSample()
    expect(r.methodId).toBe(ANTENNA_PATTERN_VIEW_ID)
    expect(r.dipPeak).toBeCloseTo(1, 6)
    expect(r.dipAxis).toBeCloseTo(0, 6)
    expect(r.dirPeak).toBeCloseTo(1, 6)
    expect(r.dirBack).toBe(0)
    expect(r.iso).toBeCloseTo(1, 9)
  })

  it('runFriisVsDistanceSample：距离×2 → FSPL +20·log10(2) dB', () => {
    const r = runFriisVsDistanceSample(10, 2.4e9, 20, 2.15, 2.15)
    const dB2 = 20 * Math.log10(2) // ≈ 6.02 dB
    expect(r.methodId).toBe(ANTENNA_FRIIS_ID)
    expect(r.dFspl).toBeCloseTo(dB2, 10)
    expect(r.dPr).toBeCloseTo(dB2, 10)
    // Both entry points now share the same Friis implementation and units.
    expect(r.prViaAntenna).toBe(r.pr0)
    expect(r.fspl0).toBe(freeSpacePathLoss(2.4e9, 10))
  })

  it('图鉴波长：Wi-Fi 2.45 GHz λ = c/f', () => {
    const r = runCatalogWavelengthSample()
    expect(r.catalogId).toBe('wifi24')
    expect(r.lambda).toBeCloseTo(r.expected, 12)
    expect(r.lambda).toBeCloseTo(3e8 / 2.45e9, 9)
    expect(r.gainDbi).toBeGreaterThan(0)
  })
})

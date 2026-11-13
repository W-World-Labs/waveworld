import { describe, it, expect } from 'vitest'
import {
  ARRAY_BEAMFORMER_GROUP,
  MVDR_METHOD_ID,
  MVDR_PARENT,
  MVDR_WEIGHTS_ID,
  mvdrPattern,
  mvdrWeights,
  runMvdrSample,
  runMvdrWeightsSample,
  sampleCovarianceReal,
  steeringVector,
} from './mvdr-algos'
import { methodById, parallelGroup } from '../../data/methods/methods'

describe('MVDR / Capon 波束成形', () => {
  it('方法 id 与并行组对齐目录', () => {
    expect(MVDR_METHOD_ID).toBe('method-beamforming-mvdr')
    expect(MVDR_PARENT).toBe('method-array-beamforming')
    const m = methodById(MVDR_METHOD_ID)
    expect(m).toBeDefined()
    expect(m!.parentId).toBe(MVDR_PARENT)
    expect(m!.parallelGroupId).toBe(ARRAY_BEAMFORMER_GROUP)
    expect(parallelGroup(ARRAY_BEAMFORMER_GROUP).length).toBeGreaterThanOrEqual(2)
  })

  it('导向矢量 θ=0 为全 1 实部', () => {
    const a = steeringVector(0, 4, 0.5)
    for (let i = 0; i < 4; i++) {
      expect(a.re[i]).toBeCloseTo(1, 12)
      expect(a.im[i]).toBeCloseTo(0, 12)
    }
  })

  it('协方差对角主导且对称', () => {
    const N = 4
    const R = sampleCovarianceReal(N, 0.5, [{ thetaDeg: 0, power: 1 }], 0.5)
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        expect(R[i * N + j]).toBeCloseTo(R[j * N + i]!, 12)
      }
      expect(R[i * N + i]).toBeGreaterThan(0.5)
    }
  })

  it('MVDR look 增益 ≈1，干扰处更小', () => {
    const N = 8
    const d = 0.5
    const look = 0
    const jam = 35
    const R = sampleCovarianceReal(
      N,
      d,
      [
        { thetaDeg: look, power: 1 },
        { thetaDeg: jam, power: 20 },
      ],
      0.05,
    )
    const w = mvdrWeights(R, look, N, d)
    const gLook = mvdrPattern(w, look, N, d)
    const gJam = mvdrPattern(w, jam, N, d)
    expect(gLook).toBeCloseTo(1, 5)
    expect(gJam).toBeLessThan(gLook)
  })

  it('runMvdrSample：look≈1、nullDepth>1', () => {
    const r = runMvdrSample()
    expect(r.methodId).toBe(MVDR_METHOD_ID)
    expect(r.familyId).toBe(MVDR_PARENT)
    expect(r.lookGain).toBeCloseTo(1, 4)
    expect(r.jammerGain).toBeLessThan(r.lookGain)
    expect(r.nullDepth).toBeGreaterThan(1)
  })

  it('runMvdrWeightsSample：aᵀw≈1', () => {
    const r = runMvdrWeightsSample()
    expect(r.methodId).toBe(MVDR_WEIGHTS_ID)
    expect(r.parentId).toBe(MVDR_METHOD_ID)
    expect(r.lookConstraint).toBeCloseTo(1, 5)
    expect(r.weightNorm).toBeGreaterThan(0)
  })
})

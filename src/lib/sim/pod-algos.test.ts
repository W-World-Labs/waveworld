import { describe, it, expect } from 'vitest'
import {
  METHOD_POD,
  METHOD_ALGO_POD_SVD,
  METHOD_ALGO_POD_PROJECT,
  POD_PARENT,
  POD_METHOD_IDS,
  POD_MAX_N,
  norm2,
  dot,
  maxAbs,
  gramMatrix,
  jacobiEigenSymmetric,
  powerIterSymmetric,
  podSvd,
  energyCaptureRatio,
  projectSnapshot,
  reconstructSnapshot,
  reconstructionErrorRel,
  makeLowRankSnapshots,
  makeWaveSnapshots,
  getSnapshot,
  runPodSvdSample,
  runPodProjectSample,
} from './pod-algos'

describe('POD · SVD reduced-order teaching stubs', () => {
  it('method id constants (not in catalog; do not methodById)', () => {
    expect(METHOD_POD).toBe('method-pod')
    expect(METHOD_ALGO_POD_SVD).toBe('method-algo-pod-svd')
    expect(METHOD_ALGO_POD_PROJECT).toBe('method-algo-pod-project')
    expect(POD_PARENT).toBe(METHOD_POD)
    expect(POD_METHOD_IDS).toContain(METHOD_ALGO_POD_SVD)
    expect(POD_METHOD_IDS).toContain(METHOD_ALGO_POD_PROJECT)
    expect(POD_MAX_N).toBe(16)
  })

  it('norm2 / dot / maxAbs basics', () => {
    expect(norm2([3, 4])).toBeCloseTo(5, 12)
    expect(dot([1, 2, 3], [4, 5, 6])).toBeCloseTo(32, 12)
    expect(maxAbs([-2, 5, -7])).toBeCloseTo(7, 12)
  })

  it('jacobiEigenSymmetric: diagonal matrix exact', () => {
    const A = new Float64Array([3, 0, 0, 1])
    const { eigenvalues, eigenvectors } = jacobiEigenSymmetric(A, 2)
    expect(eigenvalues[0]).toBeCloseTo(3, 10)
    expect(eigenvalues[1]).toBeCloseTo(1, 10)
    // first eigenvector along e0
    expect(Math.abs(eigenvectors[0]!)).toBeCloseTo(1, 8)
    expect(Math.abs(eigenvectors[1]!)).toBeLessThan(1e-8)
  })

  it('jacobiEigenSymmetric: 2×2 known pair', () => {
    // [[2,1],[1,2]] → λ=3,1; v1=(1,1)/√2
    const A = new Float64Array([2, 1, 1, 2])
    const { eigenvalues, eigenvectors } = jacobiEigenSymmetric(A, 2)
    expect(eigenvalues[0]).toBeCloseTo(3, 10)
    expect(eigenvalues[1]).toBeCloseTo(1, 10)
    const v0 = [eigenvectors[0]!, eigenvectors[1]!]
    expect(norm2(v0)).toBeCloseTo(1, 10)
    expect(Math.abs(v0[0]!)).toBeCloseTo(Math.SQRT1_2, 6)
    expect(Math.abs(v0[1]!)).toBeCloseTo(Math.SQRT1_2, 6)
  })

  it('powerIterSymmetric matches dominant Jacobi eigenpair', () => {
    const A = new Float64Array([4, 1, 0, 1, 3, 1, 0, 1, 2])
    const jac = jacobiEigenSymmetric(A, 3)
    const pow = powerIterSymmetric(A, 3)
    expect(pow.eigenvalue).toBeCloseTo(jac.eigenvalues[0]!, 6)
    // same direction up to sign
    let c = 0
    for (let i = 0; i < 3; i++) {
      c += pow.eigenvector[i]! * jac.eigenvectors[i]!
    }
    expect(Math.abs(c)).toBeCloseTo(1, 5)
  })

  it('gramMatrix is SPD-ish and matches snapshot dots', () => {
    const nSpace = 4
    const nTime = 3
    const X = new Float64Array([
      // col0
      1, 0, 0, 0,
      // col1
      0, 2, 0, 0,
      // col2
      1, 1, 0, 0,
    ])
    const G = gramMatrix(X, nSpace, nTime)
    expect(G[0]).toBeCloseTo(1, 12)
    expect(G[1 * 3 + 1]).toBeCloseTo(4, 12)
    expect(G[0 * 3 + 2]).toBeCloseTo(1, 12)
    expect(G[1 * 3 + 2]).toBeCloseTo(2, 12)
  })

  it('podSvd: rank-deficient data recovers rank and energy', () => {
    const nSpace = 10
    const nTime = 8
    const trueRank = 3
    const toy = makeLowRankSnapshots(nSpace, nTime, trueRank, { seed: 3 })
    const pod = podSvd(toy.X, nSpace, nTime)
    expect(pod.rank).toBeGreaterThanOrEqual(trueRank)
    expect(pod.singularValues[0]!).toBeGreaterThan(0)
    // singular values descending
    for (let p = 1; p < pod.rank; p++) {
      expect(pod.singularValues[p]!).toBeLessThanOrEqual(
        pod.singularValues[p - 1]! + 1e-9,
      )
    }
    expect(energyCaptureRatio(pod, trueRank)).toBeGreaterThan(0.999)
    // modes orthonormal
    for (let p = 0; p < trueRank; p++) {
      let self = 0
      for (let i = 0; i < nSpace; i++) {
        self += pod.modes[i + p * nSpace]! * pod.modes[i + p * nSpace]!
      }
      expect(self).toBeCloseTo(1, 8)
    }
  })

  it('project + reconstruct: tiny error for r ≥ true rank', () => {
    const nSpace = 12
    const nTime = 9
    const trueRank = 2
    const toy = makeLowRankSnapshots(nSpace, nTime, trueRank, { seed: 5 })
    const pod = podSvd(toy.X, nSpace, nTime)
    const err = reconstructionErrorRel(
      toy.X,
      nSpace,
      nTime,
      pod.modes,
      trueRank,
    )
    expect(err).toBeLessThan(1e-9)

    // single snapshot round-trip
    const x0 = getSnapshot(toy.X, nSpace, nTime, 0)
    const c = projectSnapshot(pod.modes, nSpace, trueRank, x0)
    const xr = reconstructSnapshot(pod.modes, nSpace, trueRank, c)
    expect(norm2(Array.from({ length: nSpace }, (_, i) => x0[i]! - xr[i]!))).toBeLessThan(
      1e-9,
    )
  })

  it('under-resolved projection leaves residual energy', () => {
    const nSpace = 10
    const nTime = 8
    const trueRank = 3
    const toy = makeLowRankSnapshots(nSpace, nTime, trueRank, { seed: 9 })
    const pod = podSvd(toy.X, nSpace, nTime)
    const err1 = reconstructionErrorRel(toy.X, nSpace, nTime, pod.modes, 1)
    const err3 = reconstructionErrorRel(toy.X, nSpace, nTime, pod.modes, 3)
    expect(err1).toBeGreaterThan(err3 * 10)
    expect(err3).toBeLessThan(1e-8)
  })

  it('wave snapshots: POD energy concentrates in first 2 modes', () => {
    const X = makeWaveSnapshots(12, 10)
    const pod = podSvd(X, 12, 10)
    expect(energyCaptureRatio(pod, 2)).toBeGreaterThan(0.999)
    expect(reconstructionErrorRel(X, 12, 10, pod.modes, 2)).toBeLessThan(1e-8)
  })

  it('runPodSvdSample: ok, methodId/familyId', () => {
    const r = runPodSvdSample({ nSpace: 10, nTime: 8, trueRank: 3 })
    expect(r.methodId).toBe(METHOD_ALGO_POD_SVD)
    expect(r.familyId).toBe(METHOD_POD)
    expect(r.familyId).toBe('method-pod')
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.modesOrthonormal).toBe(true)
    expect(r.energyTop).toBeGreaterThan(0.999)
    expect(r.recoveredRank).toBeGreaterThanOrEqual(r.trueRank)
    expect(r.sigma0).toBeGreaterThan(0)
  })

  it('runPodProjectSample: ok, small reconstruction error', () => {
    const r = runPodProjectSample({ nSpace: 12, nTime: 10, trueRank: 2 })
    expect(r.methodId).toBe(METHOD_ALGO_POD_PROJECT)
    expect(r.familyId).toBe(METHOD_POD)
    expect(r.ok).toBe(true)
    expect(r.finite).toBe(true)
    expect(r.errFull).toBeLessThan(1e-8)
    expect(r.energyAtR).toBeGreaterThan(0.999)
    expect(r.errUnder).toBeGreaterThan(r.errFull)
  })
})

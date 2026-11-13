import { computeChargedForces } from './interactions'
import { phaseSeparationDegree } from './pedotpss'
// src/lib/sim/pedotpss.test.ts
import { describe, it, expect } from 'vitest'
import { screenedCoulomb } from './pedotpss'
import {  type PedotPssParams } from './pedotpss'
import { hopRate, tryHop, type HopParams } from './pedotpss'
import { carrierHopStep, makeChargeState, type ParticleKind } from './pedotpss'
import { computeForces } from './md'
import { rng } from '../mc'

const HOP: HopParams = { distMax: 1.6, beta: 2, attempt: 0.8 }

const PARAMS: PedotPssParams = {
  kCoulomb: 1, epsR: 24, lambdaD: 3,
  hopDistMax: 1.6, hopBeta: 1, hopAttempt: 0.5,
  solvationEpsR: 50, washoutBeta: 1,
}

describe('screenedCoulomb: Debye–Hückel 屏蔽库仑', () => {
  it('同号电荷斥（fOverR>0, u>0）、异号吸（fOverR<0, u<0）', () => {
    const same = screenedCoulomb(1.0, +1, +1, 1, 10)
    const opp = screenedCoulomb(1.0, +1, -1, 1, 10)
    expect(same.fOverR).toBeGreaterThan(0); expect(same.u).toBeGreaterThan(0)
    expect(opp.fOverR).toBeLessThan(0); expect(opp.u).toBeLessThan(0)
  })
  it('λD→∞ 退化为裸库仑 1/r²：fOverR·r·r2 ≈ kCoulomb·qi·qj', () => {
    const r2 = 4.0, r = 2.0
    const { fOverR } = screenedCoulomb(r2, +1, +1, 1, 1e9, 1) // kCoulomb=1
    // 裸库仑 F = C/r²，fOverR = F/r = C/r³ ⇒ fOverR·r³ = C = 1·1·1/1 = 1
    expect(fOverR * r * r2).toBeCloseTo(1, 3)
  })
  it('r≫λD 时被 exp(−r/λD) 指数压制趋零', () => {
    const near = Math.abs(screenedCoulomb(0.25, +1, +1, 1, 0.5).fOverR) // r=0.5=λD
    const far = Math.abs(screenedCoulomb(100, +1, +1, 1, 0.5).fOverR)   // r=10≫λD
    expect(far).toBeLessThan(near * 1e-6)
  })
  it('介电单调：epsR 80(水) 的力是 24(乙醇) 的 24/80（精确 1/εr）', () => {
    const e24 = screenedCoulomb(1.0, +1, -1, 24, 10).fOverR
    const e80 = screenedCoulomb(1.0, +1, -1, 80, 10).fOverR
    expect(e80).toBeCloseTo(e24 * (24 / 80), 9)
  })
  it('soft-core：极小 r² 有限（不发散）', () => {
    const tiny = screenedCoulomb(1e-20, +1, +1, 1, 1)
    expect(Number.isFinite(tiny.u)).toBe(true)
    expect(Number.isFinite(tiny.fOverR)).toBe(true)
    // 与 r2 = R2_MIN=1e-8 对齐
    const floor = screenedCoulomb(1e-8, +1, +1, 1, 1)
    expect(tiny.u).toBeCloseTo(floor.u, 9)
    expect(tiny.fOverR).toBeCloseTo(floor.fOverR, 9)
  })
  it('soft-core：epsR/lambdaD→0 有限', () => {
    const z = screenedCoulomb(1.0, +1, -1, 0, 0)
    expect(Number.isFinite(z.u)).toBe(true)
    expect(Number.isFinite(z.fOverR)).toBe(true)
  })
})

describe('computeChargedForces: 总力 = LJ + 屏蔽库仑', () => {
  it('全中性 q=0 时逐元素退化为纯 LJ（Phase 1 回归）', () => {
    const dim = 2, N = 4, L = 10, rc = 2.5
    const pos = new Float32Array([2, 2, 3, 2.2, 2.5, 3, 4, 4])
    const charge = new Float32Array([0, 0, 0, 0]) // 全中性
    const got = computeChargedForces(pos, charge, L, N, dim, rc, PARAMS)
    const lj = computeForces(pos, L, N, dim, rc)
    for (let i = 0; i < N * dim; i++) expect(got.force[i]).toBeCloseTo(lj.force[i], 6)
    expect(got.potential).toBeCloseTo(lj.potential, 6)
    expect(got.virial).toBeCloseTo(lj.virial, 6)
  })
  it('带电时总力 = LJ + 屏蔽库仑（异号对吸引增强）', () => {
    const dim = 2, N = 2, L = 10, rc = 2.5
    const pos = new Float32Array([3, 3, 4.2, 3]) // 相距 1.2
    const charge = new Float32Array([+1, -1])
    const got = computeChargedForces(pos, charge, L, N, dim, rc, PARAMS)
    const lj = computeForces(pos, L, N, dim, rc)
    // 异号库仑吸引：粒子0 在 +x 处的伙伴吸引它 → x 分量比纯 LJ 更偏向 +x（朝粒子1）
    expect(got.force[0]).toBeGreaterThan(lj.force[0]) // 叠加吸引项使其更朝 +x
    expect(got.force[0]).not.toBeCloseTo(lj.force[0], 6)
  })
})

describe('hopRate / tryHop: 载流子跳跃门控', () => {
  it('超距（dist≥distMax）跳跃率为 0', () => {
    expect(hopRate(1.6, 0, HOP)).toBe(0)
    expect(hopRate(2.0, -1, HOP)).toBe(0)
  })
  it('能量有利（dE≤0）取上限 attempt；dE 增大单调压制', () => {
    expect(hopRate(1.0, 0, HOP)).toBeCloseTo(0.8, 9)
    expect(hopRate(1.0, -5, HOP)).toBeCloseTo(0.8, 9)
    expect(hopRate(1.0, 1, HOP)).toBeLessThan(hopRate(1.0, 0, HOP))
    expect(hopRate(1.0, 2, HOP)).toBeLessThan(hopRate(1.0, 1, HOP))
  })
  it('tryHop 可种子化复现', () => {
    const a = rng(42), b = rng(42)
    const seqA = Array.from({ length: 10 }, () => tryHop(1.0, 0.3, HOP, a))
    const seqB = Array.from({ length: 10 }, () => tryHop(1.0, 0.3, HOP, b))
    expect(seqA).toEqual(seqB)
  })
})

describe('carrierHopStep: 跳跃扫描电荷守恒', () => {
  it('跳跃前后总电荷守恒，单次转移供受体各 ∓1/±1', () => {
    const dim = 2, N = 3, L = 20
    // 三个紧邻 PEDOT，载流子集中在 0 号
    const pos = new Float32Array([5, 5, 6, 5, 7, 5])
    const kinds: ParticleKind[] = ['PEDOT', 'PEDOT', 'PEDOT']
    const st = makeChargeState(kinds)
    st.charge[0] = 2; st.charge[1] = 1; st.charge[2] = 1 // 0 号超出基线，可供出
    const before = st.charge[0] + st.charge[1] + st.charge[2]
    // 高 attempt + 全有利 → 必发生跳跃
    const params: PedotPssParams = {
      kCoulomb: 1, epsR: 1, lambdaD: 5,
      hopDistMax: 1.5, hopBeta: 0.1, hopAttempt: 1, solvationEpsR: 50, washoutBeta: 1,
    }
    const res = carrierHopStep(pos, st, L, N, dim, params, rng(7))
    const after = st.charge[0] + st.charge[1] + st.charge[2]
    expect(after).toBe(before)               // 总电荷守恒
    expect(res.hops).toBeGreaterThan(0)       // 确有跳跃
  })
})

import {  phaseSeparation } from './pedotpss'

describe('phaseSeparationDegree: 相分离度单调可区分', () => {
  it('已分离（PEDOT 聚成一簇）度高，均匀分散度低', () => {
    const dim = 2, L = 50
    // 已分离：4 个 PEDOT 紧挨成簇（间距 1<rCluster）
    const clustered = new Float32Array([5, 5, 6, 5, 5, 6, 6, 6])
    const kc: ParticleKind[] = ['PEDOT', 'PEDOT', 'PEDOT', 'PEDOT']
    const dClustered = phaseSeparationDegree(clustered, kc, L, 4, dim, 'PEDOT', 1.5)
    // 均匀分散：4 个 PEDOT 彼此远离（间距 15>rCluster）
    const spread = new Float32Array([2, 2, 20, 2, 2, 20, 20, 20])
    const dSpread = phaseSeparationDegree(spread, kc, L, 4, dim, 'PEDOT', 1.5)
    expect(dClustered).toBeGreaterThan(dSpread)
    expect(dClustered).toBeCloseTo(1, 5)   // 全连通 → 1
    expect(dSpread).toBeCloseTo(0.25, 5)   // 各自单点 → 1/4
  })
})

describe('phaseSeparation: 溶剂强时洗出过量反离子', () => {
  it('epsR≥solvationEpsR 时标记 COUNTERION 为溶剂化', () => {
    const st = makeChargeState(['PEDOT', 'COUNTERION', 'COUNTERION'])
    const strong: PedotPssParams = {
      kCoulomb: 1, epsR: 80, lambdaD: 5, hopDistMax: 1.6, hopBeta: 1, hopAttempt: 0.5,
      solvationEpsR: 50, washoutBeta: 1,
    }
    const res = phaseSeparation(st, strong)
    expect(res.washed).toBe(2)              // 两个反离子被洗出
    expect(res.solvated[1]).toBe(1); expect(res.solvated[2]).toBe(1)
    expect(res.solvated[0]).toBe(0)         // PEDOT 不洗
  })
  it('epsR<solvationEpsR 时不洗出', () => {
    const st = makeChargeState(['COUNTERION'])
    const weak: PedotPssParams = {
      kCoulomb: 1, epsR: 24, lambdaD: 5, hopDistMax: 1.6, hopBeta: 1, hopAttempt: 0.5,
      solvationEpsR: 50, washoutBeta: 1,
    }
    expect(phaseSeparation(st, weak).washed).toBe(0)
  })
})

import { netCarrierDisplacementRate, initSpecies } from './pedotpss'

describe('netCarrierDisplacementRate + initSpecies', () => {
  it('电导代理 = 净位移/时间，时间≤0 返回 0', () => {
    expect(netCarrierDisplacementRate(12, 4)).toBeCloseTo(3, 9)
    expect(netCarrierDisplacementRate(5, 0)).toBe(0)
  })
  it('initSpecies 长度=N、含四物种、PSS 过量（多于 PEDOT）', () => {
    const kinds = initSpecies(40, 7)
    expect(kinds.length).toBe(40)
    const count = (k: ParticleKind) => kinds.filter((x) => x === k).length
    expect(count('PSS')).toBeGreaterThan(count('PEDOT')) // 过量绝缘聚阴离子
    expect(count('PEDOT')).toBeGreaterThan(0)
    expect(count('ETHANOL')).toBeGreaterThanOrEqual(0)
  })
  it('initSpecies 同种子可复现', () => {
    expect(initSpecies(20, 42)).toEqual(initSpecies(20, 42))
  })
})

// 追加到 pedotpss.test.ts
import { SPECIES_LJ, speciesSigmaEps } from './pedotpss'

describe('SPECIES_LJ: PEDOT:PSS 真实物种 σ/ε（约化到 PEDOT 参考）', () => {
  it('PEDOT 约化 σ*=ε*=1（参考物种）', () => {
    expect(SPECIES_LJ.PEDOT.sigmaStar).toBeCloseTo(1, 6)
    expect(SPECIES_LJ.PEDOT.epsStar).toBeCloseTo(1, 6)
  })
  it('COUNTERION 比 PEDOT 小且弱（Na⁺ σ/ε 更小）', () => {
    expect(SPECIES_LJ.COUNTERION.sigmaStar).toBeLessThan(1)
    expect(SPECIES_LJ.COUNTERION.epsStar).toBeLessThan(1)
  })
  it('每物种带来源引证', () => {
    for (const k of ['PEDOT', 'PSS', 'COUNTERION', 'ETHANOL'] as const) {
      expect(SPECIES_LJ[k].source.length).toBeGreaterThan(0)
    }
  })
  it('speciesSigmaEps 按 kind 数组构建 per-particle σ*/ε* 数组', () => {
    const kinds: ParticleKind[] = ['PEDOT', 'COUNTERION', 'ETHANOL']
    const { sigma, eps } = speciesSigmaEps(kinds)
    expect(sigma.length).toBe(3); expect(eps.length).toBe(3)
    expect(sigma[0]).toBeCloseTo(1, 6) // PEDOT
    expect(sigma[1]).toBeLessThan(1)   // COUNTERION
  })
})

describe('computeChargedForces 异质 σ/ε 生效', () => {
  it('真实 σ/ε 与同质 σ=ε=1 给出不同力（异质化确实改变物理）', () => {
    const dim = 2, N = 2, L = 10, rc = 2.5
    const pos = new Float32Array([3, 3, 4, 3]) // 相距 1
    const charge = new Float32Array([0, 0])    // 纯 LJ 隔离电荷影响
    const params: PedotPssParams = { kCoulomb: 1, epsR: 24, lambdaD: 3, hopDistMax: 1.6, hopBeta: 1, hopAttempt: 0.5, solvationEpsR: 50, washoutBeta: 1 }
    const { sigma, eps } = speciesSigmaEps(['PEDOT', 'COUNTERION'])
    const homo = computeChargedForces(pos, charge, L, N, dim, rc, params)
    const hetero = computeChargedForces(pos, charge, L, N, dim, rc, params, sigma, eps)
    expect(hetero.force[0]).not.toBeCloseTo(homo.force[0], 6) // 异质 σ/ε 改变 LJ 力
  })
})

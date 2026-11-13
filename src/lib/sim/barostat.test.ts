import { describe, it, expect } from 'vitest'
import { initLattice, computeForces, temperature, pressure, velocityVerlet, type MdState } from './md'
import { berendsenBarostat, type BarostatParams } from './barostat'

/** 深拷贝 MdState 的数值字段，供逐位对拍。 */
function snapshot(s: MdState) {
  return {
    L: s.L,
    pos: s.pos.slice(),
    vel: s.vel.slice(),
    force: s.force.slice(),
    posUnwrapped: s.posUnwrapped.slice(),
    potential: s.potential,
    virial: s.virial,
  }
}

function expectArrayEqual(a: Float32Array, b: Float32Array) {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < a.length; i++) expect(a[i]).toBe(b[i])
}

describe('berendsenBarostat', () => {
  it('关闭（Ptarget=NaN）⇒ 返回 1 且 state 逐位不变（回归锁）', () => {
    const st = initLattice(64, 8, 2, 0.8, 7)
    const before = snapshot(st)
    const mu = berendsenBarostat(st, { Ptarget: NaN, tauP: 1, dt: 0.005 })
    expect(mu).toBe(1)
    expect(st.L).toBe(before.L)
    expectArrayEqual(st.pos, before.pos)
    expectArrayEqual(st.vel, before.vel)
    expectArrayEqual(st.force, before.force)
    expectArrayEqual(st.posUnwrapped, before.posUnwrapped)
    expect(st.potential).toBe(before.potential)
    expect(st.virial).toBe(before.virial)
  })

  it('超压 ⇒ μ>1、盒子膨胀；欠压 ⇒ μ<1、盒子收缩', () => {
    // 稠密低温体系 → 维里项使瞬时压强偏高
    const st = initLattice(100, 9, 2, 0.4, 3)
    const T = temperature(st.vel, st.N, st.dim)
    const P = pressure(st.N, st.L, st.dim, T, st.virial)

    // 目标压强远低于瞬时 → 超压 → 膨胀
    const hi = initLattice(100, 9, 2, 0.4, 3)
    const Lbefore = hi.L
    const muHi = berendsenBarostat(hi, { Ptarget: P - 5, tauP: 1, dt: 0.005 })
    expect(muHi).toBeGreaterThan(1)
    expect(hi.L).toBeGreaterThan(Lbefore)

    // 目标压强远高于瞬时 → 欠压 → 收缩
    const lo = initLattice(100, 9, 2, 0.4, 3)
    const Lbefore2 = lo.L
    const muLo = berendsenBarostat(lo, { Ptarget: P + 5, tauP: 1, dt: 0.005 })
    expect(muLo).toBeLessThan(1)
    expect(lo.L).toBeLessThan(Lbefore2)
  })

  it('各向同性缩放：L 与每个坐标按同一 μ 缩放（分数坐标守恒）', () => {
    const st = initLattice(64, 8, 2, 0.8, 11)
    const Lbefore = st.L
    const posBefore = st.pos.slice()
    const unwrapBefore = st.posUnwrapped.slice()
    const T = temperature(st.vel, st.N, st.dim)
    const P = pressure(st.N, st.L, st.dim, T, st.virial)
    const mu = berendsenBarostat(st, { Ptarget: P - 1, tauP: 2, dt: 0.005 })

    expect(st.L).toBeCloseTo(mu * Lbefore, 6)
    for (let i = 0; i < st.pos.length; i++) {
      expect(st.pos[i]).toBeCloseTo(mu * posBefore[i], 5)
      expect(st.posUnwrapped[i]).toBeCloseTo(mu * unwrapBefore[i], 5)
      // 仍在盒内
      expect(st.pos[i]).toBeGreaterThanOrEqual(0)
      expect(st.pos[i]).toBeLessThan(st.L)
    }
  })

  it('数值护栏：极端压差时 μ 被限制在 [1−maxScale, 1+maxScale]', () => {
    const maxScale = 0.02
    const st = initLattice(64, 8, 2, 0.5, 5)
    const T = temperature(st.vel, st.N, st.dim)
    const P = pressure(st.N, st.L, st.dim, T, st.virial)
    const params: BarostatParams = { Ptarget: P - 1e6, tauP: 0.01, dt: 0.01, maxScale }
    const mu = berendsenBarostat(st, params)
    expect(mu).toBeLessThanOrEqual(1 + maxScale + 1e-12)
    expect(mu).toBeGreaterThanOrEqual(1 - maxScale - 1e-12)
  })

  it('力自洽：施压后 state.force 与当前 pos/L 重算的力一致', () => {
    const st = initLattice(81, 9, 2, 0.7, 9)
    const T = temperature(st.vel, st.N, st.dim)
    const P = pressure(st.N, st.L, st.dim, T, st.virial)
    berendsenBarostat(st, { Ptarget: P - 2, tauP: 1, dt: 0.005 })
    const fr = computeForces(st.pos, st.L, st.N, st.dim, st.rc)
    for (let i = 0; i < st.force.length; i++) expect(st.force[i]).toBeCloseTo(fr.force[i], 5)
    expect(st.potential).toBeCloseTo(fr.potential, 5)
    expect(st.virial).toBeCloseTo(fr.virial, 5)
  })

  it('耦合退化：τ_P→∞ ⇒ μ→1、state 近乎不变（平滑退化）', () => {
    const st = initLattice(64, 8, 2, 0.8, 13)
    const Lbefore = st.L
    const T = temperature(st.vel, st.N, st.dim)
    const P = pressure(st.N, st.L, st.dim, T, st.virial)
    const mu = berendsenBarostat(st, { Ptarget: P - 3, tauP: 1e9, dt: 0.005 })
    expect(mu).toBeCloseTo(1, 6)
    expect(st.L).toBeCloseTo(Lbefore, 4)
  })

  it('收敛（集成）：NVT 平衡后开 NPT ⇒ ⟨P⟩ 向 Ptarget 逼近、L 朝正确方向移动', () => {
    const st = initLattice(100, 11, 2, 0.9, 21)
    const dt = 0.005
    const Ttarget = 0.9
    const thermostat = () => {
      const T = temperature(st.vel, st.N, st.dim)
      if (T > 0) {
        const s = Math.sqrt(Ttarget / T)
        for (let i = 0; i < st.vel.length; i++) st.vel[i] *= s
      }
    }

    // ① 先纯 NVT 平衡（盒长不变），测代表性平衡压强 P_eq
    let peqSum = 0, peqCount = 0
    for (let k = 0; k < 2000; k++) {
      velocityVerlet(st, dt)
      thermostat()
      if (k >= 1000) {
        const Tk = temperature(st.vel, st.N, st.dim)
        peqSum += pressure(st.N, st.L, st.dim, Tk, st.virial)
        peqCount++
      }
    }
    const Peq = peqSum / peqCount
    const Lbefore = st.L
    const Ptarget = Peq - 2.0 // 目标明显低于平衡压强 → 盒子应膨胀

    // ② 开 NPT，后半段取压强均值
    let pSum = 0, pCount = 0
    for (let k = 0; k < 4000; k++) {
      velocityVerlet(st, dt)
      thermostat()
      berendsenBarostat(st, { Ptarget, tauP: 0.5, dt })
      if (k >= 2000) {
        const Tk = temperature(st.vel, st.N, st.dim)
        pSum += pressure(st.N, st.L, st.dim, Tk, st.virial)
        pCount++
      }
    }
    const pMean = pSum / pCount
    // ⟨P⟩ 比平衡压强更接近目标
    expect(Math.abs(pMean - Ptarget)).toBeLessThan(Math.abs(Peq - Ptarget))
    // 目标压强更低 → 盒子膨胀
    expect(st.L).toBeGreaterThan(Lbefore)
  })
})

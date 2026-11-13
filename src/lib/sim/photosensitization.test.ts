import { describe, it, expect } from 'vitest'
import {
  defaultPhotoParams,
  effectiveTripletDecay,
  steadyState,
  branchFractions,
  integratePhotosensitization,
  type PhotoParams,
} from './photosensitization'

// 解析稳态参考（对拍护栏的「精确解」一侧）：
//   总敏化剂守恒 S0+S1+T1=C_tot；令 a=k_exc/(k_f+k_isc)、b=k_isc/k_T,eff，
//   k_T,eff = k_T + k_q·[³O2] + k_I·[sub]。
//   S0_ss = C_tot/(1+a+a·b)，T1_ss = a·b·S0_ss，φ_T,ss = a·b/(1+a+a·b)，
//   ¹O2_ss = k_q·[³O2]·T1_ss/k_d，稳态 ¹O2 生成率 G_ss = k_q·[³O2]·T1_ss。

describe('稳态解析解（对拍护栏的参考）', () => {
  it('effectiveTripletDecay = k_T + k_q·[³O2] + k_I·[sub]', () => {
    const p = defaultPhotoParams()
    expect(effectiveTripletDecay(p)).toBeCloseTo(
      p.k_T + p.k_q * p.O2 + p.k_I * p.substrate,
      12,
    )
  })

  it('steadyState 满足守恒：S0+S1+T1 = C_tot', () => {
    const p = defaultPhotoParams()
    const ss = steadyState(p)
    expect(ss.S0 + ss.S1 + ss.T1).toBeCloseTo(p.cTot, 9)
  })

  it('steadyState 各 d/dt 残差为 0（自洽）', () => {
    const p = defaultPhotoParams()
    const ss = steadyState(p)
    const kTeff = effectiveTripletDecay(p)
    const dS1 = p.k_exc * ss.S0 - (p.k_f + p.k_isc) * ss.S1
    const dT1 = p.k_isc * ss.S1 - kTeff * ss.T1
    const dO1 = p.k_q * p.O2 * ss.T1 - p.k_d * ss.singletO2
    expect(dS1).toBeCloseTo(0, 9)
    expect(dT1).toBeCloseTo(0, 9)
    expect(dO1).toBeCloseTo(0, 9)
  })

  it('φ_T,ss 与三线态占比一致（0<φ_T<1）', () => {
    const p = defaultPhotoParams()
    const ss = steadyState(p)
    expect(ss.phiTss).toBeGreaterThan(0)
    expect(ss.phiTss).toBeLessThan(1)
    expect(ss.phiTss).toBeCloseTo(ss.T1 / p.cTot, 9)
  })
})

describe('★ 对拍护栏：RK4 数值积分收敛到解析稳态', () => {
  it('[T1] / [¹O2] 长时间积分 ≈ 解析稳态（相对容差 1e-3）', () => {
    const p = defaultPhotoParams()
    const ss = steadyState(p)
    const traj = integratePhotosensitization(p)
    const last = traj[traj.length - 1]
    expect(last.t).toBeGreaterThan(0)
    // 相对容差对拍（比照 ising/heat 的解析对拍铁律）
    expect(Math.abs(last.T1 - ss.T1) / ss.T1).toBeLessThan(1e-3)
    expect(Math.abs(last.singletO2 - ss.singletO2) / ss.singletO2).toBeLessThan(1e-3)
  })

  it('稳态 ¹O2 生成率 G_ss = k_q·[³O2]·T1_ss（解析与积分末态一致）', () => {
    const p = defaultPhotoParams()
    const ss = steadyState(p)
    const traj = integratePhotosensitization(p)
    const last = traj[traj.length - 1]
    const gAnalytic = p.k_q * p.O2 * ss.T1
    const gNumeric = p.k_q * p.O2 * last.T1
    expect(ss.genRateSinglet).toBeCloseTo(gAnalytic, 9)
    expect(Math.abs(gNumeric - gAnalytic) / gAnalytic).toBeLessThan(1e-3)
  })
})

describe('守恒（数值积分全程）', () => {
  it('每步总敏化剂浓度守恒 S0+S1+T1 ≈ C_tot', () => {
    const p = defaultPhotoParams()
    const traj = integratePhotosensitization(p)
    for (const s of traj) {
      expect(s.S0 + s.S1 + s.T1).toBeCloseTo(p.cTot, 6)
    }
  })
})

describe('Type I / Type II 分支占比随 [³O2] 单调', () => {
  it('branchFractions 占比和为 1（含失活道）', () => {
    const p = defaultPhotoParams()
    const f = branchFractions(p)
    expect(f.typeII + f.typeI + f.deactivation).toBeCloseTo(1, 9)
  })

  it('氧浓度 ↑ → Type II 占比 ↑（严格单调）', () => {
    const base = defaultPhotoParams()
    const fLow = branchFractions({ ...base, O2: 0.2 })
    const fMid = branchFractions({ ...base, O2: 1.0 })
    const fHigh = branchFractions({ ...base, O2: 5.0 })
    expect(fLow.typeII).toBeLessThan(fMid.typeII)
    expect(fMid.typeII).toBeLessThan(fHigh.typeII)
  })

  it('氧浓度 ↑ → Type I 占比 ↓（被 Type II 抢占）', () => {
    const base = defaultPhotoParams()
    const fLow = branchFractions({ ...base, O2: 0.2 })
    const fHigh = branchFractions({ ...base, O2: 5.0 })
    expect(fHigh.typeI).toBeLessThan(fLow.typeI)
  })

  it('稳态 ¹O2 生成随 [³O2] 升而升（更多氧 → 更多单线态氧）', () => {
    const base = defaultPhotoParams()
    const gLow = steadyState({ ...base, O2: 0.5 }).genRateSinglet
    const gHigh = steadyState({ ...base, O2: 3.0 }).genRateSinglet
    expect(gHigh).toBeGreaterThan(gLow)
  })
})

describe('参数默认值合理（正、非平凡）', () => {
  it('defaultPhotoParams 全部速率为正、初值占比归一于 S0', () => {
    const p: PhotoParams = defaultPhotoParams()
    for (const k of [p.k_exc, p.k_f, p.k_isc, p.k_T, p.k_q, p.k_d] as const) {
      expect(k).toBeGreaterThan(0)
    }
    expect(p.cTot).toBeGreaterThan(0)
    expect(p.steps).toBeGreaterThan(0)
    expect(p.dt).toBeGreaterThan(0)
  })
})

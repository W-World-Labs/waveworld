// LJ 约化单位 ↔ SI 物理单位换算。约化体系 ε=σ=m=k_B=1；给定材料的 (σ,ε,m) 标度回真实单位。
// 单位巧合（MD 常用）：σ[nm]·√(m[amu]/ε[kJ/mol]) = τ[ps]。温度 T[K]=T*·ε/k_B。
// 见 WaveWorld WebGPU 仿真框架愿景（参数对齐 + 定性档→定量档）。

export const KB_KJ_PER_MOL_K = 0.0083145 // 玻尔兹曼常数，kJ/mol/K
export const N_A = 6.02214076e23          // 阿伏伽德罗常数，/mol

/** 材料的 LJ 标度三元组（来自真实力场参数）。 */
export interface LjScale {
  sigma_nm: number       // 长度标度 σ
  epsilon_kJmol: number  // 能量标度 ε
  mass_amu: number       // 质量标度 m
}

/** 派生标度（含时间 τ）。 */
export interface DerivedScale extends LjScale {
  tau_ps: number         // 时间标度 τ = σ√(m/ε)，单位 ps
  temp_K_per_Tstar: number // 温度换算：T[K] = T* · ε/k_B
}

export function makeScale(s: LjScale): DerivedScale {
  return {
    ...s,
    tau_ps: s.sigma_nm * Math.sqrt(s.mass_amu / s.epsilon_kJmol),
    temp_K_per_Tstar: s.epsilon_kJmol / KB_KJ_PER_MOL_K,
  }
}

/** 约化温度 T* → 开尔文。 */
export function tStarToKelvin(tStar: number, s: DerivedScale): number {
  return tStar * s.temp_K_per_Tstar
}
/** 开尔文 → 约化温度 T*。 */
export function kelvinToTStar(tK: number, s: DerivedScale): number {
  return tK / s.temp_K_per_Tstar
}
/** 约化长度 → nm。 */
export function reducedLengthToNm(rStar: number, s: DerivedScale): number {
  return rStar * s.sigma_nm
}
/** 约化时间 → ps。 */
export function reducedTimeToPs(tStar: number, s: DerivedScale): number {
  return tStar * s.tau_ps
}

/** 约化扩散系数 D* → nm²/ps（D[nm²/ps] = D*·σ²/τ，σ[nm]、τ[ps]）。 */
export function diffusionReducedToNm2PerPs(dStar: number, s: DerivedScale): number {
  return (dStar * s.sigma_nm * s.sigma_nm) / s.tau_ps
}

/**
 * 约化压强 P* → SI（P_SI = P*·ε/σ^dim，ε 焦耳/分子、σ 米）。
 * dim=3 → 帕斯卡 Pa（N/m²）；dim=2 → N/m（二维「面压」/线张力，本 MD 默认）。
 * 维度必须显式传入——2D 体系不是 Pa。
 */
export function pressureReducedToSI(pStar: number, s: LjScale, dim: number): number {
  const epsJ = (s.epsilon_kJmol * 1e3) / N_A // kJ/mol → J/分子
  const sigmaM = s.sigma_nm * 1e-9           // nm → m
  return (pStar * epsJ) / Math.pow(sigmaM, dim)
}

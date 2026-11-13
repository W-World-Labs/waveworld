// 三线态 → ROS 光/声敏化动力学（Jablonski 速率方程组）——纯 CPU 数值核心，
// 与热扩散/Ising/RC 暂态同档：RK4 时间积分 + 解析稳态做 sample/expected 对拍闸门。
//
// 状态量（敏化剂分子在各电子态的浓度/占比 + 单线态氧池）：
//   [S0] 基态、[S1] 单线态激发态、[T1] 三线态激发态、[¹O2] 单线态氧。
//   基态三重态氧 [³O2] 作给定氧池参数（PDT/SDT 共享的氧依赖）。
//
// 速率过程（spec §5.1，Type II 为主、Type I 可选）：
//   S0 --k_exc--> S1            激发（PDT=光泵浦；SDT=超声激活率，抽象为输入参数）
//   S1 --k_f--> S0             荧光/内转换
//   S1 --k_isc--> T1           系间窜越 ISC
//   T1 --k_T--> S0             磷光/失活
//   T1 + ³O2 --k_q--> S0 + ¹O2  Type II 能量转移（→ 单线态氧 ¹O2）
//   ¹O2 --k_d--> ³O2           ¹O2 衰减（细胞内 µs 寿命）
//   T1 + 底物 --k_I--> 自由基    Type I 电子/氢转移（→ O2·⁻/·OH，可选）
//
// 守恒：敏化剂在三个电子态间循环，S0+S1+T1 = C_tot 全程守恒（¹O2 自成一池）。
//
// ODE：
//   dS0/dt = −k_exc·S0 + k_f·S1 + (k_T + k_q·[³O2] + k_I·[sub])·T1
//   dS1/dt =  k_exc·S0 − (k_f + k_isc)·S1
//   dT1/dt =  k_isc·S1 − (k_T + k_q·[³O2] + k_I·[sub])·T1
//   d¹O2/dt = k_q·[³O2]·T1 − k_d·¹O2
//
// 稳态解析解（对拍护栏的「精确解」一侧）：令
//   k_T,eff = k_T + k_q·[³O2] + k_I·[sub]，a = k_exc/(k_f+k_isc)，b = k_isc/k_T,eff，
//   则 S0_ss = C_tot/(1+a+a·b)，S1_ss = a·S0_ss，T1_ss = a·b·S0_ss，
//   φ_T,ss = T1_ss/C_tot = a·b/(1+a+a·b)，¹O2_ss = k_q·[³O2]·T1_ss/k_d。

/** Jablonski 速率方程参数（速率常数单位 1/s，浓度单位约化无量纲）。 */
export interface PhotoParams {
  k_exc: number   // 激发率（PDT 光泵浦 / SDT 超声激活，抽象输入）
  k_f: number     // S1→S0 荧光/内转换
  k_isc: number   // S1→T1 系间窜越
  k_T: number     // T1→S0 磷光/失活（氧无关道）
  k_q: number     // T1+³O2 Type II 猝灭速率常数（×[³O2] 得伪一级率）
  k_d: number     // ¹O2 衰减
  k_I: number     // T1+底物 Type I 速率常数（×[sub] 得伪一级率；0=关闭 Type I）
  O2: number      // [³O2] 基态氧池浓度
  substrate: number // [sub] Type I 底物浓度
  cTot: number    // 总敏化剂浓度 C_tot（守恒量）
  dt: number      // RK4 步长
  steps: number   // 积分步数
}

/** 合理默认（速率常数取「ISC 快、Type II 在常氧下主导」的典型形态）。 */
export function defaultPhotoParams(): PhotoParams {
  return {
    k_exc: 0.5,
    k_f: 2.0,
    k_isc: 3.0,
    k_T: 0.2,
    k_q: 1.5,
    k_d: 5.0,
    k_I: 0.3,
    O2: 1.0,
    substrate: 1.0,
    cTot: 1.0,
    dt: 0.01,
    steps: 4000,
  }
}

/** T1 总失活伪一级率 k_T,eff = k_T + k_q·[³O2] + k_I·[sub]。 */
export function effectiveTripletDecay(p: PhotoParams): number {
  return p.k_T + p.k_q * p.O2 + p.k_I * p.substrate
}

/** 仿真状态：四浓度 + 时间。 */
export interface PhotoState {
  t: number
  S0: number
  S1: number
  T1: number
  singletO2: number
}

/** 解析稳态（含三线态占比 φ_T,ss 与稳态 ¹O2 生成率 G_ss）。 */
export interface SteadyState {
  S0: number
  S1: number
  T1: number
  singletO2: number
  phiTss: number        // 稳态三线态占比 T1_ss/C_tot
  genRateSinglet: number // 稳态 ¹O2 生成率 G_ss = k_q·[³O2]·T1_ss
}

/** 解析稳态（守恒 + 各 d/dt=0 的闭式解）。 */
export function steadyState(p: PhotoParams): SteadyState {
  const kTeff = effectiveTripletDecay(p)
  const a = p.k_exc / (p.k_f + p.k_isc)
  const b = p.k_isc / kTeff
  const S0 = p.cTot / (1 + a + a * b)
  const S1 = a * S0
  const T1 = a * b * S0
  const genRateSinglet = p.k_q * p.O2 * T1
  const singletO2 = genRateSinglet / p.k_d
  return { S0, S1, T1, singletO2, phiTss: T1 / p.cTot, genRateSinglet }
}

/** T1 失活道的分支占比：Type II（→¹O2）/ Type I（→自由基）/ 氧无关失活，和为 1。 */
export interface BranchFractions {
  typeII: number
  typeI: number
  deactivation: number
}

/** T1 去激各道占比（伪一级率归一）：氧 ↑ → Type II 占比 ↑（抢占 Type I/失活）。 */
export function branchFractions(p: PhotoParams): BranchFractions {
  const kTeff = effectiveTripletDecay(p)
  return {
    typeII: (p.k_q * p.O2) / kTeff,
    typeI: (p.k_I * p.substrate) / kTeff,
    deactivation: p.k_T / kTeff,
  }
}

/** ODE 右端：dy/dt（y=[S0,S1,T1,¹O2]）。 */
function deriv(s: PhotoState, p: PhotoParams): [number, number, number, number] {
  const kTeff = effectiveTripletDecay(p)
  const dS0 = -p.k_exc * s.S0 + p.k_f * s.S1 + kTeff * s.T1
  const dS1 = p.k_exc * s.S0 - (p.k_f + p.k_isc) * s.S1
  const dT1 = p.k_isc * s.S1 - kTeff * s.T1
  const dO1 = p.k_q * p.O2 * s.T1 - p.k_d * s.singletO2
  return [dS0, dS1, dT1, dO1]
}

/** 经典 RK4 单步推进（不修改入参），返回新状态。 */
export function rk4Step(s: PhotoState, p: PhotoParams, dt: number): PhotoState {
  const apply = (
    base: PhotoState,
    k: [number, number, number, number],
    h: number,
  ): PhotoState => ({
    t: base.t,
    S0: base.S0 + h * k[0],
    S1: base.S1 + h * k[1],
    T1: base.T1 + h * k[2],
    singletO2: base.singletO2 + h * k[3],
  })
  const k1 = deriv(s, p)
  const k2 = deriv(apply(s, k1, dt / 2), p)
  const k3 = deriv(apply(s, k2, dt / 2), p)
  const k4 = deriv(apply(s, k3, dt), p)
  return {
    t: s.t + dt,
    S0: s.S0 + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    S1: s.S1 + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    T1: s.T1 + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
    singletO2: s.singletO2 + (dt / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]),
  }
}

/** 初态：全敏化剂在基态 S0=C_tot，激发态与 ¹O2 为 0，t=0。 */
export function initPhotoState(p: PhotoParams): PhotoState {
  return { t: 0, S0: p.cTot, S1: 0, T1: 0, singletO2: 0 }
}

/**
 * RK4 时间积分，返回 [T1]、[¹O2] 等随时间的轨迹（含初态）。
 * 与解析稳态 steadyState 对拍：长时间末态 ≈ 稳态（相对容差）。
 */
export function integratePhotosensitization(p: PhotoParams): PhotoState[] {
  const traj: PhotoState[] = []
  let s = initPhotoState(p)
  traj.push(s)
  for (let i = 0; i < p.steps; i++) {
    s = rk4Step(s, p, p.dt)
    traj.push(s)
  }
  return traj
}

// 原子力显微镜 (AFM) 原理：针尖-表面 Lennard-Jones 力 → 悬臂(弹簧)偏转 → 反映表面形貌。
//   U(d) = 4ε[(σ/d)¹² − (σ/d)⁶]，  F(d) = −dU/dd = 24ε/d·[2(σ/d)¹² − (σ/d)⁶]
//   F>0 排斥(近)，F<0 吸引(远)，F=0 在 d0 = σ·2^(1/6)。悬臂偏转 z = F/k。
//
// 恒力（接触）模式：扫描器不是把针尖停在固定基座高度，而是由 PI 反馈环逐列
// 调节针尖高度 z(x)，使实测悬臂偏转 dMeas = F_LJ(z − h(x))/k 跟踪设定偏转。
// 记录收敛后的 z 为形貌通道，残余偏转误差为误差通道——这就是真实 AFM 的
// topography / error 两路输出。

export const LJ_MIN = (sigma: number) => sigma * Math.pow(2, 1 / 6)

/** Minimum tip–sample gap as a fraction of σ (soft-core; matches scanLine). */
const D_MIN_FRAC = 0.2

/** 针尖-样品力（正=排斥）。d 下限 D_MIN_FRAC·σ，避免 d→0 发散。 */
export function ljForce(d: number, eps = 1, sigma = 1): number {
  const dd = Math.max(d, D_MIN_FRAC * sigma)
  const s6 = (sigma / dd) ** 6, s12 = s6 * s6
  return (24 * eps / dd) * (2 * s12 - s6)
}

/** 悬臂偏转（胡克定律）。 */
export function deflection(force: number, k: number): number {
  return force / k
}

/** 开环偏转模式：在基座高度 base 扫描，直接返回各点 F/k（无反馈）。 */
export function scanLine(surface: number[], base: number, k: number, eps = 1, sigma = 1): number[] {
  return scanForces(surface, base, eps, sigma).map(force => deflection(force, k))
}

export const AFM_SAMPLES = 220
// 表面形貌（σ 单位）：几个「原子」凸起 + 一个台阶
function buildAFMSurface(): number[] {
  const s: number[] = []
  for (let i = 0; i < AFM_SAMPLES; i++) {
    const x = i / AFM_SAMPLES
    let h = 0
    for (const c of [0.2, 0.32, 0.44]) h += 1.6 * Math.exp(-((x - c) ** 2) / 0.0006) // 原子团簇
    if (x > 0.62 && x < 0.9) h += 1.1 // 台阶
    h += 0.15 * Math.sin(x * 80) * (x > 0.62 && x < 0.9 ? 1 : 0) // 台阶上的晶格起伏
    s.push(h)
  }
  return s
}

function scanForces(surface: number[], base: number, eps = 1, sigma = 1): number[] {
  return surface.map(h => ljForce(base - h, eps, sigma))
}

// —— 恒力模式反馈环参数 ——
// 设定力取间隙 0.9σ 处的排斥力（d < d0 的排斥支上 F 单调，反馈可锁）。
const SET_GAP = 0.9
// 工作点处 dF/dg 的幅值（σ=ε=1 单位）：F'(0.9σ) ≈ −2.3e3。
// PI 增益按 k/|F'| 归一化，使环路易收敛于 k∈[2,20] 全范围。
const F_SLOPE_AT_SET = 2333
const KP_GAIN = 0.4 // 比例：相对开环增益的份额
const KI_GAIN = 0.08 // 积分：消残差
const PI_ITERS = 200 // 每列反馈迭代次数
const SLEW = 0.25 // 压电每迭代最大行程（σ），即扫描器响应速率限制

export interface AfmScene {
  base: number // 起始进针高度（σ），反馈环首列从此开始逼近
  k: number // 悬臂劲度系数
  setpoint?: number // 可选：力设定值（约化单位，>0 取排斥支），缺省为 F(0.9σ)
}

/**
 * 恒力接触模式扫描：对每列 x，PI 环迭代调节针尖高度 z，
 * 使悬臂偏转 dMeas = F_LJ(z − h)/k → dSet = F_set/k。
 * 返回：
 *  - surface/gaps/forces/deflections：真实表面、收敛间隙、实测力与实测偏转
 *  - topography：记录的针尖高度 z(x)（= 压电位置，含恒定接触间隙偏置）
 *  - errors：残余偏转误差 dMeas − dSet（误差信号通道）
 *  - setpoint：实际使用的偏转设定值
 */
export function afmScanResult(scene: AfmScene) {
  const surface = buildAFMSurface()
  const k = scene.k
  const fSet = scene.setpoint !== undefined && Number.isFinite(scene.setpoint) && scene.setpoint > 0
    ? scene.setpoint
    : ljForce(SET_GAP)
  const dSet = deflection(fSet, k)

  const gaps: number[] = []
  const forces: number[] = []
  const deflections: number[] = []
  const topography: number[] = []
  const errors: number[] = []

  const kp = (KP_GAIN * k) / F_SLOPE_AT_SET
  const ki = (KI_GAIN * k) / F_SLOPE_AT_SET
  const iLim = 1.0 / ki // 积分项绝对上限 1σ

  // 行扫描有记忆：每列从上一列的针尖位置继续（真实光栅扫描的暖启动）
  let z = scene.base
  for (const h of surface) {
    let integ = 0
    let dMeas = 0
    for (let it = 0; it < PI_ITERS; it++) {
      const gap = Math.max(z - h, D_MIN_FRAC)
      dMeas = deflection(ljForce(gap), k)
      const err = dSet - dMeas // >0 → 偏转不足 → 需要更近
      const raw = -(kp * err + ki * integ) // err>0 → z 下降
      const step = Math.min(SLEW, Math.max(-SLEW, raw))
      // 抗饱和（条件积分）：压电被速率限幅时不累积积分，防止进针/过冲期间卷绕
      if (Math.abs(raw) <= SLEW) integ = Math.min(iLim, Math.max(-iLim, integ + err))
      z += step
      // 提早收敛则跳出
      if (Math.abs(err) < 1e-9 * (1 + Math.abs(dSet))) break
    }
    const gap = Math.max(z - h, D_MIN_FRAC)
    const force = ljForce(gap)
    dMeas = deflection(force, k)
    topography.push(z)
    gaps.push(gap)
    forces.push(force)
    deflections.push(dMeas)
    errors.push(dMeas - dSet)
  }
  return { surface, gaps, forces, deflections, topography, errors, setpoint: dSet }
}

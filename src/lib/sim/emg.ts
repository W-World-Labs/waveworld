import { rng as seededRng } from '../mc'

// 肌电 EMG 参考核心（纯函数，无 React / 无副作用，供 TDD 与页面复用）。
// 物理：肌肉收缩时，许多运动单元（运动神经元 + 其支配的肌纤维）各自发放
// 动作电位（MUAP）。表面电极采集到的是这些电位在时间上的叠加 ——
// 高频、随机、双极性的「干涉模式」（interference pattern）。
//
// 本模块实现经典 Fuglevand 风格运动单元池模型：
//   · 募集（recruitment / size principle）：MU i 的募集阈值按指数分布
//     thr_i = e^{i·ln(RR)/N}/RR ∈ [1/RR, 1]，驱动 a ≥ thr_i 时该单元开始放电；
//   · 幅度：MUAP 幅度同样按 size principle 分布 amp_i = e^{i·ln(RP)/N}/RP，
//     大单元（高阈值）产生大幅 MUAP；
//   · 频率编码（rate coding）：已募集单元的放电率
//     rate_i = FR_BASE + FR_SPAN·(a − thr_i)/(1 − thr_i)，从 8 Hz 到 ~35 Hz；
//   · 每个发放时刻卷积一个三相互零均值 MUAP 模板（高斯二阶导），
//     全部 MUAP 相加 + 电极基线噪声 = 输出。
// 干涉信号的方差由 Campbell 散粒噪声定理给出：Var = Σᵢ λᵢ·ampᵢ²·Σtemplate²，
// emgSample 用这个真实方差做单点抽取，与完整卷积仿真的幅度律一致。

const BASELINE = 0.02 // 基线噪声幅度（静息时的电极/放大器本底）
const MU_COUNT = 60 // 运动单元池大小（小型手部肌肉量级）
const RECRUIT_SPAN = 40 // RR：最高/最低募集阈值比（Fuglevand 指数阈值分布）
const MUAP_SPAN = 50 // RP：最大/最小 MUAP 幅度比（size principle）
const FR_BASE = 8 // 募集起始放电率（Hz）
const FR_SPAN = 27 // 频率编码增益：满驱动时 ≈ 35 Hz
const FIRE_CV = 0.2 // 发放间隔抖动（相对均值的 CV，均匀抖动）
const MUAP_SIGMA = 0.0035 // MUAP 模板宽度 σ（秒）→ 总时长 ~25 ms
const MUAP_HALFSIGMA = 3.5 // 模板截断在 ±3.5σ
const TARGET_RMS = 0.35 // 满驱动（a=1）干涉信号的目标 RMS 标定

// ── 运动单元池常量（募集阈值 / MUAP 幅度 / 模板能量）─────────────────

/** thr_i ∈ [1/RR, 1]：募集阈值（驱动 a 超过它才放电） */
const MU_THR = Array.from({ length: MU_COUNT }, (_, i) =>
  Math.exp(((i + 1) * Math.log(RECRUIT_SPAN)) / MU_COUNT) / RECRUIT_SPAN)
/** amp_i ∈ [~1/RP, 1]：MUAP 峰值幅度（大单元大幅） */
const MU_AMP = Array.from({ length: MU_COUNT }, (_, i) =>
  Math.exp(((i + 1) * Math.log(MUAP_SPAN)) / MU_COUNT) / MUAP_SPAN)

export const EMG_SAMPLE_RATE = 512

/** 三相互零均值 MUAP 模板：m(τ) = (1 − (τ/σ)²)·exp(−τ²/2σ²)，±3.5σ 截断 */
const MUAP_TEMPLATE = (() => {
  const half = Math.ceil(MUAP_HALFSIGMA * MUAP_SIGMA * EMG_SAMPLE_RATE)
  const sigS = MUAP_SIGMA * EMG_SAMPLE_RATE // σ 以样本计
  const t = new Array<number>(2 * half + 1)
  for (let k = 0; k < t.length; k++) {
    const u = (k - half) / sigS
    t[k] = (1 - u * u) * Math.exp(-(u * u) / 2)
  }
  return t
})()
const MUAP_E2 = MUAP_TEMPLATE.reduce((s, v) => s + v * v, 0) // Σtemplate²（样本域能量）

/** MU i 在驱动 a 下的放电率（Hz）；未募集 → 0 */
function muRate(a: number, thr: number): number {
  if (a <= thr) return 0
  return FR_BASE + (FR_SPAN * (a - thr)) / (1 - thr)
}

/**
 * 干涉爆发方差（未乘增益）：Campbell 散粒噪声定理
 *   Var = Σᵢ (rate_i/fs)·amp_i²·Σtemplate²
 * 随 a 增大而单调上升（更多单元被募集 + 已募集单元放电更快）。
 */
function shotVariance(a: number): number {
  let v = 0
  for (let i = 0; i < MU_COUNT; i++) {
    const r = muRate(a, MU_THR[i])
    if (r > 0) v += (r / EMG_SAMPLE_RATE) * MU_AMP[i] * MU_AMP[i] * MUAP_E2
  }
  return v
}

/** 整体增益标定：满驱动 a=1 时干涉信号 RMS ≈ TARGET_RMS */
const MU_GAIN = TARGET_RMS / Math.sqrt(shotVariance(1))

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

/**
 * 生成一段 EMG 通道信号：对全部已募集运动单元做抖动 renewal 脉冲列，
 * 每个发放卷积三相互 MUAP 模板并求和，最后加基线均匀噪声。
 * 确定性：所有随机性来自注入的 rng（mulberry32 流）。
 * @param activation 收缩强度 a ∈ [0,1]
 * @param n          样本数
 * @param rng        [0,1) 随机源
 */
export function emgChannel(activation: number, n: number, rng: () => number): number[] {
  const a = clamp01(activation)
  const out = new Array<number>(n).fill(0)
  const half = (MUAP_TEMPLATE.length - 1) / 2
  for (let i = 0; i < MU_COUNT; i++) {
    const rate = muRate(a, MU_THR[i])
    if (rate <= 0) continue
    const meanIsi = EMG_SAMPLE_RATE / rate // 平均发放间隔（样本）
    const amp = MU_AMP[i]
    let next = meanIsi * (0.5 + rng()) // 首个发放的随机相位（去同步）
    while (next < n + half) {
      const s = Math.round(next)
      for (let k = 0; k < MUAP_TEMPLATE.length; k++) {
        const idx = s + k - half
        if (idx >= 0 && idx < n) out[idx] += amp * MUAP_TEMPLATE[k]
      }
      next += meanIsi * (1 + FIRE_CV * (2 * rng() - 1))
    }
  }
  for (let i = 0; i < n; i++) out[i] = out[i] * MU_GAIN + (rng() - 0.5) * 2 * BASELINE
  return out
}

/**
 * 单个 EMG 采样值（双极性，零均值附近）。
 * activation∈[0,1]：收缩强度。返回 = 基线小噪声 + 按募集/率编码真实方差
 * 缩放的零均值三角分布毛刺（单点抽取，无时间相关结构；完整干涉模式见 emgChannel）。
 * rng: ()=>number，返回 [0,1) 的随机数源（注入以便确定性测试）。
 */
export function emgSample(activation: number, rng: () => number): number {
  const a = clamp01(activation)
  const baseline = (rng() - 0.5) * 2 * BASELINE
  const std = MU_GAIN * Math.sqrt(shotVariance(a))
  const burst = (rng() - rng()) * std * Math.sqrt(6) // U1−U2 的方差为 1/6 → 归一
  return baseline + burst
}

/**
 * n 个 EMG 采样的 RMS（均方根）——即整流后的包络幅度，临床上正比于收缩强度。
 * 由完整 MUAP 卷积仿真产生，幅度严格服从募集 + 频率编码关系。
 */
export function emgRMS(activation: number, n: number, rng: () => number): number {
  if (n <= 0) return 0
  const x = emgChannel(activation, n, seededRng(Math.floor(rng() * 4294967296)))
  let sumSq = 0
  for (let i = 0; i < n; i++) sumSq += x[i] * x[i]
  return Math.sqrt(sumSq / n)
}

export type EmgScene = { agonist: number; antag: number; seed: number; samples: number }
export const EMG_RMS_WINDOW = 64
export function emgResult(scene: EmgScene) {
  const random = seededRng(scene.seed)
  // 两通道各自独立的确定性随机流（同一 seed → 同一输出）
  const seedA = Math.floor(random() * 4294967296)
  const seedB = Math.floor(random() * 4294967296)
  const channels: number[][] = [
    emgChannel(scene.agonist, scene.samples, seededRng(seedA)),
    emgChannel(scene.antag, scene.samples, seededRng(seedB)),
  ]
  const rms: number[][] = [[], []]
  const sums = [0, 0]
  for (let i = 0; i < scene.samples; i++) for (let ch = 0; ch < 2; ch++) {
    const value = channels[ch][i]; sums[ch] += value * value
    if (i >= EMG_RMS_WINDOW) sums[ch] -= channels[ch][i - EMG_RMS_WINDOW] ** 2
    rms[ch].push(Math.sqrt(Math.max(0, sums[ch]) / Math.min(i + 1, EMG_RMS_WINDOW)))
  }
  // Uniform baseline in [-BASELINE,+BASELINE): exact RMS, no repeated Monte Carlo in React render.
  return { channels, rms, sampleRate: EMG_SAMPLE_RATE, baselineRms: BASELINE / Math.sqrt(3) }
}

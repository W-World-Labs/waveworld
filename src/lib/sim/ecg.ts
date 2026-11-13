import type { SignalRecording } from '../signal-recording'

// 心电图 ECG 合成 —— McSharry 动力学模型（IEEE TBME 2003, 50(3):289–294）
//
// 不再用「相位上叠高斯」的玩具波形，而是直接积分论文中的三常微分方程组：
//   ẋ = α·x − ω·y
//   ẏ = α·y + ω·x
//   ż = −Σᵢ aᵢ·Δθᵢ·exp(−Δθᵢ² / 2bᵢ²) − (z − z₀(t))
// 其中 α = 1 − √(x²+y²) 把轨迹吸向单位圆极限环，θ = atan2(y,x) 是心动周期角相位，
// Δθᵢ = wrap(θ − θᵢ, (−π,π]) 是到第 i 个特征波（P/Q/R/S/T）角位置的角距，
// ω = 2π·hr/60 是相位角速度，z 即体表导联电压（模型任意单位，下面按 R≈1 mV 标定）。
// z₀(t) = 0.005·sin(2π·0.25·t) 为呼吸性基线漂移（ecgsyn 原始实现的默认形式）。
//
// 由于 α 的构造使 θ̇ ≡ ω 精确成立，把初值放在单位圆上 (x,y)=(cosθ₀,sinθ₀) 就已
// 处于极限环；只需让 z 经过数秒预热进入准周期稳态（z 的暂态按 e^{−t} 衰减）。
// 积分一律使用经典 RK4（不用 Euler）；240 Hz 步长下与 960 Hz 参考结果一致到 1e-4。
//
// 心率相关的形态缩放沿用 ecgsyn：bᵢ·√(hr/60)（事件宽度随 √hr 加宽角域 = 时域变窄，
// 且恰好抵消 z 振幅 ∝1/ω 的趋势）、θ_P·(hr/60)^¼、θ_Q/θ_S·√(hr/60)（PR/QRS 随心率
// 缩短——即真实 QT 缩短效应）。
//
// 纯函数、无副作用、可导出，供页面与测试复用。

/** ecgsyn 标准特征波参数（P,Q,R,S,T 顺序） */
const MCSHARRY_THETA = [-60, -15, 0, 15, 90].map((d) => (d * Math.PI) / 180)
const MCSHARRY_A = [1.2, -5.0, 30.0, -7.5, 0.75]
const MCSHARRY_B = [0.25, 0.1, 0.1, 0.1, 0.4]

/** 呼吸性基线漂移：0.25 Hz 呼吸频率，0.005 模型单位幅度（ecgsyn 默认） */
const RESP_HZ = 0.25
const RESP_AMP = 0.005

/** 模型 z 单位 → mV 标定增益：60 bpm 时 R 峰 ≈ 1.0 mV（导联 II 正常量级） */
const MV_GAIN = 24

/** 预热时长（秒）：z 子系统是时间常数 1 s 的稳定滤波，8 s 后暂态残余 ~e⁻⁸≈3e-4 */
const WARMUP_S = 8

type Vec3 = [number, number, number]

/** 心率依赖的 McSharry 参数（ω + 形态缩放后的 θᵢ/aᵢ/bᵢ） */
interface McSharryParams {
  w: number
  theta: number[]
  a: readonly number[]
  b: number[]
}

function mcSharryParams(hr: number): McSharryParams {
  const w = (2 * Math.PI * hr) / 60
  const hrf = Math.sqrt(hr / 60)
  const hrf2 = Math.sqrt(hrf)
  const theta = MCSHARRY_THETA.slice()
  const b = MCSHARRY_B.map((v) => v * hrf)
  theta[0] *= hrf2 // P 角位置随 hr^¼ 前移（PR 间期缩短）
  theta[1] *= hrf // Q
  theta[3] *= hrf // S
  return { w, theta, a: MCSHARRY_A, b }
}

/** 角距 wrap 到 (−π, π] */
function wrapPi(x: number): number {
  let d = (x + Math.PI) % (2 * Math.PI)
  if (d < 0) d += 2 * Math.PI
  return d - Math.PI
}

/** 呼吸性基线 z₀(t)，模型单位 */
function zBase(t: number): number {
  return RESP_AMP * Math.sin(2 * Math.PI * RESP_HZ * t)
}

/** McSharry 三方程右端；z0 为当前基线电平（呼吸漂移由调用方注入） */
function deriv(s: Vec3, z0: number, p: McSharryParams): Vec3 {
  const [x, y, z] = s
  const alpha = 1 - Math.hypot(x, y)
  const theta = Math.atan2(y, x)
  let f = 0
  for (let i = 0; i < 5; i++) {
    const d = wrapPi(theta - p.theta[i])
    f += p.a[i] * d * Math.exp(-(d * d) / (2 * p.b[i] * p.b[i]))
  }
  return [alpha * x - p.w * y, alpha * y + p.w * x, -f - (z - z0)]
}

/** 经典四阶 Runge–Kutta 单步；z0Of 给出 t 处的基线电平 */
function rk4(s: Vec3, t: number, dt: number, p: McSharryParams, z0Of: (t: number) => number): Vec3 {
  const k1 = deriv(s, z0Of(t), p)
  const s2: Vec3 = [s[0] + 0.5 * dt * k1[0], s[1] + 0.5 * dt * k1[1], s[2] + 0.5 * dt * k1[2]]
  const k2 = deriv(s2, z0Of(t + 0.5 * dt), p)
  const s3: Vec3 = [s[0] + 0.5 * dt * k2[0], s[1] + 0.5 * dt * k2[1], s[2] + 0.5 * dt * k2[2]]
  const k3 = deriv(s3, z0Of(t + 0.5 * dt), p)
  const s4: Vec3 = [s[0] + dt * k3[0], s[1] + dt * k3[1], s[2] + dt * k3[2]]
  const k4 = deriv(s4, z0Of(t + dt), p)
  return [
    s[0] + (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    s[1] + (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    s[2] + (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
  ]
}

/** 心动周期内特征波的标称相位/宽度/幅度（60 bpm 参考值，供标注用） */
export interface EcgWave {
  /** 相位中心 μ（0..1，θ=−π 起算；R 峰在 θ=0 → μ=0.5） */
  mu: number
  /** 相位宽度 σ（由 McSharry bᵢ 折算） */
  sigma: number
  /** 幅度（正为向上、负为向下，mV 量级；60 bpm 标称） */
  amp: number
}

/**
 * 导联 II 特征波标称位置（由 McSharry θᵢ/bᵢ 折算到归一化相位，幅度为 60 bpm 实测量级）。
 * 波形本身由 ODE 产生，本表仅作标注/外部展示参考。
 */
export const ECG_WAVES: Record<'P' | 'Q' | 'R' | 'S' | 'T', EcgWave> = {
  P: { mu: (180 - 60) / 360, sigma: 0.25 / (2 * Math.PI), amp: 0.14 },
  Q: { mu: (180 - 15) / 360, sigma: 0.1 / (2 * Math.PI), amp: -0.23 },
  R: { mu: 0.5, sigma: 0.1 / (2 * Math.PI), amp: 1.0 },
  S: { mu: (180 + 15) / 360, sigma: 0.1 / (2 * Math.PI), amp: -0.4 },
  T: { mu: (180 + 90) / 360, sigma: 0.4 / (2 * Math.PI), amp: 0.33 },
}

/** RR 间期（秒）= 60 / 心率 */
export function rrInterval(hr: number): number {
  return 60 / hr
}

/** 极限环轨道表的内部分辨率（Hz） */
const ORBIT_FS = 480

/** 呼吸驱动经 z 子系统（一阶低通 τ=1 s）的稳态响应解析式：ż+z = A·sin(ω_r·t) */
function zResp(t: number): number {
  const wr = 2 * Math.PI * RESP_HZ
  return (RESP_AMP / Math.sqrt(1 + wr * wr)) * Math.sin(wr * t - Math.atan(wr))
}

/**
 * 一个心动周期的稳态极限环轨道（不含呼吸项）。
 * z 子系统 ż = F(θ(t)) − z 是线性稳定系统且 F 以 T=60/hr 为周期，故存在唯一
 * T-周期轨道。用两遍 RK4 求其不动点：z(T) = e^{−T}·z(0) + C（C 为零初值响应），
 * 解得周期初值 z* = C/(1−e^{−T})，第二遍记录整周期 z 值。
 */
function ecgOrbit(hr: number): { period: number; z: number[] } {
  const p = mcSharryParams(hr)
  const T = rrInterval(hr)
  const dt = 1 / ORBIT_FS
  const n = Math.max(8, Math.round(T * ORBIT_FS))
  // 第一遍：z(0)=0 → 测强迫响应 C（z0≡0，呼吸项由 zResp 解析叠加）
  let s: Vec3 = [-1, 0, 0]
  for (let i = 0; i < n; i++) s = rk4(s, i * dt, dt, p, () => 0)
  const zStar = s[2] / (1 - Math.exp(-T))
  // 第二遍：z(0)=z* → 记录精确 T-周期轨道
  s = [-1, 0, zStar]
  const z = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    z[i] = s[2]
    s = rk4(s, i * dt, dt, p, () => 0)
  }
  return { period: T, z }
}

/**
 * 合成心电电压（mV 量级），导联 II —— McSharry 极限环上的稳态轨迹。
 * @param tSec 绝对时间（秒）
 * @param hr   心率（bpm），周期 T = 60/hr
 * @returns    ODE 轨迹在 tSec 处的 z 值（含呼吸基线漂移），标定到 mV
 *
 * 实现：按相位在精确周期轨道表（RK4 两遍不动点求解）中线性插值，再叠加
 * 呼吸项的一阶低通稳态解析响应。与 ecgResult 的逐样本 RK4 输出一致（~1e-3 mV 内）。
 */
export function ecgWaveform(tSec: number, hr: number): number {
  const { period, z } = ecgOrbit(hr)
  let ph = (tSec % period) / period
  if (ph < 0) ph += 1
  const u = ph * z.length
  const i0 = Math.floor(u) % z.length
  const i1 = (i0 + 1) % z.length
  const f = u - Math.floor(u)
  return (z[i0] * (1 - f) + z[i1] * f + zResp(tSec)) * MV_GAIN
}

export type EcgScene = { hr: number; samples: number } | { recording: SignalRecording; channel: number }
export const ECG_SAMPLE_RATE = 240
/** Fixed-time samples; render/playback frequency never changes the signal. */
export function ecgResult(scene: EcgScene) {
  const recorded = 'recording' in scene
  const values = recorded ? scene.recording.channels[scene.channel].values.slice()
    : synthEcg(scene.hr, scene.samples)
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const rms = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length)
  return { values, sampleRate: recorded ? scene.recording.sampleRate : ECG_SAMPLE_RATE,
    bpm: recorded ? null : scene.hr, rr: recorded ? null : rrInterval(scene.hr), mean, rms,
    label: recorded ? scene.recording.channels[scene.channel].name : 'Lead II',
    unit: recorded ? scene.recording.unit : 'mV', source: recorded ? 'recording' as const : 'synthetic' as const }
}

/**
 * 逐样本 RK4 推进 McSharry 方程：先预热 WARMUP_S 秒进入稳态极限环，
 * 再以输出采样率 dt=1/ECG_SAMPLE_RATE 产生 n 个样本（values[i] = z(i·dt)）。
 */
function synthEcg(hr: number, n: number): number[] {
  const p = mcSharryParams(hr)
  const dt = 1 / ECG_SAMPLE_RATE
  const t0 = -WARMUP_S
  const th0 = -Math.PI + p.w * t0
  let s: Vec3 = [Math.cos(th0), Math.sin(th0), zBase(t0)]
  const warm = Math.round(WARMUP_S * ECG_SAMPLE_RATE)
  for (let i = 0; i < warm; i++) s = rk4(s, t0 + i * dt, dt, p, zBase)
  const values = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    values[i] = s[2] * MV_GAIN
    s = rk4(s, i * dt, dt, p, zBase)
  }
  return values
}

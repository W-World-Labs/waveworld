import { rng as seededRng } from '../mc'

// 脑电 EEG 参考核心（纯函数，无 React / 无副作用，供 TDD 与页面复用）。
// 物理：头皮电极记录到的脑电是大量皮层神经元同步活动产生的微弱电位（μV 量级），
// 习惯上按频率分成若干「频带」：δ(深睡)/θ(困倦)/α(放松闭眼)/β(清醒思考)/γ(高级认知)。
//
// 真实脑电并不是正弦叠加：每个节律是「限带随机过程」。因此本模块按真实采集模型合成：
//   · 每个频带 = 单位方差白噪声 → RBJ 双二阶带通（三节级联 ~18 dB/oct 带外衰减）
//     → 按该带冲击响应能量归一化（单位权重 ⇒ 单位方差输出）→ 乘以频带权重；
//   · 再加 1/f 粉噪本底（5 个几何分布拐点的 AR(1) 之和，逼近真实皮层功率谱底色）；
//   · 通道间用独立随机流模拟不同电极位置的非相干成分。
// `bandPower`/`dominantBand` 以及结果里的 `power`/`dominant` 都是对合成波形做
// 「带通滤波 + 方差」的真实测量，不再回显权重的平方。
//
// 各频带的节律过程使用固定内部种子（同一大脑状态的可复现实例）；scene.seed 只驱动
// 叠加的测量噪声（noise 参数），因此 noise=0 时输出与 seed 无关（协议测试约定）。

/** 五个经典 EEG 频带及其代表频率（Hz）。 */
export const BANDS: { name: string; freq: number }[] = [
  { name: 'delta', freq: 2 }, // δ ~0.5–4 Hz，深睡 / 无意识
  { name: 'theta', freq: 6 }, // θ ~4–8 Hz，困倦 / 冥想
  { name: 'alpha', freq: 10 }, // α ~8–13 Hz，清醒放松闭眼
  { name: 'beta', freq: 20 }, // β ~13–30 Hz，清醒专注
  { name: 'gamma', freq: 40 }, // γ >30 Hz，高级认知绑定
]

/** 各频带的带通边界 [f1, f2]（Hz）——合成与测量共用同一组滤波器 */
const BAND_EDGES: Record<string, [number, number]> = {
  delta: [0.5, 4],
  theta: [4, 8],
  alpha: [8, 13],
  beta: [13, 30],
  gamma: [30, 45],
}

export const EEG_SAMPLE_RATE = 256

// ── 双二阶（biquad）带通 ─────────────────────────────────────────────

interface BiquadCoef {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}
type Biquad = BiquadCoef & { s1: number; s2: number }

/** RBJ 带通（中心 0 dB 峰值增益），f0 取频带几何中心，Q = f0/(f2−f1) */
function bandpassCoef(f1: number, f2: number, fs: number): BiquadCoef {
  const f0 = Math.sqrt(f1 * f2)
  const w0 = (2 * Math.PI * f0) / fs
  const alpha = Math.sin(w0) / (2 * (f0 / (f2 - f1)))
  const cosw = Math.cos(w0)
  const a0 = 1 + alpha
  return { b0: alpha / a0, b1: 0, b2: -alpha / a0, a1: (-2 * cosw) / a0, a2: (1 - alpha) / a0 }
}

function newBiquad(c: BiquadCoef): Biquad {
  return { ...c, s1: 0, s2: 0 }
}

/** 转置直接 II 型单步 */
function biquadStep(b: Biquad, x: number): number {
  const y = b.b0 * x + b.s1
  b.s1 = b.b1 * x - b.a1 * y + b.s2
  b.s2 = b.b2 * x - b.a2 * y
  return y
}

/** 级联节数：3 节 → 带外 ~18 dB/oct，能把相邻频带（如 θ/α）大体分开 */
const CASCADE_SECTIONS = 3

function cascadeStep(secs: Biquad[], x: number): number {
  for (const s of secs) x = biquadStep(s, x)
  return x
}

/**
 * 频带噪声的归一化增益：级联滤波器冲击响应能量 Σh² 恰等于单位方差白噪声
 * 输入时的稳态输出方差（Parseval），取其倒数开方使「权重 1 ⇒ 输出方差 1」。
 */
function bandNoiseNorm(f1: number, f2: number, fs: number): number {
  const c = bandpassCoef(f1, f2, fs)
  const secs = Array.from({ length: CASCADE_SECTIONS }, () => newBiquad(c))
  let e = 0
  for (let k = 0; k < 4096; k++) {
    const y = cascadeStep(secs, k === 0 ? 1 : 0)
    e += y * y
  }
  return 1 / Math.sqrt(e)
}

/** fs = EEG_SAMPLE_RATE 时各频带的噪声归一化常数（模块加载时一次性算出） */
const BAND_NORM: Record<string, number> = Object.fromEntries(
  BANDS.map((b) => [b.name, bandNoiseNorm(...BAND_EDGES[b.name], EEG_SAMPLE_RATE)]),
)

// ── 1/f 粉噪本底（几何分布拐点的 AR(1) 之和 → PSD ≈ 1/f） ─────────────

/** AR(1) 拐点频率（Hz），几何间隔覆盖整个 EEG 范围 */
const PINK_CORNERS = [0.5, 2, 8, 32, 128]
/** 粉噪本底幅度（合成信号的 RMS 量级，μV） */
const PINK_GAIN = 0.12

// ── 通道合成器（限带随机过程之和） ─────────────────────────────────────

const EEG_STREAM_SEED = 0x51e6a // 频带节律的固定内部种子基值（非 scene.seed）

interface BandGen {
  rng: () => number
  secs: Biquad[]
  norm: number
  w: number
}

/**
 * 一个 EEG 通道的限带噪声发生器：每步 = Σ_band w·norm·BP(白噪声)
 * + 1/f 粉噪。各频带/粉噪用 (channel, band) 决定的固定种子，可复现。
 */
function makeEegChannel(weights: Record<string, number>, fs: number, ch: number) {
  const bands: BandGen[] = BANDS.map((b, i) => ({
    rng: seededRng((EEG_STREAM_SEED + ch * 7919 + i * 104729) >>> 0),
    secs: Array.from({ length: CASCADE_SECTIONS }, () =>
      newBiquad(bandpassCoef(...BAND_EDGES[b.name], fs))),
    norm: fs === EEG_SAMPLE_RATE ? BAND_NORM[b.name] : bandNoiseNorm(...BAND_EDGES[b.name], fs),
    w: weights[b.name] ?? 0,
  }))
  const pinkRng = seededRng((EEG_STREAM_SEED ^ 0x5a5a) + ch * 6151 >>> 0)
  const pink = PINK_CORNERS.map((fc) => {
    const a = Math.exp((-2 * Math.PI * fc) / fs)
    return { a, g: Math.sqrt(1 - a * a), y: 0 } // g 使各分量稳态方差 = 1
  })
  const pinkScale = PINK_GAIN / Math.sqrt(PINK_CORNERS.length)
  const next = (): number => {
    let v = 0
    for (const g of bands) {
      if (g.w === 0) continue
      // 单位方差白噪声（均匀→√12 缩放），带通后 ×norm → 权重 1 时方差 1
      const u = (g.rng() - 0.5) * Math.sqrt(12)
      v += g.w * g.norm * cascadeStep(g.secs, u)
    }
    let p = 0
    for (const f of pink) {
      f.y = f.a * f.y + f.g * (pinkRng() - 0.5) * Math.sqrt(12)
      p += f.y
    }
    return v + p * pinkScale
  }
  return { next }
}

/**
 * 在时刻 tSec（秒）采样一个合成 EEG 电位（通道 0 的限带噪声过程 + 测量噪声项）。
 * rng 只用于叠加的测量噪声（每调用一次消耗一个随机数，与旧接口约定一致）。
 * @param tSec    时间（秒）
 * @param weights 各频带权重 { delta, theta, alpha, beta, gamma }，缺省按 0 处理
 * @param rng     可选随机源（默认 Math.random）
 * @returns 合成电位（与权重同量纲，可理解为 μV）
 */
export function eegSample(
  tSec: number,
  weights: Record<string, number>,
  rng: () => number = Math.random,
): number {
  const k = Math.max(0, Math.round(tSec * EEG_SAMPLE_RATE))
  const gen = makeEegChannel(weights, EEG_SAMPLE_RATE, 0)
  let v = 0
  for (let i = 0; i <= k; i++) v = gen.next()
  const noise = (rng() - 0.5) * 0.3
  return v + noise
}

/**
 * 对一段已生成的信号测量各频带功率：每个频带做同一组级联带通滤波，
 * 取滤波输出的方差作为该带功率，再归一化到总和 1（全 0 → 全 0）。
 * 这是真实测量（滤波 + 方差），不是回显合成权重。
 */
export function measureBandPower(x: number[], fs: number): Record<string, number> {
  const raw: Record<string, number> = {}
  let total = 0
  const n = x.length
  for (const b of BANDS) {
    const c = bandpassCoef(...BAND_EDGES[b.name], fs)
    const secs = Array.from({ length: CASCADE_SECTIONS }, () => newBiquad(c))
    let sum = 0
    let sum2 = 0
    for (let i = 0; i < n; i++) {
      const y = cascadeStep(secs, x[i])
      sum += y
      sum2 += y * y
    }
    const m = n > 0 ? sum / n : 0
    const v = Math.max(0, n > 0 ? sum2 / n - m * m : 0)
    raw[b.name] = v
    total += v
  }
  const out: Record<string, number> = {}
  for (const b of BANDS) out[b.name] = total > 0 ? raw[b.name] / total : 0
  return out
}

/**
 * 各频带功率（归一化到总和 1）：内部按 weights 合成一段确定性的 8 秒通道信号
 * （含 1/f 本底），再用 measureBandPower 实测。全 0 权重 → 全 0（无节律活动）。
 * @returns { delta, theta, alpha, beta, gamma } 归一化到总和 1（全 0 时全 0）
 */
export function bandPower(weights: Record<string, number>): Record<string, number> {
  if (BANDS.every((b) => (weights[b.name] ?? 0) <= 0)) {
    return Object.fromEntries(BANDS.map((b) => [b.name, 0]))
  }
  const gen = makeEegChannel(weights, EEG_SAMPLE_RATE, 0)
  const x = Array.from({ length: 8 * EEG_SAMPLE_RATE }, () => gen.next())
  return measureBandPower(x, EEG_SAMPLE_RATE)
}

/** 返回主导频带名（实测功率最大者）。全 0 权重时返回空串。 */
export function dominantBand(weights: Record<string, number>): string {
  let best = ''
  let bestP = -1
  const p = bandPower(weights)
  for (const b of BANDS) {
    if (p[b.name] > bestP) {
      bestP = p[b.name]
      best = b.name
    }
  }
  return bestP > 0 ? best : ''
}

export const EEG_STATES: { name: string; nameEn: string; w: Record<string, number> }[] = [
  { name: '清醒专注', nameEn: 'Awake focus', w: { delta: 0.2, theta: 0.3, alpha: 0.4, beta: 1.4, gamma: 0.7 } },
  { name: '放松闭眼', nameEn: 'Relaxed eyes-closed', w: { delta: 0.3, theta: 0.5, alpha: 1.6, beta: 0.5, gamma: 0.3 } },
  { name: '困倦欲睡', nameEn: 'Drowsy', w: { delta: 0.8, theta: 1.4, alpha: 0.6, beta: 0.3, gamma: 0.15 } },
  { name: '深度睡眠', nameEn: 'Deep sleep', w: { delta: 1.8, theta: 0.6, alpha: 0.2, beta: 0.15, gamma: 0.1 } },
]

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

// state ∈ [0,3] → 权重（相邻状态间线性插值）+ 当前主导态名
export function stateWeights(
  state: number,
): { weights: Record<string, number>; stateIndex: number } {
  const s = Math.max(0, Math.min(3, state))
  const i = Math.min(2, Math.floor(s))
  const t = s - i
  const a = EEG_STATES[i].w
  const b = EEG_STATES[i + 1].w
  const weights: Record<string, number> = {}
  for (const band of BANDS) {
    weights[band.name] = lerp(a[band.name] ?? 0, b[band.name] ?? 0, t)
  }
  return { weights, stateIndex: t < 0.5 ? i : i + 1 }
}


export type EegScene = { state: number; noise: number; seed: number; samples: number }
export function eegResult(scene: EegScene) {
  const { weights, stateIndex } = stateWeights(scene.state)
  const noiseRng = seededRng(scene.seed) // scene.seed 只驱动测量噪声（noise=0 → 与 seed 无关）
  const channels: number[][] = []
  for (let ch = 0; ch < 4; ch++) {
    const gen = makeEegChannel(weights, EEG_SAMPLE_RATE, ch)
    const out = new Array<number>(scene.samples)
    for (let i = 0; i < scene.samples; i++) {
      out[i] = gen.next() + (noiseRng() - 0.5) * scene.noise * 1.2
    }
    channels.push(out)
  }
  // 实测频带功率：对每个通道滤波测方差，再对通道取平均
  const power: Record<string, number> = Object.fromEntries(BANDS.map((b) => [b.name, 0]))
  for (const x of channels) {
    const p = measureBandPower(x, EEG_SAMPLE_RATE)
    for (const b of BANDS) power[b.name] += p[b.name] / channels.length
  }
  let dominant = ''
  let bestP = -1
  for (const b of BANDS) {
    if (power[b.name] > bestP) {
      bestP = power[b.name]
      dominant = b.name
    }
  }
  return { channels, sampleRate: EEG_SAMPLE_RATE, stateIndex, power, dominant }
}

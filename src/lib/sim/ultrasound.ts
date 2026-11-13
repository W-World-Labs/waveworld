// 超声 B 模成像参考核心（纯函数，无 React / 无副作用，供 TDD 与页面复用）。
// 物理：脉冲回波卷积模型。
//   1. 由声阻抗界面构造 1D 反射率剖面 r(z)（每个离散界面按其振幅反射系数
//      r = (Z2−Z1)/(Z2+Z1) 在深度格上留下带符号冲激）。
//   2. 与真实发射脉冲卷积：高斯窗正弦 h(ζ) = exp(−ζ²/2σ²)·cos(2πζ/λ)，
//      波长 λ 与带宽（σ 以载波周期计）决定轴向分辨率。
//   3. 双程深度衰减 exp(−2∫α dz)，α 随材料分段（含低衰减囊液 → 后方增强）。
//   4. I/Q 正交解调（混频 + 高斯低通）取包络，再对数压缩成 B 模灰度。
//   散斑来自组织内的亚分辨率散射体：按场景 seed 逐线播种的随机微反射率。

/** 振幅反射系数 r = (Z2 − Z1)/(Z2 + Z1)。Z2>Z1→正；相等→0；Z2<Z1→负。 */
export function reflectionCoef(z1: number, z2: number): number {
  const denom = z2 + z1
  if (denom === 0) return 0
  return (z2 - z1) / denom
}

// —— 发射脉冲参数（以成像深度为尺度）——
// 载波在 maxDepth 内有 PULSE_CYCLES 个周期：λ = maxDepth/48 ≈ 2.1 mm @100 mm，
// 相当于 c≈1540 m/s 下 ~0.74 MHz 的低频探头；高斯窗 σ 以载波周期计 → 相对带宽 ≈ 1/(2π·1.4) ≈ 11%。
const PULSE_CYCLES = 48
const PULSE_SIGMA_CYCLES = 1.4
// I/Q 解调低通的 σ（载波周期），与脉宽同阶 → 解调后峰幅度 ≈ |r|（归一化见下）
const DEMOD_SIGMA_CYCLES = 1.4
// B 模显示动态范围（dB）：包络 ≤ −60 dB 的样本落到黑
const DYN_RANGE_DB = 60

/**
 * 单程幅度衰减系数：数值 → 均匀 α（Nepers/深度单位）；
 * 函数 → 局部 α(depth)（逐材料分段），由 aline 内部做梯形累积成 A(d)。
 * 回波走往返路径，故乘子为 exp(−A)，A(d) = 2∫₀^d α。
 */
export type Attenuation = number | ((depth: number) => number)

/**
 * 生成一条压缩后的 A 线（B 模列）。
 * @param boundaries 反射率剖面来源 {depth: 深度, r: 带符号振幅反射系数}
 * @param maxDepth   成像最大深度（与 depth 同量纲）
 * @param samples    深度采样点数（A 线长度）
 * @param atten      衰减（数值=均匀单程 α；函数=局部 α(depth)）
 * @returns Float32Array(samples)，对数压缩后灰度 ∈ [0,1]
 */
export function aline(
  boundaries: { depth: number; r: number }[],
  maxDepth: number,
  samples: number,
  atten: Attenuation,
): Float32Array {
  const out = new Float32Array(samples)
  if (samples <= 0 || maxDepth <= 0) return out
  const dz = maxDepth / samples
  const lambda = maxDepth / PULSE_CYCLES
  const sigma = PULSE_SIGMA_CYCLES * lambda
  const sigmaL = DEMOD_SIGMA_CYCLES * lambda

  // 1) 反射率剖面：各界面系数按位置线性分摊到相邻两格（亚格点精度）
  const refl = new Float64Array(samples)
  for (const b of boundaries) {
    if (!Number.isFinite(b.depth) || !Number.isFinite(b.r)) continue
    if (b.depth < 0 || b.depth > maxDepth) continue
    const pos = b.depth / dz - 0.5
    const i = Math.floor(pos)
    const frac = pos - i
    if (i >= 0 && i < samples) refl[i] += b.r * (1 - frac)
    if (i + 1 >= 0 && i + 1 < samples) refl[i + 1] += b.r * frac
  }

  // 2) 累积双程衰减 A[i] = 2∫α（梯形），并构造 RF 回波迹线：
  //    rf = (refl ∗ h)·exp(−A)，h 为高斯窗正弦发射脉冲
  const rf = new Float64Array(samples)
  const span = Math.max(1, Math.ceil((3 * sigma) / dz))
  let attenAcc = 0
  const alphaOf = (d: number) => (typeof atten === 'function' ? atten(d) : atten)
  let prevAlpha = alphaOf(0)
  for (let i = 0; i < samples; i++) {
    const d = (i + 0.5) * dz
    const a = alphaOf(d)
    attenAcc += 0.5 * (prevAlpha + a) * dz
    prevAlpha = a
    let acc = 0
    const j0 = Math.max(0, i - span)
    const j1 = Math.min(samples - 1, i + span)
    for (let j = j0; j <= j1; j++) {
      const rv = refl[j]
      if (rv === 0) continue
      const zeta = (i - j) * dz
      acc += rv * Math.exp(-(zeta * zeta) / (2 * sigma * sigma)) * Math.cos((2 * Math.PI * zeta) / lambda)
    }
    rf[i] = acc * Math.exp(-2 * attenAcc)
  }

  // 3) I/Q 正交解调取包络：与载波混频后高斯低通；env = 2√(I²+Q²)。
  //    对单反射体脉冲包络 e^{−ζ²/2σ²}，该解调峰值 = |r|·σ/√(σ²+σL²)，
  //    乘归一化因子 √(σ²+σL²)/σ 后包络峰 ≈ |r|（含衰减）。
  const env = new Float64Array(samples)
  const spanL = Math.max(1, Math.ceil((3 * sigmaL) / dz))
  const kernel: number[] = []
  let kSum = 0
  for (let m = -spanL; m <= spanL; m++) {
    const w = Math.exp(-((m * dz) ** 2) / (2 * sigmaL * sigmaL))
    kernel.push(w)
    kSum += w
  }
  const norm = Math.sqrt(1 + (sigmaL / sigma) ** 2) * 2
  for (let i = 0; i < samples; i++) {
    let ii = 0
    let qq = 0
    const j0 = Math.max(0, i - spanL)
    const j1 = Math.min(samples - 1, i + spanL)
    for (let j = j0; j <= j1; j++) {
      const w = kernel[j - i + spanL]!
      const ph = (2 * Math.PI * (j + 0.5) * dz) / lambda
      ii += rf[j]! * Math.cos(ph) * w
      qq += rf[j]! * Math.sin(ph) * w
    }
    env[i] = (norm * Math.hypot(ii, qq)) / kSum
  }

  // 4) 对数压缩到固定动态范围的灰度
  for (let i = 0; i < samples; i++) {
    const db = 20 * Math.log10(Math.max(env[i], 1e-9))
    out[i] = Math.min(1, Math.max(0, (db + DYN_RANGE_DB) / DYN_RANGE_DB))
  }
  return out
}

export const US_MAX_DEPTH = 100 // 成像深度（mm 量级，示意）
export const US_SAMPLES = 256 // 每条 A 线深度采样数
export const US_LINES = 200 // 横向扫描线数

// 组织体模：分层 + 一个内含物（囊肿）。各层声阻抗 Z（MRayl）。
type Layer = { z0: number; z1: number; name: string; nameEn: string } // y 范围（0..1 归一深度）
export const US_LAYERS: Layer[] = [
  { z0: 0.0, z1: 0.12, name: '皮肤 / 耦合层', nameEn: 'Skin / gel layer' },
  { z0: 0.12, z1: 0.34, name: '脂肪层', nameEn: 'Fat' },
  { z0: 0.34, z1: 0.78, name: '腺体 / 肌肉', nameEn: 'Gland / muscle' },
  { z0: 0.78, z1: 1.0, name: '深层组织', nameEn: 'Deep tissue' },
]
// 各界面两侧声阻抗（MRayl）
export const US_Z_VALUES = [1.5, 1.38, 1.65, 1.7]
// 各层相对吸收系数（无量纲，乘场景 atten）：肌肉/皮肤吸收强，脂肪弱
const US_ATTEN_FACTOR = [1.2, 0.9, 1.3, 1.1]
// 内含物（无回声囊肿）：圆心(归一横向, 归一深度) + 半径；囊液吸收近似为零 → 后方增强
const CYST = { cx: 0.62, cy: 0.55, r: 0.13, z: 1.48, attenFactor: 0.05 }
// 散斑：亚分辨率散射体的逐格随机反射率幅度
const SPECKLE_AMP = 0.02
const SPECKLE_FILL = 0.55 // 每个深度格出现散射体的概率

function inCyst(lx: number, yn: number): boolean {
  return (lx - CYST.cx) ** 2 + (yn - CYST.cy) ** 2 < CYST.r * CYST.r
}

// 逐线确定性 PRNG（splitmix32 混合场景 seed 与线号）
function lineRandom(seed: number, line: number): () => number {
  let s = (seed ^ Math.imul(line + 1, 0x9e3779b9)) >>> 0
  return () => {
    s = (s + 0x9e3779b9) >>> 0
    let z = s
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad)
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97)
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296
  }
}

// 给定横向位置 lx∈[0,1] 与该线 seed：构造镜面反射界面 + 亚分辨率散斑反射率
function boundariesAt(lx: number, gain: number, rnd: () => number): { depth: number; r: number }[] {
  const bs: { depth: number; r: number }[] = []
  const dz = US_MAX_DEPTH / US_SAMPLES
  // 分层界面（镜面反射，保留符号：Z 下降的界面为负反射）
  for (let i = 0; i < US_LAYERS.length - 1; i++) {
    const depth = US_LAYERS[i].z1 * US_MAX_DEPTH
    bs.push({ depth, r: reflectionCoef(US_Z_VALUES[i], US_Z_VALUES[i + 1]) * gain })
  }
  // 囊肿壁：进出各一次真实界面回波（带符号），内部无散射体 → 无回声暗区；
  // 囊液低吸收经衰减剖面自然产生后方增强，不再人工增益
  const dx = lx - CYST.cx
  const through = Math.abs(dx) < CYST.r
  if (through) {
    const half = Math.sqrt(CYST.r * CYST.r - dx * dx)
    const zAbove = layerZAt(CYST.cy - half)
    const zBelow = layerZAt(CYST.cy + half)
    bs.push({ depth: (CYST.cy - half) * US_MAX_DEPTH, r: reflectionCoef(zAbove, CYST.z) * gain })
    bs.push({ depth: (CYST.cy + half) * US_MAX_DEPTH, r: reflectionCoef(CYST.z, zBelow) * gain })
  }
  // 亚分辨率散射体：组织内每格以概率放入随机反射率 → 卷积后形成散斑纹理
  for (let i = 0; i < US_SAMPLES; i++) {
    if (rnd() > SPECKLE_FILL) continue
    const yn = (i + 0.5) / US_SAMPLES
    if (yn < US_LAYERS[0].z1 || inCyst(lx, yn)) continue // 表皮层与囊肿内无散斑
    bs.push({ depth: (i + 0.5) * dz, r: (rnd() * 2 - 1) * SPECKLE_AMP * gain })
  }
  return bs
}

function layerIndexAt(yn: number): number {
  for (let i = 0; i < US_LAYERS.length; i++) if (yn < US_LAYERS[i].z1) return i
  return US_LAYERS.length - 1
}
function layerZAt(yn: number): number {
  return US_Z_VALUES[Math.min(layerIndexAt(yn), US_Z_VALUES.length - 1)]
}

/** 该横向位置上局部单程衰减系数 α(d)：分层因子 ×（囊液内近零）。 */
function alphaAt(lx: number, atten: number): (depth: number) => number {
  return (depth: number) => {
    const yn = depth / US_MAX_DEPTH
    if (inCyst(lx, yn)) return atten * CYST.attenFactor
    return atten * US_ATTEN_FACTOR[layerIndexAt(yn)]
  }
}

export type UltrasoundScene = { atten: number; gain: number; seed?: number }
export function ultrasoundResult(scene: UltrasoundScene) {
  const seed = (scene.seed ?? 0x51ed1e) >>> 0
  const field: number[] = [], echoes: number[] = []
  for (let line = 0; line < US_LINES; line++) {
    const lx = line / (US_LINES - 1)
    const rnd = lineRandom(seed, line)
    const values = aline(boundariesAt(lx, scene.gain, rnd), US_MAX_DEPTH, US_SAMPLES, alphaAt(lx, scene.atten))
    field.push(...values)
    // 局部分离峰计数（压缩灰度 0.5 ≈ 包络 −30 dB 阈值）
    let count = 0
    for (let i = 1; i < values.length - 1; i++) if (values[i] > 0.5 && values[i] > values[i - 1] && values[i] >= values[i + 1]) count++
    echoes.push(count)
  }
  // 参考衰减包络：纯组织路径（避开囊肿）的 exp(−A(d))
  const refAlpha = alphaAt(0.25, scene.atten)
  const envelope: number[] = []
  let acc = 0
  let prev = refAlpha(0)
  for (let i = 0; i < US_SAMPLES; i++) {
    const d = (i + 0.5) * (US_MAX_DEPTH / US_SAMPLES)
    const a = refAlpha(d)
    acc += 0.5 * (prev + a) * (US_MAX_DEPTH / US_SAMPLES)
    prev = a
    envelope.push(Math.exp(-2 * acc))
  }
  return { field, echoes, lines: US_LINES, samples: US_SAMPLES, maxDepth: US_MAX_DEPTH,
    coefficients: US_Z_VALUES.slice(0, -1).map((z, i) => reflectionCoef(z, US_Z_VALUES[i + 1])),
    envelope }
}

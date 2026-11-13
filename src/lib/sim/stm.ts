// 扫描隧道显微镜 (STM) 原理：隧穿电流对针尖-表面间距 d 指数敏感。
//   I = I0 · exp(−2κd)，  κ 为隧穿衰减常数（≈ sqrt(2mφ)/ħ）。
//   d 每变化 ln10/(2κ) ≈ 0.1nm，电流变化一个数量级 → 原子级垂直分辨率。
// 两种成像模式：
//   恒高（constant-height）：针高固定，逐点测电流 → 电流图反映起伏（快但易撞针）。
//   恒流（constant-current）：反馈调针高使 I=setpoint → 针高轨迹即等电荷面 ≈ 表面形貌。

/** 隧穿电流 I = I0·exp(−2κd)（d=针尖-表面间距）。 */
export function tunnelCurrent(d: number, kappa: number, I0: number): number {
  return I0 * Math.exp(-2 * kappa * d)
}

/** 反解：给定电流求间距 d = (1/2κ)·ln(I0/I)。 */
export function gapFromCurrent(I: number, kappa: number, I0: number): number {
  return (1 / (2 * kappa)) * Math.log(I0 / I)
}

/** 恒高扫描：针绝对高度 tipHeight 固定，间距 = tipHeight−surface，返回各点电流。 */
export function scanConstantHeight(
  surface: number[],
  tipHeight: number,
  kappa: number,
  I0: number,
): number[] {
  return surface.map((h) => tunnelCurrent(tipHeight - h, kappa, I0))
}

/** 恒流扫描：反馈使 I=setCurrent，针高 = surface + (1/2κ)·ln(I0/setCurrent)。返回针高轨迹。 */
export function scanConstantCurrent(
  surface: number[],
  setCurrent: number,
  kappa: number,
  I0: number,
): number[] {
  const gap = gapFromCurrent(setCurrent, kappa, I0) // 恒定间距
  return surface.map((h) => h + gap)
}

export const STM_SAMPLES = 240
// 原子点阵表面：正弦晶格起伏 + 一处缺陷（空位）。单位 ≈ nm 级。
function buildSTMSurface(): number[] {
  const s: number[] = []
  for (let i = 0; i < STM_SAMPLES; i++) {
    const x = i / STM_SAMPLES
    // 晶格：两个方向叠加形成「原子」周期凸起
    let h = 0.06 * (0.5 + 0.5 * Math.cos(x * 2 * Math.PI * 14))
    h += 0.02 * (0.5 + 0.5 * Math.cos(x * 2 * Math.PI * 28 + 1.3))
    // 缺陷：抹平一个原子（空位）
    if (x > 0.55 && x < 0.6) h *= 0.15
    s.push(h)
  }
  return s
}

export interface StmScene { mode: 'height' | 'current'; tipHeight: number; setCurrent: number }
export function stmScanResult(scene: StmScene) {
  const surface = buildSTMSurface(), kappa = 11.5, I0 = 1
  const tipHeights = scene.mode === 'height' ? surface.map(() => scene.tipHeight) : scanConstantCurrent(surface, scene.setCurrent, kappa, I0)
  const currents = scene.mode === 'height' ? scanConstantHeight(surface, scene.tipHeight, kappa, I0) : surface.map(() => scene.setCurrent)
  return { surface, tipHeights, currents, gaps: tipHeights.map((z, i) => z - surface[i]) }
}

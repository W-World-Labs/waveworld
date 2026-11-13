// 多边/三角定位：已知若干锚点(接收机)及各自到目标的距离，最小二乘解目标坐标。
// 回波定位中 距离 = 回波往返时延 × 波速 / 2。

export interface Pt { x: number; y: number }

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

/** 以锚点 0 为参考线性化，解 2×2 法方程（需 ≥3 锚点，非共线）。 */
export function trilaterate(anchors: Pt[], ranges: number[]): Pt {
  if (anchors.length < 3 || ranges.length < anchors.length) {
    return anchors[0] ? { x: anchors[0].x, y: anchors[0].y } : { x: 0, y: 0 }
  }
  const n = anchors.length
  const { x: x0, y: y0 } = anchors[0]
  const r0 = ranges[0]
  let A00 = 0, A01 = 0, A11 = 0, b0 = 0, b1 = 0
  for (let i = 1; i < n; i++) {
    const xi = anchors[i].x, yi = anchors[i].y, ri = ranges[i]
    const ax = 2 * (xi - x0), ay = 2 * (yi - y0)
    const bb = (xi * xi - x0 * x0) + (yi * yi - y0 * y0) + (r0 * r0 - ri * ri)
    A00 += ax * ax; A01 += ax * ay; A11 += ay * ay
    b0 += ax * bb; b1 += ay * bb
  }
  const det = A00 * A11 - A01 * A01
  if (Math.abs(det) < 1e-12) return { x: x0, y: y0 }
  return { x: (b0 * A11 - b1 * A01) / det, y: (A00 * b1 - A01 * b0) / det }
}

/** Pulse range resolution c/(2B); B is bandwidth, not carrier frequency. */
export function rangeResolution(waveSpeed: number, bandwidth: number) {
  return waveSpeed / (2 * bandwidth)
}

export const LOCALIZATION_W = 520, LOCALIZATION_H = 380
export const LOCALIZATION_ANCHORS: Pt[] = [{ x: 60, y: 60 }, { x: 460, y: 60 }, { x: 60, y: 320 }, { x: 460, y: 320 }]
export interface LocalizationScene { target: Pt; noise: number; seed: number; bandwidth: number }

/** Reproducible uniform measurement noise, shared by range and range-difference scenes. */
export function sampleRangeNoise(count: number, amplitude: number, seed: number): number[] {
  return Array.from({ length: count }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return (seed / 4294967296 * 2 - 1) * amplitude
  })
}
export function localizationResult(scene: LocalizationScene) {
  const noise = sampleRangeNoise(LOCALIZATION_ANCHORS.length, scene.noise, scene.seed)
  const ranges = LOCALIZATION_ANCHORS.map((a, i) => Math.max(0, dist(a, scene.target) + noise[i]))
  const est = trilaterate(LOCALIZATION_ANCHORS, ranges)
  return { ranges, est, err: dist(est, scene.target), resolution: rangeResolution(300, scene.bandwidth) }
}

import { sampleRangeNoise } from './trilateration'

// 到达时间差(TDOA)双曲线定位。
// 各接收机(锚点)记录信号到达时间，两两之差 × 波速 = 距离差 Δr。
// 满足 |P-a_i|-|P-a_0| = Δr_i 的点 P 构成一支双曲线（焦点为 a_0, a_i）。
// 多对双曲线交汇 = 信号源位置。GPS、声源定位、闪电定位皆用此原理。

export interface Pt { x: number; y: number }

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * 以 anchor0 为参考求解信号源坐标（线性最小二乘）。
 * rangeDiff[i] = |P-a_i| - |P-a_0|（i≥1，rangeDiff[0] 被忽略）。
 *
 * 线性化：令 R0 = |P-a_0|，则 |P-a_i| = R0 + Δr_i。
 * |P-a_i|² = (R0+Δr_i)² 展开：
 *   x²-2x·xi+xi² + y²-2y·yi+yi² = R0² + 2 R0 Δr_i + Δr_i²
 * 用 i 式减去 0 式（|P-a_0|²=R0²）消去 x²+y² 与 R0²：
 *   -2x·xi+xi² -2y·yi+yi² - (-2x·x0+x0² -2y·y0+y0²) = 2 R0 Δr_i + Δr_i²
 * 整理成关于未知 (x,y,R0) 的线性方程：
 *   2(x0-xi)·x + 2(y0-yi)·y - 2Δr_i·R0 = Δr_i² - (xi²-x0²) - (yi²-y0²)
 * 对 i≥1 堆叠求最小二乘解，返回 {x,y}（需 ≥3 锚点）。
 */
export function tdoaLocate(anchors: Pt[], rangeDiff: number[]): Pt {
  const n = anchors.length
  if (n < 3) return { x: anchors[0]?.x ?? 0, y: anchors[0]?.y ?? 0 }
  const { x: x0, y: y0 } = anchors[0]

  // 每个 i≥1：G_i·[x,y]ᵀ = c_i + d_i·R0
  //   G_i = [2(x0-xi), 2(y0-yi)]
  //   c_i = Δr_i² - (xi²-x0²) - (yi²-y0²)
  //   d_i = 2Δr_i
  // 以 R0 为参数对 [x,y] 做最小二乘 → x=px+qx·R0, y=py+qy·R0。
  // 再代入一致性约束 (x-x0)²+(y-y0)²=R0² 得 R0 的二次方程，取正根。
  let G00 = 0, G01 = 0, G11 = 0   // GᵀG
  let Gc0 = 0, Gc1 = 0            // Gᵀc
  let Gd0 = 0, Gd1 = 0            // Gᵀd
  for (let i = 1; i < n; i++) {
    const xi = anchors[i].x, yi = anchors[i].y
    const dr = rangeDiff[i]
    const g0 = 2 * (x0 - xi), g1 = 2 * (y0 - yi)
    const ci = dr * dr - (xi * xi - x0 * x0) - (yi * yi - y0 * y0)
    const di = 2 * dr
    G00 += g0 * g0; G01 += g0 * g1; G11 += g1 * g1
    Gc0 += g0 * ci; Gc1 += g1 * ci
    Gd0 += g0 * di; Gd1 += g1 * di
  }
  const det = G00 * G11 - G01 * G01
  if (Math.abs(det) < 1e-12) return { x: x0, y: y0 }
  // [px,py] = (GᵀG)⁻¹ Gᵀc，[qx,qy] = (GᵀG)⁻¹ Gᵀd
  const px = (G11 * Gc0 - G01 * Gc1) / det
  const py = (G00 * Gc1 - G01 * Gc0) / det
  const qx = (G11 * Gd0 - G01 * Gd1) / det
  const qy = (G00 * Gd1 - G01 * Gd0) / det

  // (px+qx R - x0)² + (py+qy R - y0)² = R²
  const ex = px - x0, ey = py - y0
  const A = qx * qx + qy * qy - 1
  const B = 2 * (qx * ex + qy * ey)
  const C = ex * ex + ey * ey
  const candidates = solveR0(A, B, C).map(R0 => ({ x: px + qx * R0, y: py + qy * R0 }))
  // More receivers disambiguate roots: compare the actual range-difference residuals.
  const residual = (p: Pt) => {
    const r0 = dist(p, anchors[0])
    return anchors.slice(1).reduce((sum, a, i) => sum + (dist(p, a) - r0 - rangeDiff[i + 1]) ** 2, 0)
  }
  return candidates.reduce((best, p) => residual(p) < residual(best) ? p : best)
}

/** Nonnegative roots of A·R²+B·R+C=0; preserve both possible locations. */
function solveR0(A: number, B: number, C: number): number[] {
  if (Math.abs(A) < 1e-12) return [Math.abs(B) < 1e-12 ? 0 : Math.max(0, -C / B)]
  const disc = B * B - 4 * A * C
  if (disc < 0) return [Math.max(0, -B / (2 * A))]
  const s = Math.sqrt(disc)
  const q = -0.5 * (B + (B >= 0 ? s : -s))
  const candidates = (q === 0 ? [0] : [q / A, C / q]).filter(r => Number.isFinite(r) && r >= -1e-9).map(r => Math.max(0, r)).sort((a, b) => a - b)
  return candidates.length ? candidates : [0]
}

/**
 * 采样一支双曲线：满足 |P-ai| - |P-a0| = rangeDiff 的点集，用于绘制。
 * 沿 a0→ai 连线方向建局部坐标 (u 沿轴, v 垂直)，双曲线标准方程
 *   u²/A² - v²/B² = 1，A = |Δr|/2，焦距 c = |a0a1|/2，B² = c²-A²。
 * 取靠近 a0 (Δr>0) 或 ai (Δr<0) 的一支，沿 v 在 [-span,span] 采样 n 点。
 */
export function hyperbolaPoints(a0: Pt, ai: Pt, rangeDiff: number, n: number, span: number): Pt[] {
  const out: Pt[] = []
  const cx = (a0.x + ai.x) / 2, cy = (a0.y + ai.y) / 2 // 中心(两焦点中点)
  const dx = ai.x - a0.x, dy = ai.y - a0.y
  const L = Math.hypot(dx, dy)
  if (L < 1e-9) return out
  const ux = dx / L, uy = dy / L      // 轴向单位向量 (a0→ai)
  const nx = -uy, ny = ux             // 法向单位向量
  const c = L / 2
  const A = Math.abs(rangeDiff) / 2
  if (A > c + 1e-9) return out // Distance differences larger than the baseline are impossible.
  if (Math.abs(A - c) <= 1e-9) {
    // Equality degenerates to a ray, including a source located at a receiver.
    const origin = rangeDiff >= 0 ? a0 : ai, sign = rangeDiff >= 0 ? -1 : 1
    for (let k = 0; k <= n; k++) out.push({ x: origin.x + sign * ux * span * k / n, y: origin.y + sign * uy * span * k / n })
    return out
  }
  const B = Math.sqrt(c * c - A * A)
  // |P-ai|-|P-a0|=Δr：Δr>0 ⇒ 离 ai 更远 ⇒ 顶点偏向 a0 (u<0)；Δr<0 ⇒ 偏向 ai (u>0)。
  const sign = rangeDiff >= 0 ? -1 : 1
  for (let k = 0; k <= n; k++) {
    const v = -span + (2 * span * k) / n
    const u = sign * A * Math.sqrt(1 + (v * v) / (B * B))
    out.push({ x: cx + u * ux + v * nx, y: cy + u * uy + v * ny })
  }
  return out
}

export const TDOA_W = 640, TDOA_H = 380
export const TDOA_ANCHORS: Pt[] = [{ x: 90, y: 320 }, { x: 550, y: 320 }, { x: 320, y: 60 }, { x: 120, y: 110 }]
export interface TdoaScene { source: Pt; noise: number; seed: number }
export function tdoaResult(scene: TdoaScene) {
  const r0 = dist(scene.source, TDOA_ANCHORS[0])
  const noise = sampleRangeNoise(3, scene.noise / 2, scene.seed)
  const diffs = TDOA_ANCHORS.map((a, i) => i === 0 ? 0 : dist(scene.source, a) - r0 + noise[i - 1])
  const est = tdoaLocate(TDOA_ANCHORS, diffs)
  const curves = TDOA_ANCHORS.slice(1).map((a, i) => hyperbolaPoints(TDOA_ANCHORS[0], a, diffs[i + 1], 120, 520))
  return { diffs, est, err: dist(est, scene.source), curves }
}

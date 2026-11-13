/**
 * 粒子网格 PIC 三级 · Boris 推进（2D，常 B 场回旋）。
 * 磁推旋转保持 |v|；回旋角频率 ≈ qB/m。
 * method id 仅常量，不改 methods.data。
 */
import { PIC_L2_PARENT } from './pic-l2-algos'

export { PIC_L2_PARENT }

/** 父族 · PIC。 */
export const PIC_L3_PARENT = PIC_L2_PARENT

/** 三级 · Boris 磁推。 */
export const METHOD_ALGO_PIC_BORIS = 'method-algo-pic-boris'

export const PIC_L3_METHOD_IDS = [METHOD_ALGO_PIC_BORIS] as const

export type Vec2 = { x: number; y: number }

/** |v|。 */
export function speed2(v: Vec2): number {
  return Math.hypot(v.x, v.y)
}

/**
 * Boris 半步磁推（无 E）：常 B = (0,0,Bz)，更新 (vx,vy)。
 *
 * t = ω dt/2，ω = q Bz / m
 * v' = v + v × t̂
 * s = 2 t / (1+|t|²)
 * v ← v + v' × ŝ
 *
 * 精确保持 |v|（纯旋转，无电加速）。
 */
export function borisPush2dMagnetic(
  vx: number,
  vy: number,
  qOverM: number,
  Bz: number,
  dt: number,
): Vec2 {
  const tx = 0
  const ty = 0
  const tz = (qOverM * Bz * dt) / 2

  // v' = v⁻ + v⁻ × t  （此处 v⁻ = v，无 E 半踢）
  const vpx = vx + (vy * tz - 0 * ty)
  const vpy = vy + (0 * tx - vx * tz)
  // vpz unused in 2D

  const t2 = tx * tx + ty * ty + tz * tz
  const sx = (2 * tx) / (1 + t2)
  const sy = (2 * ty) / (1 + t2)
  const sz = (2 * tz) / (1 + t2)

  // v⁺ = v⁻ + v' × s
  const vxNew = vx + (vpy * sz - 0 * sy)
  const vyNew = vy + (0 * sx - vpx * sz)
  return { x: vxNew, y: vyNew }
}

/**
 * 完整 Boris 一步（可选常 E，2D；B 仅 z 分量）：
 * 1) 半电踢  2) 磁旋  3) 半电踢  4) 位置漂移 x ← x + v dt
 */
export function borisStep2d(
  pos: Vec2,
  vel: Vec2,
  qOverM: number,
  Ex: number,
  Ey: number,
  Bz: number,
  dt: number,
): { pos: Vec2; vel: Vec2 } {
  // 半电踢
  let vx = vel.x + qOverM * Ex * (dt / 2)
  let vy = vel.y + qOverM * Ey * (dt / 2)
  // 磁旋
  const mag = borisPush2dMagnetic(vx, vy, qOverM, Bz, dt)
  vx = mag.x
  vy = mag.y
  // 半电踢
  vx += qOverM * Ex * (dt / 2)
  vy += qOverM * Ey * (dt / 2)
  return {
    pos: { x: pos.x + vx * dt, y: pos.y + vy * dt },
    vel: { x: vx, y: vy },
  }
}

/**
 * 从速度历史估计回旋角频率幅值：累加 |Δθ|（atan2 交叉/点积），
 * ω ≈ Σ|Δθ| / ((N−1) dt)。符号随 B 可正可负，幅值对拍 |qB/m|。
 * 仅用 (vx,vy) 平面。
 */
export function estimateCyclotronOmega(
  velHistory: ReadonlyArray<Vec2>,
  dt: number,
): number {
  if (velHistory.length < 2 || !(dt > 0)) return 0
  let ang = 0
  for (let i = 1; i < velHistory.length; i++) {
    const a = velHistory[i - 1]!
    const b = velHistory[i]!
    const cross = a.x * b.y - a.y * b.x
    const dot = a.x * b.x + a.y * b.y
    ang += Math.abs(Math.atan2(cross, dot))
  }
  return ang / ((velHistory.length - 1) * dt)
}

/**
 * Boris 样例：纯 B 场回旋。
 * - |v| 守恒（相对误差极小）
 * - 估计 ω ≈ qB/m
 */
export function runBorisPushSample(
  opts?: {
    qOverM?: number
    Bz?: number
    dt?: number
    steps?: number
    v0x?: number
    v0y?: number
  },
): {
  speed0: number
  speedF: number
  /** max_t ||v(t)| − |v0|| / |v0| */
  maxRelSpeedErr: number
  omegaExact: number
  omegaEst: number
  /** |ω_est − ω_exact| / |ω_exact| */
  omegaRelErr: number
  steps: number
  dt: number
  methodId: typeof METHOD_ALGO_PIC_BORIS
  familyId: typeof PIC_L3_PARENT
} {
  const qOverM = opts?.qOverM ?? 1
  const Bz = opts?.Bz ?? 2.5
  const dt = opts?.dt ?? 0.02
  const steps = opts?.steps ?? 200
  const v0x = opts?.v0x ?? 1
  const v0y = opts?.v0y ?? 0

  let vel: Vec2 = { x: v0x, y: v0y }
  let pos: Vec2 = { x: 0, y: 0 }
  const speed0 = speed2(vel)
  const hist: Vec2[] = [{ x: vel.x, y: vel.y }]
  let maxRelSpeedErr = 0

  for (let s = 0; s < steps; s++) {
    const r = borisStep2d(pos, vel, qOverM, 0, 0, Bz, dt)
    pos = r.pos
    vel = r.vel
    hist.push({ x: vel.x, y: vel.y })
    const sp = speed2(vel)
    const rel = Math.abs(sp - speed0) / Math.max(speed0, 1e-30)
    if (rel > maxRelSpeedErr) maxRelSpeedErr = rel
  }

  const speedF = speed2(vel)
  /** 回旋角频率标量 |qB/m|（符号依赖电荷与 B 向；样例比速率）。 */
  const omegaExact = Math.abs(qOverM * Bz)
  /** 估计速率取绝对值，与 |qB/m| 对齐。 */
  const omegaEst = Math.abs(estimateCyclotronOmega(hist, dt))
  const omegaRelErr =
    Math.abs(omegaEst - omegaExact) / Math.max(omegaExact, 1e-30)

  return {
    speed0,
    speedF,
    maxRelSpeedErr,
    omegaExact,
    omegaEst,
    omegaRelErr,
    steps,
    dt,
    methodId: METHOD_ALGO_PIC_BORIS,
    familyId: PIC_L3_PARENT,
  }
}

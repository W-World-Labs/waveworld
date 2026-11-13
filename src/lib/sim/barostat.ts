// Berendsen 弱耦合压浴（NPT 控压系综，约化 LJ 单位）。
// 缩放与重算力由共享 Rust 内核执行。
import type { MdState } from './md'

export interface BarostatParams {
  /** 目标压强（约化）。NaN ⇒ 关闭，惰性零改动（与不调用逐位等价）。 */
  Ptarget: number
  /** 压浴弛豫时间常数 τ_P（约化）。越大耦合越弱、缩放越缓。 */
  tauP: number
  /** 积分步长 dt（约化），与 velocityVerlet 同。 */
  dt: number
  /** 等温压缩率 κ_T（约化），缺省 1。 */
  kappaT?: number
  /** 每步线性缩放幅度上限 |μ−1|（数值护栏），缺省 0.02。 */
  maxScale?: number
}

/**
 * Berendsen 各向同性压浴单步：缩放盒长与全部坐标使瞬时压强弛豫向 Ptarget。
 *   μ^dim = 1 − κ_T·(dt/τ_P)·(Ptarget − P_inst)
 *   L ← μ·L，pos ← μ·pos，posUnwrapped ← μ·posUnwrapped（不缩放速度）。
 * 缩放后重算力以保持 state.force 与 state.pos 自洽（单组分 LJ）。
 * 返回本步施加的线性缩放因子 μ（关闭时 1，state 逐位不变）。
 */
export function berendsenBarostat(state: MdState, p: BarostatParams): number {
  return state.barostat(p)
}

/**
 * MD 二级算法模块 · Berendsen 压浴等（一级 md-algos 之外的 NPT 装配）。
 * 对应 method-algo-berendsen-barostat；委托 barostat.ts / md.ts，不重实现。
 */
import { berendsenBarostat } from './barostat'
import {
  initLattice,
  pressure,
  temperature,
  velocityVerlet,
  type MdState,
} from './md'

/** 二级压浴算法节点 id。 */
export const MD_L2_BERENDSEN_METHOD_ID = 'method-algo-berendsen-barostat'

/** 父族（与 methods.data 中 berendsen 的 parentId 对齐）。 */
export const MD_L2_PARENT = 'method-md-lj'

/**
 * Berendsen 压浴样例：先做若干 NVT 式 Verlet+速度重标定，再在瞬时压强
 * 远低于目标时施加压浴，期望盒子收缩（μ<1）且缩放因子有限。
 *
 * 返回：
 * - mu：本步缩放因子
 * - Lbefore / Lafter：盒长
 * - Pinst：施压前瞬时压强
 * - Ptarget：目标压强（设为 Pinst+δ，欠压→收缩）
 */
export function runBerendsenSample(nvtSteps = 80, dt = 0.005): {
  mu: number
  Lbefore: number
  Lafter: number
  Pinst: number
  Ptarget: number
  finite: boolean
} {
  const st: MdState = initLattice(100, 9, 2, 0.4, 3)
  const Ttarget = 0.4

  // ① 短程 NVT：Verlet + 速度重标定恒温
  for (let k = 0; k < nvtSteps; k++) {
    velocityVerlet(st, dt)
    const T = temperature(st.vel, st.N, st.dim)
    if (T > 0) {
      const s = Math.sqrt(Ttarget / T)
      for (let i = 0; i < st.vel.length; i++) st.vel[i] *= s
    }
  }

  const T = temperature(st.vel, st.N, st.dim)
  const Pinst = pressure(st.N, st.L, st.dim, T, st.virial)
  // 目标远高于瞬时 → 欠压 → 盒子应收缩（μ < 1）
  const Ptarget = Pinst + 5
  const Lbefore = st.L
  const mu = berendsenBarostat(st, { Ptarget, tauP: 1, dt })
  return {
    mu,
    Lbefore,
    Lafter: st.L,
    Pinst,
    Ptarget,
    finite: Number.isFinite(mu) && Number.isFinite(st.L),
  }
}

/**
 * 对称样例：目标远低于瞬时压强 → 超压 → 膨胀（μ > 1）。
 * 与 runBerendsenSample 共用同一 NVT 预热口径。
 */
export function runBerendsenExpandSample(nvtSteps = 80, dt = 0.005): {
  mu: number
  Lbefore: number
  Lafter: number
  finite: boolean
} {
  const st: MdState = initLattice(100, 9, 2, 0.4, 3)
  const Ttarget = 0.4
  for (let k = 0; k < nvtSteps; k++) {
    velocityVerlet(st, dt)
    const T = temperature(st.vel, st.N, st.dim)
    if (T > 0) {
      const s = Math.sqrt(Ttarget / T)
      for (let i = 0; i < st.vel.length; i++) st.vel[i] *= s
    }
  }
  const T = temperature(st.vel, st.N, st.dim)
  const Pinst = pressure(st.N, st.L, st.dim, T, st.virial)
  const Lbefore = st.L
  const mu = berendsenBarostat(st, { Ptarget: Pinst - 5, tauP: 1, dt })
  return {
    mu,
    Lbefore,
    Lafter: st.L,
    finite: Number.isFinite(mu) && Number.isFinite(st.L),
  }
}

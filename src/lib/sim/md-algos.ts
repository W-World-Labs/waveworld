/**
 * 分子动力学方法族 · 一级/二级可组装模块入口。
 * 对应 method-md-lj 下的 step / parallel-variant 子节点。
 */
import {
  computeForces,
  initLattice,
  kineticEnergy,
  ljPair,
  rescaleThermostat,
  temperature,
  velocityVerlet,
  type MdState,
} from './md'
import { childrenOf } from '../../data/methods/methods'

export const MD_PARENT_METHOD_ID = 'method-md-lj'

export type MdAlgoId =
  | 'lj-pair'
  | 'velocity-verlet'
  | 'rescale-thermostat'
  | 'ff-lj-homog'

export const MD_ALGO_METHOD_IDS: Record<MdAlgoId, string> = {
  'lj-pair': 'method-algo-lj-pair',
  'velocity-verlet': 'method-algo-velocity-verlet',
  'rescale-thermostat': 'method-algo-rescale-thermostat',
  'ff-lj-homog': 'method-algo-ff-lj-homog',
}

/** LJ 成对：在截断内 r=2^1/6（势阱底）势能应接近 −1（平移后略大于 −1）。 */
export function runLjPairSample(): { uMin: number; fAtMin: number; uBeyond: number } {
  const rc2 = 2.5 * 2.5
  const rMin = Math.pow(2, 1 / 6)
  const { u: uMin, fOverR } = ljPair(rMin * rMin, rc2)
  const { u: uBeyond } = ljPair(rc2 + 0.1, rc2)
  return { uMin, fAtMin: fOverR * rMin, uBeyond }
}

/** Velocity Verlet：短跑后能量有限、温度有限。 */
export function runVelocityVerletSample(steps = 50, dt = 0.005): {
  ke0: number
  keF: number
  T: number
  pe: number
} {
  const s: MdState = initLattice(36, 6, 2, 0.5, 7)
  const ke0 = kineticEnergy(s.vel)
  for (let i = 0; i < steps; i++) velocityVerlet(s, dt)
  return {
    ke0,
    keF: kineticEnergy(s.vel),
    T: temperature(s.vel, s.N, s.dim),
    pe: s.potential,
  }
}

/** 恒温器：热高时缩放后温度逼近目标。 */
export function runRescaleThermostatSample(): { Tbefore: number; Tafter: number; target: number } {
  const s = initLattice(36, 6, 2, 1.2, 3)
  const Tbefore = temperature(s.vel, s.N, s.dim)
  const target = 0.4
  rescaleThermostat(s.vel, target, Tbefore)
  const Tafter = temperature(s.vel, s.N, s.dim)
  return { Tbefore, Tafter, target }
}

/** 均质力场：晶格力对称有限。 */
export function runHomogForceSample(): { potential: number; forceNorm: number } {
  const s = initLattice(16, 4, 2, 0.3, 1)
  const fr = computeForces(s.pos, s.L, s.N, s.dim, s.rc)
  let forceNorm = 0
  for (let i = 0; i < fr.force.length; i++) forceNorm += fr.force[i] * fr.force[i]
  return { potential: fr.potential, forceNorm: Math.sqrt(forceNorm) }
}

export function runMdAlgo(id: MdAlgoId): unknown {
  switch (id) {
    case 'lj-pair':
      return runLjPairSample()
    case 'velocity-verlet':
      return runVelocityVerletSample()
    case 'rescale-thermostat':
      return runRescaleThermostatSample()
    case 'ff-lj-homog':
      return runHomogForceSample()
    default: {
      const _e: never = id
      return _e
    }
  }
}

export function mdChildCount(): number {
  return childrenOf(MD_PARENT_METHOD_ID).length
}

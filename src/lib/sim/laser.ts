import { WasmLaser } from './wasm-fields'

// 激光速率方程（双能级简化）：粒子数反转 N 与腔内光子数 S 的耦合演化。
//   dN/dt = Pump − N/τN − B·N·S          泵浦 / 自发弛豫 / 受激辐射消耗
//   dS/dt = B·N·S − S/τC + ε·N            受激增益 / 腔损耗 / 自发辐射种子
// 泵浦低于阈值时 S≈0；超过阈值受激辐射雪崩，光子数骤增（起振）。

export interface LaserParams { tauN: number; tauC: number; B: number; spont: number }
export interface LaserState { N: number; S: number }

export const DEFAULT: LaserParams = { tauN: 1, tauC: 0.05, B: 0.02, spont: 1e-4 }

function assertLaserParams(p: LaserParams): void {
  if (!Number.isFinite(p.tauN) || !(p.tauN > 0)) {
    throw new RangeError(`tauN must be a finite number > 0 (got ${p.tauN})`)
  }
  if (!Number.isFinite(p.tauC) || !(p.tauC > 0)) {
    throw new RangeError(`tauC must be a finite number > 0 (got ${p.tauC})`)
  }
  if (!Number.isFinite(p.B) || !(p.B > 0)) {
    throw new RangeError(`B must be a finite number > 0 (got ${p.B})`)
  }
  if (!Number.isFinite(p.spont) || p.spont < 0) {
    throw new RangeError(`spont must be a finite number ≥ 0 (got ${p.spont})`)
  }
}

/** Rust/WASM stepping; callers with repeated steps reuse the same owner. */
export function laserStep(s: LaserState, pump: number, dt: number, p: LaserParams = DEFAULT, owner = new WasmLaser()): LaserState {
  assertLaserParams(p)
  if (!Number.isFinite(pump) || pump < 0) throw new RangeError('pump must be finite and non-negative')
  if (!Number.isFinite(dt) || dt <= 0) throw new RangeError('dt must be finite and positive')
  if (!Number.isFinite(s.N) || !Number.isFinite(s.S) || s.N < 0 || s.S < 0) throw new RangeError('state N,S must be finite and non-negative')
  owner.configure(p, pump, dt); owner.setState(s); owner.advance(1)
  return owner.snapshot()
}

export function steadyPhotons(pump: number, p: LaserParams = DEFAULT, owner = new WasmLaser()): number {
  assertLaserParams(p)
  if (!Number.isFinite(pump) || pump < 0) throw new RangeError('pump must be finite and non-negative')
  owner.configure(p)
  return owner.steady(pump)
}

export const LASER_DT = 0.02
// Product controls must remain usable without a local computation engine.
export const LASER_DEFAULT_PUMP = 1000, LASER_MAX_PUMP = 4000
export function laserCharacteristics(pump: number, owner = new WasmLaser()) {
  owner.configure(DEFAULT)
  return owner.characteristics(pump)
}

export function thresholdPump(p: LaserParams = DEFAULT, owner = new WasmLaser()): number {
  assertLaserParams(p)
  owner.configure(p)
  return owner.threshold()
}

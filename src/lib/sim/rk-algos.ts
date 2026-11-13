/**
 * Classical Runge–Kutta integrators · meta/ODE toy.
 * RK4 vs Euler on y'=-y and harmonic oscillator energy/error.
 * method id 仅常量，不改 methods.data / moduleRegistry / edges.
 */

/** 父族 · Runge–Kutta（经典 ODE 积分）。 */
export const METHOD_RK = 'method-runge-kutta'

/** 子算法 · 经典四阶 RK4。 */
export const METHOD_ALGO_RK4 = 'method-algo-rk4'

export const RK_METHOD_IDS = [METHOD_ALGO_RK4] as const

/** 父族别名（与 familyId 对齐）。 */
export const RK_PARENT = METHOD_RK

export type ScalarOde = (t: number, y: number) => number

/**
 * 显式欧拉单步：y ← y + dt · f(t,y)。
 */
export function eulerStep(
  y: number,
  t: number,
  dt: number,
  f: ScalarOde,
): number {
  return y + dt * f(t, y)
}

/**
 * 经典 RK4 单步：
 *   k1=f(t,y), k2=f(t+h/2,y+h k1/2), …
 *   y ← y + (h/6)(k1+2k2+2k3+k4)
 */
export function rk4Step(
  y: number,
  t: number,
  dt: number,
  f: ScalarOde,
): number {
  const k1 = f(t, y)
  const k2 = f(t + dt / 2, y + (dt * k1) / 2)
  const k3 = f(t + dt / 2, y + (dt * k2) / 2)
  const k4 = f(t + dt, y + dt * k3)
  return y + (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4)
}

/**
 * 固定步长积分标量 ODE 到 tEnd（从 t0）。
 * steps = round((tEnd−t0)/dt) 风格：用 nSteps 与 dt。
 */
export function integrateScalar(
  y0: number,
  t0: number,
  dt: number,
  nSteps: number,
  f: ScalarOde,
  method: 'euler' | 'rk4',
): { y: number; t: number } {
  let y = y0
  let t = t0
  const step = method === 'rk4' ? rk4Step : eulerStep
  for (let i = 0; i < nSteps; i++) {
    y = step(y, t, dt, f)
    t += dt
  }
  return { y, t }
}

/** 向量场：f(t, y, out) 写入 out（可与 y 同缓冲仅当 out≠中间态）。 */
export type VecOde = (t: number, y: ArrayLike<number>, out: Float64Array) => void

/** 显式欧拉向量单步（返回新数组）。 */
export function eulerStepVec(
  y: ArrayLike<number>,
  t: number,
  dt: number,
  f: VecOde,
): Float64Array {
  const n = y.length
  const k = new Float64Array(n)
  f(t, y, k)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = y[i]! + dt * k[i]!
  return out
}

/** 经典 RK4 向量单步（返回新数组）。 */
export function rk4StepVec(
  y: ArrayLike<number>,
  t: number,
  dt: number,
  f: VecOde,
): Float64Array {
  const n = y.length
  const k1 = new Float64Array(n)
  const k2 = new Float64Array(n)
  const k3 = new Float64Array(n)
  const k4 = new Float64Array(n)
  const tmp = new Float64Array(n)

  f(t, y, k1)
  for (let i = 0; i < n; i++) tmp[i] = y[i]! + (dt * k1[i]!) / 2
  f(t + dt / 2, tmp, k2)
  for (let i = 0; i < n; i++) tmp[i] = y[i]! + (dt * k2[i]!) / 2
  f(t + dt / 2, tmp, k3)
  for (let i = 0; i < n; i++) tmp[i] = y[i]! + dt * k3[i]!
  f(t + dt, tmp, k4)

  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    out[i] =
      y[i]! + (dt / 6) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!)
  }
  return out
}

/**
 * 谐振子 y'' + ω² y = 0 写成一阶系统：
 *   q' = v,  v' = −ω² q
 * 状态 [q, v]；能量 E = (v² + ω² q²) / 2。
 */
export function harmonicField(omega: number): VecOde {
  const w2 = omega * omega
  return (_t, y, out) => {
    out[0] = y[1]!
    out[1] = -w2 * y[0]!
  }
}

export function harmonicEnergy(q: number, v: number, omega: number): number {
  return 0.5 * (v * v + omega * omega * q * q)
}

/**
 * 指数衰减 y' = −y：精确解 y(t)=y0 e^{−t}。
 */
export const decayOde: ScalarOde = (_t, y) => -y

export function decayExact(y0: number, t: number): number {
  return y0 * Math.exp(-t)
}

/**
 * 代表样例：RK4 在 y'=-y 与谐振子上均优于 Euler（误差 / 能量漂移）。
 */
export function runRk4Sample(
  opts: {
    /** 衰减方程步数 */
    decaySteps?: number
    decayDt?: number
    /** 谐振子 */
    oscSteps?: number
    oscDt?: number
    omega?: number
  } = {},
): {
  decayExact: number
  decayRk4: number
  decayEuler: number
  decayRk4Err: number
  decayEulerErr: number
  decayRk4Better: boolean
  energy0: number
  energyRk4: number
  energyEuler: number
  energyDriftRk4: number
  energyDriftEuler: number
  oscRk4Better: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_RK4
  familyId: typeof METHOD_RK
} {
  const decaySteps = opts.decaySteps ?? 40
  const decayDt = opts.decayDt ?? 0.05
  const y0 = 1
  const tEnd = decaySteps * decayDt
  const yExact = decayExact(y0, tEnd)
  const yRk4 = integrateScalar(y0, 0, decayDt, decaySteps, decayOde, 'rk4').y
  const yEuler = integrateScalar(y0, 0, decayDt, decaySteps, decayOde, 'euler').y
  const decayRk4Err = Math.abs(yRk4 - yExact)
  const decayEulerErr = Math.abs(yEuler - yExact)
  const decayRk4Better = decayRk4Err < decayEulerErr * 0.5

  const omega = opts.omega ?? 1
  // 约 1–2 周期：展示 RK4 能量几乎守恒、Euler 明显漂移
  const oscSteps = opts.oscSteps ?? 120
  const oscDt = opts.oscDt ?? 0.05
  const f = harmonicField(omega)
  let yR = new Float64Array([1, 0])
  let yE = new Float64Array([1, 0])
  const energy0 = harmonicEnergy(yR[0]!, yR[1]!, omega)
  let t = 0
  for (let i = 0; i < oscSteps; i++) {
    yR = new Float64Array(rk4StepVec(yR, t, oscDt, f))
    yE = new Float64Array(eulerStepVec(yE, t, oscDt, f))
    t += oscDt
  }
  const energyRk4 = harmonicEnergy(yR[0]!, yR[1]!, omega)
  const energyEuler = harmonicEnergy(yE[0]!, yE[1]!, omega)
  const energyDriftRk4 =
    energy0 > 0 ? Math.abs(energyRk4 - energy0) / energy0 : 0
  const energyDriftEuler =
    energy0 > 0 ? Math.abs(energyEuler - energy0) / energy0 : 0
  const oscRk4Better = energyDriftRk4 < energyDriftEuler * 0.5

  const finite =
    Number.isFinite(yRk4) &&
    Number.isFinite(yEuler) &&
    Number.isFinite(energyRk4) &&
    Number.isFinite(energyEuler) &&
    Number.isFinite(decayRk4Err) &&
    Number.isFinite(energyDriftRk4)

  const ok =
    finite &&
    decayRk4Better &&
    oscRk4Better &&
    decayRk4Err < 1e-6 &&
    energyDriftRk4 < 1e-4

  return {
    decayExact: yExact,
    decayRk4: yRk4,
    decayEuler: yEuler,
    decayRk4Err,
    decayEulerErr,
    decayRk4Better,
    energy0,
    energyRk4,
    energyEuler,
    energyDriftRk4,
    energyDriftEuler,
    oscRk4Better,
    finite,
    ok,
    methodId: METHOD_ALGO_RK4,
    familyId: METHOD_RK,
  }
}

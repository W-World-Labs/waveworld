/**
 * 有限体积 FVM · 1D 守恒律面通量样例（迎风 / Lax–Friedrichs）。
 * method-finite-volume 研究骨架；不改 methods.data。
 */

export const FVM_PARENT = 'method-finite-volume'
export const FVM_FLUX_ID = 'method-algo-fvm-flux'

/**
 * 标量迎风数值通量：F*(uL,uR; a) = a·u_upwind。
 * a>0 → 取左态；a<0 → 取右态；a=0 → 0。
 */
export function upwindFlux(uL: number, uR: number, a: number): number {
  if (a > 0) return a * uL
  if (a < 0) return a * uR
  return 0
}

/**
 * 局部 Lax–Friedrichs 通量：
 * F* = ½(a uL + a uR) − ½|a|(uR − uL)
 */
export function laxFriedrichsFlux(uL: number, uR: number, a: number): number {
  const alpha = Math.abs(a)
  return 0.5 * a * (uL + uR) - 0.5 * alpha * (uR - uL)
}

/**
 * 1D 有限体积一步（周期边界）：
 * u_i^{n+1} = u_i − (dt/dx)(F_{i+1/2} − F_{i−1/2})
 */
export function fvmStep1d(
  u: Float64Array,
  a: number,
  dx: number,
  dt: number,
  flux: (uL: number, uR: number, a: number) => number = upwindFlux,
): Float64Array {
  const n = u.length
  const next = new Float64Array(n)
  const F = new Float64Array(n) // F[i] = 面 i+1/2 通量（右界面）
  for (let i = 0; i < n; i++) {
    const iR = (i + 1) % n
    F[i] = flux(u[i]!, u[iR]!, a)
  }
  const c = dt / dx
  for (let i = 0; i < n; i++) {
    const iL = (i - 1 + n) % n
    next[i] = u[i]! - c * (F[i]! - F[iL]!)
  }
  return next
}

export function sumMass(u: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < u.length; i++) s += u[i]!
  return s
}

/**
 * 子算法 · FVM 面通量原子：高斯脉冲平流若干步，质量守恒 + CFL 稳定。
 */
export function runFvmFluxSample(opts?: {
  n?: number
  a?: number
  cfl?: number
  steps?: number
}): {
  mass0: number
  massF: number
  massErr: number
  peak0: number
  peakF: number
  cfl: number
  finite: boolean
  methodId: typeof FVM_FLUX_ID
} {
  const n = opts?.n ?? 64
  const a = opts?.a ?? 1
  const cfl = opts?.cfl ?? 0.4
  const steps = opts?.steps ?? 20
  const dx = 1 / n
  const dt = (cfl * dx) / Math.max(Math.abs(a), 1e-12)

  const u = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * dx
    u[i] = Math.exp(-((x - 0.5) ** 2) / (2 * 0.04 ** 2))
  }
  let peak0 = 0
  for (let i = 0; i < n; i++) if (u[i]! > peak0) peak0 = u[i]!
  const mass0 = sumMass(u) * dx

  let cur: Float64Array = new Float64Array(u)
  for (let s = 0; s < steps; s++) cur = new Float64Array(fvmStep1d(cur, a, dx, dt, upwindFlux))

  let peakF = 0
  let finite = true
  for (let i = 0; i < n; i++) {
    const v = cur[i]!
    if (!Number.isFinite(v)) finite = false
    if (v > peakF) peakF = v
  }
  const massF = sumMass(cur) * dx
  return {
    mass0,
    massF,
    massErr: Math.abs(massF - mass0),
    peak0,
    peakF,
    cfl,
    finite,
    methodId: FVM_FLUX_ID,
  }
}

/** 族代表样例：面通量 + 质量守恒摘要。 */
export function runFvmSample() {
  const r = runFvmFluxSample()
  return {
    mass0: r.mass0,
    massF: r.massF,
    massErr: r.massErr,
    peakF: r.peakF,
    finite: r.finite,
    methodId: FVM_PARENT as typeof FVM_PARENT,
  }
}

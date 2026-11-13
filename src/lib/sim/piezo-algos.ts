/**
 * 压电效应 · 纯算法教学 stub。
 * 正压电：电荷/电压 ~ d · F；逆压电：应变 ~ d · E。
 * method id 仅常量；不改 methods.data / moduleRegistry / edges / dependencies。
 */

/** 父族 · 压电换能。 */
export const METHOD_PIEZO = 'method-piezo'

/** 子算法 · 正压电（力 → 电荷/电压）。 */
export const METHOD_ALGO_PIEZO_DIRECT = 'method-algo-piezo-direct'

/** 子算法 · 逆压电（电场 → 应变）。 */
export const METHOD_ALGO_PIEZO_CONVERSE = 'method-algo-piezo-converse'

export const PIEZO_METHOD_IDS = [
  METHOD_ALGO_PIEZO_DIRECT,
  METHOD_ALGO_PIEZO_CONVERSE,
] as const

/**
 * 正压电：生成电荷
 *   Q = d · F
 *
 * d: 压电常数 (C/N)，F: 力 (N)。教学标量（忽略张量下标）。
 */
export function piezoDirectCharge(d: number, force: number): number {
  if (!Number.isFinite(d) || !Number.isFinite(force)) return NaN
  return d * force
}

/**
 * 正压电：开路电压（平行板电容近似）
 *   V = Q / C = (d · F) / C
 *
 * C: 电容 (F)。C≤0 时 NaN。
 */
export function piezoDirectVoltage(
  d: number,
  force: number,
  capacitance: number,
): number {
  if (
    !Number.isFinite(d) ||
    !Number.isFinite(force) ||
    !Number.isFinite(capacitance) ||
    !(capacitance > 0)
  ) {
    return NaN
  }
  return (d * force) / capacitance
}

/**
 * 逆压电：应变
 *   S = d · E
 *
 * d: 压电常数 (m/V，与 C/N 在 SI 下同量纲)，E: 电场 (V/m)。
 * 教学标量：应变无量纲。
 */
export function piezoConverseStrain(d: number, electricField: number): number {
  if (!Number.isFinite(d) || !Number.isFinite(electricField)) return NaN
  return d * electricField
}

/**
 * 逆压电：位移（均匀场、厚度 t）
 *   ΔL = S · t = d · E · t = d · V
 *
 * 当 E = V/t 时 ΔL = d · V（与厚度无关的常见教学式）。
 */
export function piezoConverseDisplacement(
  d: number,
  voltage: number,
): number {
  if (!Number.isFinite(d) || !Number.isFinite(voltage)) return NaN
  return d * voltage
}

/**
 * 正压电样例：Q=dF；V=Q/C；对 F 线性；F=0 → 0。
 */
export function runPiezoDirectSample(opts?: {
  d?: number
  force?: number
  capacitance?: number
}): {
  d: number
  force: number
  capacitance: number
  Q: number
  V: number
  Q_doubleF: number
  Q_zero: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_PIEZO_DIRECT
  familyId: typeof METHOD_PIEZO
} {
  // PZT 量级教学：d33 ~ 300 pC/N
  const d = opts?.d ?? 300e-12
  const force = opts?.force ?? 10 // N
  const capacitance = opts?.capacitance ?? 1e-9 // 1 nF

  const Q = piezoDirectCharge(d, force)
  const V = piezoDirectVoltage(d, force, capacitance)
  const Q_doubleF = piezoDirectCharge(d, 2 * force)
  const Q_zero = piezoDirectCharge(d, 0)

  const finite =
    Number.isFinite(Q) &&
    Number.isFinite(V) &&
    Number.isFinite(Q_doubleF) &&
    Number.isFinite(Q_zero)

  const linOk = Math.abs(Q_doubleF - 2 * Q) < 1e-18
  const zeroOk = Math.abs(Q_zero) < 1e-30
  const vOk = Math.abs(V - Q / capacitance) < 1e-12 * Math.max(1, Math.abs(V))
  const signOk = (d > 0 && force > 0 && Q > 0) || Q === 0

  const ok = finite && linOk && zeroOk && vOk && signOk

  return {
    d,
    force,
    capacitance,
    Q,
    V,
    Q_doubleF,
    Q_zero,
    finite,
    ok,
    methodId: METHOD_ALGO_PIEZO_DIRECT,
    familyId: METHOD_PIEZO,
  }
}

/**
 * 逆压电样例：S=dE；ΔL=dV；对 E/V 线性。
 */
export function runPiezoConverseSample(opts?: {
  d?: number
  electricField?: number
  voltage?: number
}): {
  d: number
  electricField: number
  voltage: number
  strain: number
  displacement: number
  strain_doubleE: number
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_PIEZO_CONVERSE
  familyId: typeof METHOD_PIEZO
} {
  const d = opts?.d ?? 300e-12
  const electricField = opts?.electricField ?? 1e5 // V/m
  const voltage = opts?.voltage ?? 100 // V

  const strain = piezoConverseStrain(d, electricField)
  const displacement = piezoConverseDisplacement(d, voltage)
  const strain_doubleE = piezoConverseStrain(d, 2 * electricField)

  const finite =
    Number.isFinite(strain) &&
    Number.isFinite(displacement) &&
    Number.isFinite(strain_doubleE)

  const linOk = Math.abs(strain_doubleE - 2 * strain) < 1e-18
  const dispOk = Math.abs(displacement - d * voltage) < 1e-18
  const nonNeg = d > 0 && electricField > 0 ? strain > 0 : true

  const ok = finite && linOk && dispOk && nonNeg

  return {
    d,
    electricField,
    voltage,
    strain,
    displacement,
    strain_doubleE,
    finite,
    ok,
    methodId: METHOD_ALGO_PIEZO_CONVERSE,
    familyId: METHOD_PIEZO,
  }
}

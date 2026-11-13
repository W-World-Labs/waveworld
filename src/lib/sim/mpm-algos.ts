/**
 * 物质点法 MPM · 纯算法核（1D 教学 stub）。
 * P2G：线性 hat 权重将质量/动量散射到均匀网格；
 * G2P：网格速度插值回粒子（可选 PIC/FLIP 混合）。
 * method id 仅常量；不改 methods.data / moduleRegistry / edges / dependencies。
 */

/** 父族 · 物质点法 MPM。 */
export const METHOD_MPM = 'method-mpm'

/** 子算法 · PIC 风格 P2G 质量/动量转移。 */
export const METHOD_ALGO_MPM_PIC_TRANSFER = 'method-algo-mpm-pic-transfer'

/** 子算法 · G2P 速度插值（可选 PIC 混合）。 */
export const METHOD_ALGO_MPM_G2P = 'method-algo-mpm-g2p'

export const MPM_METHOD_IDS = [
  METHOD_ALGO_MPM_PIC_TRANSFER,
  METHOD_ALGO_MPM_G2P,
] as const

/** 1D 物质点（质量 m、位置 x、速度 v）。 */
export type MpmParticle1d = {
  m: number
  x: number
  v: number
}

/**
 * 1D 线性 hat 形函数 N(ξ)，ξ = (x − x_i)/h：
 *   N = 1 − |ξ|  if |ξ| < 1
 *   N = 0        otherwise
 *
 * 相邻两节点权重之和为 1（粒子在单元内）。
 */
export function linearHat(xi: number): number {
  if (!Number.isFinite(xi)) return 0
  const a = Math.abs(xi)
  return a < 1 ? 1 - a : 0
}

/**
 * 节点 i 在粒子位置 x_p 处的 hat 权重：
 * N_i(x_p) = linearHat((x_p − (x0 + i·h)) / h)。
 */
export function hatWeight(
  x_p: number,
  nodeIndex: number,
  h: number,
  x0 = 0,
): number {
  if (!(h > 0) || !Number.isFinite(x_p) || !Number.isFinite(x0)) return 0
  const x_i = x0 + nodeIndex * h
  return linearHat((x_p - x_i) / h)
}

/**
 * 返回粒子 x_p 支撑的左右节点下标与权重（均匀网格，非周期夹持边界）。
 * i = floor((x_p−x0)/h)，wL = 1−frac，wR = frac；越界节点权重记 0。
 */
export function particleNodeWeights(
  x_p: number,
  nNodes: number,
  h: number,
  x0 = 0,
): { iL: number; iR: number; wL: number; wR: number } {
  if (!(h > 0) || nNodes < 1 || !Number.isFinite(x_p)) {
    return { iL: 0, iR: 0, wL: 0, wR: 0 }
  }
  const xi = (x_p - x0) / h
  let iL = Math.floor(xi)
  const frac = xi - iL
  // 恰在最右节点：全部权重落在 nNodes−1
  if (iL >= nNodes - 1) {
    iL = nNodes - 1
    return { iL, iR: iL, wL: 1, wR: 0 }
  }
  if (iL < 0) {
    return { iL: 0, iR: Math.min(1, nNodes - 1), wL: 0, wR: 0 }
  }
  const iR = iL + 1
  const wL = 1 - frac
  const wR = frac
  return { iL, iR, wL, wR }
}

/**
 * P2G：将粒子质量/动量散射到网格节点（线性 hat，APIC 略）。
 * 就地清零并写入 nodeMass、nodeMomentum；可选写出 nodeVelocity = p/m。
 *
 * m_i  ← Σ_p m_p N_i(x_p)
 * p_i  ← Σ_p m_p v_p N_i(x_p)
 * v_i  ← p_i / m_i  (m_i > 0)
 */
export function p2gMassMomentum1d(
  particles: ReadonlyArray<MpmParticle1d>,
  nNodes: number,
  h: number,
  x0 = 0,
  out?: {
    nodeMass?: Float64Array
    nodeMomentum?: Float64Array
    nodeVelocity?: Float64Array
  },
): {
  nodeMass: Float64Array
  nodeMomentum: Float64Array
  nodeVelocity: Float64Array
  particleMass: number
  gridMass: number
} {
  const nodeMass =
    out?.nodeMass && out.nodeMass.length === nNodes
      ? out.nodeMass
      : new Float64Array(nNodes)
  const nodeMomentum =
    out?.nodeMomentum && out.nodeMomentum.length === nNodes
      ? out.nodeMomentum
      : new Float64Array(nNodes)
  const nodeVelocity =
    out?.nodeVelocity && out.nodeVelocity.length === nNodes
      ? out.nodeVelocity
      : new Float64Array(nNodes)

  nodeMass.fill(0)
  nodeMomentum.fill(0)
  nodeVelocity.fill(0)

  let particleMass = 0
  for (let p = 0; p < particles.length; p++) {
    const part = particles[p]!
    const m = part.m
    const x = part.x
    const v = part.v
    if (!(m > 0) || !Number.isFinite(m) || !Number.isFinite(x) || !Number.isFinite(v)) {
      continue
    }
    particleMass += m
    const { iL, iR, wL, wR } = particleNodeWeights(x, nNodes, h, x0)
    if (wL > 0) {
      nodeMass[iL]! += m * wL
      nodeMomentum[iL]! += m * v * wL
    }
    if (wR > 0 && iR !== iL) {
      nodeMass[iR]! += m * wR
      nodeMomentum[iR]! += m * v * wR
    }
  }

  let gridMass = 0
  for (let i = 0; i < nNodes; i++) {
    const mi = nodeMass[i]!
    gridMass += mi
    nodeVelocity[i] = mi > 1e-30 ? nodeMomentum[i]! / mi : 0
  }

  return { nodeMass, nodeMomentum, nodeVelocity, particleMass, gridMass }
}

/**
 * 从网格速度插值到粒子位置（纯 PIC）：v_p = Σ_i v_i N_i(x_p)。
 */
export function g2pPicVelocity1d(
  x_p: number,
  nodeVelocity: ArrayLike<number>,
  h: number,
  x0 = 0,
): number {
  const nNodes = nodeVelocity.length
  if (nNodes < 1 || !(h > 0)) return 0
  const { iL, iR, wL, wR } = particleNodeWeights(x_p, nNodes, h, x0)
  let v = 0
  if (wL > 0) v += nodeVelocity[iL]! * wL
  if (wR > 0 && iR !== iL) v += nodeVelocity[iR]! * wR
  return v
}

/**
 * G2P：网格速度 → 粒子速度。
 *
 * - picBlend = 1（默认）：纯 PIC，v ← v_pic
 * - picBlend = 0：纯 FLIP，v ← v + (v_pic − v_pic_n)，其中 v_pic_n 由 nodeVelocityOld 插值
 * - 0 < α < 1：v ← (1−α)·FLIP + α·PIC
 *
 * 若未给 nodeVelocityOld，FLIP 退化为保持原粒子速度（仅 PIC 部分混合）。
 */
export function g2pVelocity1d(
  particles: ReadonlyArray<MpmParticle1d>,
  nodeVelocity: ArrayLike<number>,
  h: number,
  x0 = 0,
  opts?: {
    /** PIC 混合系数 α∈[0,1]，默认 1（纯 PIC）。 */
    picBlend?: number
    /** 本步网格更新前的节点速度（FLIP 用）。 */
    nodeVelocityOld?: ArrayLike<number>
  },
): Float64Array {
  const n = particles.length
  const out = new Float64Array(n)
  const alphaRaw = opts?.picBlend ?? 1
  const alpha = Math.min(1, Math.max(0, alphaRaw))
  const vOld = opts?.nodeVelocityOld

  for (let p = 0; p < n; p++) {
    const part = particles[p]!
    const vPic = g2pPicVelocity1d(part.x, nodeVelocity, h, x0)
    if (alpha >= 1 - 1e-15 || !vOld) {
      // 纯 PIC，或无旧网格速度时：PIC 与旧粒子速度按 α 混合
      if (!vOld && alpha < 1) {
        out[p] = (1 - alpha) * part.v + alpha * vPic
      } else {
        out[p] = vPic
      }
      continue
    }
    const vPicOld = g2pPicVelocity1d(part.x, vOld, h, x0)
    const vFlip = part.v + (vPic - vPicOld)
    out[p] = (1 - alpha) * vFlip + alpha * vPic
  }
  return out
}

/** 粒子总质量 Σ m_p。 */
export function totalParticleMass(particles: ReadonlyArray<MpmParticle1d>): number {
  let s = 0
  for (let i = 0; i < particles.length; i++) {
    const m = particles[i]!.m
    if (Number.isFinite(m) && m > 0) s += m
  }
  return s
}

/** 网格总质量 Σ m_i。 */
export function totalGridMass(nodeMass: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < nodeMass.length; i++) s += nodeMass[i]!
  return s
}

/** 粒子总动量 Σ m_p v_p。 */
export function totalParticleMomentum(
  particles: ReadonlyArray<MpmParticle1d>,
): number {
  let s = 0
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]!
    if (Number.isFinite(p.m) && Number.isFinite(p.v)) s += p.m * p.v
  }
  return s
}

/** 网格总动量 Σ p_i。 */
export function totalGridMomentum(nodeMomentum: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < nodeMomentum.length; i++) s += nodeMomentum[i]!
  return s
}

/**
 * PIC 转移样例（P2G）：多粒子散射到均匀网格。
 * - 总质量守恒（边界内粒子）
 * - 总动量守恒
 * - 节点速度有限
 */
export function runMpmPicTransferSample(opts?: {
  nNodes?: number
  h?: number
  x0?: number
}): {
  nParticles: number
  nNodes: number
  h: number
  particleMass: number
  gridMass: number
  massErr: number
  particleMomentum: number
  gridMomentum: number
  momentumErr: number
  maxAbsNodeVel: number
  ok: boolean
  methodId: typeof METHOD_ALGO_MPM_PIC_TRANSFER
  familyId: typeof METHOD_MPM
} {
  const nNodes = opts?.nNodes ?? 17
  const h = opts?.h ?? 1
  const x0 = opts?.x0 ?? 0
  // 粒子放在网格内部，避免边界 hat 截断丢质量
  const particles: MpmParticle1d[] = [
    { m: 1.0, x: x0 + 2.25 * h, v: 1.0 },
    { m: 2.0, x: x0 + 5.0 * h, v: -0.5 },
    { m: 0.5, x: x0 + 8.75 * h, v: 0.25 },
    { m: 1.5, x: x0 + 11.5 * h, v: 0.0 },
  ]

  const { nodeMass, nodeMomentum, nodeVelocity, particleMass, gridMass } =
    p2gMassMomentum1d(particles, nNodes, h, x0)

  const massErr = Math.abs(gridMass - particleMass)
  const particleMomentum = totalParticleMomentum(particles)
  const gridMomentum = totalGridMomentum(nodeMomentum)
  const momentumErr = Math.abs(gridMomentum - particleMomentum)

  let maxAbsNodeVel = 0
  let finite = true
  for (let i = 0; i < nNodes; i++) {
    const vi = nodeVelocity[i]!
    if (!Number.isFinite(vi) || !Number.isFinite(nodeMass[i]!)) finite = false
    const a = Math.abs(vi)
    if (a > maxAbsNodeVel) maxAbsNodeVel = a
  }

  const ok =
    finite &&
    particleMass > 0 &&
    massErr < 1e-12 &&
    momentumErr < 1e-12 &&
    Number.isFinite(maxAbsNodeVel)

  return {
    nParticles: particles.length,
    nNodes,
    h,
    particleMass,
    gridMass,
    massErr,
    particleMomentum,
    gridMomentum,
    momentumErr,
    maxAbsNodeVel,
    ok,
    methodId: METHOD_ALGO_MPM_PIC_TRANSFER,
    familyId: METHOD_MPM,
  }
}

/**
 * G2P 样例：均匀网格速度场插值回粒子；PIC 混合检查。
 * - 常数速度场：粒子速度 = 该常数（PIC）
 * - 线性速度场：hat 插值精确重现
 * - picBlend 边界行为有限
 */
export function runMpmG2pSample(opts?: {
  nNodes?: number
  h?: number
  x0?: number
  /** 常数速度场幅值 */
  vConst?: number
  picBlend?: number
}): {
  nParticles: number
  nNodes: number
  h: number
  vConst: number
  picBlend: number
  /** 常数场下粒子速度相对误差 max |v_p − vConst| */
  constFieldErr: number
  /** 线性场 v(x)=a·(x−x0) 下 max 插值误差 */
  linearFieldErr: number
  /** PIC 混合后速度有限 */
  blendFinite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_MPM_G2P
  familyId: typeof METHOD_MPM
} {
  const nNodes = opts?.nNodes ?? 17
  const h = opts?.h ?? 1
  const x0 = opts?.x0 ?? 0
  const vConst = opts?.vConst ?? 2.5
  const picBlend = opts?.picBlend ?? 0.5

  const particles: MpmParticle1d[] = [
    { m: 1, x: x0 + 3.3 * h, v: 0 },
    { m: 1, x: x0 + 7.0 * h, v: 1 },
    { m: 1, x: x0 + 12.1 * h, v: -1 },
  ]

  // 常数速度场
  const nodeVConst = new Float64Array(nNodes)
  nodeVConst.fill(vConst)
  const vPicConst = g2pVelocity1d(particles, nodeVConst, h, x0, { picBlend: 1 })
  let constFieldErr = 0
  for (let p = 0; p < particles.length; p++) {
    const e = Math.abs(vPicConst[p]! - vConst)
    if (e > constFieldErr) constFieldErr = e
  }

  // 线性速度场 v_i = a · (x_i − x0)；1D 线性 hat 精确
  const aSlope = 0.3
  const nodeVLin = new Float64Array(nNodes)
  for (let i = 0; i < nNodes; i++) {
    nodeVLin[i] = aSlope * (x0 + i * h - x0)
  }
  let linearFieldErr = 0
  for (let p = 0; p < particles.length; p++) {
    const expected = aSlope * (particles[p]!.x - x0)
    const got = g2pPicVelocity1d(particles[p]!.x, nodeVLin, h, x0)
    const e = Math.abs(got - expected)
    if (e > linearFieldErr) linearFieldErr = e
  }

  // 混合：先 P2G 得到网格，再 G2P 带 picBlend
  const particlesMoving: MpmParticle1d[] = [
    { m: 1, x: x0 + 4.5 * h, v: 1.0 },
    { m: 2, x: x0 + 9.25 * h, v: -0.5 },
  ]
  const p2g = p2gMassMomentum1d(particlesMoving, nNodes, h, x0)
  // 人为更新网格速度（模拟网格步）
  const nodeVNew = new Float64Array(nNodes)
  for (let i = 0; i < nNodes; i++) {
    nodeVNew[i] = p2g.nodeVelocity[i]! + 0.1
  }
  const vBlend = g2pVelocity1d(particlesMoving, nodeVNew, h, x0, {
    picBlend,
    nodeVelocityOld: p2g.nodeVelocity,
  })
  let blendFinite = true
  for (let p = 0; p < vBlend.length; p++) {
    if (!Number.isFinite(vBlend[p]!)) blendFinite = false
  }

  const ok =
    constFieldErr < 1e-12 &&
    linearFieldErr < 1e-12 &&
    blendFinite &&
    Number.isFinite(constFieldErr)

  return {
    nParticles: particles.length,
    nNodes,
    h,
    vConst,
    picBlend,
    constFieldErr,
    linearFieldErr,
    blendFinite,
    ok,
    methodId: METHOD_ALGO_MPM_G2P,
    familyId: METHOD_MPM,
  }
}

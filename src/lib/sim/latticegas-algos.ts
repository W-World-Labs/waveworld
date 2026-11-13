/**
 * HPP lattice gas pure algo stub · 2D square lattice, 4 velocities.
 * Head-on collision exchange (↔ ↔ ↕ ↕) + stream to neighbors; mass conserved.
 * method id constants only; no methods.data / registry / edges.
 */

/** Family · lattice gas (HPP). */
export const METHOD_LATTICE_GAS = 'method-lattice-gas'

/** Algo · HPP head-on collision. */
export const METHOD_ALGO_HPP_COLLIDE = 'method-algo-hpp-collide'

/** Algo · HPP streaming to neighbor cells. */
export const METHOD_ALGO_HPP_STREAM = 'method-algo-hpp-stream'

/** Parent alias (aligns with familyId). */
export const LATTICE_GAS_PARENT = METHOD_LATTICE_GAS

export const LATTICE_GAS_METHOD_IDS = [
  METHOD_ALGO_HPP_COLLIDE,
  METHOD_ALGO_HPP_STREAM,
] as const

/**
 * HPP discrete velocities (q = 0..3):
 *   0: +x (right), 1: +y (up), 2: −x (left), 3: −y (down).
 */
export const HPP_E = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const

/** Number of velocity channels. */
export const HPP_Q = 4

/**
 * Occupancy state: f[q] is row-major nx×ny, values 0 or 1 (boolean gas).
 * Exclusion: at most one particle per (cell, direction).
 */
export type HppState = Float64Array[]

/** Allocate empty nx×ny HPP field (all zero). */
export function createHpp(nx: number, ny: number): HppState {
  const n = nx * ny
  return [
    new Float64Array(n),
    new Float64Array(n),
    new Float64Array(n),
    new Float64Array(n),
  ]
}

/** Flat index for (i,j) with row-major, i in x, j in y. */
export function hppIdx(i: number, j: number, nx: number): number {
  return j * nx + i
}

/** Local density ρ = Σ_q f_q at cell k. */
export function densityAt(f: HppState, k: number): number {
  return f[0]![k]! + f[1]![k]! + f[2]![k]! + f[3]![k]!
}

/** Total mass Σ cells ρ. */
export function totalMass(f: HppState): number {
  const n = f[0]!.length
  let m = 0
  for (let k = 0; k < n; k++) m += densityAt(f, k)
  return m
}

/** Mean density. */
export function meanDensity(f: HppState): number {
  const n = f[0]!.length
  return n > 0 ? totalMass(f) / n : 0
}

/**
 * Density field variance (flatness diagnostic):
 * Var(ρ) = ⟨ρ²⟩ − ⟨ρ⟩².
 */
export function densityVariance(f: HppState): number {
  const n = f[0]!.length
  if (n === 0) return 0
  let s = 0
  let s2 = 0
  for (let k = 0; k < n; k++) {
    const r = densityAt(f, k)
    s += r
    s2 += r * r
  }
  const mean = s / n
  return s2 / n - mean * mean
}

/**
 * HPP head-on collision (in-place, boolean):
 * Only exclusive pairs exchange:
 *   right+left (no up/down) → up+down
 *   up+down (no left/right) → right+left
 * Dual occupancy of both pairs is unchanged (two head-ons cancel / rest).
 * Mass and momentum (up to lattice) conserved at each site.
 */
export function hppCollide(f: HppState): void {
  const n = f[0]!.length
  for (let k = 0; k < n; k++) {
    const r = f[0]![k]!
    const u = f[1]![k]!
    const l = f[2]![k]!
    const d = f[3]![k]!
    // exclusive horizontal head-on → vertical
    const horiz = r > 0.5 && l > 0.5 && u < 0.5 && d < 0.5
    // exclusive vertical head-on → horizontal
    const vert = u > 0.5 && d > 0.5 && r < 0.5 && l < 0.5
    if (horiz) {
      f[0]![k] = 0
      f[2]![k] = 0
      f[1]![k] = 1
      f[3]![k] = 1
    } else if (vert) {
      f[1]![k] = 0
      f[3]![k] = 0
      f[0]![k] = 1
      f[2]![k] = 1
    }
  }
}

/**
 * HPP stream (periodic): f_q(x) → f_q(x + e_q).
 * Does not mutate input; returns new state.
 */
export function hppStream(f: HppState, nx: number, ny: number): HppState {
  const out = createHpp(nx, ny)
  for (let q = 0; q < HPP_Q; q++) {
    const ex = HPP_E[q]![0]
    const ey = HPP_E[q]![1]
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const src = hppIdx(i, j, nx)
        const val = f[q]![src]!
        if (val === 0) continue
        const ti = (((i + ex) % nx) + nx) % nx
        const tj = (((j + ey) % ny) + ny) % ny
        out[q]![hppIdx(ti, tj, nx)] = val
      }
    }
  }
  return out
}

/** One full HPP step: collide in-place on a copy, then stream. */
export function hppStep(f: HppState, nx: number, ny: number): HppState {
  const cur: HppState = [
    new Float64Array(f[0]!),
    new Float64Array(f[1]!),
    new Float64Array(f[2]!),
    new Float64Array(f[3]!),
  ]
  hppCollide(cur)
  return hppStream(cur, nx, ny)
}

/**
 * Seed a compact blob of horizontal head-on pairs near center
 * (right+left at each cell of a block) for collision demos.
 */
export function seedHeadOnPairs(
  f: HppState,
  nx: number,
  ny: number,
  halfW = 2,
): void {
  const cx = Math.floor(nx / 2)
  const cy = Math.floor(ny / 2)
  for (let dj = -halfW; dj <= halfW; dj++) {
    for (let di = -halfW; di <= halfW; di++) {
      const i = cx + di
      const j = cy + dj
      if (i < 0 || i >= nx || j < 0 || j >= ny) continue
      const k = hppIdx(i, j, nx)
      f[0]![k] = 1
      f[2]![k] = 1
    }
  }
}

/**
 * Seed a localized density peak: fill all 4 directions in a small disk.
 * Used for stream / multi-step flatness demos.
 */
export function seedDensityPeak(
  f: HppState,
  nx: number,
  ny: number,
  radius = 2,
): void {
  const cx = Math.floor(nx / 2)
  const cy = Math.floor(ny / 2)
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const dx = i - cx
      const dy = j - cy
      if (dx * dx + dy * dy <= radius * radius) {
        const k = hppIdx(i, j, nx)
        for (let q = 0; q < HPP_Q; q++) f[q]![k] = 1
      }
    }
  }
}

/**
 * Collision sample: exclusive head-on pairs flip direction axes; mass conserved.
 * methodId → method-algo-hpp-collide.
 */
export function runHppCollideSample(
  opts: { nx?: number; ny?: number } = {},
): {
  nx: number
  ny: number
  mass0: number
  massF: number
  massErr: number
  /** sites that were exclusive horiz pairs before collide */
  pairs0: number
  /** sites that became exclusive vert pairs after collide */
  pairsVertF: number
  flipped: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_HPP_COLLIDE
  familyId: typeof METHOD_LATTICE_GAS
} {
  const nx = opts.nx ?? 16
  const ny = opts.ny ?? 16
  const f = createHpp(nx, ny)
  seedHeadOnPairs(f, nx, ny, 2)

  let pairs0 = 0
  const n = nx * ny
  for (let k = 0; k < n; k++) {
    if (
      f[0]![k]! > 0.5 &&
      f[2]![k]! > 0.5 &&
      f[1]![k]! < 0.5 &&
      f[3]![k]! < 0.5
    ) {
      pairs0++
    }
  }

  const mass0 = totalMass(f)
  hppCollide(f)
  const massF = totalMass(f)

  let pairsVertF = 0
  let finite = true
  for (let k = 0; k < n; k++) {
    for (let q = 0; q < HPP_Q; q++) {
      if (!Number.isFinite(f[q]![k]!)) finite = false
    }
    if (
      f[1]![k]! > 0.5 &&
      f[3]![k]! > 0.5 &&
      f[0]![k]! < 0.5 &&
      f[2]![k]! < 0.5
    ) {
      pairsVertF++
    }
  }

  const massErr = Math.abs(massF - mass0)
  const flipped = pairsVertF === pairs0 && pairs0 > 0
  const ok = massErr < 1e-12 && flipped && finite

  return {
    nx,
    ny,
    mass0,
    massF,
    massErr,
    pairs0,
    pairsVertF,
    flipped,
    finite,
    ok,
    methodId: METHOD_ALGO_HPP_COLLIDE,
    familyId: METHOD_LATTICE_GAS,
  }
}

/**
 * Stream sample: peak propagates; multi-step collide+stream mass conserved.
 * Optional density flatness: variance drops as particles disperse.
 * methodId → method-algo-hpp-stream.
 */
export function runHppStreamSample(
  opts: { nx?: number; ny?: number; steps?: number } = {},
): {
  nx: number
  ny: number
  steps: number
  mass0: number
  massF: number
  massErr: number
  var0: number
  varF: number
  /** stream unit test: single right-mover advanced one cell */
  streamOk: boolean
  densityFlattened: boolean
  finite: boolean
  ok: boolean
  methodId: typeof METHOD_ALGO_HPP_STREAM
  familyId: typeof METHOD_LATTICE_GAS
} {
  const nx = opts.nx ?? 24
  const ny = opts.ny ?? 24
  const steps = opts.steps ?? 30

  // unit stream: one particle e=+x at (0,0) → (1,0)
  const unit = createHpp(nx, ny)
  unit[0]![hppIdx(0, 0, nx)] = 1
  const unitS = hppStream(unit, nx, ny)
  const streamOk = unitS[0]![hppIdx(1, 0, nx)] === 1 && totalMass(unitS) === 1

  let f = createHpp(nx, ny)
  seedDensityPeak(f, nx, ny, 2)
  const mass0 = totalMass(f)
  const var0 = densityVariance(f)

  for (let t = 0; t < steps; t++) {
    f = hppStep(f, nx, ny)
  }

  const massF = totalMass(f)
  const varF = densityVariance(f)
  let finite = true
  const n = nx * ny
  for (let k = 0; k < n; k++) {
    for (let q = 0; q < HPP_Q; q++) {
      if (!Number.isFinite(f[q]![k]!)) finite = false
    }
  }

  const massErr = Math.abs(massF - mass0)
  const densityFlattened = varF < var0 * 0.95 || varF < var0 - 1e-9
  const ok =
    streamOk &&
    massErr < 1e-12 &&
    densityFlattened &&
    finite &&
    mass0 > 0

  return {
    nx,
    ny,
    steps,
    mass0,
    massF,
    massErr,
    var0,
    varF,
    streamOk,
    densityFlattened,
    finite,
    ok,
    methodId: METHOD_ALGO_HPP_STREAM,
    familyId: METHOD_LATTICE_GAS,
  }
}

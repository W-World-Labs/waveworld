/**
 * LAMMPS input-script subset interpreter for the bundled software-case corpus.
 *
 * Reads commands, never data files (that is `lammps-data.ts`). The supported
 * subset is exactly what the canonical `examples/melt/in.melt` script needs:
 * a 3D periodic cubic box of unit-mass LJ atoms on an fcc lattice, Maxwell–
 * Boltzmann `velocity create`, `pair_style lj/cut`, `fix … nve`, `run`.
 * Anything else fails closed with a named command instead of being skipped.
 */
import { rng } from '../mc'

export const LAMMPS_INPUT_MAX_BYTES = 64 * 1024
/** LAMMPS default timestep for `units lj` when the script sets none. */
export const LAMMPS_LJ_DEFAULT_DT = 0.005

export type LammpsInputSpec = {
  atomStyle: 'atomic'
  lattice: { style: 'fcc'; density: number }
  /** Cubic box edge in LJ units (region extent × lattice constant). */
  boxL: number
  atomTypes: number
  atomType: number
  /** Atom count implied by the lattice fill (region cells × 4). */
  atomCount: number
  mass: number
  rCut: number
  epsilon: number
  sigma: number
  /** `velocity all create` target temperature and seed. */
  temperature: number
  seed: number
  fix: 'nve'
  dt: number
  steps: number
}

const NUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const num = (tok: string | undefined, what: string): number => {
  const v = Number(tok)
  if (tok === undefined || !NUM.test(tok) || !Number.isFinite(v)) {
    throw new Error(`LAMMPS input: expected numeric ${what}`)
  }
  return v
}
const int = (tok: string | undefined, what: string): number => {
  const v = num(tok, what)
  if (!Number.isSafeInteger(v)) throw new Error(`LAMMPS input: expected integer ${what}`)
  return v
}

/**
 * Parse a LAMMPS input script into the executable subset above.
 * Unknown or unsupported commands throw; comment lines and blanks are skipped.
 */
export function parseLammpsInput(text: string): LammpsInputSpec {
  if (new TextEncoder().encode(text).length > LAMMPS_INPUT_MAX_BYTES) {
    throw new Error('LAMMPS input exceeds 64 KiB')
  }
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)

  let units = ''
  let atomStyle = ''
  let lattice: { style: 'fcc'; density: number } | null = null
  const regions = new Map<string, number[]>()
  let atomTypes = 0
  let atomType = 0
  let boxRegion: string | null = null
  let createAtoms = false
  let mass = 0
  let pairStyle = ''
  let rCut = 0
  let pairCoeffs: { i: number; j: number; epsilon: number; sigma: number; rCut: number }[] = []
  let velocity: { temperature: number; seed: number } | null = null
  let fix: 'nve' | null = null
  let dt = LAMMPS_LJ_DEFAULT_DT
  let steps = 0
  // Settings that configure LAMMPS internals but carry no physics for the
  // subset: record their presence, verify their token shapes, ignore the rest.
  const VEL_EXTRA = new Set(['loop', 'geom', 'gaussian', 'uniform', 'sum', 'yes', 'no', 'mom', 'rot', 'dist'])

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const [cmd, ...args] = line.split(/\s+/)
    switch (cmd) {
      case 'units':
        if (args.length !== 1 || args[0] !== 'lj') throw new Error('LAMMPS input: only `units lj` is supported')
        units = 'lj'
        break
      case 'dimension':
        if (args.length !== 1 || args[0] !== '3') throw new Error('LAMMPS input: only `dimension 3` is supported')
        break
      case 'boundary':
        if (args.join(' ') !== 'p p p') throw new Error('LAMMPS input: only `boundary p p p` is supported')
        break
      case 'atom_style':
        if (args.length !== 1 || args[0] !== 'atomic') throw new Error('LAMMPS input: only `atom_style atomic` is supported')
        atomStyle = 'atomic'
        break
      case 'lattice': {
        if (args.length !== 2 || args[0] !== 'fcc') throw new Error('LAMMPS input: only `lattice fcc <density>` is supported')
        const density = num(args[1], 'lattice density')
        if (!(density > 0) || density > 2) throw new Error('LAMMPS input: lattice density out of range')
        lattice = { style: 'fcc', density }
        break
      }
      case 'region': {
        // `region name block x0 x1 y0 y1 z0 z1` — bounds in lattice units.
        if (args.length !== 8 || args[1] !== 'block') {
          throw new Error('LAMMPS input: only `region <name> block …` is supported')
        }
        const bounds = args.slice(2).map((t) => num(t, 'region bound'))
        if (regions.has(args[0]!)) throw new Error('LAMMPS input: duplicate region')
        regions.set(args[0]!, bounds)
        break
      }
      case 'create_box': {
        if (args.length !== 2) throw new Error('LAMMPS input: `create_box <ntypes> <region>`')
        atomTypes = int(args[0], 'create_box ntypes')
        if (atomTypes < 1 || atomTypes > 16) throw new Error('LAMMPS input: atom type count out of range')
        if (!regions.has(args[1]!)) throw new Error('LAMMPS input: create_box references an unknown region')
        boxRegion = args[1]!
        break
      }
      case 'create_atoms': {
        if (args.length !== 2 || args[1] !== 'box') throw new Error('LAMMPS input: only `create_atoms <type> box` is supported')
        atomType = int(args[0], 'create_atoms type')
        createAtoms = true
        break
      }
      case 'mass': {
        if (args.length !== 2) throw new Error('LAMMPS input: `mass <type> <m>`')
        const m = num(args[1], 'mass')
        if (m !== 1) throw new Error('LAMMPS input: this method requires unit mass (m=1) in LJ units')
        mass = m
        break
      }
      case 'velocity': {
        // `velocity all create <T> <seed> [keyword …]` — keyword whitelist only.
        if (args.length < 4 || args[0] !== 'all' || args[1] !== 'create') {
          throw new Error('LAMMPS input: only `velocity all create <T> <seed>` is supported')
        }
        const temperature = num(args[2], 'velocity temperature')
        if (!(temperature > 0) || temperature > 100) throw new Error('LAMMPS input: velocity temperature out of range')
        for (const kw of args.slice(4)) {
          if (!VEL_EXTRA.has(kw)) throw new Error(`LAMMPS input: unsupported velocity keyword '${kw}'`)
        }
        velocity = { temperature, seed: int(args[3], 'velocity seed') }
        break
      }
      case 'pair_style': {
        if (args.length !== 2 || args[0] !== 'lj/cut') throw new Error('LAMMPS input: only `pair_style lj/cut <rc>` is supported')
        pairStyle = 'lj/cut'
        rCut = num(args[1], 'pair_style cutoff')
        if (!(rCut > 0) || rCut > 10) throw new Error('LAMMPS input: cutoff out of range')
        break
      }
      case 'pair_coeff': {
        // `pair_coeff i j eps sigma [rc]`; single-component systems only.
        if (args.length !== 4 && args.length !== 5) throw new Error('LAMMPS input: `pair_coeff i j eps sigma [rc]`')
        const i = int(args[0], 'pair_coeff i')
        const j = int(args[1], 'pair_coeff j')
        if (i !== j || i !== 1) throw new Error('LAMMPS input: only single-component `pair_coeff 1 1` is supported')
        const epsilon = num(args[2], 'pair_coeff epsilon')
        const sigma = num(args[3], 'pair_coeff sigma')
        if (epsilon !== 1 || sigma !== 1) throw new Error('LAMMPS input: this method requires epsilon=sigma=1 in LJ units')
        const rc = args.length === 5 ? num(args[4], 'pair_coeff cutoff') : rCut
        pairCoeffs.push({ i, j, epsilon, sigma, rCut: rc })
        break
      }
      case 'fix': {
        // `fix <id> all nve` — the only integrator this subset supports.
        if (args.length !== 3 || args[1] !== 'all' || args[2] !== 'nve') {
          throw new Error('LAMMPS input: only `fix <id> all nve` is supported')
        }
        if (fix) throw new Error('LAMMPS input: multiple fixes are not supported')
        fix = 'nve'
        break
      }
      case 'unfix':
        throw new Error('LAMMPS input: unfix is not supported')
      case 'neighbor':
      case 'neigh_modify':
      case 'thermo':
      case 'thermo_style':
        // Neighbor-list cadence and logging cadence are engine internals here.
        break
      case 'timestep': {
        if (args.length !== 1) throw new Error('LAMMPS input: `timestep <dt>`')
        dt = num(args[0], 'timestep')
        if (!(dt > 0) || dt > 0.02) throw new Error('LAMMPS input: timestep out of range')
        break
      }
      case 'run': {
        if (args.length !== 1) throw new Error('LAMMPS input: only `run <steps>` is supported')
        steps = int(args[0], 'run steps')
        if (steps < 1 || steps > 100_000) throw new Error('LAMMPS input: run steps out of range')
        break
      }
      default:
        throw new Error(`LAMMPS input: unsupported command '${cmd}'`)
    }
  }

  if (units !== 'lj' || atomStyle !== 'atomic' || !lattice || boxRegion === null || !createAtoms ||
      mass !== 1 || pairStyle !== 'lj/cut' || pairCoeffs.length === 0 || !velocity || !fix || !(steps > 0)) {
    throw new Error('LAMMPS input: incomplete simulation definition for the supported subset')
  }

  // Region bounds are in lattice units: fcc cell edge a = (4/ρ)^{1/3}.
  const bounds = regions.get(boxRegion)!
  const a = Math.cbrt(4 / lattice.density)
  const ext = [bounds[1]! - bounds[0]!, bounds[3]! - bounds[2]!, bounds[5]! - bounds[4]!]
  if (!ext.every((e) => Number.isInteger(e) && e >= 1 && e <= 64)) {
    throw new Error('LAMMPS input: region must span a whole number of fcc cells')
  }
  if (Math.abs(ext[0]! - ext[1]!) > 0 || Math.abs(ext[1]! - ext[2]!) > 0) {
    throw new Error('LAMMPS input: only cubic regions are supported')
  }
  const boxL = ext[0]! * a
  if (rCut >= boxL / 2) throw new Error('LAMMPS input: cutoff exceeds half the box edge')

  return {
    atomStyle,
    lattice,
    boxL,
    atomTypes,
    atomType,
    atomCount: 4 * ext[0]! * ext[1]! * ext[2]!,
    mass,
    rCut,
    epsilon: pairCoeffs[0]!.epsilon,
    sigma: pairCoeffs[0]!.sigma,
    temperature: velocity.temperature,
    seed: velocity.seed,
    fix,
    dt,
    steps,
  }
}

/** Box–Muller on the shared seeded stream (`velocity create` semantics). */
function gaussian(r: () => number): number {
  let u1 = r()
  if (u1 < 1e-12) u1 = 1e-12
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * r())
}

/**
 * Build the atom system the script describes: fcc lattice at the declared
 * density plus per-component Maxwell–Boltzmann velocities at the declared
 * temperature (COM-removed and rescaled so the measured T matches exactly —
 * the same contract as LAMMPS `velocity all create`, though the RNG stream
 * itself is ours, not LAMMPS's Park–Miller sequence).
 */
export function buildLammpsInputSystem(spec: LammpsInputSpec): {
  n: number
  L: number
  pos: Float32Array
  vel: Float32Array
} {
  const nCells = Math.round(spec.boxL / Math.cbrt(4 / spec.lattice.density))
  const a = spec.boxL / nCells
  const n = spec.atomCount
  const L = spec.boxL
  const pos = new Float32Array(n * 3)
  const basis = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]] as const
  let k = 0
  for (let iz = 0; iz < nCells; iz++) {
    for (let iy = 0; iy < nCells; iy++) {
      for (let ix = 0; ix < nCells; ix++) {
        for (const b of basis) {
          pos[k * 3] = Math.fround(((ix + b[0]) * a) % L)
          pos[k * 3 + 1] = Math.fround(((iy + b[1]) * a) % L)
          pos[k * 3 + 2] = Math.fround(((iz + b[2]) * a) % L)
          k++
        }
      }
    }
  }
  const r = rng(spec.seed)
  const vel = new Float32Array(n * 3)
  const sigmaT = Math.sqrt(spec.temperature)
  for (let i = 0; i < n * 3; i++) vel[i] = sigmaT * gaussian(r)
  for (let d = 0; d < 3; d++) {
    let mean = 0
    for (let i = 0; i < n; i++) mean += vel[i * 3 + d]!
    mean /= n
    for (let i = 0; i < n; i++) vel[i * 3 + d]! -= mean
  }
  // Rescale to the exact requested temperature (LAMMPS `create` contract).
  let ke = 0
  for (let i = 0; i < n * 3; i++) ke += vel[i]! * vel[i]!
  const tNow = ke / (3 * n)
  const scale = Math.sqrt(spec.temperature / tNow)
  for (let i = 0; i < n * 3; i++) vel[i] *= scale
  return { n, L, pos, vel }
}

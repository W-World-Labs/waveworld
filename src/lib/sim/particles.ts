import { rng } from '../mc'
import { MD_DT, initialParticles, analyzeMdFrame, type MdObservables } from './md'
import type { ScreeningParams } from './interactions'

export type ParticleSpecies = { name: string; count: number; charge: number; sigma: number; epsilon: number }
/** Current method: equal-mass periodic LJ + screened Coulomb, in reduced units; job/WASM path is 3D unless the scene declares `dim: 2` (e.g. imported 2D LAMMPS data). */
export type ParticleScene = ScreeningParams & {
  species: ParticleSpecies[]; boxL: number; temperature: number; thermostat: boolean
  steps: number; seed: number; positions?: number[]; velocities?: number[]; kind?: number[]
  /** 3（缺省，作业路径）或 2（导入的二维体系，如 z=0 的 LAMMPS 薄片）。 */
  dim?: 2 | 3
}
export type ParticleFrame = {
  pos: Float32Array; speed: Float32Array; kind: Uint8Array; charge: Float32Array
  observables: MdObservables & { totalCharge: number }
}
export const PARTICLE_RDF_BINS = 50
export const particleCount = (scene: ParticleScene) => scene.species.reduce((sum, s) => sum + s.count, 0)

/** Expand user composition with a reproducible spatial permutation, independent of names. */
export function particleProperties(scene: ParticleScene) {
  const ids = scene.kind ? [...scene.kind] : scene.species.flatMap((s, index) => Array<number>(s.count).fill(index)), random = rng(scene.seed)
  for (let i = scene.kind ? 0 : ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  return {
    kind: Uint8Array.from(ids),
    charge: Float32Array.from(ids, i => scene.species[i].charge),
    sigma: Float32Array.from(ids, i => scene.species[i].sigma),
    eps: Float32Array.from(ids, i => scene.species[i].epsilon),
  }
}

/**
 * Shared seeded/explicit initialization; imported coordinates and velocities
 * retain their order. `dim` is 3 on the job/WASM path and 2 for the
 * interactive 2D view; imported arrays must hold `dim` components per particle.
 */
export function initialParticleState(scene: ParticleScene, dim: 2 | 3 = 3) {
  if (scene.dim !== undefined) dim = scene.dim
  const N = particleCount(scene)
  if (scene.positions && scene.positions.length !== N * dim) {
    throw new Error(`particle positions must contain ${dim === 3 ? 'x,y,z' : 'x,y'} for every seeded particle index`)
  }
  if (scene.velocities && scene.velocities.length !== N * dim) {
    throw new Error(`particle velocities must contain ${dim === 3 ? 'vx,vy,vz' : 'vx,vy'} for every particle`)
  }
  const initial = scene.positions && scene.velocities
    ? { pos: Float32Array.from(scene.positions), vel: Float32Array.from(scene.velocities) }
    : initialParticles(N, scene.boxL, dim, scene.temperature, scene.seed)
  if (scene.positions) initial.pos.set(scene.positions)
  if (scene.velocities) initial.vel.set(scene.velocities)
  return { ...initial, ...particleProperties(scene) }
}

/** Same MD file transport, with numeric per-particle interactions; names remain product metadata. */
export function prepareParticleInput(scene: ParticleScene) {
  const dim = scene.dim ?? 3
  const initial = initialParticleState(scene, dim)
  return { n: initial.kind.length, dim, boxL: scene.boxL, dt: MD_DT, rc: 2.5,
    pos: Array.from(initial.pos), vel: Array.from(initial.vel),
    particles: { kind: Array.from(initial.kind), charge: Array.from(initial.charge), sigma: Array.from(initial.sigma), eps: Array.from(initial.eps),
      epsR: scene.epsR, lambdaD: scene.lambdaD, kCoulomb: scene.kCoulomb },
  }
}

export function particleResult(frame: ParticleFrame, steps: number) {
  const { rdf } = analyzeMdFrame(frame, [], PARTICLE_RDF_BINS, false)
  return {
    steps, dt: MD_DT, time: steps * MD_DT,
    pos: Array.from(frame.pos), speed: Array.from(frame.speed), kind: Array.from(frame.kind), charge: Array.from(frame.charge),
    observables: { ...frame.observables }, rdf: { r: Array.from(rdf.r), g: Array.from(rdf.g) },
  }
}

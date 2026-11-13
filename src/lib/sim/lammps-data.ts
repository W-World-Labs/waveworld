import type { ParticleScene } from './particles'
import { validateModuleInput } from './module-compute'

export const LAMMPS_DATA_MAX_BYTES = 512 * 1024

/** Data import into the existing 2D, unit-mass, periodic shifted-LJ method.
 * This reads data, never LAMMPS commands. Run settings are not stored in a data file.
 * Particle indices follow ascending atom IDs; image flags do not carry prior MSD history.
 */
export function parseLammpsData(text: string): ParticleScene {
  if (text.length > LAMMPS_DATA_MAX_BYTES || new TextEncoder().encode(text).length > LAMMPS_DATA_MAX_BYTES) throw new Error('LAMMPS data exceeds 512 KiB')
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const units = lines[0]?.match(/\bunits\s*=\s*(\w+)/)?.[1]
  if (units && units !== 'lj') throw new Error('This method requires LAMMPS units lj')
  const headers = new Map<string, number[]>()
  const sections = new Map<string, number[][]>()
  let section = ''
  for (const raw of lines.slice(1)) {
    const [body, comment = ''] = raw.split('#'), line = body.trim().replace(/\s+/g, ' ')
    if (!line) continue
    if (['Masses', 'Pair Coeffs', 'Atoms', 'Velocities'].includes(line)) {
      if (sections.has(line)) throw new Error(`Duplicate LAMMPS section: ${line}`)
      if (line === 'Atoms' && comment.trim() !== 'atomic') throw new Error('Expected Atoms # atomic; molecular/charge styles are not supported')
      if (line === 'Pair Coeffs' && comment.trim() !== 'lj/cut') throw new Error('Expected Pair Coeffs # lj/cut')
      section = line; sections.set(section, []); continue
    }
    if (/^[A-Za-z]/.test(line)) throw new Error(`Unsupported LAMMPS section or command: ${line.slice(0, 60)}`)
    if (!section) {
      const count = line.match(/^(\d+) (atoms|atom types|bonds|angles|dihedrals|impropers|bond types|angle types|dihedral types|improper types)$/)
      const box = line.match(/^(\S+)\s+(\S+)\s+(xlo xhi|ylo yhi|zlo zhi)$/)
      if (!count && !box) throw new Error('Unsupported LAMMPS header; only an orthogonal atomic box is supported')
      const key = count ? count[2] : box![3], values = count ? [Number(count[1])] : [Number(box![1]), Number(box![2])]
      if (headers.has(key) || !values.every(Number.isFinite)) throw new Error(`Invalid or duplicate LAMMPS header: ${key}`)
      if (count && key !== 'atoms' && key !== 'atom types' && values[0] !== 0) throw new Error('Bonded interactions are not implemented by this method')
      headers.set(key, values)
    } else {
      const tokens = line.split(/\s+/), values = tokens.map(Number)
      if (!tokens.every(t => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) || !values.every(Number.isFinite)) throw new Error(`Invalid numeric row in ${section}`)
      sections.get(section)!.push(values)
    }
  }
  const N = headers.get('atoms')?.[0] ?? 0, types = headers.get('atom types')?.[0] ?? 0
  if (N < 2 || N > 400 || types < 1 || types > 16) throw new Error('Expected 2–400 atoms and 1–16 atom types')
  const x = headers.get('xlo xhi'), y = headers.get('ylo yhi'), z = headers.get('zlo zhi')
  if (!x || !y || !z || z[0] >= 0 || z[1] <= 0) throw new Error('Box bounds must include z=0 for a 2D model')
  const boxL = x[1] - x[0]
  if (!(boxL > 0) || Math.abs(boxL - (y[1] - y[0])) > 1e-10 * boxL) throw new Error('This method requires a square x/y box')
  const keyed = (name: string, count: number, lengths: number[]) => {
    const rows = sections.get(name)
    if (!rows || rows.length !== count) throw new Error(`${name} must contain exactly ${count} rows`)
    const map = new Map<number, number[]>()
    for (const row of rows) {
      if (!lengths.includes(row.length) || !Number.isSafeInteger(row[0]) || row[0] <= 0 || map.has(row[0])) throw new Error(`Invalid or duplicate ID in ${name}`)
      map.set(row[0], row)
    }
    return map
  }
  const masses = keyed('Masses', types, [2]), pairs = keyed('Pair Coeffs', types, [3, 4])
  const species: ParticleScene['species'] = []
  for (let type = 1; type <= types; type++) {
    const mass = masses.get(type), pair = pairs.get(type)
    if (!mass || mass[1] !== 1) throw new Error('Every atom type must have mass 1 in LJ units')
    if (!pair || (pair.length === 4 && pair[3] !== 2.5)) throw new Error('Every atom type needs LJ coefficients with cutoff 2.5')
    species.push({ name: `Type ${type}`, count: 0, charge: 0, sigma: pair[2], epsilon: pair[1] })
  }
  const atoms = keyed('Atoms', N, [5, 8])
  const velocityRows = sections.has('Velocities') ? keyed('Velocities', N, [4]) : null
  const positions: number[] = [], velocities: number[] = [], kind: number[] = []
  for (const [id, atom] of [...atoms].sort(([a], [b]) => a - b)) {
    const type = atom[1], velocity = velocityRows?.get(id) ?? (velocityRows ? null : [id, 0, 0, 0])
    if (!Number.isInteger(type) || type < 1 || type > types) throw new Error('Atom type is outside the declared type range')
    if (!velocity || Math.abs(atom[4]) > 1e-10 || Math.abs(velocity[3]) > 1e-10) throw new Error('This 2D method requires z=0 and vz=0 for every atom')
    if (atom.length === 8 && (!atom.slice(5).every(Number.isSafeInteger) || atom[7] !== 0)) throw new Error('Invalid 2D image flags')
    for (let d = 0; d < 2; d++) {
      const p = atom[2 + d] - (d === 0 ? x[0] : y[0])
      if (p < 0 || p > boxL) throw new Error('Atom coordinates must be wrapped into the declared box')
      // The periodic upper face is the lower face, including FP32 rounding onto it.
      const rounded = Math.fround(p)
      positions.push(rounded >= boxL ? 0 : rounded)
      velocities.push(velocity[1 + d])
    }
    kind.push(type - 1); species[type - 1].count++
  }
  const scene: ParticleScene = { species, boxL, positions, velocities, kind, dim: 2,
    temperature: 1, thermostat: false, epsR: 1, lambdaD: 1, kCoulomb: 0, steps: 5, seed: 1 }
  validateModuleInput({ module: 'particles', scene })
  return scene
}

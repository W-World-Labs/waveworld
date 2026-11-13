import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  LAMMPS_LJ_DEFAULT_DT,
  buildLammpsInputSystem,
  parseLammpsInput,
} from './lammps-input'

const MELT = readFileSync(
  resolve('scripts/research/software-cases/lammps/examples/melt/in.melt'),
  'utf8',
)

const BASE = `units lj
dimension 3
boundary p p p
atom_style atomic
lattice fcc 0.8442
region box block 0 4 0 4 0 4
create_box 1 box
create_atoms 1 box
mass 1 1.0
velocity all create 1.0 12345 loop geom
pair_style lj/cut 2.5
pair_coeff 1 1 1.0 1.0
fix 1 all nve
run 10
`

describe('LAMMPS input-script subset interpreter', () => {
  it('parses the bundled in.melt example', () => {
    const s = parseLammpsInput(MELT)
    expect(s.lattice.density).toBe(0.8442)
    expect(s.atomCount).toBe(4000)
    expect(s.boxL).toBeCloseTo(10 * Math.cbrt(4 / 0.8442), 9)
    expect(s.temperature).toBe(3)
    expect(s.seed).toBe(87287)
    expect(s.steps).toBe(250)
    expect(s.dt).toBe(LAMMPS_LJ_DEFAULT_DT)
  })

  it('generates an fcc lattice with exact MB velocities', () => {
    const s = parseLammpsInput(BASE)
    const sys = buildLammpsInputSystem(s)
    expect(sys.n).toBe(256)
    // Density check: atoms at ρ=0.8442 fill the declared box exactly.
    expect(sys.L * sys.L * sys.L * s.lattice.density).toBeCloseTo(sys.n, 6)
    // Zero COM momentum after removal.
    for (let d = 0; d < 3; d++) {
      let p = 0
      for (let i = 0; i < sys.n; i++) p += sys.vel[i * 3 + d]!
      expect(Math.abs(p)).toBeLessThan(1e-5)
    }
    // Rescaled to exactly the requested temperature (m=kB=1): T = Σv²/(3N).
    let ke = 0
    for (const v of sys.vel) ke += v * v
    expect(ke / (3 * sys.n)).toBeCloseTo(s.temperature, 4)
  })

  it('fails closed on commands outside the subset', () => {
    const cases: [string, RegExp][] = [
      [BASE.replace('units lj', 'units real'), /only `units lj`/],
      [BASE.replace('atom_style atomic', 'atom_style molecular'), /only `atom_style atomic`/],
      [BASE.replace('lattice fcc 0.8442', 'lattice sc 1.0'), /only `lattice fcc <density>`/],
      [BASE.replace('block 0 4 0 4 0 4', 'prism 0 4 0 4 0 4 0 0 0'), /only `region <name> block/],
      [BASE.replace('create_atoms 1 box', 'create_atoms 1 single 0 0 0'), /only `create_atoms <type> box`/],
      [BASE.replace('mass 1 1.0', 'mass 1 2.0'), /unit mass/],
      [BASE.replace('lj/cut 2.5', 'buck 11.0'), /only `pair_style lj\/cut/],
      [BASE.replace('pair_coeff 1 1 1.0 1.0', 'pair_coeff 1 1 2.0 1.0'), /epsilon=sigma=1/],
      [BASE.replace('fix 1 all nve', 'fix 1 all nvt temp 1 1 1'), /only `fix <id> all nve`/],
      [BASE.replace('fix 1 all nve', 'fix 1 all nve\nfix 2 all nve'), /multiple fixes/],
      [BASE.replace('velocity all create 1.0 12345', 'velocity all set 0 0 0'), /only `velocity all create/],
      [BASE.replace('block 0 4 0 4 0 4', 'block 0 4 0 5 0 4'), /only cubic regions/],
      [BASE + 'minimize 1e-4 1e-6 100 1000\n', /unsupported command 'minimize'/],
      [BASE + 'read_data melt.data\n', /unsupported command 'read_data'/],
    ]
    for (const [text, re] of cases) {
      expect(() => parseLammpsInput(text), re.source).toThrow(re)
    }
  })

  it('rejects incomplete definitions and out-of-range values', () => {
    expect(() => parseLammpsInput(BASE.replace('run 10', ''))).toThrow(/incomplete/)
    expect(() => parseLammpsInput(BASE.replace('velocity all create 1.0 12345 loop geom\n', ''))).toThrow(/incomplete/)
    expect(() => parseLammpsInput(BASE.replace('lj/cut 2.5', 'lj/cut 4.0'))).toThrow(/half the box edge/)
    expect(() => parseLammpsInput(BASE.replace('create_box 1 box', 'create_box 1 other'))).toThrow(/unknown region/)
    expect(() => parseLammpsInput(BASE.replace('block 0 4 0 4 0 4', 'block 0 4.5 0 4 0 4'))).toThrow(/whole number of fcc cells/)
  })
})

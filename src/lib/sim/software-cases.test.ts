import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseLammpsData } from './lammps-data'
import manifest from '../../../scripts/research/software-cases/manifest.json'

// An integrity pass is not an import or solver pass. The one accepted MD case
// reuses the 5-step reference comparison already in module-compute.test.ts.
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const corpus = resolve(root, 'scripts/research/software-cases')
const maxFileBytes = 64 * 1024
const maxCorpusBytes = 512 * 1024
type Fixture = { path: string; bytes: number; sha256: string; encoding?: string }
const projects = manifest.projects
const rejected = {
  'lammps-rigid': {
    file: 'lammps/examples/rigid/data.rigid',
    error: /Expected Pair Coeffs # lj\/cut/,
  },
  'lammps-triclinic-fcc': {
    file: 'lammps/examples/triclinic/data.8Apr24.fcc.primitive.g++.1',
    error: /only an orthogonal atomic box is supported/,
  },
  'lammps-kappa-langevin': {
    file: 'lammps/examples/KAPPA/in.langevin',
    error: /^Unsupported LAMMPS section or command: variable x index 10$/,
  },
  'lammps-friction': {
    file: 'lammps/examples/friction/in.friction',
    error: /^Unsupported LAMMPS section or command: dimension 2$/,
  },
  'lammps-flow-poiseuille': {
    file: 'lammps/examples/flow/in.flow.pois',
    error: /^Unsupported LAMMPS section or command: dimension 2$/,
  },
}

function checkedFile(base: string, file: Fixture) {
  const path = resolve(base, file.path)
  expect(path.startsWith(base + sep)).toBe(true)
  expect(statSync(path).isFile()).toBe(true)
  expect(file.bytes).toBeGreaterThan(0)
  expect(file.bytes).toBeLessThanOrEqual(maxFileBytes)
  expect(statSync(path).size).toBe(file.bytes)
  const bytes = readFileSync(path)
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256)
  if (file.encoding !== 'binary') {
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).not.toThrow()
  }
  return bytes.toString('utf8')
}

describe('pinned upstream software case corpus (offline)', () => {
  it('keeps licenses, provenance, byte limits and coverage levels explicit', () => {
    expect(manifest.schemaVersion).toBe(1)
    expect(new Set(manifest.cases.map(c => c.id)).size).toBe(manifest.cases.length)
    // Removing a case or downgrading its label must not silently skip evidence.
    expect(manifest.cases.filter(c => c.check === 'reject-unsupported').map(c => c.id).sort())
      .toEqual(Object.keys(rejected).sort())
    expect(manifest.cases.filter(c => c.check === 'reference-smoke').map(c => c.id))
      .toEqual(['lammps-lj-2d'])
    const files = [...Object.values(projects).map(p => p.license.file), ...manifest.cases.flatMap(c => c.files)]
    expect(new Set(files.map(f => f.path)).size).toBe(files.length)
    expect(files.reduce((sum, f) => sum + f.bytes, 0)).toBeLessThanOrEqual(maxCorpusBytes)
    const bundled = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? bundled(resolve(path, entry.name)) : [resolve(path, entry.name)])
    expect(bundled(corpus).sort()).toEqual([
      resolve(corpus, 'manifest.json'), resolve(corpus, 'README.md'), ...files.map(f => resolve(corpus, f.path)),
    ].sort())
    for (const project of Object.values(projects)) {
      expect(project.repository).toMatch(/^https:\/\/github\.com\/[\w-]+\/[\w.-]+$/)
      expect(project.commit).toMatch(/^[a-f0-9]{40}$/)
      expect(project.attribution.length).toBeGreaterThan(0)
      expect(project.license.name.length).toBeGreaterThan(0)
      expect(project.license.file.url).toBe(`${project.repository.replace('github.com', 'raw.githubusercontent.com')}/${project.commit}/${project.license.file.sourcePath}`)
      checkedFile(corpus, project.license.file)
    }
    for (const entry of manifest.cases) {
      expect(['DFT', 'CFD', 'MD', 'quantum-chemistry', 'structural', 'thermal']).toContain(entry.domain)
      expect(entry.physics.length).toBeGreaterThan(0)
      expect(entry.limitation.length).toBeGreaterThan(0)
      expect(['integrity-only', 'reject-unsupported', 'reference-smoke', 'executed-solver']).toContain(entry.check)
      // Upgrading these levels requires an implemented importer/solver test.
      if (entry.project !== 'lammps') {
        expect(['integrity-only', 'executed-solver']).toContain(entry.check)
      }
      if (entry.check === 'executed-solver') {
        expect(entry.test).toContain('src/lib/sim/software-cases-exec.test.ts:')
        expect([
          'calculix-b31', 'calculix-planestrain', 'calculix-planestrain2', 'calculix-planestress',
          'energyplus-1zone-envelope', 'frame3dd-exA-truss', 'lammps-melt',
          'moose-casl-i1-heat-source', 'moose-casl-i4-heated-plate', 'moose-convective-flux', 'moose-nafems-t3',
          'moose-simple-diffusion', 'moose-simple-transient-diffusion',
          'openfoam12-cavity',
          'openfoam12-planarcouette', 'openfoam12-planarpoiseuille',
          'openfoam12-shocktube', 'openfoam8-cavity-laminar', 'openfoam8-dambreak',
        ]).toContain(entry.id)
      }
      if (entry.check === 'reference-smoke') {
        expect(entry.id).toBe('lammps-lj-2d')
        expect(entry.test).toContain('src/lib/sim/module-compute.test.ts:')
        expect(entry.references?.map(f => f.path)).toEqual([
          'public/datasets/lammps-lj-2d.data', 'public/datasets/lammps-lj-2d-reference.json',
        ])
        for (const reference of entry.references!) checkedFile(root, reference)
      }
    }
  })

  it('byte-pins every bundled dataset documented in public/datasets/README.md', () => {
    const dir = resolve(root, 'public/datasets')
    const readme = readFileSync(resolve(dir, 'README.md'), 'utf8')
    const bundled = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? bundled(resolve(path, entry.name)) : [resolve(path, entry.name).slice(dir.length + 1).split(sep).join('/')])
    expect(bundled(dir).filter(name => name !== 'README.md').sort())
      .toEqual(manifest.datasets.map(file => file.path.slice('public/datasets/'.length)).sort())
    for (const file of manifest.datasets) {
      expect(file.path.startsWith('public/datasets/')).toBe(true)
      // The README documents each digest; the manifest pins and CI recomputes it.
      expect(readme).toContain(file.sha256)
      checkedFile(root, file)
    }
  })

  for (const entry of manifest.cases) {
    it(`${entry.id}: source integrity only (${entry.files.length} source files)`, () => {
      const project = projects[entry.project as keyof typeof projects]
      expect(entry.files.length).toBeGreaterThan(0)
      for (const file of entry.files) {
        expect(file.url).toBe(`${project.repository.replace('github.com', 'raw.githubusercontent.com')}/${project.commit}/${file.sourcePath}`)
        checkedFile(corpus, file)
      }
    })
  }

  for (const entry of manifest.cases.filter(c => c.check === 'reject-unsupported')) {
    it(`${entry.id}: rejects unsupported original LAMMPS input`, () => {
      const expected = rejected[entry.id as keyof typeof rejected]
      expect(expected).toBeDefined()
      expect(entry.rejectFile).toBe(expected.file)
      const file = entry.files.find(f => f.path === entry.rejectFile)!
      expect(file).toBeDefined()
      expect(() => parseLammpsData(checkedFile(corpus, file))).toThrow(expected.error)
    })
  }
})

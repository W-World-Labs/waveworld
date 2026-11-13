import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { defaultJobSpec } from '@w-sim/contracts'
import { createLbmJobRunner, bgkTauFromViscosity } from '@w-sim/solvers-lbm'
import { createStructuralRunner } from '@w-sim/solvers-structural'
import { createThermalRunner } from '@w-sim/solvers-thermal'
import {
  parseOpenFoamBoundaryField,
  parseOpenFoamBlockMesh,
  parseOpenFoamMomentumSource,
  parseOpenFoamNu,
  parseOpenFoamSetFields,
  parseOpenFoamSimulationType,
  parseOpenFoamThermo,
  parseOpenFoamTwoPhaseTransport,
  parseOpenFoamUniformVector,
} from './openfoam-dict'
import { solveSphDamBreak2d } from './sph-l3-algos'
import { parseLammpsInput, buildLammpsInputSystem, LAMMPS_LJ_DEFAULT_DT } from './lammps-input'
import { parseLammpsData } from './lammps-data'
import {
  calculixBeam2dParameters,
  calculixCstParameters,
  parseCalculixDatDisplacements,
  parseCalculixDatStresses,
  parseCalculixFrdDisplacements,
  parseCalculixInp,
} from './calculix-inp'
import { parseMooseDiffusionInput } from './moose-inp'
import { crankNicolsonStep1D } from './heat-l3-algos'
import { WasmMd } from './wasm-fields'
import {
  consToPrim,
  exactRiemannEuler1d,
  exactRiemannStar,
  hllcStep1d,
  primToCons,
  soundSpeed,
} from './fvm-l3-algos'
import {
  parseFrame3ddInput,
  parseFrame3ddOutput,
  frame3ddBeam2dParameters,
} from './frame3dd'
import { idfConstructions, idfConstructionResistance, parseIdf } from './energyplus-idf'
import manifest from '../../../scripts/research/software-cases/manifest.json'

/**
 * Executed software-case checks: the corpus inputs below are parsed from the
 * pinned upstream files and run through real W-Sim solver runners. Comparison
 * references are either the file's own analytic/declared values or upstream
 * published output — never values the solver produced itself.
 * Manifest `check: 'executed-solver'` cases must all appear here.
 *
 * Split per #117: default CI (test:smoke) runs the short functional checks —
 * parse → capability admission → small-grid execution → finite output →
 * terminal state. Multi-second convergence / external-benchmark comparisons
 * (poiseuille, couette, both cavities, dambreak) run only under
 * WAVEWORLD_SOFTWARE_CASES_FULL=1, which `test:software-cases` sets — the
 * explicit long command the issue asks for.
 */

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const corpus = resolve(root, 'scripts/research/software-cases')
const corpusFile = (path: string) => {
  const full = resolve(corpus, path)
  if (!full.startsWith(corpus + sep)) throw new Error('corpus path escapes corpus root')
  return readFileSync(full, 'utf8')
}

const executedIds = new Set(
  manifest.cases.filter((c) => c.check === 'executed-solver').map((c) => c.id),
)

// Full = the explicit long-case command; default CI keeps these skipped.
const FULL = process.env.WAVEWORLD_SOFTWARE_CASES_FULL === '1'
const itLong = it.runIf(FULL)

/** Piecewise-linear interpolation of (xs, ys) at x; clamps to endpoints. */
function interp(xs: number[], ys: number[], x: number): number {
  let i = 0
  while (i < xs.length - 2 && xs[i + 1]! < x) i++
  const t = (x - xs[i]!) / (xs[i + 1]! - xs[i]!)
  return ys[i]! + t * (ys[i + 1]! - ys[i]!)
}

describe('executed software-case checks (real solver runs)', () => {
  it('covers every manifest executed-solver case exactly once', () => {
    expect([...executedIds].sort()).toEqual([
      'calculix-b31',
      'calculix-planestrain',
      'calculix-planestrain2',
      'calculix-planestress',
      'energyplus-1zone-envelope',
      'frame3dd-exA-truss',
      'lammps-melt',
      'moose-casl-i1-heat-source',
      'moose-casl-i4-heated-plate',
      'moose-convective-flux',
      'moose-nafems-t3',
      'moose-simple-diffusion',
      'moose-simple-transient-diffusion',
      'openfoam12-cavity',
      'openfoam12-planarcouette',
      'openfoam12-planarpoiseuille',
      'openfoam12-shocktube',
      'openfoam8-cavity-laminar',
      'openfoam8-dambreak',
    ])
  })

  itLong('openfoam12-planarpoiseuille: force-driven channel converges to the analytic profile', async () => {
    // Upstream case: nu=0.1 m^2/s, half-height h=1 m (wall y=0, symmetryPlane y=1),
    // explicit momentum source (5 0 0) m/s^2. Equivalent full channel H=2h:
    //   u_max = G·H²/(8ν) = 25 m/s,  Re_h = u_max·h/ν = 250.
    const nuPhys = parseOpenFoamNu(corpusFile('openfoam-12/tutorials/incompressibleFluid/planarPoiseuille/constant/physicalProperties'))
    expect(nuPhys).toBeCloseTo(0.1, 12)
    const source = parseOpenFoamMomentumSource(corpusFile('openfoam-12/tutorials/incompressibleFluid/planarPoiseuille/constant/fvModels'))
    expect(source).toEqual([5, 0, 0])
    const mesh = parseOpenFoamBlockMesh(corpusFile('openfoam-12/tutorials/incompressibleFluid/planarPoiseuille/system/blockMeshDict'))
    const wall = mesh.patches.find((p) => p.name === 'walls')
    const centreline = mesh.patches.find((p) => p.name === 'centreline')
    expect(wall).toMatchObject({ type: 'wall', planes: [{ axis: 'y', at: 0 }] })
    expect(centreline).toMatchObject({ type: 'symmetryPlane', planes: [{ axis: 'y', at: 1 }] })
    expect(mesh.patches.filter((p) => p.type === 'cyclic')).toHaveLength(2)

    const halfHeightM = centreline!.planes[0]!.at - wall!.planes[0]!.at
    const gPhys = source[0]
    const uMaxPhys = (gPhys * (2 * halfHeightM) ** 2) / (8 * nuPhys)
    const reHalf = (uMaxPhys * halfHeightM) / nuPhys
    expect(reHalf).toBeCloseTo(250, 6)

    // Lattice mapping at matched Re: pick u_lbm low-Mach and derive ν_lbm, G_lbm.
    const ny = 65
    const hLbm = (ny - 1) / 2
    const uLbm = 0.1
    const nuLbm = (uLbm * hLbm) / reHalf
    const tau = bgkTauFromViscosity(nuLbm)
    const gLbm = (8 * nuLbm * uLbm) / (2 * hLbm) ** 2
    expect(tau).toBeGreaterThan(0.505)
    expect(gLbm).toBeLessThan(1e-2)

    const runner = createLbmJobRunner()
    const spec = defaultJobSpec({
      kind: 'lbm-d3q19',
      name: 'openfoam12-planarpoiseuille-exec',
      model: { source: 'preset', presetId: 'openfoam12-planarpoiseuille' },
      parameters: {
        mode: 'd2q9-force-poiseuille',
        nx: 8, ny, tau, bodyForce: gLbm, steps: 120_000,
      },
      run: { maxSteps: 120_000 },
      outputs: { forces: false, history: false, fields: [], kpis: [] },
      requirements: { backends: ['cpu'], precision: 'float64', requiredOutputs: [] },
    })
    const result = await runner.run(spec)
    const s = result.summary as Record<string, number>
    expect(s.method).toBe('d2q9-bgk-force-poiseuille')
    expect(s.stepsCompleted).toBe(120_000)
    expect(s.massRelativeResidual).toBeLessThanOrEqual(1e-8)
    expect(s.uMaxAnalytic).toBeCloseTo(uLbm, 8)
    // Converged D2Q9 channel reproduces the analytic u_max to ~0.2% at H=64.
    expect(s.uMaxRelativeError).toBeLessThanOrEqual(0.01)
    expect(s.meanAbsV).toBeLessThan(s.uMid! * 0.05)
    expect(s.maxSpeed).toBeLessThan(0.2)
  }, 120_000)

  itLong('openfoam12-planarcouette: moving-wall channel reproduces the linear Couette profile', async () => {
    // Upstream case: movingWall fixedValue (1 0 0) m/s over a no-slip bottom
    // wall, cyclic streamwise patches, 20×20×1 blockMesh on a 0.1×0.1 m section
    // (convertToMeters 0.1), nu=1.5e-5 m^2/s, Maxwell viscoelastic laminar model.
    // The Maxwell constitutive entry is not simulated; the steady Couette
    // *velocity* profile u(y) = U·y/H is identical for Newtonian and Maxwell
    // steady shear, so checking the linear profile remains a valid comparison
    // of the parsed geometry/BCs (normal-stress differences are not modeled).
    const nuPhys = parseOpenFoamNu(corpusFile('openfoam-12/tutorials/incompressibleFluid/planarCouette/constant/physicalProperties'))
    expect(nuPhys).toBeCloseTo(1.5e-5, 12)
    const transport = parseOpenFoamSimulationType(corpusFile('openfoam-12/tutorials/incompressibleFluid/planarCouette/constant/momentumTransport'))
    expect(transport).toEqual({ type: 'laminar', model: 'Maxwell' })
    const patches = parseOpenFoamBoundaryField(corpusFile('openfoam-12/tutorials/incompressibleFluid/planarCouette/0/U'))
    expect(patches.find((p) => p.name === 'movingWall')).toMatchObject({ type: 'fixedValue', value: [1, 0, 0] })
    expect(patches.find((p) => p.name === 'bottomWall')).toMatchObject({ type: 'noSlip' })
    const mesh = parseOpenFoamBlockMesh(corpusFile('openfoam-12/tutorials/incompressibleFluid/planarCouette/system/blockMeshDict'))
    expect(mesh.cells).toEqual([20, 20, 1])
    expect(mesh.patches.find((p) => p.name === 'movingWall')).toMatchObject({ type: 'wall', planes: [{ axis: 'y', at: 0.1 }] })
    expect(mesh.patches.find((p) => p.name === 'bottomWall')).toMatchObject({ type: 'wall', planes: [{ axis: 'y', at: 0 }] })
    expect(mesh.patches.filter((p) => p.type === 'cyclic')).toHaveLength(2)

    // Lattice run at the file's wall-node count (20 cells → 21 rows); the
    // steady linear profile is Re-independent, so a comfortable lattice
    // viscosity is used (documented in the manifest limitation).
    const uWall = 0.05
    const runner = createLbmJobRunner()
    const result = await runner.run(defaultJobSpec({
      kind: 'lbm-d3q19',
      name: 'openfoam12-planarcouette-exec',
      model: { source: 'preset', presetId: 'openfoam12-planarcouette' },
      parameters: { mode: 'd2q9-couette', nx: 8, ny: 21, tau: 0.8, uWall, steps: 40_000 },
      run: { maxSteps: 40_000 },
      outputs: { forces: false, history: false, fields: [], kpis: [] },
      requirements: { backends: ['cpu'], precision: 'float64', requiredOutputs: [] },
    }))
    const s = result.summary as Record<string, number>
    expect(s.method).toBe('d2q9-bgk-couette-channel')
    expect(s.stepsCompleted).toBe(40_000)
    expect(s.channelHeight).toBe(20)
    expect(s.massRelativeResidual).toBeLessThanOrEqual(1e-8)
    // Interior rows are essentially exact; wall rows carry the ~2% half-way
    // bounce-back offset (first-order, verified to halve under refinement).
    expect(s.profileL2RelativeError).toBeLessThanOrEqual(0.02)
    expect(s.profileMaxRelativeError).toBeLessThanOrEqual(0.03)
    expect(s.meanAbsV).toBeLessThan(uWall * 1e-3)
    expect(s.maxSpeed).toBeLessThan(0.15)
  }, 120_000)

  itLong('openfoam8-cavity-laminar: Re=10 lid cavity converges under grid refinement', async () => {
    // Upstream case: transportProperties nu=0.01 m^2/s, lid U=(1 0 0) m/s on a
    // 0.1 m square — Re = U·L/ν = 10. Ghia tables start at Re=100, so the check
    // is grid convergence of the centerline profile plus steady-state residual.
    const nuPhys = parseOpenFoamNu(corpusFile('openfoam-8/tutorials/incompressible/icoFoam/cavity/cavity/constant/transportProperties'))
    expect(nuPhys).toBeCloseTo(0.01, 12)
    const patches = parseOpenFoamBoundaryField(corpusFile('openfoam-8/tutorials/incompressible/icoFoam/cavity/cavity/0/U'))
    const lid = patches.find((p) => p.name === 'movingWall')
    expect(lid).toMatchObject({ type: 'fixedValue', value: [1, 0, 0] })
    expect(patches.find((p) => p.name === 'fixedWalls')).toMatchObject({ type: 'noSlip' })
    const mesh = parseOpenFoamBlockMesh(corpusFile('openfoam-8/tutorials/incompressible/icoFoam/cavity/cavity/system/blockMeshDict'))
    expect(mesh.patches.find((p) => p.name === 'movingWall')).toMatchObject({ type: 'wall', planes: [{ axis: 'y', at: 0.1 }] })

    const L = 0.1
    const uLid = 1
    const re = (uLid * L) / nuPhys
    expect(re).toBeCloseTo(10, 6)

    const runner = createLbmJobRunner()
    const run = async (n: number, uLbm: number, steps: number) => {
      const tau = bgkTauFromViscosity((uLbm * n) / re)
      expect(tau).toBeGreaterThan(0.505)
      const result = await runner.run(defaultJobSpec({
        kind: 'lbm-d3q19',
        name: `openfoam8-cavity-n${n}`,
        model: { source: 'preset', presetId: 'openfoam8-cavity-laminar' },
        parameters: { mode: 'd2q9-lid-cavity', n, tau, uLid: uLbm, steps, sampleEvery: Math.floor(steps / 4) },
        run: { maxSteps: steps },
        outputs: { forces: false, history: false, fields: [], kpis: [] },
        requirements: { backends: ['cpu'], precision: 'float64', requiredOutputs: [] },
      }))
      return result.summary as unknown as Record<string, number> & { uCenterline: number[]; uCenterlineY: number[] }
    }

    const coarse = await run(32, 0.1, 8_000)
    const fine = await run(64, 0.08, 20_000)
    for (const r of [coarse, fine]) {
      expect(r.method).toBe('d2q9-bgk-lid-cavity')
      expect(r.reynolds).toBeCloseTo(re, 6)
      expect(r.velocityL2Residual).toBeLessThanOrEqual(1e-3)
      expect(r.massRelativeResidual).toBeLessThanOrEqual(1e-8)
      expect(r.maxSpeed).toBeLessThan(0.2)
      // Primary vortex: u<0 along most of the centerline, ~+uLid at the lid.
      expect(Math.min(...r.uCenterline)).toBeLessThan(-0.1)
      expect(r.uCenterline[r.uCenterline.length - 1]!).toBeGreaterThan(0.85)
    }
    // Grid convergence: fine-grid profile interpolated to coarse samples.
    let maxDiff = 0
    let l2 = 0
    let norm = 0
    for (const j in fine.uCenterlineY) {
      const d = Math.abs(interp(coarse.uCenterlineY, coarse.uCenterline, fine.uCenterlineY[j]!) - fine.uCenterline[j]!)
      maxDiff = Math.max(maxDiff, d)
      l2 += d * d
      norm += fine.uCenterline[j]! ** 2
    }
    expect(maxDiff).toBeLessThanOrEqual(0.03)
    expect(Math.sqrt(l2 / norm)).toBeLessThanOrEqual(0.05)
  }, 120_000)

  itLong('openfoam12-cavity: Re=10000 RAS case runs bounded on the laminar MRT path', async () => {
    // Upstream case is Re=10000 modeled with k-epsilon RAS — beyond the laminar
    // LBM engineering envelope (validated to Re≤1000; ≥3200 is stub-band). The
    // executed check proves the real file's regime parameters dispatch and run
    // bounded; no Ghia gate is asserted because the upstream model is turbulent.
    const nuPhys = parseOpenFoamNu(corpusFile('openfoam-12/tutorials/incompressibleFluid/cavity/constant/physicalProperties'))
    expect(nuPhys).toBeCloseTo(1e-5, 12)
    const transport = parseOpenFoamSimulationType(corpusFile('openfoam-12/tutorials/incompressibleFluid/cavity/constant/momentumTransport'))
    expect(transport).toEqual({ type: 'RAS', model: 'kEpsilon' })
    const mesh = parseOpenFoamBlockMesh(corpusFile('openfoam-12/tutorials/incompressibleFluid/cavity/system/blockMeshDict'))
    expect(mesh.patches.find((p) => p.name === 'movingWall')).toMatchObject({ type: 'wall', planes: [{ axis: 'y', at: 0.1 }] })
    const re = (1 * 0.1) / nuPhys
    expect(re).toBeCloseTo(10_000, 6)

    const runner = createLbmJobRunner()
    const n = 48
    const uLid = 0.06
    const tau = bgkTauFromViscosity((uLid * n) / re)
    const result = await runner.run(defaultJobSpec({
      kind: 'lbm-d3q19',
      name: 'openfoam12-cavity-re10000-bounded',
      model: { source: 'preset', presetId: 'openfoam12-cavity' },
      parameters: {
        mode: 'd2q9-mrt-lid-cavity',
        n, tau, uLid, steps: 3_000, sampleEvery: 1_500, ghiaReferenceRe: 10_000,
      },
      run: { maxSteps: 3_000 },
      outputs: { forces: false, history: false, fields: [], kpis: [] },
      requirements: { backends: ['cpu'], precision: 'float64', requiredOutputs: [] },
    }))
    const s = result.summary as Record<string, number>
    expect(s.method).toBe('d2q9-mrt-lid-cavity-v1')
    expect(s.reynolds).toBeCloseTo(re, 6)
    expect(s.massRelativeResidual).toBeLessThanOrEqual(1e-8)
    expect(s.maxSpeed).toBeLessThan(0.35)
    expect(Number.isFinite(s.ghiaUCenterlineL2)).toBe(true)
    expect(s.uMinCenterline).toBeLessThan(0)
  }, 120_000)

  it('frame3dd-exA-truss: displacements and reactions match the upstream .out (load case 1)', async () => {
    const input = parseFrame3ddInput(corpusFile('frame3dd/examples/exA.3dd'))
    expect(input.title).toMatch(/2D truss/i)
    expect(input.title).toMatch(/kips.*in/i)
    expect(input.nodes).toHaveLength(12)
    expect(input.elements).toHaveLength(21)
    expect(input.loadCases).toHaveLength(2)

    const params = frame3ddBeam2dParameters(input, { loadCase: 1, units: 'kip-in' })
    const spec = defaultJobSpec({
      kind: 'structural-static',
      name: 'frame3dd-exA-truss-lc1',
      model: { source: 'preset', presetId: 'frame3dd-exA' },
      parameters: params,
      run: { maxSteps: 1 },
      outputs: { forces: true, history: false, fields: ['displacement'], kpis: [] },
      requirements: { backends: ['cpu'], precision: 'float64', requiredOutputs: ['fields'] },
    })
    const result = await createStructuralRunner().run(spec)
    const displacement = String(result.derived!.displacementCsv).split(',').map(Number)
    const reaction = String(result.derived!.reactionCsv).split(',').map(Number)

    const ref = parseFrame3ddOutput(corpusFile('frame3dd/examples/exA.out'), 1)
    const IN = 0.0254
    const KIP = 4448.2216152605
    const tolM = 1e-5 * IN // .out prints 6 decimals; solver agrees to ~5e-7 in
    const tolRad = 1e-6
    const tolN = 5 // kip printed to 3 decimals → ±0.0005 kip ≈ 2.2 N
    expect(ref.displacements.size).toBe(12)
    expect(ref.reactions.size).toBe(12)
    for (const [node, d] of ref.displacements) {
      const base = (node - 1) * 3
      expect(Math.abs(displacement[base]! - d[0] * IN)).toBeLessThanOrEqual(tolM)
      expect(Math.abs(displacement[base + 1]! - d[1] * IN)).toBeLessThanOrEqual(tolM)
      expect(Math.abs(displacement[base + 2]! - d[5])).toBeLessThanOrEqual(tolRad)
    }
    for (const [node, f] of ref.reactions) {
      const base = (node - 1) * 3
      expect(Math.abs(reaction[base]! - f[0] * KIP)).toBeLessThanOrEqual(tolN)
      expect(Math.abs(reaction[base + 1]! - f[1] * KIP)).toBeLessThanOrEqual(tolN)
    }
  })

  it('energyplus-1zone-envelope: constructions reproduce their declared resistance', async () => {
    const objects = parseIdf(corpusFile('energyplus/testfiles/1ZoneUncontrolled.idf'))
    const constructions = idfConstructions(objects)
    expect(constructions.map((c) => c.name).sort()).toEqual(['FLOOR', 'R13WALL', 'ROOF31'])

    // Winter design day from the file (−15.5 °C Denver 99% heating) vs a
    // conventional 20 °C interior setpoint.
    const winter = objects.find(
      (o) => o.type === 'SizingPeriod:DesignDay' && o.fields[3] === 'WinterDesignDay',
    )
    const tOutside = Number(winter!.fields[4])
    expect(tOutside).toBeCloseTo(-15.5, 6)
    const tInside = 20

    const runner = createThermalRunner()
    // Standard ASHRAE still-air / 24 km/h-wind surface films (the same pair the
    // solvers-thermal building-envelope fixture uses); the layer resistance comes
    // from the IDF, so the solver must recover each declared R from the coupled
    // film+conduction problem — not just a linear profile between fixed nodes.
    const hInterior = 7.7
    const hExterior = 23
    for (const c of constructions) {
      const layer = c.layers[0]!
      const declaredR = idfConstructionResistance(c)
      expect(declaredR).toBeGreaterThan(0)
      // Material layers carry real (L, k); NoMass layers are a declared R —
      // represented here by the equivalent conductivity k = L/R.
      const lengthM = layer.kind === 'material' ? layer.thicknessM : 0.1
      const k = layer.kind === 'material' ? layer.conductivity : lengthM / layer.resistanceR
      const spec = defaultJobSpec({
        kind: 'thermal-3d-steady',
        name: `energyplus-1zone-${c.name.toLowerCase()}`,
        model: { source: 'preset', presetId: 'energyplus-1zone-uncontrolled' },
        parameters: {
          dimension: 1,
          lengthX: lengthM,
          nx: 33,
          conductivity: k,
          volumetricHeatWPerM3: 0,
          units: {
            length: 'm', temperature: 'C', conductivity: 'W/(m·K)',
            heatFlux: 'W/m^2', power: 'W',
          },
          boundaries: {
            left: { type: 'robin', h: hInterior, ambientTemp: tInside },
            right: { type: 'robin', h: hExterior, ambientTemp: tOutside },
          },
          residualTol: 1e-9,
          maxIterations: 50_000,
        },
        run: { maxSteps: 50_000 },
        outputs: { forces: false, history: true, fields: ['temperature'], kpis: ['heatFlowInW', 'residual'] },
        requirements: { backends: ['cpu'], thermal: true, precision: 'float64', requiredOutputs: ['kpis', 'fields'] },
      })
      const result = await runner.run(spec)
      const s = result.summary as Record<string, number>
      const rTotal = 1 / hInterior + declaredR + 1 / hExterior
      const qExpected = (tInside - tOutside) / rTotal
      const tSi = tInside - qExpected / hInterior
      const tSe = tOutside + qExpected / hExterior
      expect(s.converged).toBe(1)
      expect(Math.abs(s.tMax! - tSi)).toBeLessThan(0.01)
      expect(Math.abs(s.tMin! - tSe)).toBeLessThan(0.01)
      expect(Math.abs(hInterior * (tInside - s.tMax!) - qExpected)).toBeLessThan(0.1)
      // Net boundary inflow is a residual-scale quantity at steady state;
      // bound it relative to the layer heat flux, not absolutely.
      const qTol = Math.max(1e-6, qExpected * 1e-6)
      expect(Math.abs(s.heatFlowInW!)).toBeLessThan(qTol)
      expect(Math.abs(s.energyImbalance!)).toBeLessThan(qTol)
      // Recovered layer resistance (between the two solved surface temperatures).
      expect(Math.abs((s.tMax! - s.tMin!) / qExpected - declaredR)).toBeLessThanOrEqual(declaredR * 1e-3)
    }
  })

  it('openfoam12-shocktube: inviscid perfect-gas Riemann problem matches the exact solution', async () => {
    // Upstream case: shockFluid/shockTube — 1D tube x∈[−5,5] m, 1000 cells,
    // diaphragm at x=0: left (default) p=100000 Pa, T=348.432 K; boxToCell
    // x∈[0,5] p=10000 Pa, T=278.746 K; U=0. perfectGas air (molWeight 28.96,
    // Cp 1004.5, mu=0) → inviscid Euler. The bundled setFieldsDict supplies the
    // initial states the .orig field templates need.
    const thermo = parseOpenFoamThermo(corpusFile('openfoam-12/tutorials/shockFluid/shockTube/constant/physicalProperties'))
    expect(thermo.equationOfState).toBe('perfectGas')
    expect(thermo.mu).toBe(0)
    expect(thermo.molWeightKgPerMol).toBeCloseTo(0.02896, 8)
    expect(thermo.cp).toBeCloseTo(1004.5, 6)
    const R = 8.31446261815324 / thermo.molWeightKgPerMol
    const gamma = thermo.cp / (thermo.cp - R)
    expect(gamma).toBeCloseTo(1.4, 2)

    const setFields = parseOpenFoamSetFields(corpusFile('openfoam-12/tutorials/shockFluid/shockTube/system/setFieldsDict'))
    expect(setFields.defaults).toMatchObject({ U: [0, 0, 0], T: 348.432, p: 100000 })
    expect(setFields.regions).toHaveLength(1)
    const region = setFields.regions[0]!
    expect(region.values).toMatchObject({ T: 278.746, p: 10000 })
    // The seeded box spans x∈[0,5]: the low state is right of the diaphragm.
    expect(region.box[0][0]).toBe(0)
    expect(region.box[1][0]).toBe(5)

    const mesh = parseOpenFoamBlockMesh(corpusFile('openfoam-12/tutorials/shockFluid/shockTube/system/blockMeshDict'))
    expect(mesh.cells).toEqual([1000, 1, 1])
    const sides = mesh.patches.find((p) => p.name === 'sides')!
    expect(sides.planes).toEqual([{ axis: 'x', at: 5 }, { axis: 'x', at: -5 }])
    const control = corpusFile('openfoam-12/tutorials/shockFluid/shockTube/system/controlDict')
    const endTime = Number(control.match(/endTime\s+([\d.eE+-]+)/)![1])
    expect(endTime).toBeCloseTo(0.007, 9)

    // Physical left/right states (diaphragm at x=0).
    const xLo = -5
    const xHi = 5
    const wL = { rho: setFields.defaults.p! / (R * setFields.defaults.T!), u: 0, p: setFields.defaults.p! }
    const wR = { rho: region.values.p! / (R * region.values.T!), u: 0, p: region.values.p! }
    expect(wL.rho).toBeCloseTo(0.9997, 3)
    expect(wR.rho).toBeCloseTo(0.125, 3)

    // The file's `sides` patches carry zeroGradient fields → transmissive
    // boundaries; the HLLC step is run with the matching boundary mode.
    const n = mesh.cells[0]
    const dx = (xHi - xLo) / n
    const rho = new Float64Array(n)
    const mom = new Float64Array(n)
    const en = new Float64Array(n)
    const xC = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const x = xLo + (i + 0.5) * dx
      xC[i] = x
      const w = x < 0 ? wL : wR
      const U = primToCons(w, gamma)
      rho[i] = U.rho; mom[i] = U.mom; en[i] = U.E
    }
    const mass0 = rho.reduce((a, b) => a + b) * dx
    const cfl = 0.4
    let t = 0
    let cur: { rho: Float64Array; mom: Float64Array; E: Float64Array } = { rho, mom, E: en }
    while (t < endTime) {
      let smax = 0
      for (let i = 0; i < n; i++) {
        const w = consToPrim({ rho: cur.rho[i]!, mom: cur.mom[i]!, E: cur.E[i]! }, gamma)
        smax = Math.max(smax, Math.abs(w.u) + soundSpeed(w, gamma))
      }
      const dt = Math.min((cfl * dx) / smax, endTime - t)
      cur = hllcStep1d(cur.rho, cur.mom, cur.E, dx, dt, gamma, 'transmissive')
      t += dt
    }

    // Exact Riemann reference at endTime, diaphragm at x=0.
    const exact = exactRiemannEuler1d({ wL, wR, gamma, x0: 0, t: endTime, x: xC })
    let l1Rho = 0; let l1U = 0; let l1P = 0
    for (let i = 0; i < n; i++) {
      const w = consToPrim({ rho: cur.rho[i]!, mom: cur.mom[i]!, E: cur.E[i]! }, gamma)
      l1Rho += Math.abs(w.rho - exact.rho[i]!)
      l1U += Math.abs(w.u - exact.u[i]!)
      l1P += Math.abs(w.p - exact.p[i]!)
    }
    l1Rho /= n; l1U /= n; l1P /= n
    // First-order HLLC on the file's 1000-cell mesh: L1 errors of a few % of
    // the jump magnitudes (contact smearing dominates).
    expect(l1Rho / (wL.rho - wR.rho)).toBeLessThanOrEqual(0.05)
    expect(l1P / (wL.p - wR.p)).toBeLessThanOrEqual(0.05)
    expect(l1U).toBeLessThanOrEqual(20)
    // Mass is conserved: edge states stay quiescent (waves reach ≈±4 m at
    // endTime, inside the ±5 m ends), so no mass crosses the transmissive ends.
    expect(Math.abs(cur.rho.reduce((a, b) => a + b) * dx - mass0)).toBeLessThan(1e-6)
    // Star-state sanity: a compressive right shock (pR < p* < pL).
    const { pStar } = exactRiemannStar(wL, wR, gamma)
    expect(pStar).toBeGreaterThan(wR.p)
    expect(pStar).toBeLessThan(wL.p)
  }, 60_000)

  itLong('openfoam8-dambreak: WCSPH water column collapses within physical bounds', async () => {
    // Upstream case: interFoam damBreak — 0.1461 m × 0.292 m water column in a
    // 0.584 m square tank (convertToMeters 0.146 over a 4×4 block mesh), water
    // rho=1000 nu=1e-6, air rho=1 nu=1.48e-5, sigma=0.07, g=(0,-9.81,0),
    // laminar, dry bed, endTime=1 s.
    //
    // Executed check: the parsed geometry/physics drive our 2D WCSPH solver
    // (single-phase water; air phase and surface tension are not modeled —
    // air/water density ratio 1:1000 and sigma make their early-collapse effect
    // negligible, but this is a bounded-physics check, not a VOF equivalence
    // claim). Asserted invariants: total mechanical energy (PE+KE+Tait EOS
    // internal) is non-increasing, the surge front advances monotonically below
    // the Ritter dry-bed bound 2·sqrt(g·h0), the column top falls, and every
    // particle stays inside the boundary-particle barrier.
    const base = 'openfoam-8/tutorials/multiphase/interFoam/laminar/damBreak/damBreak'
    const transport = parseOpenFoamTwoPhaseTransport(corpusFile(`${base}/constant/transportProperties`))
    const water = transport.phases.find((p) => p.name === 'water')!
    const air = transport.phases.find((p) => p.name === 'air')!
    expect(water).toMatchObject({ transportModel: 'Newtonian', nu: 1e-6, rho: 1000 })
    expect(air).toMatchObject({ transportModel: 'Newtonian', nu: 1.48e-5, rho: 1 })
    expect(transport.sigma).toBeCloseTo(0.07, 8)

    const g = parseOpenFoamUniformVector(corpusFile(`${base}/constant/g`))
    expect(g).toEqual([0, -9.81, 0])
    expect(parseOpenFoamSimulationType(corpusFile(`${base}/constant/momentumTransport`))).toEqual({ type: 'laminar' })

    const setFields = parseOpenFoamSetFields(corpusFile(`${base}/system/setFieldsDict`))
    expect(setFields.defaults.scalars['alpha.water']).toBe(0)
    expect(setFields.regions).toHaveLength(1)
    const region = setFields.regions[0]!
    expect(region.values.scalars['alpha.water']).toBe(1)
    const columnWidth = region.box[1][0] - region.box[0][0]
    const columnHeight = region.box[1][1] - region.box[0][1]
    expect(columnWidth).toBeCloseTo(0.1461, 6)
    expect(columnHeight).toBeCloseTo(0.292, 6)
    expect(region.box[0][0]).toBe(0)
    expect(region.box[0][1]).toBe(0)

    const mesh = parseOpenFoamBlockMesh(corpusFile(`${base}/system/blockMeshDict`))
    expect(mesh.convertToMeters).toBeCloseTo(0.146, 9)
    expect(mesh.bounds.min).toEqual([0, 0, 0])
    expect(mesh.bounds.max[0]).toBeCloseTo(0.584, 6)
    expect(mesh.bounds.max[1]).toBeCloseTo(0.584, 6)
    expect(mesh.blocks).toHaveLength(5)
    for (const name of ['leftWall', 'rightWall', 'lowerWall']) {
      expect(mesh.patches.find((p) => p.name === name)?.type).toBe('wall')
    }
    expect(mesh.patches.find((p) => p.name === 'atmosphere')?.type).toBe('patch')

    const control = corpusFile(`${base}/system/controlDict`)
    expect(control.match(/application\s+(\w+)/)![1]).toBe('interFoam')
    const endTime = Number(control.match(/endTime\s+([\d.eE+-]+)/)![1])
    expect(endTime).toBeCloseTo(1, 9)

    const tEnd = 0.25 // bounded early-collapse window (upstream runs to 1 s)
    const r = solveSphDamBreak2d({
      tankWidth: mesh.bounds.max[0]!,
      tankHeight: mesh.bounds.max[1]!,
      columnWidth,
      columnHeight,
      rho0: water.rho,
      gravity: -g[1]!,
      kinematicViscosity: water.nu,
      dx: columnWidth / 16,
      tEnd,
    })
    expect(r.finite).toBe(true)
    expect(r.escaped).toBe(0)
    // Energy (PE+KE+EOS internal) never grows: artificial viscosity and wall
    // friction only dissipate.
    expect(r.energyMaxRatio).toBeLessThanOrEqual(1.001)
    expect(r.energyF).toBeLessThan(r.energy0)
    // Surge front: advances monotonically, outruns still water, stays below the
    // Ritter dry-bed shallow-water bound x ≤ a + 2√(g·h0)·t (+5%).
    expect(r.frontMonotone).toBe(true)
    expect(r.frontNondimX).toBeGreaterThan(1 + 0.4 * r.nondimT)
    const ritterBoundX = columnWidth + 2 * Math.sqrt(-g[1]! * columnHeight) * tEnd * 1.05
    expect(r.frontX).toBeLessThan(ritterBoundX)
    // Column top falls materially; density stays in the WCSPH band.
    expect(r.yTopF).toBeLessThan(0.7 * r.yTop0)
    expect(r.rhoMax).toBeLessThan(1.15 * water.rho)
    expect(r.rhoMin).toBeGreaterThan(0)
    // Mass is carried by fixed-count particles; check the implied water volume.
    const volume = r.nFluid * water.rho * r.dx * r.dx
    expect(Math.abs(volume / water.rho - columnWidth * columnHeight)).toBeLessThanOrEqual(
      2 * r.dx * (columnWidth + columnHeight),
    )
  }, 120_000)

  it('lammps-melt: the canonical 3D FCC LJ input script executes on the shared MD kernel', async () => {
    // Upstream case: examples/melt/in.melt — `units lj`, `lattice fcc 0.8442`,
    // cubic region 10 cells/edge (4000 atoms, L = 10·(4/ρ)^(1/3) ≈ 16.796),
    // `velocity all create 3.0 87287`, `pair_style lj/cut 2.5`, `fix … nve`,
    // `run 250` at the LJ default timestep 0.005.
    //
    // Executed check: a fail-closed input-script subset interpreter
    // (lammps-input.ts) turns the script into an atom system which runs on the
    // shared Rust/WASM MD kernel (3D velocity-Verlet, min-image PBC, shifted
    // LJ). The velocity draw honors the `velocity create` contract (MB at the
    // declared T, zero COM, exact rescale) but the RNG stream is ours, not
    // LAMMPS's Park–Miller sequence — so the checks are energy conservation
    // and physical melting bands, not trajectory agreement. Neighbor/thermo
    // cadences are engine-internal settings carried verbatim.
    const text = corpusFile('lammps/examples/melt/in.melt')
    const spec = parseLammpsInput(text)
    expect(spec).toMatchObject({
      atomStyle: 'atomic',
      lattice: { style: 'fcc', density: 0.8442 },
      atomTypes: 1,
      mass: 1,
      rCut: 2.5,
      epsilon: 1,
      sigma: 1,
      temperature: 3,
      seed: 87287,
      fix: 'nve',
      dt: LAMMPS_LJ_DEFAULT_DT,
      steps: 250,
    })
    expect(spec.atomCount).toBe(4000)
    expect(spec.boxL).toBeCloseTo(10 * Math.cbrt(4 / 0.8442), 9)
    // The data-file importer still (correctly) refuses input scripts.
    expect(() => parseLammpsData(text)).toThrow()

    const sys = buildLammpsInputSystem(spec)
    expect(sys.n).toBe(4000)
    const state = new WasmMd(sys.n, sys.L, 3, spec.rCut, sys.pos, sys.vel)
    const f0 = state.read()
    expect(f0.observables.temperature).toBeCloseTo(3, 6)
    expect(f0.observables.density).toBeCloseTo(0.8442, 9)
    // Perfect fcc lattice cohesive energy at this density: U/N ≈ −6.33.
    expect(f0.observables.potential / sys.n).toBeLessThan(-5)
    expect(f0.observables.potential / sys.n).toBeGreaterThan(-8)

    for (let s = 0; s < spec.steps; s++) state.step(spec.dt)
    const f = state.read()

    // NVE: total energy is conserved to Verlet accuracy over 250 steps.
    const eDrift = Math.abs(f.observables.total - f0.observables.total) / Math.abs(f0.observables.total)
    expect(eDrift).toBeLessThan(2e-3)
    // The lattice melts (T*=3 ≫ T_melt ≈ 0.7): PE rises toward the liquid
    // range and T falls below the initialization temperature.
    expect(f.observables.potential).toBeGreaterThan(f0.observables.potential)
    expect(f.observables.potential / sys.n).toBeGreaterThan(-5.5)
    expect(f.observables.potential / sys.n).toBeLessThan(-3)
    expect(f.observables.temperature).toBeGreaterThan(1)
    expect(f.observables.temperature).toBeLessThan(2.9)
    expect(f.observables.pressure).toBeGreaterThan(0)
    expect(f.observables.msd).toBeGreaterThan(0.05)
    // Every atom stays wrapped inside the periodic box.
    for (const p of f.pos) {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(sys.L)
    }
  }, 120_000)

  it('calculix-planestress: CPS8R tension patch runs as CST and matches planestress.dat.ref', async () => {
    // Upstream case: test/planestress.inp — 1 mm × 1 mm plate, t = 0.01 mm,
    // four CPS8R quads, left edge ux = 0 plus uy pinned at (0,0.5), DLOAD
    // P2 = −100 MPa traction on the right edge (uniaxial tension).
    //
    // Executed check: the fail-closed .inp subset interpreter keeps every
    // node and fan-triangulates each 8-node quad into six CST triangles; the
    // real displacement field is linear (constant-strain patch), so the
    // linear elements reproduce the CCX reference exactly. The unit-free
    // input is adopted as consistent N-mm-MPa and converted to SI.
    const inp = parseCalculixInp(corpusFile('calculix/test/planestress.inp'))
    expect(inp.nodes).toHaveLength(21)
    expect(inp.elements).toHaveLength(4)
    expect(inp.continuumKind).toBe('plane-stress')
    expect(inp.material.E).toBe(210000)
    expect(inp.thickness).toBe(0.01)
    expect(inp.dloads).toEqual([
      { elem: 3, face: 2, pressure: -100 },
      { elem: 4, face: 2, pressure: -100 },
    ])

    const params = calculixCstParameters(inp)
    const spec = defaultJobSpec({
      kind: 'structural-static',
      name: 'calculix-planestress',
      model: { source: 'preset', presetId: 'calculix-planestress' },
      parameters: params,
      run: { maxSteps: 1 },
      outputs: { forces: true, history: false, fields: ['displacement'], kpis: ['meanSxxPa', 'maxStressPa'] },
      requirements: { backends: ['cpu'], precision: 'float64', requiredOutputs: ['fields', 'kpis'] },
    })
    const result = await createStructuralRunner().run(spec)
    const nodeIds = String(result.derived!.nodeIdsCsv).split(',').map(Number)
    const u = String(result.derived!.displacementCsv).split(',').map(Number)

    const ref = parseCalculixDatDisplacements(corpusFile('calculix/test/planestress.dat.ref'))
    expect(ref.size).toBe(21)
    // Corner connectivity survives the CST reduction (9 nodes); mid-side
    // nodes interpolate the affine field identically and are not run.
    expect(nodeIds).toEqual([1, 2, 3, 4, 9, 10, 14, 15, 19])
    // .dat.ref prints 6 significant digits; CST is exact here.
    const tol = (v: number) => Math.max(1e-9, Math.abs(v) * 2e-5)
    for (const [node, r] of ref) {
      if (!nodeIds.includes(node)) continue // reduced-away mid-side node
      const i = nodeIds.indexOf(node)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(Math.abs(u[i * 2]! - r[0] * 1e-3)).toBeLessThanOrEqual(tol(r[0] * 1e-3))
      expect(Math.abs(u[i * 2 + 1]! - r[1] * 1e-3)).toBeLessThanOrEqual(tol(r[1] * 1e-3))
    }
    // Uniaxial patch: mean sxx = +100 MPa.
    expect(result.summary!.meanSxxPa).toBeCloseTo(100e6, 3)
    expect(result.summary!.maxStressPa).toBeCloseTo(100e6, 3)
    const refS = parseCalculixDatStresses(corpusFile('calculix/test/planestress.dat.ref'))
    for (const [, s] of refS) expect(s[0]).toBeCloseTo(100, 6)
  })

  it('calculix-planestrain: CPE4 tension quad runs as CST and matches planestrain.dat.ref', async () => {
    // Upstream case: test/planestrain.inp — one CPE4 quad, bottom edge
    // uy = 0 plus ux pinned at node 1, CLOAD +0.5 N at nodes 3,4 (tension
    // σyy = 100 MPa, plane-strain σzz = ν σyy = 30 MPa).
    const inp = parseCalculixInp(corpusFile('calculix/test/planestrain.inp'))
    expect(inp.elements).toHaveLength(1)
    expect(inp.continuumKind).toBe('plane-strain')
    expect(inp.cloads).toEqual([
      { node: 3, dof: 2, value: 0.5 },
      { node: 4, dof: 2, value: 0.5 },
    ])

    const spec = defaultJobSpec({
      kind: 'structural-static',
      name: 'calculix-planestrain',
      model: { source: 'preset', presetId: 'calculix-planestrain' },
      parameters: calculixCstParameters(inp),
      run: { maxSteps: 1 },
      outputs: { forces: true, history: false, fields: ['displacement'], kpis: ['meanSxxPa', 'maxStressPa'] },
      requirements: { backends: ['cpu'], precision: 'float64', requiredOutputs: ['fields', 'kpis'] },
    })
    const result = await createStructuralRunner().run(spec)
    const nodeIds = String(result.derived!.nodeIdsCsv).split(',').map(Number)
    const u = String(result.derived!.displacementCsv).split(',').map(Number)

    const ref = parseCalculixDatDisplacements(corpusFile('calculix/test/planestrain.dat.ref'))
    expect(ref.size).toBe(4)
    const tol = (v: number) => Math.max(1e-9, Math.abs(v) * 2e-5)
    for (const [node, r] of ref) {
      const i = nodeIds.indexOf(node)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(Math.abs(u[i * 2]! - r[0] * 1e-3)).toBeLessThanOrEqual(tol(r[0] * 1e-3))
      expect(Math.abs(u[i * 2 + 1]! - r[1] * 1e-3)).toBeLessThanOrEqual(tol(r[1] * 1e-3))
    }
    // Plane-strain tension: sxx ≈ 0 in-plane, |s|max = syy = 100 MPa.
    expect(Math.abs(Number(result.summary!.meanSxxPa))).toBeLessThan(1e-3)
    expect(result.summary!.maxStressPa).toBeCloseTo(100e6, 3)
  })

  it('calculix-planestrain2: CPE8 quadratic nodal loads fold onto the CST corners exactly', async () => {
    // Upstream case: test/planestrain2.inp — one CPE8 quad, node 1 ux+uy = 0,
    // nodes 2 and 8 uy = 0, CLOAD 0.1667/0.1667 on the top corners and 0.6667
    // on top mid-side node 6 (the quadratic consistent distribution for a
    // uniform σyy = 100 MPa traction; same affine field as planestrain).
    //
    // Executed check: the interpreter reduces the 8-node quad to two CST
    // corner triangles; the mid-side CLOAD folds 50/50 onto the edge ends,
    // reproducing the uniform-traction consistent load exactly.
    const inp = parseCalculixInp(corpusFile('calculix/test/planestrain2.inp'))
    expect(inp.elements[0]).toMatchObject({ type: 'CPE8', conn: [1, 4, 3, 2, 5, 6, 7, 8] })
    expect(inp.continuumKind).toBe('plane-strain')
    const params = calculixCstParameters(inp)
    // Mid-side node 6's 0.6667 folds half onto corners 3 and 4 → 0.5 each.
    const fy = new Map(
      (params.loads as { node: number; dof: string; value: number }[])
        .filter(l => l.dof === 'uy').map(l => [l.node, l.value]),
    )
    expect(fy.get(3)).toBeCloseTo(0.5, 6)
    expect(fy.get(4)).toBeCloseTo(0.5, 6)

    const spec = defaultJobSpec({
      kind: 'structural-static',
      name: 'calculix-planestrain2',
      model: { source: 'preset', presetId: 'calculix-planestrain2' },
      parameters: params,
      run: { maxSteps: 1 },
      outputs: { forces: true, history: false, fields: ['displacement'], kpis: ['meanSxxPa', 'maxStressPa'] },
      requirements: { backends: ['cpu'], precision: 'float64', requiredOutputs: ['fields', 'kpis'] },
    })
    const result = await createStructuralRunner().run(spec)
    const nodeIds = String(result.derived!.nodeIdsCsv).split(',').map(Number)
    const u = String(result.derived!.displacementCsv).split(',').map(Number)
    expect(nodeIds).toEqual([1, 2, 3, 4])

    const ref = parseCalculixDatDisplacements(corpusFile('calculix/test/planestrain2.dat.ref'))
    expect(ref.size).toBe(8)
    const tol = (v: number) => Math.max(1e-9, Math.abs(v) * 2e-5)
    for (const [node, r] of ref) {
      if (!nodeIds.includes(node)) continue // reduced-away mid-side node
      const i = nodeIds.indexOf(node)
      expect(Math.abs(u[i * 2]! - r[0] * 1e-3)).toBeLessThanOrEqual(tol(r[0] * 1e-3))
      expect(Math.abs(u[i * 2 + 1]! - r[1] * 1e-3)).toBeLessThanOrEqual(tol(r[1] * 1e-3))
    }
    expect(Math.abs(Number(result.summary!.meanSxxPa))).toBeLessThan(1e-3)
    // CLOADs are printed to 8 digits (0.16666666): traction is 99.999998 MPa.
    expect(Math.abs(Number(result.summary!.maxStressPa) - 100e6) / 100e6).toBeLessThan(1e-6)
  })

  it('calculix-b31: B31 cantilever beam runs as beam2d and matches Euler-Bernoulli / b31.frd.ref', async () => {
    // Upstream case: test/b31.inp — ten B31 (linear Timoshenko) beam elements
    // along +z, node 1 clamped (dofs 1-6), 1 N tip force in +x on node 11,
    // RECT 0.25×0.25 section (dir 1 = +x), E = 1e7, ν = 0.3 (consistent
    // N-mm units). Mapped onto the Euler-Bernoulli beam2d element; the B31
    // shear deformation is not modelled (~0.05% here, bounded below).
    const inp = parseCalculixInp(corpusFile('calculix/test/b31.inp'))
    expect(inp.family).toBe('beam')
    expect(inp.elements).toHaveLength(10)
    expect(inp.beamSection).toMatchObject({ a: 0.25, b: 0.25, dir: [1, 0, 0] })
    const params = calculixBeam2dParameters(inp)

    const spec = defaultJobSpec({
      kind: 'structural-static',
      name: 'calculix-b31',
      model: { source: 'preset', presetId: 'calculix-b31' },
      parameters: params,
      run: { maxSteps: 1 },
      outputs: { forces: true, history: false, fields: ['displacement'], kpis: [] },
      requirements: { backends: ['cpu'], precision: 'float64', requiredOutputs: ['fields'] },
    })
    const result = await createStructuralRunner().run(spec)
    const nodeIds = String(result.derived!.nodeIdsCsv).split(',').map(Number)
    const u = String(result.derived!.displacementCsv).split(',').map(Number)
    expect(nodeIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])

    // Euler-Bernoulli cantilever under a tip force: uy(s) = F s²(3L−s)/(6EI),
    // exact for 2-node EB elements with nodal loads. I = 0.25·0.25³/12 mm⁴,
    // converted to SI by the adapter (N-mm-MPa → m-Pa).
    const M = 1e-3, MPA = 1e6
    const L = 10 * M, F = 1, E = 1e7 * MPA, I = ((0.25 * 0.25 ** 3) / 12) * M ** 4
    const ebTip = (F * L ** 3) / (3 * E * I)
    for (const [k, node] of nodeIds.entries()) {
      const s = (node - 1) * 1 * M // node k+1 sits at z = k mm
      const uy = (F * s * s * (3 * L - s)) / (6 * E * I)
      expect(Math.abs(u[k * 3]!)).toBeLessThan(1e-12) // no axial deformation
      expect(Math.abs(u[k * 3 + 1]! - uy)).toBeLessThanOrEqual(Math.max(1e-12, uy * 1e-9))
      expect(Math.abs(u[k * 3 + 2]! - (F * s * (2 * L - s)) / (2 * E * I))).toBeLessThanOrEqual(1e-9)
    }

    // Upstream .frd.ref holds the section-expansion nodes only; the tip ring's
    // |vx| = 0.102148 mm is the B31 Timoshenko tip deflection. Euler-Bernoulli
    // gives FL³/(3EI) = 0.1024 mm — 0.25% stiffer, within the documented
    // shear-deformation gap.
    const frd = parseCalculixFrdDisplacements(corpusFile('calculix/test/b31.frd.ref'))
    let refTip = 0
    for (const v of frd.values()) if (Math.abs(v[0]) > Math.abs(refTip)) refTip = v[0]
    expect(refTip * M).toBeGreaterThan(0)
    expect(Math.abs(ebTip - refTip * M) / ebTip).toBeLessThan(0.01)
    expect(Math.abs(u[10 * 3 + 1]! - refTip * M) / ebTip).toBeLessThan(0.01)
  })

  it('moose-simple-diffusion: 2D Dirichlet diffusion reproduces the linear field', async () => {
    // Upstream case: MOOSE test/tests/kernels/simple_diffusion — GeneratedMesh
    // 10×10 elements on the unit square, single Diffusion kernel (coefficient
    // 1), DirichletBC u=0 on 'left' and u=1 on 'right'; 'top'/'bottom' have no
    // BC block so they carry MOOSE's natural zero-flux condition. Exact
    // solution: u = x.
    //
    // Executed check: the interpreter maps the case onto the 2-D steady
    // conduction solver (node-centred FD — same PDE, second order, and the
    // exact solution is linear so the method difference drops out).
    const mo = parseMooseDiffusionInput(corpusFile('moose/test/tests/kernels/simple_diffusion/simple_diffusion.i'))
    expect(mo.mesh).toMatchObject({ dim: 2, xmin: 0, xmax: 1, ymin: 0, ymax: 1, nx: 10, ny: 10 })
    expect(mo.bcs).toEqual([
      { boundary: 'left', type: 'dirichlet', value: 0 },
      { boundary: 'right', type: 'dirichlet', value: 1 },
    ])
    const bc = (side: 'left' | 'right' | 'top' | 'bottom') => {
      const b = mo.bcs.find(x => x.boundary === side)
      return b === undefined ? { type: 'insulated' as const }
        : b.type === 'dirichlet' ? { type: 'dirichlet' as const, temperature: b.value }
        : b.type === 'neumann' ? { type: 'neumann' as const, heatFlux: b.value }
        : { type: 'insulated' as const }
    }
    // MOOSE nx counts elements; the FD grid counts nodes.
    const nx = mo.mesh.nx + 1, ny = mo.mesh.ny + 1
    const spec = defaultJobSpec({
      kind: 'thermal-3d-steady',
      name: 'moose-simple-diffusion',
      model: { source: 'preset', presetId: 'moose-simple-diffusion' },
      parameters: {
        dimension: 2,
        lengthX: mo.mesh.xmax - mo.mesh.xmin,
        lengthY: mo.mesh.ymax - mo.mesh.ymin,
        nx, ny,
        conductivity: 1, // MOOSE Diffusion kernel has coefficient 1
        volumetricHeatWPerM3: 0,
        units: {
          length: 'm', temperature: 'C', conductivity: 'W/(m·K)',
          heatFlux: 'W/m^2', power: 'W',
        },
        boundaries: { left: bc('left'), right: bc('right'), bottom: bc('bottom'), top: bc('top') },
        residualTol: 1e-12,
        maxIterations: 50_000,
      },
      run: { maxSteps: 50_000 },
      outputs: { forces: false, history: false, fields: ['temperature'], kpis: ['residual'] },
      requirements: { backends: ['cpu'], thermal: true, precision: 'float64', requiredOutputs: ['fields'] },
    })
    const result = await createThermalRunner().run(spec)
    expect(result.summary!.converged).toBe(1)
    const T = String(result.derived!.temperatureCsv).split(',').map(Number)
    expect(T.length).toBe(nx * ny)
    let maxErr = 0
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = mo.mesh.xmin + (i / (nx - 1)) * (mo.mesh.xmax - mo.mesh.xmin)
        maxErr = Math.max(maxErr, Math.abs(T[j * nx + i]! - x))
      }
    }
    expect(maxErr).toBeLessThan(1e-8)
  })

  it('moose-simple-transient-diffusion: fixed-end slab transient matches the analytic series', async () => {
    // Upstream case: test/tests/kernels/simple_transient_diffusion — same
    // GeneratedMesh as simple_diffusion but CoefDiffusion coef=0.1 plus a
    // TimeDerivative kernel, Transient executioner dt=0.1 num_steps=20.
    // Top/bottom carry the natural zero-flux condition, so the exact solution
    // is y-invariant and the 2-D problem reduces to the 1-D slab
    //   u_t = 0.1 u_xx, u(0,t)=0, u(1,t)=1, u(x,0)=0
    // whose closed form is a Fourier sine series (integrated term-by-term).
    //
    // Executed check: the built-in Crank–Nicolson 1-D solver at MOOSE's
    // dt/grid; compared against the series — integrator-agnostic, so MOOSE's
    // backward-Euler time discretization difference drops out.
    const mo = parseMooseDiffusionInput(corpusFile('moose/test/tests/kernels/simple_transient_diffusion/simple_transient_diffusion.i'))
    expect(mo.diffusionCoef).toBeCloseTo(0.1, 12)
    expect(mo.transient).toBe(true)
    if (mo.executioner.type !== 'transient') throw new Error('expected transient executioner')
    const ex = mo.executioner
    expect(ex).toMatchObject({ dt: 0.1, numSteps: 20 })

    const nx = mo.mesh.nx + 1
    const L = mo.mesh.xmax - mo.mesh.xmin
    const dx = L / (nx - 1)
    const a = mo.diffusionCoef
    const exact = (x: number, t: number) => {
      let s = x / L
      for (let k = 1; k <= 2000; k++) {
        s += (2 * Math.pow(-1, k) / (k * Math.PI)) * Math.sin(k * Math.PI * x / L)
          * Math.exp(-a * k * k * Math.PI * Math.PI * t / (L * L))
      }
      return s
    }
    const r = a * ex.dt / (dx * dx)
    const rightBc = mo.bcs.find(b => b.boundary === 'right')
    if (rightBc?.type !== 'dirichlet') throw new Error('expected dirichlet right bc')
    let u: Float64Array = new Float64Array(nx)
    u[nx - 1] = rightBc.value // interior 0, Dirichlet ends
    for (let s = 0; s < ex.numSteps; s++) u = crankNicolsonStep1D(u, r)
    let maxErr = 0
    for (let i = 0; i < nx; i++) {
      maxErr = Math.max(maxErr, Math.abs(u[i]! - exact(mo.mesh.xmin + i * dx, ex.endTime)))
    }
    expect(maxErr).toBeLessThan(1e-3)
  })

  it('moose-nafems-t3: sinusoidal-boundary slab transient matches the analytic benchmark', async () => {
    // Upstream case: modules/heat_transfer NAFEMS/transient/T3 — the NAFEMS
    // T3 verification benchmark. Slab 0.1 × 0.01 m, QUAD4 GeneratedMesh 5×1,
    // T(left)=0, T(right)=100·sin(πt/40), k=35, ρ=7200, cp=440.5, dt=1 s,
    // end_time=32 s; probe = NodalVariableValue at nodeid 9.
    //
    // Top/bottom carry the natural zero-flux condition → the field is
    // y-invariant and the 2-D problem reduces to the 1-D slab
    //   ρcp·T_t = k·T_xx, T(0,t)=0, T(L,t)=100·sin(ωt), T(x,0)=0
    // which has a closed-form exact solution: a steady-oscillation part
    //   T_osc = A·Im{ e^{iωt}·sinh(λx)/sinh(λL) }, λ = √(iω/α)
    // plus a decaying sine series that enforces T(x,0)=0.
    //
    // Executed check: built-in 1-D Crank–Nicolson with the new time-varying
    // Dirichlet support, run at MOOSE's dt=1 s on a refined grid. Verified
    // against BOTH the exact series and the bundled MOOSE quad4 fine gold
    // CSV — the gold's early-time FE wiggles are quantified, not asserted away.
    const mo = parseMooseDiffusionInput(corpusFile('moose/modules/heat_transfer/test/tests/NAFEMS/transient/T3/nafems_t3_quad_template.i'))
    if (mo.executioner.type !== 'transient') throw new Error('expected transient executioner')
    const ex = mo.executioner
    expect(mo.materials).toMatchObject({ thermalConductivity: 35, specificHeat: 440.5, density: 7200 })
    expect(mo.probeNodes).toEqual([9])
    const alpha = mo.diffusionCoef / mo.timeCoef
    expect(alpha).toBeCloseTo(35 / (7200 * 440.5), 15)

    // Probe location: MOOSE GeneratedMesh numbers nodes id = i·(ny+1)+j
    // (y-fastest), so nodeid 9 on the 5×1 mesh is i=4 → x = 0.08 m — the
    // documented NAFEMS T3 probe point.
    const rowLen = mo.mesh.ny + 1
    const probeI = Math.floor(mo.probeNodes[0]! / rowLen)
    const probeX = mo.mesh.xmin + probeI * (mo.mesh.xmax - mo.mesh.xmin) / mo.mesh.nx
    expect(probeX).toBeCloseTo(0.08, 12)

    const L = mo.mesh.xmax - mo.mesh.xmin
    const A = 100, w = Math.PI / 40
    const rightBc = mo.bcs.find(b => b.boundary === 'right')
    if (rightBc?.type !== 'dirichlet-fn') throw new Error('expected function Dirichlet BC on right')
    expect(rightBc.fn(32)).toBeCloseTo(A * Math.sin(w * 32), 9)
    const leftBc = mo.bcs.find(b => b.boundary === 'left')
    if (leftBc?.type !== 'dirichlet') throw new Error('expected constant Dirichlet BC on left')
    expect(leftBc.value).toBe(0)

    // Exact solution (Carslaw–Jaeger): steady-oscillation closed form plus the
    // decaying transient series for the zero initial condition.
    const lam = Math.sqrt(w / (2 * alpha)) // λ = (1+i)·lam
    const sinhRatio = (x: number): [number, number] => {
      const a = lam * x, b = lam * L
      const nr = Math.sinh(a) * Math.cos(a), ni = Math.cosh(a) * Math.sin(a)
      const dr = Math.sinh(b) * Math.cos(b), di = Math.cosh(b) * Math.sin(b)
      const d = dr * dr + di * di
      return [(nr * dr + ni * di) / d, (ni * dr - nr * di) / d]
    }
    const tOsc = (x: number, t: number) => {
      const [re, im] = sinhRatio(x)
      return A * (re * Math.sin(w * t) + im * Math.cos(w * t))
    }
    const M = 4000, qdx = L / M
    const bn = (n: number) => {
      let sum = 0
      for (let j = 0; j <= M; j++) {
        const f = tOsc(j * qdx, 0) * Math.sin(n * Math.PI * j * qdx / L)
        sum += j === 0 || j === M ? f : j % 2 ? 4 * f : 2 * f
      }
      return -(2 / L) * sum * qdx / 3
    }
    const BN: number[] = []
    for (let n = 1; n <= 400; n++) BN.push(bn(n))
    const tExact = (x: number, t: number) => {
      let v = tOsc(x, t)
      for (let n = 1; n <= 400; n++) {
        v += BN[n - 1]! * Math.sin(n * Math.PI * x / L)
          * Math.exp(-alpha * n * n * Math.PI * Math.PI * t / (L * L))
      }
      return v
    }
    // Sanity: the closed-form matches the published NAFEMS answer T(0.08,32)≈36.6.
    expect(tExact(probeX, 32)).toBeCloseTo(36.6, 1)

    // Built-in CN at MOOSE's dt on a refined grid (fine enough that the FD
    // discretization error is ≪ the MOOSE gold's own deviation).
    const nx = 201
    const dx = L / (nx - 1)
    const r = alpha * ex.dt / (dx * dx)
    const ip = Math.round(probeX / dx)
    let u: Float64Array = new Float64Array(nx).fill(mo.initial)
    const ours: number[] = []
    for (let s = 0; s < ex.numSteps; s++) {
      const tNext = (s + 1) * ex.dt
      u = crankNicolsonStep1D(u, r, {
        left: leftBc.value,
        right: rightBc.fn(tNext),
      })
      ours.push(u[ip]!)
    }

    // Bundled MOOSE quad4 fine gold CSV (time,target_temp).
    const gold = corpusFile('moose/modules/heat_transfer/test/tests/NAFEMS/transient/T3/gold/nafems_t3_quad4_fine_out.csv')
      .trim().split('\n').slice(1).map(l => l.split(',').map(Number) as [number, number])
    expect(gold).toHaveLength(ex.numSteps + 1) // includes the t=0 row
    expect(gold[0]).toEqual([0, 0])

    let maxOursExact = 0, maxOursGold = 0, maxGoldExact = 0
    for (const [i, [tg, g]] of gold.slice(1).entries()) {
      const t = tg!
      expect(t).toBeCloseTo((i + 1) * ex.dt, 9)
      const e = tExact(probeX, t)
      maxOursExact = Math.max(maxOursExact, Math.abs(ours[i]! - e))
      maxOursGold = Math.max(maxOursGold, Math.abs(ours[i]! - g!))
      maxGoldExact = Math.max(maxGoldExact, Math.abs(g! - e))
    }
    // Our CN is within ~0.02 K of the exact solution over the full history;
    // MOOSE's own fine grid deviates up to ~0.42 K in the early wiggles — we
    // bound both rather than asserting positivity the reference lacks.
    expect(maxOursExact).toBeLessThan(0.05)
    expect(maxOursGold).toBeLessThan(0.5)
    expect(maxGoldExact).toBeLessThan(0.5)
    expect(Math.abs(ours[31]! - 36.6)).toBeLessThan(0.15)
  })

  it('moose-casl-i1: heat-source slab matches the bundled ParsedFunction and L1 gold series', async () => {
    // Upstream case: modules/heat_transfer code_verification cartesian_test_no1
    // — CASL verification problem I.1 (SAND2020-3887): 1-D EDGE2 slab, k=12,
    // volumetric HeatSource q=1200, u(0)=100, u(1)=0. Upstream's own check is
    // a spatial-convergence CSV of the elementwise ∫|u_h−u*| dx error.
    //
    // Executed check: the interpreter parses the dim=1 mesh, HeatSource
    // kernel and the [Functions] ParsedFunction (symbol_names/symbol_values
    // honoured — no eval), then runs the 1-D steady conduction solver with
    // volumetricHeatWPerM3 at the parsed nx and the same h sequence as the
    // upstream convergence series. The FD solution is nodally exact for this
    // quadratic field, and its piecewise-linear interpolant reproduces the
    // upstream error metric.
    const mo = parseMooseDiffusionInput(corpusFile('moose/modules/heat_transfer/test/tests/code_verification/cartesian_test_no1.i'))
    expect(mo.mesh).toMatchObject({ dim: 1, nx: 1 })
    expect(mo.diffusionCoef).toBe(12)
    expect(mo.source).toBe(1200)
    expect(mo.executioner.type).toBe('steady')
    const exact = mo.functions.get('exact')
    if (!exact) throw new Error('missing [Functions/exact] ParsedFunction')
    expect(exact({ x: 0 })).toBeCloseTo(100, 12)
    expect(exact({ x: 1 })).toBeCloseTo(0, 12)

    const gold = corpusFile('moose/modules/heat_transfer/test/tests/code_verification/gold/cartesian_test_no1_first_order.csv')
      .trim().split('\n').slice(1).map(l => l.split(','))
      .map(cols => ({ h: Number(cols[1]), err: Number(cols[2]) }))
    expect(gold.map(g => g.h)).toEqual([1, 0.5, 0.25, 0.125, 0.0625])

    const bc = (side: 'left' | 'right') => {
      const b = mo.bcs.find(x => x.boundary === side)
      if (b?.type !== 'dirichlet') throw new Error(`expected Dirichlet on ${side}`)
      return { type: 'dirichlet' as const, temperature: b.value }
    }
    const L = mo.mesh.xmax - mo.mesh.xmin
    const runner = createThermalRunner()
    for (const g of gold) {
      const nElem = Math.round(1 / g.h)
      const spec = defaultJobSpec({
        kind: 'thermal-3d-steady',
        name: `moose-casl-i1-h${g.h}`,
        model: { source: 'preset', presetId: 'moose-casl-i1' },
        parameters: {
          dimension: 1,
          lengthX: L,
          nx: nElem + 1,
          conductivity: mo.diffusionCoef,
          volumetricHeatWPerM3: mo.source,
          units: {
            length: 'm', temperature: 'C', conductivity: 'W/(m·K)',
            heatFlux: 'W/m^2', power: 'W',
          },
          boundaries: { left: bc('left'), right: bc('right') },
          residualTol: 1e-12,
          maxIterations: 50_000,
        },
        run: { maxSteps: 50_000 },
        outputs: { forces: false, history: false, fields: ['temperature'], kpis: [] },
        requirements: { backends: ['cpu'], thermal: true, precision: 'float64', requiredOutputs: ['fields'] },
      })
      const result = await runner.run(spec)
      expect(result.summary!.converged).toBe(1)
      const T = String(result.derived!.temperatureCsv).split(',').map(Number)
      expect(T).toHaveLength(nElem + 1)

      // Nodal exactness against the case's own ParsedFunction.
      let maxNodal = 0
      for (let i = 0; i <= nElem; i++) {
        const x = mo.mesh.xmin + (i / nElem) * L
        maxNodal = Math.max(maxNodal, Math.abs(T[i]! - exact({ x })))
      }
      expect(maxNodal).toBeLessThan(1e-8)

      // Upstream's metric: elementwise ∫|u_h−u*|dx over the piecewise-linear
      // interpolant (Simpson quadrature — exact for this quadratic field).
      let l1 = 0
      for (let i = 0; i < nElem; i++) {
        const xa = mo.mesh.xmin + (i / nElem) * L, xb = xa + L / nElem
        const intExact = (xb - xa) / 6 * (exact({ x: xa }) + 4 * exact({ x: (xa + xb) / 2 }) + exact({ x: xb }))
        l1 += Math.abs(intExact - (T[i]! + T[i + 1]!) / 2 * (xb - xa))
      }
      expect(Math.abs(l1 - g.err) / g.err).toBeLessThan(0.02)
    }
  })

  it('moose-convective-flux: ConvectiveHeatFluxBC reproduces the hand-calc surface T and −500 flux', async () => {
    // Upstream case: modules/heat_transfer convective_heat_flux/flux.i — one
    // QUAD4 element, HeatConduction thermal_conductivity=10 (kernel param, no
    // [Materials]), Dirichlet T=100 left, ConvectiveHeatFluxBC h=10/T∞=200
    // right. Hand calc (upstream comment): the temperature drop splits evenly
    // between body and film → surface T = 150, diffusive flux = −500 W/m².
    // The executioner is Transient num_steps=1 with NO time kernel — MOOSE
    // semantics make that a stationary solve, which we run on the steady
    // solver (transient=false tells us there is no u_t term).
    const mo = parseMooseDiffusionInput(corpusFile('moose/modules/heat_transfer/test/tests/convective_heat_flux/flux.i'))
    expect(mo.variable).toBe('temp')
    expect(mo.transient).toBe(false)
    expect(mo.diffusionCoef).toBe(10)
    expect(mo.bcs).toEqual([
      { boundary: 'left', type: 'dirichlet', value: 100 },
      { boundary: 'right', type: 'robin', h: 10, tInf: 200 },
    ])

    const nx = mo.mesh.nx + 1, ny = mo.mesh.ny + 1
    const spec = defaultJobSpec({
      kind: 'thermal-3d-steady',
      name: 'moose-convective-flux',
      model: { source: 'preset', presetId: 'moose-convective-flux' },
      parameters: {
        dimension: 2,
        lengthX: mo.mesh.xmax - mo.mesh.xmin,
        lengthY: mo.mesh.ymax - mo.mesh.ymin,
        nx, ny,
        conductivity: mo.diffusionCoef,
        volumetricHeatWPerM3: mo.source,
        units: {
          length: 'm', temperature: 'C', conductivity: 'W/(m·K)',
          heatFlux: 'W/m^2', power: 'W',
        },
        boundaries: {
          left: { type: 'dirichlet', temperature: 100 },
          right: { type: 'robin', h: 10, ambientTemp: 200 },
          bottom: { type: 'insulated' },
          top: { type: 'insulated' },
        },
        residualTol: 1e-12,
        maxIterations: 50_000,
      },
      run: { maxSteps: 50_000 },
      outputs: { forces: false, history: false, fields: ['temperature'], kpis: [] },
      requirements: { backends: ['cpu'], thermal: true, precision: 'float64', requiredOutputs: ['fields'] },
    })
    const result = await createThermalRunner().run(spec)
    expect(result.summary!.converged).toBe(1)
    const T = String(result.derived!.temperatureCsv).split(',').map(Number)

    // Hand calc: series resistance 1/(k/L) + 1/h → surface T = 150.
    const tRight = (nx - 1)
    for (let j = 0; j < ny; j++) {
      expect(Math.abs(T[j * nx + tRight]! - 150)).toBeLessThan(0.5)
      expect(Math.abs(T[j * nx]! - 100)).toBeLessThan(1e-9)
    }
    // Diffusive flux −k(T_R−T_L)/L vs the bundled gold (−500 = into the body).
    const gold = corpusFile('moose/modules/heat_transfer/test/tests/convective_heat_flux/gold/flux_out.csv')
      .trim().split('\n').slice(1).map(l => l.split(',').map(Number))
    expect(gold[gold.length - 1]![1]).toBeCloseTo(-500, 6)
    const tSurf = (T[tRight]! + T[(ny - 1) * nx + tRight]!) / 2
    const flux = -mo.diffusionCoef * (tSurf - 100) / (mo.mesh.xmax - mo.mesh.xmin)
    expect(Math.abs(flux - gold[gold.length - 1]![1]!)).toBeLessThan(5)
    // Consistency: the same flux crosses the film, h(T_surf − T∞) = −500.
    expect(Math.abs(10 * (tSurf - 200) - flux)).toBeLessThan(5)
  })

  it('moose-casl-i4: heated plate with flux + convection matches the enclosure-cooling archetype', async () => {
    // Upstream case: modules/heat_transfer code_verification cartesian_test_no4
    // — CASL verification problem I.4 (SAND2020-3887): 1-D plate k=1 with
    // volumetric generation q=1200, imposed inward flux q0=200 on the left
    // (NeumannBC) and CoupledConvectiveHeatFluxBC h=10/T∞=100 on the right.
    // This is the canonical electronics-cooling abstraction: a dissipating
    // wall (component/PCB) cooled by an airflow path — the same physics
    // Icepak/FloTHERM resolve with full conjugate CFD, reduced here to its
    // 1-D verification form with a closed-form exact solution.
    //
    // Executed check: the interpreter maps CoupledConvectiveHeatFluxBC with a
    // literal htc+T_infinity to a Robin BC, runs the 1-D steady conduction
    // solver with neumann flux + robin + volumetricHeatWPerM3 across the
    // upstream convergence h-sequence, and checks nodal exactness against
    // the case's own ParsedFunction plus the global energy balance
    // (in 200 + generated 1200 = out 1400 through the film).
    const mo = parseMooseDiffusionInput(corpusFile('moose/modules/heat_transfer/test/tests/code_verification/cartesian_test_no4.i'))
    expect(mo.mesh).toMatchObject({ dim: 1, nx: 1 })
    expect(mo.diffusionCoef).toBe(1)
    expect(mo.source).toBe(1200)
    expect(mo.bcs).toEqual([
      { boundary: 'left', type: 'neumann', value: 200 },
      { boundary: 'right', type: 'robin', h: 10, tInf: 100 },
    ])
    const exact = mo.functions.get('exact')
    if (!exact) throw new Error('missing [Functions/exact] ParsedFunction')
    // Hand check: u(0)=1040, u(1)=240; film drop h(u(1)−T∞)=1400 W/m².
    expect(exact({ x: 0 })).toBeCloseTo(1040, 9)
    expect(exact({ x: 1 })).toBeCloseTo(240, 9)

    // Same h refinement sequence as the upstream convergence study.
    const gold = corpusFile('moose/modules/heat_transfer/test/tests/code_verification/gold/cartesian_test_no4_first_order.csv')
      .trim().split('\n').slice(1).map(l => ({ h: Number(l.split(',')[1]) }))
    expect(gold.map(g => g.h)).toEqual([1, 0.5, 0.25, 0.125, 0.0625])

    const runner = createThermalRunner()
    for (const g of gold) {
      const nElem = Math.round(1 / g.h)
      const spec = defaultJobSpec({
        kind: 'thermal-3d-steady',
        name: `moose-casl-i4-h${g.h}`,
        model: { source: 'preset', presetId: 'moose-casl-i4' },
        parameters: {
          dimension: 1,
          lengthX: mo.mesh.xmax - mo.mesh.xmin,
          nx: nElem + 1,
          conductivity: mo.diffusionCoef,
          volumetricHeatWPerM3: mo.source,
          units: {
            length: 'm', temperature: 'C', conductivity: 'W/(m·K)',
            heatFlux: 'W/m^2', power: 'W',
          },
          boundaries: {
            left: { type: 'neumann', heatFlux: 200 },
            right: { type: 'robin', h: 10, ambientTemp: 100 },
          },
          residualTol: 1e-12,
          maxIterations: 50_000,
        },
        run: { maxSteps: 50_000 },
        outputs: { forces: false, history: false, fields: ['temperature'], kpis: [] },
        requirements: { backends: ['cpu'], thermal: true, precision: 'float64', requiredOutputs: ['fields'] },
      })
      const result = await runner.run(spec)
      expect(result.summary!.converged).toBe(1)
      const T = String(result.derived!.temperatureCsv).split(',').map(Number)
      let maxNodal = 0
      for (let i = 0; i <= nElem; i++) {
        maxNodal = Math.max(maxNodal, Math.abs(T[i]! - exact({ x: i / nElem })))
      }
      // The FD Neumann+Robin treatment is exact for this quadratic field —
      // tighter than upstream's first-order FE, whose PL-interpolant error
      // (gold CSV column 3) converges only as O(h²).
      expect(maxNodal).toBeLessThan(1e-8)
      // Energy balance at the robin face: in 200 + generated 1200·L = h(u_R−T∞).
      const tR = T[nElem]!
      expect(Math.abs(10 * (tR - 100) - 1400)).toBeLessThan(1e-6)
    }
  })
})

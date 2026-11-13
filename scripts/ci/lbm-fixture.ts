import { LBM_NEE_OUTLET_FEATURE, LBM_NEE_INLET_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_GAUGE_FORCE_FEATURE, type FluidJobSpecV1 } from '@w-sim/contracts'
import { computeLatticeUnits, forceToCoefficient, latticeForceToNewton } from '@w-sim/solvers-lbm/d3q19'
import type { ComputeLbmInput } from '../../apps/host/src/types/compute'

/** Isolated solid voxel: its first-step force is analytically 2*rho_lattice*U_lattice. */
export function tinyForceFixture() {
  const spec: FluidJobSpecV1 = { ...lbmSpec(), model: { source: 'artifact', artifactId: '00000000-0000-4000-8000-000000000001', referenceLength: 0.1, referenceArea: 0.0025 },
    parameters: { gridPreset: 'fast', inletVelocity: 1, fluidDensity: 1.2, fluidViscosity: 0.06, viscosityMode: 'physical' },
    outputs: { forces: true, history: true } }
  const units = computeLatticeUnits({ inletVelocity: 1, characteristicLength: 0.1, characteristicCells: 2, nx: 7, ny: 5, nz: 5, viscosity: 0.05 })
  const flags = new Uint8Array(175); flags[87] = 1
  const lbm: ComputeLbmInput = { nx: 7, ny: 5, nz: 5, tau: units.tau, uInlet: units.uLattice,
    smagorinskyCs: 0, turbulenceIntensity: 0, freeSlipWalls: true, density: 1.2, inletVelocity: 1, referenceArea: 0.0025, solidCells: 1, units,
    forceScale: latticeForceToNewton(1, 1.2, units.dx, units.dt), coefficientScale: forceToCoefficient(1, 1.2, 1, 0.0025) }
  return { spec, prepared: { lbm, flags } }
}

// One closed cube and three steps exercise the product preparation and transport.
export const lbmGeometry = {
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]),
  normals: new Float32Array(24),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2]),
}
// Two overlapping closed solids: an ungrouped parity fill wrongly cuts a hole in their overlap.
export const overlappingGeometry = {
  vertices: new Float32Array([...lbmGeometry.vertices, ...lbmGeometry.vertices.map((value, i) => value + [0.5, 0.25, 0.125][i % 3])]),
  normals: new Float32Array(48),
  indices: new Uint32Array([...lbmGeometry.indices, ...lbmGeometry.indices.map(index => index + 8)]),
  solidTriangleCounts: new Uint32Array([12, 12]),
}
export function lbmSpec(artifactId = '00000000-0000-4000-8000-000000000001'): FluidJobSpecV1 {
  return { schemaVersion: 1, kind: 'lbm-d3q19', model: { source: 'artifact', artifactId, referenceLength: 1 },
    parameters: { gridPreset: 'fast', modelResolution: 'coarse', inletVelocity: 5, angleOfAttack: 7, viscosityMode: 'stabilized-preview',
      fluidDensity: 1.225, fluidViscosity: 1.5e-5, smagorinskyCs: 0.12, turbulenceIntensity: 0.01, wallCondition: 'slip' },
    run: { maxSteps: 3, forceSampleEvery: 1, warmupSteps: 0 },
    outputs: { forces: true, history: true, fields: ['velocity', 'vorticity'] },
    requirements: { backends: ['cpu'], precision: 'mixed', features: [LBM_NEE_OUTLET_FEATURE, LBM_NEE_INLET_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_GAUGE_FORCE_FEATURE] } }
}

// A low-Re physical case with a resolved model/ground gap; three steps only.
export function groundSpec(artifactId?: string, mode: 'stationary' | 'moving' = 'moving'): FluidJobSpecV1 {
  const spec = lbmSpec(artifactId)
  return { ...spec, parameters: { ...spec.parameters, viscosityMode: 'physical', fluidViscosity: 1.225 * 0.02,
    ground: { mode, clearanceM: 0.1 } } }
}

// Two finite-thickness closed walls leave an open channel for an independently driven fan.
export const fanGeometry = {
  vertices: new Float32Array([0, .9].flatMap(offset => Array.from(lbmGeometry.vertices, (value, i) => i % 3 === 1 ? value * .1 + offset : value))),
  normals: new Float32Array(48),
  indices: new Uint32Array([...lbmGeometry.indices, ...lbmGeometry.indices.map(index => index + 8)]),
  solidTriangleCounts: new Uint32Array([12, 12]),
}
export function fanSpec(artifactId?: string): FluidJobSpecV1 {
  const spec = lbmSpec(artifactId)
  return { ...spec, parameters: { ...spec.parameters, angleOfAttack: 0, inletVelocity: 0,
    fan: { center: [0.5, 0.5, 0.5], axis: 'x', radiusM: 0.12, pressureRisePa: 20 } } }
}

export function thermalSpec(artifactId?: string): FluidJobSpecV1 {
  const spec = fanSpec(artifactId)
  return { ...spec, model: { ...spec.model!, referenceLength: 0.01 },
    parameters: { ...spec.parameters, viscosityMode: 'physical', thermalEnabled: true, ambientTemp: 25, heatSourceTemp: 60,
      dtSeconds: 0.0001, fan: { center: [0.5, 0.5, 0.5], axis: 'x', radiusM: 0.0012, pressureRisePa: 0.02 } },
    outputs: { ...spec.outputs, fields: ['velocity', 'vorticity', 'temperature'] },
    requirements: { ...spec.requirements, thermal: true } }
}

export function solidPowerSpec(artifactId?: string): FluidJobSpecV1 {
  const spec = lbmSpec(artifactId)
  return { ...spec, model: { ...spec.model!, referenceLength: 0.01 },
    parameters: { ...spec.parameters, viscosityMode: 'physical', angleOfAttack: 0, inletVelocity: 0.05, thermalEnabled: true,
      thermalMode: 'solid-power', ambientTemp: 25, dtSeconds: 0.0001, totalPowerW: 10,
      solidDensityKgM3: 2700, solidSpecificHeatJkgK: 900, solidConductivityWmK: 200 },
    outputs: { ...spec.outputs, fields: ['velocity', 'vorticity', 'temperature'] },
    requirements: { ...spec.requirements, thermal: true } }
}

// One mesh, two adjacent materials; power is local to the first region.
export function thermalRegionsSpec(artifactId?: string): FluidJobSpecV1 {
  const spec = solidPowerSpec(artifactId)
  return { ...spec, parameters: { ...spec.parameters, inletVelocity: 0, totalPowerW: 0,
    thermalRegions: [
      { name: 'User heat source', bounds: { min: [0, 0, 0], max: [0.35, 1, 1] }, totalPowerW: 7,
        solidDensityKgM3: 2500, solidSpecificHeatJkgK: 700, solidConductivityWmK: 40 },
      { name: 'User heat spreader', bounds: { min: [0.35, 0, 0], max: [1, 1, 1] }, totalPowerW: 0,
        solidDensityKgM3: 2700, solidSpecificHeatJkgK: 900, solidConductivityWmK: 200 },
    ],
  } }
}

// Same geometry/source, with a finite area-normalized interface resistance.
export function thermalContactsSpec(artifactId?: string): FluidJobSpecV1 {
  const spec = thermalRegionsSpec(artifactId)
  return { ...spec, parameters: { ...spec.parameters,
    thermalContacts: [{ first: 1, second: 2, resistanceM2KW: 0.001 }],
  } }
}

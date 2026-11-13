import type { IgbtSpatialChipJobParameters, IgbtSpatialChipJobSpecV1 } from '@w-sim/contracts'
import { THERMAL_IGBT_SPATIAL_FEATURE, validateIgbtSpatialDomain } from '@w-sim/solvers-thermal'

export { THERMAL_IGBT_SPATIAL_FEATURE }

export function createDefaultIgbtSpatialParameters(): IgbtSpatialChipJobParameters {
  const bounds = { min: [0, 0, 0] as [number, number, number], max: [0.02, 0.02, 0.01] as [number, number, number] }
  const operatingPoint = { currentA: 1, voltageV: 400, gateResistanceOnOhm: 4, gateResistanceOffOhm: 4, dutyCycle: 0.4, switchingFrequencyHz: 1_000 }
  return {
    mode: 'spatial-chip', dimension: 3,
    lengthX: 0.02, lengthY: 0.02, lengthZ: 0.01, nx: 5, ny: 5, nz: 3, conductivity: 100,
    units: { length: 'm', temperature: 'C', conductivity: 'W/(m·K)', power: 'W', heatFlux: 'W/m^2' },
    boundaries: {
      left: { type: 'insulated' }, right: { type: 'insulated' },
      bottom: { type: 'dirichlet', temperature: 25 }, top: { type: 'robin', h: 20, ambientTemp: 25 },
      front: { type: 'insulated' }, back: { type: 'insulated' },
    },
    caseFace: 'bottom', materials: [{ name: 'Example substrate', bounds, conductivity: 100 }],
    dies: [{
      id: 'Q1', bounds, operatingPoint,
      lossTable: {
        operatingPoint: { currentA: 1, voltageV: 400, gateResistanceOnOhm: 4, gateResistanceOffOhm: 4 },
        points: [
          { temperatureC: 25, vceSatV: 1.1, eOnJ: 0.001, eOffJ: 0.0015 },
          { temperatureC: 150, vceSatV: 1.5, eOnJ: 0.0018, eOffJ: 0.0025 },
        ],
        source: 'synthetic-example-not-vendor-data',
      }, initialJunctionTempC: 25,
    }],
    coupling: { maxJunctionTempC: 140, maxIterations: 100, temperatureToleranceC: 1e-8, relativePowerTolerance: 1e-10, relaxationFactor: 1 },
    residualTol: 1e-12, maxIterations: 50_000,
  }
}

export function buildIgbtSpatialJobSpec(
  parameters: IgbtSpatialChipJobSpecV1['parameters'],
): { ok: true; spec: IgbtSpatialChipJobSpecV1 } | { ok: false; errors: string[] } {
  const spec: IgbtSpatialChipJobSpecV1 = {
    schemaVersion: 1,
    kind: 'electro-thermal-igbt',
    name: 'spatial-igbt-chip',
    parameters,
    run: { maxSteps: 5_000 },
    outputs: {
      fields: ['temperature'],
      kpis: ['tMin', 'tMax', 'tjMaxC', 'caseMeanC', 'totalLossW', 'sourcePowerW', 'energyImbalance'],
    },
    requirements: {
      backends: ['native-cuda'],
      minVramMb: 256,
      thermal: true,
      precision: 'float64',
      features: [THERMAL_IGBT_SPATIAL_FEATURE],
      requiredOutputs: ['fields', 'kpis'],
    },
  }
  const validation = validateIgbtSpatialDomain(spec)
  if (!validation.ok) return { ok: false, errors: validation.violations.map(item => `${item.path}: ${item.message}`) }
  return { ok: true, spec }
}

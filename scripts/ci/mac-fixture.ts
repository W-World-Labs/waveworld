import { MAC_3D_FEATURE, type MacJobSpecV1 } from '@w-sim/contracts';
export { fanGeometry as macGeometry } from './lbm-fixture';

/** Synthetic P-Q curves on two separate actuator planes; a three-step plumbing oracle. */
export function macSpec(artifactId = '00000000-0000-4000-8000-000000000001', thermal = false): MacJobSpecV1 {
  return {
    schemaVersion: 1, kind: 'mac-3d', model: { source: 'artifact', artifactId, referenceLength: .04 },
    parameters: { grid: [12, 9, 9], characteristicCells: 4, dtSeconds: .0001,
      fluidDensity: 1.225, fluidViscosity: 1.81e-5, openFaces: 3,
      fans: [.25, .75].map((x, i) => ({ name: `Synthetic fan ${i + 1}`, center: [x, .5, .5], axis: 'x',
        radiusM: .011, rpmRatio: 1, curve: [{ flowM3s: 0, pressurePa: 20 }, { flowM3s: .01, pressurePa: 0 }] })),
      ...(thermal ? { thermalEnabled: true, thermalMode: 'solid-power', ambientTemp: 25,
        solidDensityKgM3: 2700, solidSpecificHeatJkgK: 900, solidConductivityWmK: 205, totalPowerW: 2 } : {}),
    },
    run: { maxSteps: 3, forceSampleEvery: 2 },
    outputs: { history: true, fields: ['velocity', 'pressure', ...(thermal ? ['temperature'] : [])], fieldFrames: 3 },
    requirements: { backends: ['cpu'], precision: 'float64', features: [MAC_3D_FEATURE], ...(thermal ? { thermal: true } : {}) },
  };
}

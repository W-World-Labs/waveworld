import { opticsPreset } from '../lab/optics-lab'
import { extremePlaneInputs } from '../../../scripts/ci/plane-fixture'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { WASM_KERNEL_SOURCE_SHA256 } from '@w-sim/solvers-lbm/d3q19'
import { WasmLbm, WasmRadar } from './wasm-fields'
import { parseLammpsData, LAMMPS_DATA_MAX_BYTES } from './lammps-data'
import { parseSignalCsv, validateRecording } from '../signal-recording'
import { eegResult } from './eeg'
import { emgResult } from './emg'
import { simulate as simulateNeuron, NEURON_DT } from './neuron'

import { describe, expect, it, vi } from 'vitest'
import { validateModuleInput, computeModule, createModuleJobSpec, readModuleJobInput, readModuleResult, moduleComputeSteps, moduleComputePrecision, knownModuleComputePrecision, isNativeAlgorithmInput, isSwModuleInput, type ModuleComputeInput } from './module-compute'
import { FDTD_NX, FDTD_NY, FDTD_PRESETS, defaultFdtdSources, injectFdtdSceneSources, type FdtdScene } from './fdtd'
import { emWave3DResult } from './spectrum-runnable-algos'
import { antenna3DResult } from './antenna'
import { antennaLinkResult } from './antennalink'
import { LASER_DT, laserStep, laserCharacteristics } from './laser'
import { radarResult, type RadarScene } from './radar-algos'
import { nljdResult } from './nljd'
import { localizationResult } from './trilateration'
import { stmScanResult, tunnelCurrent } from './stm'
import { afmScanResult } from './afm'
import { HEAT_W, HEAT_H, defaultHeatSeeds, seedHeat2D, sum } from './heat'
import { createHeatSim } from '../webgpu/heatSim'
import { HEAT_1D_M, HEAT_1D_L, HEAT_1D_X0, initHeat1D, ftcsStep, heat1DResult } from './heaterfc'
import { initLattice, velocityVerlet, MD_DT, mdBoxLength, mdMaxSteps, type MdScene } from './md'
import * as mdRuntime from '../webgpu/mdSim'
import { initIsing, metropolisSweep, energyPerSpin, createIsingScene, stepIsingScene, isingResult, isingSceneSteps, type IsingScene } from './ising'
import { forcedOscillatorStep, forcedOscillatorAmplitude, VIBRATION_DT, type VibrationScene } from './spectrum-runnable-algos'
import { Wave, RIPPLE_N, createRippleScene, defaultRippleSeeds, type RippleScene } from './wave'
import { Fluid, FLUID_N, FLUID_DT, createFluidScene, stepFluidScene, fluidResult, type FluidScene, CONVECTION_N, CONVECTION_DT, CONVECTION_COOLING, createConvectionScene, stepConvectionScene, convectionResult, type ConvectionScene } from './fluid'

import { displayResult, type DisplayScene } from './display'
import { particleResult, type ParticleScene } from './particles'
import { CST_NATIVE_OPERATIONS, NATIVE_ALGORITHM_OPERATIONS } from './native-algorithm'
import type { JobSpecV1 } from '@w-sim/contracts'
import { pedotParticleScene } from './pedotpss'
import * as particleRuntime from '../webgpu/particleSim'

const particleScene: ParticleScene = { ...pedotParticleScene(64), seed: 7, steps: 5 }

describe('native algorithm operation admission', () => {
  it('routes PEMFC polarization through the native sw-module transport unchanged', () => {
    const input = {
      module: 'sw-comsol-pemfc', method: 'polarization', backend: 'host', n: 2, E0: 1.229,
      T: 353.15, pH2: 1, pO2: 0.21, pH2O: 1, j0: 1e-4, alpha: 0.5,
      R: 0.05, jLim: 2, j: 0.5, imax: 1, points: 21,
    } as unknown as ModuleComputeInput

    expect(isSwModuleInput(input)).toBe(true)
    const spec = createModuleJobSpec(input)
    expect(spec.requirements).toEqual({ backends: ['cuda'] })
    expect(spec.run.maxSteps).toBe(1)
    expect(spec.model?.inline).toEqual(input)
    expect(spec.model?.inline).toMatchObject({ module: 'sw-comsol-pemfc', method: 'polarization', backend: 'host' })
    expect(readModuleJobInput(JSON.parse(JSON.stringify(spec)))).toEqual(input)
  })

  it('transports the exact lens geometric-ray-trace alias unchanged to native cuda', () => {
    const input = {
      module: 'lens-design', backend: 'host', method: 'geometric-ray-trace',
      surfaces: [
        { type: 'plane', n1: 1, n2: 1.5, aperture: 5, thickness: 5 },
        { type: 'spherical', R: 20, n1: 1.5, n2: 1, aperture: 4, thickness: 0 },
      ],
      rays: [
        { origin: [0, 0, -10], direction: [0, 0, 1] },
        { origin: [1, 0, -10], direction: [0, 0, 1] },
      ],
      imageDistance: 20,
    } as unknown as ModuleComputeInput

    expect(isNativeAlgorithmInput(input)).toBe(true)
    const spec = createModuleJobSpec(input)
    expect(spec.requirements).toEqual({ backends: ['cuda'] })
    expect(spec.run.maxSteps).toBe(1)
    expect(spec.model?.inline).toEqual(input)
    expect(spec.model?.inline).toMatchObject({ module: 'lens-design', backend: 'host', method: 'geometric-ray-trace' })
    expect(readModuleJobInput(JSON.parse(JSON.stringify(spec)))).toEqual(input)

    const wrongSelector = { ...input, method: 'geometric-ray-trace-extra' }
    expect(isNativeAlgorithmInput(wrongSelector)).toBe(false)
    expect(() => createModuleJobSpec(wrongSelector as unknown as ModuleComputeInput)).toThrow(/unsupported native algorithm operation selector/)
    const wrongBackend = { ...input, backend: 'cuda' }
    expect(isNativeAlgorithmInput(wrongBackend)).toBe(false)
    expect(() => createModuleJobSpec(wrongBackend as unknown as ModuleComputeInput)).toThrow(/require backend host/)
    const wrongTransport = { ...spec, requirements: { backends: ['cpu'] } } as unknown as JobSpecV1
    expect(() => readModuleJobInput(wrongTransport)).toThrow(/native w-sim-cuda backend/)
  })

  it('admits the bounded native Sellmeier multi-term material selector', () => {
    const input = {
      module: 'sellmeier', backend: 'host', method: 'method-algo-sellmeier-n-multi', lam_um: 0.5876,
      terms: [{ B: 1.03961212, C: 0.00600069867 }, { B: 0.231792344, C: 0.0200179144 }],
    } as const
    expect(isNativeAlgorithmInput(input)).toBe(true)
    const spec = createModuleJobSpec(input)
    expect(spec.requirements).toEqual({ backends: ['cuda'] })
    expect(spec.run.maxSteps).toBe(1)
    expect(spec.model?.inline).toEqual(input)
    expect(readModuleJobInput(JSON.parse(JSON.stringify(spec)))).toEqual(input)
    expect(isNativeAlgorithmInput({ ...input, method: 'method-algo-sellmeier-n-multi-extra' })).toBe(false)
  })

  it('routes exact host operations to native cuda executor and validates host provenance', async () => {
    const inputs = [
      { module: 'lens-design', method: 'geometric-ray-trace', backend: 'host', surfaces: [], rays: [], imageDistance: 20 },
      { module: 'mtf', operation: 'incoherent-lsf', backend: 'host', lsf: [0, 1, 0], sampleSpacingMm: 0.1, spatialFrequenciesCyclesPerMm: [0, 1] },
    ] as const
    for (const input of inputs) {
      expect(isNativeAlgorithmInput(input)).toBe(true)
      const spec = createModuleJobSpec(input)
      expect(spec.requirements).toEqual({ backends: ['cuda'] })
      expect(spec.model?.inline).toMatchObject({ backend: 'host' })
      expect(readModuleJobInput(JSON.parse(JSON.stringify(spec)))).toEqual(input)
      const output = { module: input.module, backend: { id: 'host-f64' }, value: 1 }
      expect(readModuleResult({ schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, moduleResult: output } as never, input)).toEqual(output)
    }
    await expect(computeModule(inputs[0])).rejects.toThrow(/no browser\/host implementation/)
  })

  it('accepts meaningful module-owned top-level result fields without requiring a nested result wrapper', () => {
    const input = { module: 'sw-cantera-nasa-poly', backend: 'host', model: 'nasa7', T: [900], species: [] } as unknown as ModuleComputeInput
    const output = { module: input.module, method: 'nasa7', nTemperatures: 1, species: [{ name: 'O2', evaluations: [{ T: 900, cp: 32.9 }] }] }
    expect(readModuleResult({ schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, moduleResult: output } as never, input)).toEqual(output)
    expect(() => readModuleResult({ schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, moduleResult: { module: input.module, method: 'nasa7' } } as never, input)).toThrow(/no payload/)
  })

  it('rejects selector/backend/scheduler variants and preserves the legacy laser teaching input', () => {
    const laserTeaching = { module: 'laser', pump: 0.5, steps: 4 } as const
    expect(isNativeAlgorithmInput(laserTeaching)).toBe(false)
    expect(createModuleJobSpec(laserTeaching).requirements).toMatchObject({ backends: ['cpu'], precision: 'float64' })
    expect(() => createModuleJobSpec({ module: 'mtf', operation: 'unknown', backend: 'host' } as unknown as ModuleComputeInput)).toThrow(/unsupported native algorithm operation selector/)
    expect(() => createModuleJobSpec({ module: 'mtf', operation: 'incoherent-lsf', backend: 'cuda' } as unknown as ModuleComputeInput)).toThrow(/require backend host/)
    const valid = createModuleJobSpec({ module: 'mtf', operation: 'incoherent-lsf', backend: 'host', lsf: [0, 1, 0], sampleSpacingMm: 0.1, spatialFrequenciesCyclesPerMm: [0, 1] })
    expect(() => readModuleJobInput({ ...valid, requirements: { backends: ['cpu'] } })).toThrow(/native w-sim-cuda backend/)
  })

  it('admits only exact CST module/operation pairs and dispatches them to native host-f64', async () => {
    expect(CST_NATIVE_OPERATIONS.length).toBeGreaterThan(0)
    for (const { module, key, value } of CST_NATIVE_OPERATIONS) {
      const input = { module, backend: 'host', [key]: value } as unknown as ModuleComputeInput
      expect(isNativeAlgorithmInput(input)).toBe(true)
      const spec = createModuleJobSpec(input)
      expect(spec.requirements).toEqual({ backends: ['cuda'] })
      expect(spec.model?.inline).toMatchObject({ module, backend: 'host', [key]: value })
      expect(readModuleJobInput(JSON.parse(JSON.stringify(spec)))).toEqual(input)
    }
    const browserOnlyInput = { module: 'array', backend: 'host', operation: 'cst-array-excitation-pattern' } as unknown as ModuleComputeInput
    await expect(computeModule(browserOnlyInput)).rejects.toThrow(/no browser\/host implementation/)
    for (const { module } of CST_NATIVE_OPERATIONS) {
      expect(isNativeAlgorithmInput({ module, backend: 'host', operation: 'cst-unknown' })).toBe(false)
    }
    expect(NATIVE_ALGORITHM_OPERATIONS.length).toBe(24 + CST_NATIVE_OPERATIONS.length)
  })

  it('transports CST S11 VSWR sweeps with the exact selector and unchanged samples', () => {
    const input = {
      module: 'vswr', backend: 'host', operation: 'cst-s11-vswr-sweep',
      frequenciesHz: [1e9, 2e9, 3e9], s11: [[0, 0], [0.2, 0], [0, 0.5]],
    } as unknown as ModuleComputeInput

    expect(isNativeAlgorithmInput(input)).toBe(true)
    const spec = createModuleJobSpec(input)
    expect(spec.requirements).toEqual({ backends: ['cuda'] })
    expect(spec.model?.inline).toEqual(input)
    expect(spec.model?.inline).toMatchObject({ module: 'vswr', backend: 'host', operation: 'cst-s11-vswr-sweep' })
    expect(readModuleJobInput(JSON.parse(JSON.stringify(spec)))).toEqual(input)

    for (const invalid of [
      { ...input, operation: 'cst-s11-vswr-sweep-extra' },
      { ...input, operation: 'cst-unknown' },
      { ...input, backend: 'cuda' },
      { ...input, module: 'mna' },
    ]) {
      expect(isNativeAlgorithmInput(invalid)).toBe(false)
      expect(() => createModuleJobSpec(invalid as unknown as ModuleComputeInput)).toThrow(/unsupported native algorithm operation selector|require backend host/)
    }
  })

  it('admits only the exact host MNA DC method and preserves the released CST selector', () => {
    const dc = { module: 'mna', method: 'method-algo-mna-dc', backend: 'host', netlist: '.dc V1 0 5 1' } as unknown as ModuleComputeInput
    expect(isNativeAlgorithmInput(dc)).toBe(true)
    const spec = createModuleJobSpec(dc)
    expect(spec.requirements).toEqual({ backends: ['cuda'] })
    expect(spec.model?.inline).toMatchObject({ module: 'mna', method: 'method-algo-mna-dc', backend: 'host' })

    const releasedCst = { module: 'mna', operation: 'cst-port-impedance-sweep', backend: 'host' } as unknown as ModuleComputeInput
    expect(isNativeAlgorithmInput(releasedCst)).toBe(true)
    expect(createModuleJobSpec(releasedCst).model?.inline).toMatchObject({ operation: 'cst-port-impedance-sweep' })

    for (const method of ['unknown', 'method-algo-mna-transient']) {
      const input = { module: 'mna', method, backend: 'host' } as unknown as ModuleComputeInput
      expect(isNativeAlgorithmInput(input)).toBe(false)
      expect(() => createModuleJobSpec(input)).toThrow(/unsupported native algorithm operation selector/)
    }
    for (const conflicting of [
      { module: 'mna', method: 'method-algo-mna-dc', operation: 'cst-port-impedance-sweep', backend: 'host' },
      { module: 'mna', method: 'method-algo-mna-dc', operation: 'cst-unknown', backend: 'host' },
    ]) {
      expect(isNativeAlgorithmInput(conflicting)).toBe(false)
      expect(() => createModuleJobSpec(conflicting as unknown as ModuleComputeInput)).toThrow(/conflicting native algorithm selectors/)
    }
  })

  it('transports only the exact native MNA DC sweep method', () => {
    const sweep = { module: 'mna', method: 'method-algo-mna-dc-sweep', backend: 'host', circuit: { nodes: 2, resistors: [{ a: 1, b: 2, r: 1000 }, { a: 2, b: 0, r: 3000 }], capacitors: [], inductors: [], vSources: [{ a: 1, b: 0, v: 10 }], iSources: [], diodes: [] }, sweep: { source: 0, start: 0, stop: 10, steps: 3 } } as unknown as ModuleComputeInput
    expect(isNativeAlgorithmInput(sweep)).toBe(true)
    const spec = createModuleJobSpec(sweep)
    expect(spec.requirements).toEqual({ backends: ['cuda'] })
    expect(spec.run.maxSteps).toBe(3)
    expect(spec.model?.inline).toEqual(sweep)
    expect(readModuleJobInput(JSON.parse(JSON.stringify(spec)))).toEqual(sweep)

    for (const method of ['method-algo-mna-dc-sweep-extra', 'method-algo-mna-ac-sweep', 'method-algo-mna-transient']) {
      const unsupported = { ...sweep, method }
      expect(isNativeAlgorithmInput(unsupported)).toBe(false)
      expect(() => createModuleJobSpec(unsupported as unknown as ModuleComputeInput)).toThrow(/unsupported native algorithm operation selector/)
    }
    const mixed = { ...sweep, operation: 'cst-port-impedance-sweep' }
    expect(isNativeAlgorithmInput(mixed)).toBe(false)
    expect(() => createModuleJobSpec(mixed as unknown as ModuleComputeInput)).toThrow(/conflicting native algorithm selectors/)
    const mismatchedTransport = { ...spec, requirements: { backends: ['cpu'] } } as unknown as JobSpecV1
    expect(() => readModuleJobInput(mismatchedTransport)).toThrow(/native w-sim-cuda backend/)
  })

  it('keeps overlapping legacy FDTD and Faraday teaching inputs on their existing path', () => {
    const fdtd = { module: 'fdtd' as const, scene }
    const faraday = { module: 'faraday' as const, scene: { omega: 4 * Math.PI, B: 0.3, N: 200, A: 0.01, vBar: 0, bMot: 0.5, lBar: 0.2 } }
    expect(isNativeAlgorithmInput(fdtd)).toBe(false)
    expect(isNativeAlgorithmInput(faraday)).toBe(false)
    expect(createModuleJobSpec(fdtd).requirements?.backends).toContain('cpu')
    expect(createModuleJobSpec(faraday).requirements?.backends).toContain('cpu')
    for (const module of ['array', 'circuit', 'fdtd']) {
      expect(isNativeAlgorithmInput({ module, backend: 'host', operation: 'cst-unknown' })).toBe(false)
      expect(() => createModuleJobSpec({ module, backend: 'host', operation: 'cst-unknown' } as unknown as ModuleComputeInput)).toThrow(/unsupported native algorithm operation selector/)
    }
    expect(() => createModuleJobSpec({ ...fdtd, operation: 'cst-unknown' } as unknown as ModuleComputeInput)).toThrow(/unsupported native algorithm operation selector/)
  })
})

describe('display and charged-bead scene adapters', () => {
  const wrap = (output: Awaited<ReturnType<typeof computeModule>>, steps: number) => ({ schemaVersion: 1 as const, summary: { steps, wallTimeMs: 1 }, moduleResult: output })
  it('transports all display modes and uses crossed-polarizer angles consistently', async () => {
    const scenes: DisplayScene[] = [{ mode: 'LED', bandgap: 2 }, { mode: 'LED', bandgap: 1.6 }, { mode: 'OLED', channels: [1, 0, 0.2] }, ...[0, 45, 90].map(rotationDeg => ({ mode: 'LCD' as const, rotationDeg }))]
    for (const scene of scenes) {
      const input = { module: 'display' as const, scene }, spec = createModuleJobSpec(input)
      expect(spec.requirements?.precision).toBe('float64'); expect(spec.run.maxSteps).toBe(1)
      const output = await computeModule(readModuleJobInput(JSON.parse(JSON.stringify(spec))))
      if (output.module !== 'display') throw new Error('wrong module')
      const result = output.result
      if (result.mode === 'LED' && scene.mode === 'LED') {
        expect(result.wavelengthNm).toBe(1240 / scene.bandgap)
        if (scene.bandgap === 1.6) { expect(result.inColorRange).toBe(false); expect(result.rgb).toEqual([0, 0, 0]) }
      } else if (result.mode === 'OLED') expect(result.rgb).toEqual([255, 0, 51])
      else if (result.mode === 'LCD' && scene.mode === 'LCD') {
        expect(result.transmission).toBeCloseTo(scene.rotationDeg / 90, 12)
        expect(result.transmissions).toHaveLength(91)
        expect(result.transmissions[0]).toBeCloseTo(0, 12); expect(result.transmissions[90]).toBe(1)
      }
      const wire = JSON.parse(JSON.stringify(wrap(output, 1)))
      wire.moduleResult.result.futureField = 'ignored'
      expect(readModuleResult(wire, input).module).toBe('display')
      wire.moduleResult.result.rgb = [0, 1, 2]
      expect(() => readModuleResult(wire, input)).toThrow()
    }
    expect(displayResult({ mode: 'LCD', rotationDeg: 30 }).transmission).toBeCloseTo(0.25, 12)
    for (const scene of [{ mode: 'LED', bandgap: 0 }, { mode: 'OLED', channels: [0, 1] }, { mode: 'LCD', rotationDeg: 91 }, { mode: 'missing' }]) {
      expect(() => createModuleJobSpec({ module: 'display', scene } as ModuleComputeInput)).toThrow()
    }
  })

  it('shares charged CPU batches and validates transported particles, energy and RDF', async () => {
    for (const epsR of [80, 24, 2]) {
      const scene = { ...particleScene, epsR, thermostat: epsR !== 2 }, input = { module: 'particles' as const, scene }
      const spec = createModuleJobSpec(input)
      expect(spec.requirements?.precision).toBe('mixed'); expect(spec.run.maxSteps).toBe(5)
      const progress: number[] = []
      const output = await computeModule(readModuleJobInput(JSON.parse(JSON.stringify(spec))), undefined, p => { progress.push(p.step) })
      if (output.module !== 'particles') throw new Error('wrong module')
      expect(progress).toEqual([0, 4])
      const sim = await particleRuntime.createParticleScene(scene, true)
      try {
        const initial = await sim.read()
        expect(initial.observables.potential).not.toBe(0)
        expect(initial.observables.totalCharge).toBe(3)
        const first = await particleRuntime.advanceParticleScene(sim, scene, 0)
        expect(first.steps).toBe(4)
        const last = await particleRuntime.advanceParticleScene(sim, scene, first.steps)
        expect(output.result).toEqual(particleResult(last.frame, last.steps))
        expect(last.frame.kind).toEqual(initial.kind); expect(last.frame.charge).toEqual(initial.charge)
        expect(output.result.pos).not.toEqual(Array.from(initial.pos))
      } finally { sim.destroy() }
      const wire = JSON.parse(JSON.stringify(wrap(output, 5)))
      expect(readModuleResult(wire, input)).toEqual(output)
      for (const change of [{ time: 1 }, { pos: [] }, { charge: Array(64).fill(0) }, { rdf: { ...output.result.rdf, g: [] } }, { observables: { ...output.result.observables, total: 0 } }, { observables: { ...output.result.observables, totalCharge: -1 } }]) {
        expect(() => readModuleResult({ ...wire, moduleResult: { module: 'particles', result: { ...output.result, ...change } } } as typeof wire, input)).toThrow()
      }
    }
  })

  it('accepts unrelated user species and coordinates without material-specific dispatch', async () => {
    const scene: ParticleScene = {
      species: [{ name: 'User alpha', count: 2, charge: 0.3, sigma: 0.6, epsilon: 0 }, { name: 'User beta', count: 1, charge: -0.6, sigma: 1.1, epsilon: 0 }],
      positions: [1, 1, 5, 3, 3, 5, 6, 6, 5], kind: [1, 0, 0], velocities: [0.2, 0, 0, 0, -0.1, 0, -0.2, 0.1, 0], boxL: 10, temperature: 0.4, thermostat: false,
      epsR: 12, lambdaD: 3, kCoulomb: 0, seed: 11, steps: 5,
    }
    const input = { module: 'particles' as const, scene }
    const first = await computeModule(input)
    const renamed = await computeModule({ ...input, scene: { ...scene, species: scene.species.map((s, i) => ({ ...s, name: 'Renamed ' + i })) } })
    expect(renamed).toEqual(first)
    if (first.module !== 'particles') throw new Error('wrong module')
    expect(first.result.kind).toEqual([1, 0, 0])
    expect(first.result.observables.potential).toBe(0)
    expect(first.result.observables.totalCharge).toBe(0)
    const sim = await particleRuntime.createParticleScene(scene, true)
    try { expect(Array.from((await sim.read()).pos)).toEqual(scene.positions) } finally { sim.destroy() }
    const expectedVelocity = Float32Array.from(scene.velocities!)
    const positions = Float32Array.from(scene.positions!)
    for (let step = 0; step < 5; step++) for (let i = 0; i < positions.length; i++) {
      positions[i] = positions[i] + expectedVelocity[i] * MD_DT
    }
    expect(first.result.pos).toEqual(Array.from(positions))
    expect(readModuleResult(JSON.parse(JSON.stringify(wrap(first, 5))), input)).toEqual(first)
    for (const species of [[], [{ ...scene.species[0], count: 1.5 }], [{ ...scene.species[0], sigma: -1 }], [scene.species[0], scene.species[0]]]) {
      expect(() => createModuleJobSpec({ ...input, scene: { ...scene, species } })).toThrow()
    }
    expect(() => createModuleJobSpec({ ...input, scene: { ...scene, positions: [1, 1, 5, 1, 1, 5, 6, 6, 5] } })).toThrow()
    for (const change of [{ kind: [0, 0, 0] }, { kind: [1, 0] }, { kind: [1, 0, 1.5] }, { kind: [1, 0, 2] }, { velocities: [] }, { velocities: [17, 0, 0, 0, 0, 0, 0, 0, 0] }, { velocities: [NaN, 0, 0, 0, 0, 0, 0, 0, 0] }]) {
      expect(() => createModuleJobSpec({ ...input, scene: { ...scene, ...change } })).toThrow()
    }
  })

  it('bounds charged work and releases the solver when cancelled between batches', async () => {
    for (const change of [{ species: [] }, { steps: 0 }, { ...pedotParticleScene(400), steps: 1678 }, { seed: -1 }, { temperature: Infinity }, { epsR: 0 }, { positions: [] }, { species: [{ name: 'A', count: 401, charge: 0, sigma: 1, epsilon: 1 }] }]) {
      expect(() => createModuleJobSpec({ module: 'particles', scene: { ...particleScene, ...change } } as ModuleComputeInput)).toThrow()
    }
    const sim = await particleRuntime.createParticleScene(particleScene, true), destroy = vi.spyOn(sim, 'destroy')
    const factory = vi.spyOn(particleRuntime, 'createParticleScene').mockResolvedValue(sim)
    const controller = new AbortController()
    try {
      await expect(computeModule({ module: 'particles', scene: particleScene }, controller.signal, p => { if (p.step === 4) controller.abort() })).rejects.toMatchObject({ name: 'AbortError' })
      expect(destroy).toHaveBeenCalledOnce()
    } finally { factory.mockRestore(); destroy.mockRestore() }
  })
})

describe('shared Rust/WASM kernels', () => {
  it('runs the shared three-dimensional wind tunnel and rejects unsupported physics', () => {
    const config = { nx: 5, ny: 4, nz: 3, tau: 0.8, uInlet: 0.04, smagorinskyCs: 0.12, turbulenceIntensity: 0, freeSlipWalls: true }
    const flags = new Uint8Array(60), solver = new WasmLbm(config, flags)
    for (let step = 0; step < 5; step++) {
      const stats = solver.step()
      expect(stats.step).toBe(step + 1)
      expect(stats.obstacleForce).toEqual([0, 0, 0])
      expect(Math.abs(stats.mass - 60)).toBeLessThan(1e-4)
      for (let cell = 0; cell < 60; cell++) {
        expect(Math.abs(solver.velocity[cell * 3] - 0.04)).toBeLessThan(3e-8)
        expect(Math.abs(solver.velocity[cell * 3 + 1])).toBeLessThan(3e-8)
        expect(Math.abs(solver.velocity[cell * 3 + 2])).toBeLessThan(3e-8)
      }
    }
    flags[30] = 2
    expect(() => new WasmLbm(config, flags)).toThrow()
    expect(() => new WasmLbm({ ...config, tau: 0.5 }, new Uint8Array(60))).toThrow()
    expect(() => new WasmLbm({ ...config, nx: 1000000000 }, new Uint8Array(60))).toThrow()
  })
  it('ships the current ABI and W-Sim source, and preserves wave arithmetic, walls and masks', () => {
    const wsimDist = dirname(createRequire(import.meta.url).resolve('@w-sim/solvers-lbm/d3q19'))
    const wasmArtifact = join(wsimDist, 'wasm-kernel.js')
    const kernelChecker = resolve(import.meta.dirname, '../../../vendor/w-sim-kernels/wasm/build-kernels.mjs')
    execFileSync(process.execPath, [kernelChecker, '--target', wasmArtifact, '--check'])
    expect(readFileSync(wasmArtifact, 'utf8')).toContain(WASM_KERNEL_SOURCE_SHA256)
    for (const n of [8, 23]) for (const damp of [0.98, 1]) {
      const wasm = new Wave(n, { damp })
      const mask = new Uint8Array(n * n); mask[3 + 3 * n] = 1
      wasm.setObstacle(mask); wasm.poke(1, 1, 2, -2); wasm.poke(4, 4, 2, 3)
      let current = wasm.u.slice(), previous = wasm.uPrev.slice()
      for (let step = 0; step < 5; step++) {
        // Independent test-only scalar reference; no second production solver.
        const next = new Float32Array(n * n)
        for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
          const k = x + y * n
          const lap = current[k - 1] + current[k + 1] + current[k - n] + current[k + n] - 4 * current[k]
          next[k] = mask[k] ? 0 : (2 * current[k] - previous[k] + 0.25 * lap) * damp
        }
        previous = current; current = next
        // External replacement copies into owned memory and keeps using WASM.
        wasm.u = wasm.u.slice(); wasm.uPrev = wasm.uPrev.slice()
        wasm.step()
        expect(wasm.engine).toBe('wasm')
        expect(wasm.u).toEqual(current); expect(wasm.uPrev).toEqual(previous)
      }
    }
  })
  it('reports unavailable WASM and rejects unstable coefficients or malformed fields', () => {
    const original = WebAssembly
    for (const value of [undefined, { ...original, Module: function () { throw new Error('CSP blocked compilation') } }]) {
      vi.stubGlobal('WebAssembly', value)
      try { expect(() => new Wave(8)).toThrow(/WASM/) } finally { vi.unstubAllGlobals() }
    }
    const wave = new Wave(8, { a: 0.51 })
    expect(() => wave.step()).toThrow(/invalid coefficient/)
    expect(() => { wave.u = new Float32Array(3) }).toThrow(/length/)
    expect(() => wave.setObstacle(new Uint8Array(3))).toThrow(/length/)
    wave.a = 0.25; wave.u[20] = NaN
    expect(() => wave.step()).toThrow(/non-finite/)
  })
})

describe('LAMMPS data interoperability', () => {
  const data = readFileSync(new URL('../../../public/datasets/lammps-lj-2d.data', import.meta.url), 'utf8')
  const reference = JSON.parse(readFileSync(new URL('../../../public/datasets/lammps-lj-2d-reference.json', import.meta.url), 'utf8'))
  it('continues a downloaded official example for five steps against real LAMMPS output', async () => {
    const scene = parseLammpsData(data), input = { module: 'particles' as const, scene }
    // Check the CI budget before executing if importer defaults ever change.
    expect(scene.steps).toBe(5); expect(scene.kind).toHaveLength(32)
    const spec = JSON.parse(JSON.stringify(createModuleJobSpec(input)))
    expect(spec.run.maxSteps).toBe(5)
    expect(readModuleJobInput(spec)).toEqual(input)
    const output = await computeModule(readModuleJobInput(spec))
    if (output.module !== 'particles') throw new Error('wrong module')
    expect(output.result.steps).toBe(5); expect(output.result.kind).toHaveLength(32)
    const delta = (values: number[], expected: number[]) => Math.max(...values.map((v, i) => Math.abs(v - expected[i])))
    expect(delta(output.result.pos, reference.positions)).toBeLessThan(2e-6)
    expect(delta(output.result.speed, reference.speeds)).toBeLessThan(2e-6)
    for (const key of ['potential', 'kinetic', 'total', 'temperature', 'pressure'] as const) {
      expect(Math.abs(output.result.observables[key] - reference[key])).toBeLessThan(1e-5)
    }
    const wire = JSON.parse(JSON.stringify({ schemaVersion: 1, summary: { steps: 5, wallTimeMs: 1 }, moduleResult: output }))
    expect(readModuleResult(wire, input)).toEqual(output)
  })
  it('handles whitespace and absent velocities without inventing thermal motion', () => {
    const scene = parseLammpsData(data.replace('32 atoms', '32   atoms').split('Velocities')[0])
    expect(scene.velocities?.every(v => v === 0)).toBe(true)
    expect(scene.kind?.every(v => v === 0)).toBe(true)
  })
  it('rejects unsupported physics, ambiguous sections and malformed or oversized data', () => {
    for (const invalid of [
      data.replace('units = lj', 'units = real'), data.replace('Atoms # atomic', 'Atoms # full'),
      data.replace('Pair Coeffs # lj/cut', 'Pair Coeffs # buck'), data.replace('1 1 1\n', '1 1 1 3\n'),
      data.replace('1 1\n', '1 2\n'), data.replace('1 atom types', '1 atom types\n1 bonds'),
      data.replace('Masses', '0.1 0 0 xy xz yz\n\nMasses'),
      data.replace('0.0473845635118472 0 0 0 0', '0.0473845635118472 1 0 0 0'),
      data.replace('32 atoms', '33 atoms'), data.replace('1 atom types', '1 atom types\n1 atom types'),
      data + '\ninclude another.input\n', 'x'.repeat(LAMMPS_DATA_MAX_BYTES + 1),
    ]) expect(() => parseLammpsData(invalid)).toThrow()
  })
})

describe('external software reference snapshots', () => {
  const reference = JSON.parse(readFileSync(new URL('../../../public/datasets/software-hello-reference.json', import.meta.url), 'utf8'))
  const near = (actual: number[], expected: number[], tolerance: number) => {
    expect(actual).toHaveLength(expected.length)
    expect(Math.max(...actual.map((v, i) => Math.abs(v - expected[i])))).toBeLessThan(tolerance)
  }
  const transported = async (input: ModuleComputeInput) => {
    const spec = JSON.parse(JSON.stringify(createModuleJobSpec(input)))
    const result = await computeModule(readModuleJobInput(spec))
    return readModuleResult(JSON.parse(JSON.stringify({ schemaVersion: 1,
      summary: { steps: spec.run.maxSteps, wallTimeMs: 1 }, moduleResult: result })), input)
  }
  it('matches ASE for five NVE steps of the same imported atomic state', async () => {
    const data = readFileSync(new URL('../../../public/datasets/lammps-lj-2d.data', import.meta.url), 'utf8')
    expect(createHash('sha256').update(data).digest('hex')).toBe(reference.ase.inputSha256)
    const scene = parseLammpsData(data)
    expect(scene.steps).toBe(5); expect(scene.kind).toHaveLength(32)
    const output = await transported({ module: 'particles', scene })
    if (output.module !== 'particles') throw new Error('wrong module')
    expect(output.result.steps).toBe(reference.ase.steps)
    near(output.result.pos, reference.ase.positions, 2e-6)
    near(output.result.speed, reference.ase.speeds, 2e-6)
    for (const key of ['potential', 'kinetic', 'total'] as const) {
      expect(Math.abs(output.result.observables[key] - reference.ase[key])).toBeLessThan(1e-5)
    }
  })
  it('matches FiPy diffusion after three steps including an insulated corner', async () => {
    const output = await transported(reference.fipy.input)
    if (output.module !== 'sim') throw new Error('wrong module')
    const expected = Array<number>(reference.fipy.width * reference.fipy.height).fill(0)
    for (const [index, value] of reference.fipy.nonzero) expected[index] = value
    expect(output.result.steps).toBe(3)
    near(output.result.field, expected, 1e-6)
    expect(Math.abs(output.result.total - reference.fipy.total)).toBeLessThan(1e-6)
    expect(Math.abs(output.result.peak - reference.fipy.peak)).toBeLessThan(1e-6)
  })
  it('matches ngspice RC charging, discharging and RL current curves in SI units', async () => {
    expect(reference.ngspice.cases.map((c: { input: { scene: { mode: string } } }) => c.input.scene.mode)).toEqual(['rc-charge', 'rc-discharge', 'rl'])
    for (const example of reference.ngspice.cases) {
      const output = await transported(example.input)
      if (output.module !== 'transient') throw new Error('wrong module')
      near(output.result.values, example.values, output.result.unit === 'A' ? 1e-9 : 1e-6)
    }
  })
  it('imports the uniformly sampled ngspice CSV through the existing replay and backend path', async () => {
    const recording = parseSignalCsv(readFileSync(new URL('../../../public/datasets/ngspice-rc-charge.csv', import.meta.url), 'utf8'))
    expect(recording.sampleRate).toBe(480); expect(recording.unit).toBe('V')
    expect(recording.name).toContain('(simulated)')
    expect(recording.channels[0].values).toEqual(reference.ngspice.cases[0].values)
    const output = await transported({ module: 'ecg', scene: { recording, channel: 0 } })
    if (output.module !== 'ecg') throw new Error('wrong module')
    expect(output.result.source).toBe('recording'); expect(output.result.unit).toBe('V')
    expect(output.result.values).toEqual(recording.channels[0].values)
  })
})

describe('fluid module integration', () => {
  const scene: FluidScene = { viscosity: 0.00005, diffusion: 0.00001, rotation: 0.02, decay: 0.995, steps: 3,
    seeds: [{ x: 1, y: 1, radius: 2, density: 40, vx: 0.5, vy: -0.2 }] }
  const wrap = (output: Awaited<ReturnType<typeof computeModule>>, steps: number) => ({ schemaVersion: 1 as const, summary: { steps, wallTimeMs: 1 }, moduleResult: output })
  it('transports the full initial scene and matches local CPU fields and statistics', async () => {
    const input = { module: 'fluid' as const, scene }, spec = createModuleJobSpec(input)
    expect(spec.run.maxSteps).toBe(3); expect(spec.requirements?.precision).toBe('mixed')
    const output = await computeModule(readModuleJobInput(JSON.parse(JSON.stringify(spec))))
    if (output.module !== 'fluid') throw new Error('wrong module')
    const fluid = createFluidScene(scene)
    expect(fluid.dens[0]).toBe(0); expect(fluid.dens[FLUID_N + 1]).toBe(40)
    for (let i = 0; i < 3; i++) stepFluidScene(fluid, scene)
    expect(output.result).toEqual(fluidResult(fluid, 3))
    expect(output.result.density.some(v => v > 0)).toBe(true)
    expect(output.result.time).toBe(3 * FLUID_DT)
    expect(readModuleResult(JSON.parse(JSON.stringify(wrap(output, 3))), input)).toEqual(output)
    for (const change of [{ nx: 1 }, { dt: 1 }, { time: 1 }, { density: [] }, { meanDensity: -1 }, { gridDivergence: -1 }, { vx: output.result.vx.map((v, i) => i === 0 ? NaN : v) }]) {
      expect(() => readModuleResult(wrap({ module: 'fluid', result: { ...output.result, ...change } }, 3), input)).toThrow()
    }
  })
  it('applies the same per-step dye retention for still and empty initial scenes', async () => {
    const still: FluidScene = { ...scene, rotation: 0, viscosity: 0, diffusion: 0, decay: 0.9,
      seeds: [{ x: 50, y: 50, radius: 1, density: 10, vx: 0, vy: 0 }] }
    const output = await computeModule({ module: 'fluid', scene: still })
    if (output.module !== 'fluid') throw new Error('wrong module')
    const dye = Math.fround(Math.fround(Math.fround(10 * 0.9) * 0.9) * 0.9)
    expect(output.result.peakDensity).toBe(dye)
    expect(output.result.meanDensity).toBe(5 * dye / (FLUID_N * FLUID_N))
    expect(output.result.maxSpeed).toBe(0); expect(output.result.gridDivergence).toBe(0)
    const empty = await computeModule({ module: 'fluid', scene: { ...still, seeds: [] } })
    if (empty.module !== 'fluid') throw new Error('wrong module')
    expect(empty.result.peakDensity).toBe(0); expect(empty.result.meanDensity).toBe(0)
  })
  it('preserves uniform open flow and advects an interior dye pulse at its prescribed speed', async () => {
    const channel: FluidScene = { ...scene, viscosity: 0, diffusion: 0, rotation: 0, decay: 1,
      inlet: { speed: 0.25, density: 0, spacing: 10, width: 2 },
      seeds: [{ x: 20, y: 50, radius: 1, density: 10, vx: 0, vy: 0 }] }
    const output = await computeModule({ module: 'fluid', scene: channel })
    if (output.module !== 'fluid') throw new Error('wrong module')
    expect(output.result.vx.every(v => v === 0.25)).toBe(true)
    expect(output.result.vy.every(v => v === 0)).toBe(true)
    expect(output.result.gridDivergence).toBe(0)
    const mass = output.result.density.reduce((sum, v) => sum + v, 0)
    const moment = output.result.density.reduce((sum, v, i) => sum + v * (i % FLUID_N), 0)
    expect(mass).toBeCloseTo(50, 4)
    expect(moment / mass).toBeCloseTo(20 + 3 * FLUID_DT * (FLUID_N - 2) * 0.25, 5)
  })
  it('transports user geometry and a continuous inlet, rejecting altered solid results', async () => {
    const obstacle = Array<number>(FLUID_N * FLUID_N).fill(0)
    for (const i of [5030, 5031, 5130]) obstacle[i] = 1 // User L shape, not a solver-specific cylinder.
    const input = { module: 'fluid' as const, scene: { ...scene, rotation: 0, seeds: [], obstacle,
      inlet: { speed: 0.3, density: 2, spacing: 10, width: 2 } } }
    const spec = JSON.parse(JSON.stringify(createModuleJobSpec(input)))
    expect(readModuleJobInput(spec)).toEqual(input)
    const output = await computeModule(readModuleJobInput(spec))
    if (output.module !== 'fluid') throw new Error('wrong module')
    expect(output.result.solid).toEqual(obstacle)
    expect(output.result.density[5006]).toBeGreaterThan(0)
    for (const i of [5030, 5031, 5130]) {
      expect(output.result.vx[i]).toBe(0); expect(output.result.vy[i]).toBe(0); expect(output.result.density[i]).toBe(0)
    }
    // JSON canonicalizes signed zero; compare the actual wire representation.
    expect(readModuleResult(JSON.parse(JSON.stringify(wrap(output, 3))), input)).toEqual(JSON.parse(JSON.stringify(output)))
    for (const change of [{ solid: undefined }, { solid: obstacle.map(() => 0) }, { vx: output.result.vx.map((v, i) => i === 5030 ? 1 : v) }]) {
      expect(() => readModuleResult(wrap({ module: 'fluid', result: { ...output.result, ...change } }, 3), input)).toThrow()
    }
    expect(input.scene.obstacle).toEqual(spec.model.inline.scene.obstacle)
  })
  it('bounds inputs and observes cancellation before the next solver chunk', async () => {
    const input = { module: 'fluid' as const, scene }
    for (const change of [{ steps: 0 }, { steps: 2001 }, { steps: 1.5 }, { viscosity: -1 }, { diffusion: Infinity }, { rotation: 1 }, { decay: 1.1 }, { seeds: Array(65).fill(scene.seeds[0]) }, { seeds: [{ ...scene.seeds[0], x: 0 }] }, { seeds: [{ ...scene.seeds[0], density: -1 }] }]) {
      expect(() => createModuleJobSpec({ ...input, scene: { ...scene, ...change } })).toThrow()
    }
    for (const inlet of [null, {}, { speed: -1, density: 1, spacing: 10, width: 2 }, { speed: 0.3, density: 101, spacing: 10, width: 2 }, { speed: 0.3, density: 1, spacing: 1.5, width: 1 }, { speed: 0.3, density: 1, spacing: 2, width: 3 }]) {
      expect(() => validateModuleInput({ ...input, scene: { ...scene, inlet } })).toThrow()
    }
    for (const obstacle of [null, [], Array(10001).fill(0), Array(10000).fill(2), Array(10000).fill(1)]) {
      expect(() => validateModuleInput({ ...input, scene: { ...scene, obstacle } })).toThrow()
    }
    await expect(computeModule(input, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
    const controller = new AbortController(), progress: number[] = []
    await expect(computeModule({ ...input, scene: { ...scene, steps: 5 } }, controller.signal, p => {
      progress.push(p.step); if (p.step === 4) controller.abort()
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(progress).toEqual([0, 4])
  })
})

describe('ripple and convection backend scenes', () => {
  const ripple: RippleScene = { damping: 0.997, steps: 3, seeds: [{ x: 90, y: 90, radius: 1, amount: 2 }, { x: 1, y: 1, radius: 2, amount: -1 }] }
  const convection: ConvectionScene = { buoyancy: 0.07, steps: 3, initialDrop: true, seeds: [{ x: 55, y: 65, hot: false }] }
  const wrap = (output: Awaited<ReturnType<typeof computeModule>>, steps: number) => ({ schemaVersion: 1 as const, summary: { steps, wallTimeMs: 1 }, moduleResult: output })

  it('transports exact finite wave pulses, fixed walls and measured displacement norms', async () => {
    const input = { module: 'ripple' as const, scene: ripple }, spec = createModuleJobSpec(input)
    expect(spec.requirements?.precision).toBe('mixed')
    const output = await computeModule(readModuleJobInput(JSON.parse(JSON.stringify(spec))))
    if (output.module !== 'ripple') throw new Error('wrong module')
    const wave = createRippleScene(ripple), n = RIPPLE_N
    expect(wave.u).toEqual(wave.uPrev)
    let current = wave.u.slice(), previous = wave.uPrev.slice()
    for (let step = 0; step < 3; step++) {
      const next = new Float32Array(n * n)
      for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
        const k = x + y * n
        next[k] = (2 * current[k] - previous[k] + 0.25 * (current[k-1] + current[k+1] + current[k-n] + current[k+n] - 4 * current[k])) * ripple.damping
      }
      previous = current; current = next
    }
    expect(output.result.field).toEqual(Array.from(current))
    expect(output.result.peak).toBe(Math.max(...current.map(Math.abs)))
    expect(output.result.rms).toBeCloseTo(Math.sqrt(Array.from(current).reduce((sum, v) => sum + v*v, 0) / (n*n)), 12)
    expect(readModuleResult(JSON.parse(JSON.stringify(wrap(output, 3))), input)).toEqual(output)
    expect(defaultRippleSeeds()).toHaveLength(2)
  })

  it('retains the thermal initial condition and applies cooling every integration step', async () => {
    const input = { module: 'convection' as const, scene: convection }
    const output = await computeModule(readModuleJobInput(createModuleJobSpec(input)))
    if (output.module !== 'convection') throw new Error('wrong module')
    const f = new Fluid(CONVECTION_N, { dt: CONVECTION_DT, iter: 14, thermal: true, buoyancy: 0.07, ambient: 0 })
    for (let y = 8; y < 14; y++) for (let x = 52; x <= 58; x++) { f.addTemp(x, y, 90); f.addVelocity(x, y, 0, 0.6) }
    for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) if (i*i+j*j <= 9) {
      f.addTemp(55+i, 65+j, -90); f.addVelocity(55+i, 65+j, 0, -0.2)
    }
    expect(createConvectionScene(convection).temp).toEqual(f.temp)
    for (let step = 0; step < 3; step++) {
      f.step()
      for (let i = 0; i < f.temp.length; i++) f.temp[i] *= 0.997
    }
    expect(CONVECTION_COOLING).toBe(0.997)
    expect(output.result.temperature).toEqual(Array.from(f.temp))
    expect(output.result.vx).toEqual(Array.from(f.vx)); expect(output.result.vy).toEqual(Array.from(f.vy))
    expect(output.result.time).toBe(3 * CONVECTION_DT)
    const grouped = createConvectionScene(convection)
    for (const count of [1, 2]) for (let i = 0; i < count; i++) stepConvectionScene(grouped)
    expect(convectionResult(grouped, 3)).toEqual(output.result)
    expect(readModuleResult(JSON.parse(JSON.stringify(wrap(output, 3))), input)).toEqual(output)
  })

  it('handles empty scenes and clips thermal deposits away from boundary ghost cells', async () => {
    const f = createConvectionScene({ ...convection, initialDrop: false, seeds: [{ x: 1, y: 1, hot: true }] })
    expect(f.temp[0]).toBe(0); expect(f.temp[1]).toBe(0); expect(f.temp[CONVECTION_N]).toBe(0)
    expect(f.temp[1 + CONVECTION_N]).toBe(90)
    const vy = f.vy[1 + CONVECTION_N]; f.applyBuoyancy()
    expect(f.vy[1 + CONVECTION_N]).toBeLessThan(vy)
    const output = await computeModule({ module: 'convection', scene: { ...convection, steps: 1, initialDrop: false, seeds: [] } })
    if (output.module !== 'convection') throw new Error('wrong module')
    expect(output.result.temperature.every(t => t === 0)).toBe(true)
    expect(output.result.maxSpeed).toBe(0); expect(output.result.gridDivergence).toBe(0)
    const still = await computeModule({ module: 'ripple', scene: { ...ripple, steps: 1, seeds: [] } })
    if (still.module !== 'ripple') throw new Error('wrong module')
    expect(still.result.peak).toBe(0); expect(still.result.rms).toBe(0)
  })

  it('rejects invalid workloads and mismatched fields, and cancels before the next thermal step', async () => {
    for (const input of [
      { module: 'ripple', scene: { ...ripple, damping: 1.1 } },
      { module: 'ripple', scene: { ...ripple, seeds: [{ x: 0, y: 1, radius: 2, amount: 1 }] } },
      { module: 'ripple', scene: { ...ripple, seeds: Array(65).fill(ripple.seeds[0]) } },
      { module: 'convection', scene: { ...convection, buoyancy: -0.1 } },
      { module: 'convection', scene: { ...convection, steps: 2001 } },
      { module: 'convection', scene: { ...convection, seeds: [{ x: 10, y: 10, hot: 1 }] } },
    ]) expect(() => createModuleJobSpec(input as ModuleComputeInput)).toThrow()
    const input = { module: 'convection' as const, scene: convection }, output = await computeModule(input)
    if (output.module !== 'convection') throw new Error('wrong module')
    for (const data of [{ ...output.result, time: 0 }, { ...output.result, vx: [] }, { ...output.result, maxSpeed: output.result.maxSpeed + 1 }]) {
      expect(() => readModuleResult(wrap({ module: 'convection', result: data }, 3), input)).toThrow()
    }
    const rippleInput = { module: 'ripple' as const, scene: ripple }, wave = await computeModule(rippleInput)
    if (wave.module !== 'ripple') throw new Error('wrong module')
    wave.result.field[0] = 1
    expect(() => readModuleResult(wrap(wave, 3), rippleInput)).toThrow(/boundary/)
    const controller = new AbortController(), step = vi.spyOn(Fluid.prototype, 'advance')
    try {
      await expect(computeModule(input, controller.signal, async p => {
        if (p.step === 1) { await Promise.resolve(); controller.abort() }
      })).rejects.toMatchObject({ name: 'AbortError' })
      expect(step).toHaveBeenCalledTimes(1)
    } finally { step.mockRestore() }
  })
})

describe('module execution checkpoints', () => {
  const input: ModuleComputeInput = { module: 'ising', scene: { size: 16, temperatures: [2], seed: 7, hot: true, burnIn: 0, samples: 17 } }

  it('reports completed chunks without changing seeded results', async () => {
    const progress: number[] = []
    const output = await computeModule(input, undefined, async p => {
      await Promise.resolve()
      expect(p.total).toBe(17)
      progress.push(p.step)
    })
    expect(progress).toEqual([0, 8, 16])
    expect(output).toEqual(await computeModule(input))
  })

  it('awaits cancellation or failed progress before executing the next chunk', async () => {
    const abort = new AbortController(), progress: number[] = []
    await expect(computeModule(input, abort.signal, async p => {
      progress.push(p.step)
      if (p.step === 8) {
        await Promise.resolve()
        abort.abort()
      }
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(progress).toEqual([0, 8])
    const unavailable = new Error('lease renewal failed')
    await expect(computeModule(input, undefined, async p => {
      if (p.step === 8) throw unavailable
    })).rejects.toBe(unavailable)
  })
})

describe('Ising and vibration scene adapters', () => {
  const ising: IsingScene = { size: 16, temperatures: [0.8, 3.6], seed: 7, hot: true, burnIn: 1, samples: 2 }
  const vibration: VibrationScene = { mass: 1, stiffness: 100, damping: 1, driveFrequency: 1.5, steps: 5 }
  const wrap = (output: Awaited<ReturnType<typeof computeModule>>, steps: number) => ({ schemaVersion: 1 as const, summary: { steps, wallTimeMs: 1 }, moduleResult: output })

  it('keeps seeded Ising sweeps and signed fluctuation statistics independent of display grouping', async () => {
    const input = { module: 'ising' as const, scene: ising }, spec = createModuleJobSpec(input)
    expect(spec.run.maxSteps).toBe(6)
    expect(spec.requirements?.precision).toBe('float64')
    const output = await computeModule(readModuleJobInput(JSON.parse(JSON.stringify(spec))))
    if (output.module !== 'ising') throw new Error('wrong module')
    const st = initIsing(16, ising.temperatures[0], ising.seed, true)
    for (let i = 0; i < ising.temperatures.length; i++) {
      st.T = ising.temperatures[i]
      metropolisSweep(st) // discarded burn-in, not a sample
      const m: number[] = [], e: number[] = []
      for (let j = 0; j < 2; j++) {
        metropolisSweep(st)
        m.push(st.spins.reduce((sum, spin) => sum + spin, 0) / st.N)
        e.push(energyPerSpin(st))
      }
      const point = output.result.points[i]
      expect(point.samples).toBe(2)
      expect(point.meanM).toBe((m[0] + m[1]) / 2)
      expect(point.meanAbsM).toBe((Math.abs(m[0]) + Math.abs(m[1])) / 2)
      expect(point.susceptibility).toBeCloseTo(st.N * ((m[0] - m[1]) ** 2 / 4) / st.T, 12)
      expect(point.specificHeat).toBeCloseTo(st.N * ((e[0] - e[1]) ** 2 / 4) / st.T ** 2, 12)
    }
    expect(output.result.spins).toEqual(Array.from(st.spins))
    const run = createIsingScene(ising)
    for (const group of [1, 3, 2]) for (let i = 0; i < group; i++) stepIsingScene(run, ising)
    expect(isingResult(run)).toEqual(output.result)
    expect(() => stepIsingScene(run, ising)).toThrow(/complete/)
    expect(readModuleResult(JSON.parse(JSON.stringify(wrap(output, 6))), input)).toEqual(output)
  })

  it('retains both Ising starts and does not invent fluctuation estimates with one sample', async () => {
    for (const hot of [false, true]) {
      const scene = { ...ising, temperatures: [2], burnIn: 0, samples: 1, hot }
      const run = createIsingScene(scene)
      expect(isingResult(run).current.meanAbsM).toBeNull()
      if (hot) expect(new Set(run.state.spins).size).toBe(2)
      else expect(new Set(run.state.spins)).toEqual(new Set([1]))
      stepIsingScene(run, scene)
      const output = { module: 'ising' as const, result: isingResult(run) }
      expect(output.result.current.susceptibility).toBeNull()
      expect(output.result.current.specificHeat).toBeNull()
      expect(readModuleResult(JSON.parse(JSON.stringify(wrap(output, 1))), { module: 'ising', scene })).toEqual(output)
    }
  })

  it('returns the complete vibration RK4 trajectory and analytic forced amplitude', async () => {
    const input = { module: 'vibration' as const, scene: vibration }
    const spec = createModuleJobSpec(input), output = await computeModule(readModuleJobInput(spec))
    if (output.module !== 'vibration') throw new Error('wrong module')
    expect(spec.requirements?.precision).toBe('float64')
    const params = { mass: 1, stiffness: 100, damping: 1, driveAmp: 1, driveOmega: 3 * Math.PI }
    let state = { x: 0, v: 0 }
    expect(output.result.states[0]).toEqual(state)
    for (let i = 0; i < vibration.steps; i++) {
      state = forcedOscillatorStep(state, params, i * VIBRATION_DT, VIBRATION_DT)
      expect(output.result.states[i + 1]).toEqual(state)
    }
    expect(output.result.time).toBe(5 / 240)
    expect(output.result.omega0).toBe(10)
    expect(output.result.amplitude).toBe(forcedOscillatorAmplitude(params))
    expect(output.result.resonance.amplitude).toHaveLength(80)
    output.result.resonance.omega.forEach((omega, i) => expect(output.result.resonance.amplitude[i]).toBe(forcedOscillatorAmplitude(params, omega)))
    expect(Math.abs(state.x)).toBeLessThan(output.result.amplitude)
    expect(readModuleResult(JSON.parse(JSON.stringify(wrap(output, 5))), input)).toEqual(output)
  })

  it('bounds Ising scan work and checks output dimensions, sample counts and time', async () => {
    for (const change of [{ temperatures: [] }, { temperatures: [0] }, { samples: 0 }, { burnIn: 0.5 }, { samples: 1000, burnIn: 1000 }, { size: 257 }, { seed: NaN }]) {
      expect(() => createModuleJobSpec({ module: 'ising', scene: { ...ising, ...change } })).toThrow()
    }
    for (const change of [{ mass: 0 }, { damping: 0 }, { stiffness: 401 }, { driveFrequency: NaN }, { steps: 2.5 }]) {
      expect(() => createModuleJobSpec({ module: 'vibration', scene: { ...vibration, ...change } })).toThrow()
    }
    const inputs: ModuleComputeInput[] = [{ module: 'ising', scene: ising }, { module: 'vibration', scene: vibration }]
    for (const input of inputs) {
      const output = await computeModule(input), result = wrap(output, moduleComputeSteps(input))
      if (output.module === 'ising') output.result.current.samples++
      else if (output.module === 'vibration') output.result.time += 1
      expect(() => readModuleResult(result, input)).toThrow()
      const broken = await computeModule(input)
      if (broken.module === 'ising') broken.result.spins[0] = 0
      else if (broken.module === 'vibration') broken.result.states.pop()
      expect(() => readModuleResult(wrap(broken, moduleComputeSteps(input)), input)).toThrow()
      if (input.module === 'ising') {
        const wrongEnergy = await computeModule(input)
        if (wrongEnergy.module === 'ising') wrongEnergy.result.energy += 0.125
        expect(() => readModuleResult(wrap(wrongEnergy, moduleComputeSteps(input)), input)).toThrow(/energy/)
      }
    }
    const abort = new AbortController()
    setTimeout(() => abort.abort(), 0)
    await expect(computeModule({ module: 'ising', scene: { ...ising, temperatures: [2], samples: 1000, burnIn: 1000 } }, abort.signal)).rejects.toThrow()
    expect(isingSceneSteps(ising)).toBe(6)
  })
})

describe('MD scene integration', () => {
  const scene: MdScene = { N: 64, temperature: 0.4, thermostat: true, barostat: false, targetP: 0.5, tauP: 0.5, steps: 5, seed: 7 }
  const wrap = (output: Awaited<ReturnType<typeof computeModule>>, steps = scene.steps) => ({ schemaVersion: 1 as const, summary: { steps, wallTimeMs: 1 }, moduleResult: output })

  it('transports seeded particles and actual times using the same 4+1 thermostat cadence', async () => {
    const input = { module: 'md' as const, scene }, spec = createModuleJobSpec(input)
    expect(spec.requirements?.precision).toBe('mixed')
    expect(spec.run.maxSteps).toBe(5)
    const output = await computeModule(readModuleJobInput(JSON.parse(JSON.stringify(spec))))
    if (output.module !== 'md') throw new Error('wrong module')
    const sim = await mdRuntime.createMdScene(scene, true)
    try {
      await sim.step(4); await sim.step(1)
      const frame = await sim.read()
      expect(output.result.pos).toEqual(Array.from(frame.pos))
      expect(output.result.speed).toEqual(Array.from(frame.speed))
      expect(output.result.observables).toEqual(frame.observables)
    } finally { sim.destroy() }
    expect(output.result.history.map(p => [p.step, p.time])).toEqual([[0, 0], [4, 0.02], [5, 0.025]])
    expect(output.result.diffusion).toBeNull()
    expect(readModuleResult(JSON.parse(JSON.stringify(wrap(output))), input)).toEqual(output)
    expect(await computeModule({ module: 'md', scene: { ...scene, seed: 8 } })).not.toEqual(output)
  })

  it('keeps thermostat-off integration identical to the existing Verlet core', async () => {
    const st = initLattice(scene.N, mdBoxLength(scene.N), 3, scene.temperature, scene.seed)
    const initialEnergy = st.potential + st.vel.reduce((sum, v) => sum + v * v / 2, 0)
    for (let i = 0; i < scene.steps; i++) velocityVerlet(st, MD_DT)
    const output = await computeModule({ module: 'md', scene: { ...scene, thermostat: false } })
    if (output.module !== 'md') throw new Error('wrong module')
    expect(output.result.pos).toEqual(Array.from(st.pos))
    expect(output.result.observables.potential).toBe(st.potential)
    expect(Math.abs(output.result.observables.total - initialEnergy) / Math.abs(initialEnergy)).toBeLessThan(0.001)
  })

  it('uses the current box for RDF and suppresses affine-box diffusion estimates', async () => {
    for (const barostat of [false, true]) {
      const input = { module: 'md' as const, scene: { ...scene, steps: 10, barostat } }
      const output = await computeModule(input)
      if (output.module !== 'md') throw new Error('wrong module')
      const r = output.result
      expect(r.history.map(p => p.time)).toEqual([0, 0.02, 0.04, 0.05])
      expect(r.rdf.r[0]).toBeCloseTo(r.observables.boxL / 240, 6)
      if (barostat) {
        expect(r.observables.boxL).not.toBe(mdBoxLength(scene.N))
        expect(r.diffusion).toBeNull()
      } else {
        expect(r.diffusion?.nFit).toBe(4)
        const meanT = r.history.reduce((s, p) => s + p.time, 0) / 4
        const meanMsd = r.history.reduce((s, p) => s + p.msd, 0) / 4
        const slope = r.history.reduce((s, p) => s + (p.time - meanT) * (p.msd - meanMsd), 0)
          / r.history.reduce((s, p) => s + (p.time - meanT) ** 2, 0)
        expect(r.diffusion?.D).toBeCloseTo(slope / 6, 12)
      }
      expect(readModuleResult(JSON.parse(JSON.stringify(wrap(output, 10))), input)).toEqual(output)
    }
  })

  it('rejects malformed positions, times, energies, RDF and unavailable fits', async () => {
    const input = { module: 'md' as const, scene }, output = await computeModule(input)
    if (output.module !== 'md') throw new Error('wrong module')
    const baseline = output.result
    const mutations: Array<(r: typeof baseline) => void> = [
      r => { r.pos.pop() }, r => { r.pos[0] = -1 }, r => { r.speed[0] = NaN },
      r => { r.history[1].time = 0.1 }, r => { r.history[0].msd = 1 },
      r => { r.observables.total += 10 }, r => { r.rdf.r[0] *= 2 },
      r => { r.diffusion = { D: 0, slope: 0, intercept: 0, r2: 1, nFit: 3 } },
    ]
    for (const mutate of mutations) {
      const altered = structuredClone(output)
      mutate(altered.result)
      expect(() => readModuleResult(wrap(altered), input)).toThrow()
    }
  })

  it('bounds work before allocation and releases the session on cancellation', async () => {
    for (const change of [{ steps: 0 }, { steps: 2.5 }, { N: 63 }, { N: 2048, steps: 65 }, { temperature: NaN }, { seed: -1 }, { tauP: 0 }, { targetP: 9 }]) {
      expect(() => createModuleJobSpec({ module: 'md', scene: { ...scene, ...change } })).toThrow()
    }
    expect(mdMaxSteps(2048)).toBe(64)
    const sim = await mdRuntime.createMdScene(scene, true)
    const destroyed = vi.spyOn(sim, 'destroy'), stepped = vi.spyOn(sim, 'step')
    const factory = vi.spyOn(mdRuntime, 'createMdScene').mockResolvedValue(sim)
    try {
      const abort = new AbortController()
      setTimeout(() => abort.abort(), 0)
      await expect(computeModule({ module: 'md', scene: { ...scene, steps: 2000 } }, abort.signal)).rejects.toThrow()
      expect(destroyed).toHaveBeenCalledOnce()
      expect(stepped).not.toHaveBeenCalled()
    } finally { factory.mockRestore(); sim.destroy() }
  })

  it.each(['md', 'particles'] as const)('submits one %s batch with one readback and protects cached frames', async module => {
    type Buffer = { data: ArrayBuffer; destroy(): void; mapAsync(): Promise<void>; getMappedRange(): ArrayBuffer; unmap(): void }
    type Command = (() => void)
    let submissions = 0, mappings = 0, destroyed = 0
    const dispatches: number[] = []
    let nextPipeline = 0
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_SRC: 2, COPY_DST: 4, UNIFORM: 8, MAP_READ: 16 })
    vi.stubGlobal('GPUMapMode', { READ: 1 })
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({ requestDevice: async () => ({
      createBuffer: ({ size }: { size: number }): Buffer => ({
        data: new ArrayBuffer(size), destroy() {},
        async mapAsync() { mappings++ }, getMappedRange() { return this.data }, unmap() {},
      }),
      queue: {
        writeBuffer(buffer: Buffer, offset: number, data: ArrayBufferView) {
          new Uint8Array(buffer.data, offset, data.byteLength).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
        },
        submit(batches: Command[][]) { submissions++; batches.flat().forEach(run => run()) },
      },
      createShaderModule: () => ({}), createBindGroup: () => ({}),
      createComputePipelineAsync: async () => ({ id: nextPipeline++, getBindGroupLayout() {} }),
      createCommandEncoder: () => {
        const commands: Command[] = []
        return {
          beginComputePass: () => {
            let pipeline = -1
            return {
              setPipeline: (p: { id: number }) => { pipeline = p.id }, setBindGroup() {},
              dispatchWorkgroups: () => { commands.push(() => { dispatches.push(pipeline) }) }, end() {},
            }
          },
          copyBufferToBuffer(src: Buffer, srcOffset: number, dst: Buffer, dstOffset: number, size: number) {
            commands.push(() => new Uint8Array(dst.data, dstOffset, size).set(new Uint8Array(src.data, srcOffset, size)))
          },
          finish: () => commands,
        }
      },
      destroy: () => { destroyed++ },
    }) }) } })
    try {
      const gpu = await (module === 'md' ? mdRuntime.createMdScene(scene) : particleRuntime.createParticleScene(particleScene))
      expect(gpu.backend).toBe('webgpu')
      expect(submissions).toBe(1) // initial force
      const initial = await gpu.read(), baseline = structuredClone(initial)
      expect(mappings).toBe(1); expect(submissions).toBe(2)
      initial.pos.fill(-1); initial.speed.fill(-1); initial.observables.temperature = -1
      expect(await gpu.read()).toEqual(baseline)
      expect(mappings).toBe(1)
      await gpu.step(4); await gpu.read()
      expect(submissions).toBe(3); expect(mappings).toBe(2)
      expect(dispatches).toEqual([0, 1, 0, 2, 1, 0, 2, 1, 0, 2, 1, 0, 2])
      await gpu.step(1); await gpu.read()
      expect(submissions).toBe(4); expect(mappings).toBe(3)
      await gpu.read()
      expect(mappings).toBe(3)
      gpu.destroy(); expect(destroyed).toBe(1)
    } finally { vi.unstubAllGlobals() }
  })

  it.each(['md', 'particles'] as const)('releases %s GPU resources on disposal and asynchronous pipeline failure', async module => {
    let destroyed = 0, failPipeline = false
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_SRC: 2, COPY_DST: 4, UNIFORM: 8, MAP_READ: 16 })
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({ requestDevice: async () => ({
      createBuffer: () => ({ destroy() {} }), queue: { writeBuffer() {}, submit() {} },
      createShaderModule: () => ({}), createBindGroup: () => ({}),
      createCommandEncoder: () => ({ beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }), finish() {} }),
      createComputePipelineAsync: async () => { if (failPipeline) throw new Error('pipeline failed'); return { getBindGroupLayout() {} } },
      destroy: () => { destroyed++ },
    }) }) } })
    try {
      const gpu = await (module === 'md' ? mdRuntime.createMdScene(scene) : particleRuntime.createParticleScene(particleScene))
      expect(gpu.backend).toBe('webgpu')
      gpu.destroy(); expect(destroyed).toBe(1)
      failPipeline = true
      const cpu = await (module === 'md' ? mdRuntime.createMdScene(scene) : particleRuntime.createParticleScene(particleScene))
      expect(cpu.backend).toBe('cpu'); expect(destroyed).toBe(2)
      await cpu.step(1)
      expect((await cpu.read()).observables.temperature).toBeGreaterThan(0)
      cpu.destroy()
    } finally { vi.unstubAllGlobals() }
  })
})

describe('thermal module scenes', () => {
  it('releases GPU devices on disposal and pipeline failure, then uses the same CPU deposits', async () => {
    let destroyed = 0, failPipeline = false
    vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_SRC: 2, COPY_DST: 4, UNIFORM: 8, MAP_READ: 16 })
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({ requestDevice: async () => ({
      createBuffer: () => ({ destroy() {} }), queue: { writeBuffer() {} },
      createShaderModule: () => ({}),
      createComputePipelineAsync: async () => { if (failPipeline) throw new Error('pipeline failed'); return {} },
      destroy: () => { destroyed++ },
    }) }) } })
    try {
      const gpu = await createHeatSim(3, 3)
      expect(gpu.backend).toBe('webgpu')
      gpu.seed(0, 0, 1, 1)
      const initial = Array.from(await gpu.field())
      expect(initial).toEqual([1, 1, 0, 1, 0, 0, 0, 0, 0])
      gpu.dispose()
      expect(destroyed).toBe(1)
      failPipeline = true
      const cpu = await createHeatSim(3, 3)
      expect(cpu.backend).toBe('cpu')
      expect(destroyed).toBe(2)
      cpu.seed(0, 0, 1, 1)
      expect(Array.from(await cpu.field())).toEqual(initial)
      await cpu.step(0.25, 1)
      expect(sum(await cpu.field())).toBe(3)
      cpu.dispose()
    } finally { vi.unstubAllGlobals() }
  })

  it('transports the exact CPU heat field, including a boundary deposit, and conserves its sum', async () => {
    const seeds = [...defaultHeatSeeds(), { x: 0, y: 0, radius: 2, amount: 100 }]
    const input = { module: 'sim' as const, scene: { r: 0.25, steps: 5, seeds } }
    const sim = await createHeatSim(HEAT_W, HEAT_H, { preferCpu: true })
    for (const s of seeds) sim.seed(s.x, s.y, s.radius, s.amount)
    const initial = sum(await sim.field())
    await sim.step(input.scene.r, input.scene.steps)
    const spec = createModuleJobSpec(input)
    expect(spec.requirements?.precision).toBe('mixed')
    const output = await computeModule(readModuleJobInput(JSON.parse(JSON.stringify(spec))))
    if (output.module !== 'sim') throw new Error('wrong module')
    expect(output.result.field).toEqual(Array.from(await sim.field()))
    expect(output.result.total).toBeCloseTo(initial, 3)
    expect(output.result.peak).toBeGreaterThan(0)
    const result = { schemaVersion: 1 as const, summary: { steps: 5, wallTimeMs: 1 }, moduleResult: output }
    expect(readModuleResult(JSON.parse(JSON.stringify(result)), input)).toEqual(output)
    output.result.field.pop()
    expect(() => readModuleResult(result, input)).toThrow(/length/)
    sim.dispose()
    const zero = await computeModule({ module: 'sim', scene: { r: 0.22, steps: 1, seeds: [] } })
    if (zero.module !== 'sim') throw new Error('wrong module')
    expect(zero.result.total).toBe(0)
    expect(zero.result.peak).toBe(0)
    const corner = new Float32Array(9)
    seedHeat2D(corner, 3, 3, { x: 0, y: 0, radius: 1, amount: 1 })
    expect(Array.from(corner)).toEqual([1, 1, 0, 1, 0, 0, 0, 0, 0])
  })

  it('retains the 1D fixed endpoints, time scale and actual sharp-step reference error', async () => {
    const input = { module: 'heaterfc' as const, scene: { kappa: 0.5, steps: 1 } }
    const h = initHeat1D(HEAT_1D_M, HEAT_1D_L, input.scene.kappa, HEAT_1D_X0)
    ftcsStep(h)
    const spec = createModuleJobSpec(input)
    expect(spec.requirements?.precision).toBe('mixed')
    const output = await computeModule(readModuleJobInput(spec))
    expect(output).toEqual({ module: 'heaterfc', result: heat1DResult(h, 1) })
    if (output.module !== 'heaterfc') throw new Error('wrong module')
    expect(output.result.temperatures[0]).toBe(1)
    expect(output.result.temperatures[HEAT_1D_M - 1]).toBe(0)
    expect(output.result.temperatures[100]).toBe(0.5)
    expect(output.result.maxError).toBeGreaterThan(0.01)
    const faster = await computeModule({ module: 'heaterfc', scene: { kappa: 1, steps: 1 } })
    if (faster.module !== 'heaterfc') throw new Error('wrong module')
    expect(faster.result.temperatures).toEqual(output.result.temperatures)
    expect(faster.result.time).toBe(output.result.time / 2)
    const result = { schemaVersion: 1 as const, summary: { steps: 1, wallTimeMs: 1 }, moduleResult: output }
    expect(readModuleResult(JSON.parse(JSON.stringify(result)), input)).toEqual(output)
    output.result.time += 1
    expect(() => readModuleResult(result, input)).toThrow(/time mismatch/)
  })

  it('rejects invalid heat workloads and interrupts either solver before a long run', async () => {
    const scene = { r: 0.22, steps: 5, seeds: defaultHeatSeeds() }
    for (const change of [{ r: 0.26 }, { steps: 0 }, { steps: 2001 }, { steps: 1.5 }, { seeds: [{ x: -1, y: 0, radius: 1, amount: 1 }] }, { seeds: [{ x: 1.5, y: 0, radius: 1, amount: 1 }] }, { seeds: [{ x: 0, y: 0, radius: 21, amount: 1 }] }, { seeds: Array(33).fill(scene.seeds[0]) }]) {
      expect(() => createModuleJobSpec({ module: 'sim', scene: { ...scene, ...change } })).toThrow()
    }
    expect(() => createModuleJobSpec({ module: 'heaterfc', scene: { kappa: 0, steps: 5 } })).toThrow()
    for (const input of [{ module: 'sim', scene: { ...scene, steps: 2000 } }, { module: 'heaterfc', scene: { kappa: 0.5, steps: 2000 } }] satisfies ModuleComputeInput[]) {
      const controller = new AbortController()
      const run = computeModule(input, controller.signal)
      controller.abort()
      await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    }
  })
})

describe('location and scanning snapshots', () => {
  it('replays the same nonnegative range measurements and separates bandwidth from noise', () => {
    const scene = { target: { x: 60, y: 60 }, noise: 25, seed: 7, bandwidth: 30 }
    const result = localizationResult(scene)
    expect(result.ranges.every(v => v >= 0)).toBe(true)
    expect(localizationResult(scene)).toEqual(result)
    expect(localizationResult({ ...scene, seed: 8 }).ranges).not.toEqual(result.ranges)
    const wider = localizationResult({ ...scene, bandwidth: 60 })
    expect(wider.ranges).toEqual(result.ranges)
    expect(wider.resolution).toBe(result.resolution / 2)
  })

  it('STM returns the selected mode, and AFM retains signed force/deflection', () => {
    for (const mode of ['height', 'current'] as const) {
      const r = stmScanResult({ mode, tipHeight: 0.28, setCurrent: 0.02 })
      r.gaps.forEach((gap, i) => {
        expect(tunnelCurrent(gap, 11.5, 1)).toBeCloseTo(r.currents[i], 12)
        expect(r.tipHeights[i] - r.surface[i]).toBe(gap)
      })
      if (mode === 'current') expect(new Set(r.currents)).toEqual(new Set([0.02]))
      else expect(new Set(r.currents).size).toBeGreaterThan(1)
    }
    const afm = afmScanResult({ base: 2.1, k: 6 })
    // 恒力模式：偏转被 PI 反馈锁定在设定值（排斥支），形貌跟踪真实表面
    expect(afm.forces.every(f => f > 0)).toBe(true)
    expect(afm.deflections.every(d => Math.abs(d - afm.setpoint) < 0.05)).toBe(true)
    expect(Math.max(...afm.errors.map(Math.abs))).toBeLessThan(0.05)
    expect(Math.max(...afm.topography.map((z, i) => Math.abs(z - afm.surface[i] - (afm.topography[0] - afm.surface[0]))))).toBeLessThan(0.05)
  })

  it('validates complete transported scans and fixed receiver measurements', async () => {
    const inputs: ModuleComputeInput[] = [
      { module: 'localization', scene: { target: { x: 300, y: 210 }, noise: 8, seed: 7, bandwidth: 30 } },
      { module: 'tdoa', scene: { source: { x: 0, y: 380 }, noise: 0, seed: 11 } },
      { module: 'stm', scene: { mode: 'current', tipHeight: 0.28, setCurrent: 0.02 } },
      { module: 'afm', scene: { base: 2.1, k: 6 } },
    ]
    for (const input of inputs) {
      const spec = createModuleJobSpec(input), output = await computeModule(readModuleJobInput(JSON.parse(JSON.stringify(spec))))
      const result = { schemaVersion: 1 as const, summary: { steps: 1, wallTimeMs: 1 }, moduleResult: output }
      expect(readModuleResult(JSON.parse(JSON.stringify(result)), input)).toEqual(output)
      if (output.module === 'stm' || output.module === 'afm') output.result.gaps.pop()
      else if (output.module === 'localization') output.result.ranges[0] = -1
      else if (output.module === 'tdoa') output.result.curves[0].pop()
      expect(() => readModuleResult(result, input)).toThrow()
    }
    expect(() => createModuleJobSpec({ module: 'localization', scene: { target: { x: 600, y: 210 }, noise: 0, seed: 7, bandwidth: 30 } })).toThrow()
    expect(() => createModuleJobSpec({ module: 'tdoa', scene: { source: { x: 0, y: 0 }, noise: 0, seed: 0.5 } })).toThrow()
    expect(() => createModuleJobSpec({ module: 'stm', scene: { mode: 'current', tipHeight: 0.28, setCurrent: 0 } })).toThrow()
    expect(() => createModuleJobSpec({ module: 'afm', scene: { base: 2.1, k: 0 } })).toThrow()
  })
})

describe('radar and signal scene adapters', () => {
  it('radar browser and backend share wave fields, final odd-step samples and null probes', async () => {
    for (const mode of ['pulse', 'cw'] as const) {
      const scene: RadarScene = { mode, steps: 5, probes: [{ x: 24, y: 100 }, { x: 0, y: 199 }, null, null] }
      const owner = new WasmRadar(scene)
      owner.advance(2); owner.advance(2); owner.advance(1)
      const traces = owner.traces
      const input = { module: 'radar' as const, scene }, spec = createModuleJobSpec(input)
      expect(spec.requirements?.precision).toBe('mixed')
      const output = await computeModule(readModuleJobInput(spec))
      expect(output).toEqual({ module: 'radar', ...radarResult(owner) })
      expect(traces[0]).toHaveLength(3)
      expect(traces[0].some(value => value !== 0)).toBe(true)
      expect(traces[1]).toEqual([0, 0, 0])
      const result = { schemaVersion: 1 as const, summary: { steps: 5, wallTimeMs: 1 }, moduleResult: output }
      expect(readModuleResult(JSON.parse(JSON.stringify(result)), input)).toEqual(output)
      if (output.module !== 'radar') throw new Error('wrong module')
      output.traces[2].push(0)
      expect(() => readModuleResult(result, input)).toThrow(/sample count/)
    }
  })

  it('rejects out-of-grid radar probes before computation and cancels before stepping', async () => {
    const scene: RadarScene = { mode: 'pulse', steps: 2, probes: [{ x: 24, y: 100 }, null, null, null] }
    for (const change of [{ steps: 2001 }, { steps: 0.5 }, { probes: [] }, { probes: [{ x: 200, y: 0 }, null, null, null] }]) {
      expect(() => createModuleJobSpec({ module: 'radar', scene: { ...scene, ...change } })).toThrow()
    }
    const controller = new AbortController()
    const run = computeModule({ module: 'radar', scene: { ...scene, steps: 2000 } }, controller.signal)
    controller.abort()
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('NLJD transports the same polynomial and amplitude ratios for all presets', async () => {
    for (const kind of [null, 0, ['metal'], {}, 'unknown']) {
      expect(() => validateModuleInput({ module: 'nljd', kind } as unknown as ModuleComputeInput)).toThrow(/junction kind/)
    }
    for (const kind of ['semiconductor', 'corrosion', 'metal'] as const) {
      const input = { module: 'nljd' as const, kind }, output = await computeModule(input)
      expect(output).toEqual({ module: 'nljd', result: nljdResult(kind) })
      if (output.module !== 'nljd') throw new Error('wrong module')
      const r = output.result.relative
      expect(r.f1 + r.f2 + r.f3).toBeCloseTo(1, 12)
      expect(output.result.verdict).toBe(kind)
      const result = { schemaVersion: 1 as const, summary: { steps: 1, wallTimeMs: 1 }, moduleResult: output }
      expect(readModuleResult(JSON.parse(JSON.stringify(result)), input)).toEqual(output)
      output.result.transfer.pop()
      expect(() => readModuleResult(result, input)).toThrow(/transfer curve/)
    }
  })
})

describe('shared EM, antenna and laser snapshots', () => {
  it('3D wave fields carry energy along +z and keep reduced speed c=1', () => {
    for (const waveNumber of [0.3, 1.6]) {
      const fields = emWave3DResult({ waveNumber, amplitude: 2, time: 0.7 })
      fields.z.forEach((z, i) => {
        expect(fields.ey[i]).toBeCloseTo(2 * Math.sin(waveNumber * (z - 0.7)), 12)
        expect(-fields.ey[i] * fields.cbx[i]).toBeGreaterThanOrEqual(0)
      })
    }
  })

  it('2D and 3D antennas share link units, including ideal zero reception', () => {
    const p = { frequencyHz: 2.4e9, ptDbm: 20, distM: 8 }
    const flat = antennaLinkResult({ ...p, type: 'dipole', gtDbi: 2.15, grDbi: 2.15 })
    const spatial = antenna3DResult({ ...p, elevationDeg: 90, polarizationDeg: 0 })
    expect(spatial.fsplDb).toBe(flat.link.fsplDb)
    expect(spatial.prDbm).toBe(flat.link.prDbm)
    expect(antenna3DResult({ ...p, elevationDeg: 90, polarizationDeg: 90 }).prDbm).toBeNull()
    expect(antenna3DResult({ ...p, elevationDeg: 0, polarizationDeg: 0 }).prDbm).toBeNull()
  })

  it('transports finite bounded snapshots and rejects malformed returned arrays', async () => {
    const inputs: ModuleComputeInput[] = [
      { module: 'emwave3d', params: { waveNumber: 0.7, amplitude: 2.2, time: 1 } },
      { module: 'antennapattern', params: { type: 'directional', ptDbm: 20, gtDbi: 6, grDbi: 6, frequencyHz: 2.4e9, distM: 100 } },
      { module: 'antenna3d', params: { ptDbm: 20, frequencyHz: 2.4e9, distM: 8, elevationDeg: 90, polarizationDeg: 90 } },
      { module: 'laser', pump: 1200, steps: 4 },
    ]
    for (const input of inputs) {
      const spec = createModuleJobSpec(input)
      const output = await computeModule(readModuleJobInput(JSON.parse(JSON.stringify(spec))))
      const result = { schemaVersion: 1 as const, summary: { steps: spec.run.maxSteps, wallTimeMs: 1 }, moduleResult: output }
      expect(readModuleResult(JSON.parse(JSON.stringify(result)), input)).toEqual(output)
      if (output.module === 'emwave3d') output.fields.ey.pop()
      else if (output.module === 'antennapattern' || output.module === 'antenna3d') output.result.pattern[0] = 2
      else if (output.module === 'laser') output.characteristics.curve.pop()
      expect(() => readModuleResult(result, input)).toThrow()
    }
  })

  it('laser uses the same initial state, timestep and cheap analytic curve, with cancellation', async () => {
    const input = { module: 'laser' as const, pump: 1200, steps: 4 }
    let state = { N: 0, S: 0 }
    for (let i = 0; i < input.steps; i++) state = laserStep(state, input.pump, LASER_DT)
    expect(await computeModule(input)).toEqual({ module: 'laser', state, steps: 4, dt: LASER_DT, characteristics: laserCharacteristics(input.pump) })
    for (const change of [{ steps: 2001 }, { steps: 0 }, { steps: 1.5 }, { pump: Infinity }, { pump: -1 }]) {
      expect(() => createModuleJobSpec({ ...input, ...change })).toThrow()
    }
    const controller = new AbortController()
    const run = computeModule({ ...input, steps: 2000 }, controller.signal)
    controller.abort()
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  })
})

const scene: FdtdScene = { preset: 'cavity', boundary: 'pec', shape: 'point', time: 'cw', omega: 0.3, steps: 4, sources: defaultFdtdSources('cavity') }

describe('module FDTD integration smoke', () => {
  it('browser CPU and Agent snapshot use identical scenes, sources and completed steps', async () => {
    // Import must work in Node / browsers where WebGPU constants do not exist.
    const { createFdtdSim } = await import('../webgpu/fdtdSim')
    const input: ModuleComputeInput = { module: 'fdtd', scene }
    const spec = createModuleJobSpec(input)
    expect(spec.run.maxSteps).toBe(4)
    expect(spec.requirements?.precision).toBe('mixed')
    const remote = await computeModule(readModuleJobInput(JSON.parse(JSON.stringify(spec))))
    expect(remote.module).toBe('fdtd')
    if (remote.module !== 'fdtd') throw new Error('wrong module')
    const preset = FDTD_PRESETS.find(p => p.id === scene.preset)!
    const sim = await createFdtdSim({ Nx: FDTD_NX, Ny: FDTD_NY, boundary: scene.boundary, eps: preset.eps?.(), pecMask: preset.pec?.() })
    expect(sim.backend).toBe('cpu')
    try {
      for (let step = 0; step < scene.steps; step++) {
        injectFdtdSceneSources(scene, step, (i, j, value) => sim.injectSource(i, j, value))
        await sim.step(1)
      }
      const local = await sim.read()
      expect(remote.Ez).toEqual(Array.from(local.Ez))
      expect(remote.Ez.some(value => value !== 0)).toBe(true)
      expect(remote.Ez.every(Number.isFinite)).toBe(true)
      const result = { schemaVersion: 1 as const, summary: { steps: scene.steps, wallTimeMs: 1 }, moduleResult: remote }
      expect(readModuleResult(JSON.parse(JSON.stringify(result)), input)).toEqual(remote)
      for (const change of [{ nx: 1 }, { steps: 3 }, { Ez: [] }, { dt: 0 }, { Ez: remote.Ez.map((value, i) => i === 0 ? NaN : value) }]) {
        const malformed = { ...result, moduleResult: { ...remote, ...change } }
        expect(() => readModuleResult(malformed, input)).toThrow()
      }
    } finally { sim.destroy() }
  })

  it('rejects invalid scenes before doing work and permits cancellation between chunks', async () => {
    for (const change of [{ steps: 2001 }, { steps: 1.5 }, { omega: Infinity }, { preset: 'missing' }, { sources: [] }, { sources: [{ i: -1, j: 2 }] }]) {
      expect(() => createModuleJobSpec({ module: 'fdtd', scene: { ...scene, ...change } } as ModuleComputeInput)).toThrow()
    }
    const input: ModuleComputeInput = { module: 'fdtd', scene: { ...scene, steps: 2000 } }
    await expect(computeModule(input, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' })
    const controller = new AbortController()
    const run = computeModule(input, controller.signal)
    setTimeout(() => controller.abort(), 0)
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('uploads valid GPU buffers and releases the owned device on dispose or shader failure', async () => {
    const { createFdtdSim } = await import('../webgpu/fdtdSim')
    const usage = { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 }
    let devicesDestroyed = 0, failShader = false
    vi.stubGlobal('GPUBufferUsage', usage)
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({ requestDevice: async () => ({
      createBuffer: (config: { usage: number }) => ({ ...config, destroy() {} }),
      queue: { writeBuffer: (buffer: { usage: number }) => { expect(buffer.usage & usage.COPY_DST).not.toBe(0) } },
      createShaderModule: () => ({}),
      createComputePipelineAsync: async () => {
        if (failShader) throw new Error('shader rejected')
        return { getBindGroupLayout: () => ({}) }
      },
      createBindGroup: () => ({}),
      destroy: () => { devicesDestroyed++ },
    }) }) } })
    try {
      const sim = await createFdtdSim({ Nx: 8, Ny: 8 })
      expect(sim.backend).toBe('webgpu')
      sim.destroy()
      expect(devicesDestroyed).toBe(1)
      failShader = true
      const fallback = await createFdtdSim({ Nx: 8, Ny: 8 })
      expect(fallback.backend).toBe('cpu')
      expect(devicesDestroyed).toBe(2)
      await fallback.step(1)
      expect((await fallback.read()).Ez.every(Number.isFinite)).toBe(true)
      fallback.destroy()
    } finally { vi.unstubAllGlobals() }
  })
})


describe('circuit and induction scene adapters', () => {
  it('transports bounded trajectories and analytic curves, including ideal infinite limits', async () => {
    const inputs: ModuleComputeInput[] = [
      { module: 'rlc', scene: { zeta: 0, drive: 'energy', steps: 4 } },
      { module: 'mutual', scene: { k: 0.99, n: 0.3, mode: 'step', steps: 4 } },
      { module: 'transient', scene: { mode: 'rc-charge', v0: 5, r: 1000, c: 1e-4, l: 0.5 } },
      { module: 'faraday', scene: { omega: 4 * Math.PI, B: 0.3, N: 200, A: 0.01, vBar: 0, bMot: 0.5, lBar: 0.2 } },
      { module: 'smith', scene: { resistance: 0, reactance: 0, thetaDeg: 90 } },
      { module: 'smith', scene: { resistance: 50, reactance: 0, thetaDeg: 0 } },
    ]
    for (const input of inputs) {
      const spec = createModuleJobSpec(input), output = await computeModule(readModuleJobInput(JSON.parse(JSON.stringify(spec))))
      expect(spec.requirements?.precision).toBe('float64')
      const result = { schemaVersion: 1 as const, summary: { steps: moduleComputeSteps(input), wallTimeMs: 1 }, moduleResult: output }
      expect(readModuleResult(JSON.parse(JSON.stringify(result)), input)).toEqual(output)
      if (output.module === 'rlc') {
        expect(output.result.Q).toBeNull()
        expect(output.result.states[4].q).toBeCloseTo(Math.cos(0.04), 10)
        output.result.states.pop()
      } else if (output.module === 'mutual') {
        expect(output.result.substeps).toBe(5)
        expect(output.result.states.every(s => Math.abs(s.i1) < 6 && Math.abs(s.i2) < 6)).toBe(true)
        output.result.secondaryShare.pop()
      } else if (output.module === 'transient') {
        expect(output.result.tau).toBe(0.1)
        expect(output.result.values[48] / 5).toBeCloseTo(1 - Math.exp(-1), 12)
        output.result.values.pop()
      } else if (output.module === 'faraday') {
        expect(output.result.motionalEmf).toBe(0)
        expect(output.result.flux[0]).toBeCloseTo(0.6, 12)
        expect(output.result.emf[45]).toBeCloseTo(output.result.peak, 12)
        output.result.emf.pop()
      } else if (output.module === 'smith') {
        if (input.module === 'smith' && input.scene.resistance === 0) {
          expect(output.result.zIn).toBeNull()
          expect(output.result.vswr).toBeNull()
          expect(output.result.powerRefl).toBe(1)
        } else {
          expect(output.result.returnLossDb).toBeNull()
          expect(output.result.vswr).toBe(1)
        }
        output.result.linePath.pop()
      }
      expect(() => readModuleResult(result, input)).toThrow()
    }
  })

  it('rejects unbounded work and singular/unknown circuit inputs before solving', () => {
    for (const input of [
      { module: 'rlc', scene: { zeta: 0, drive: 'energy', steps: 2001 } },
      { module: 'mutual', scene: { k: 1, n: 0.3, mode: 'step', steps: 4 } },
      { module: 'transient', scene: { mode: 'unknown', v0: 5, r: 1000, c: 1e-4, l: 0.5 } },
      { module: 'faraday', scene: { omega: 0, B: 0.3, N: 200, A: 0.01, vBar: 0, bMot: 0.5, lBar: 0.2 } },
      { module: 'smith', scene: { resistance: -1, reactance: 0, thetaDeg: 90 } },
    ]) expect(() => createModuleJobSpec(input as ModuleComputeInput)).toThrow()
  })
})


describe('biosignal, ultrasound and recorded-data scenes', () => {
  it('loads the recorded public ECG with channel metadata and rejects malformed CSV', () => {
    const csv = readFileSync('public/datasets/mit-bih-100-10s.csv', 'utf8')
    const recording = parseSignalCsv(csv)
    expect(recording.sampleRate).toBe(360)
    expect(recording.unit).toBe('mV')
    expect(recording.channels.map(ch => ch.name)).toEqual(['MLII', 'V5'])
    expect(recording.channels[0].values).toHaveLength(3600)
    expect(recording.channels[0].values[0]).toBe(-0.145)
    expect(recording.channels[1].values[0]).toBe(-0.065)
    expect(() => parseSignalCsv(csv.replace('sample_rate_hz=360', 'sample_rate_hz=0'))).toThrow()
    expect(() => parseSignalCsv(csv.replace('MLII,V5', 'MLII,MLII'))).toThrow()
    expect(() => parseSignalCsv('# name=test\n# sample_rate_hz=360\n# unit=mV\nECG\n1\nNaN')).toThrow()
    expect(() => validateRecording({ ...recording, channels: [recording.channels[0], { name: 'short', values: [1, 2] }] })).toThrow()
  })

  it('replays seeded noise and computes RMS from the returned samples', () => {
    const scene = { state: 1, noise: 0.4, seed: 7, samples: 16 }
    expect(eegResult(scene)).toEqual(eegResult(scene))
    expect(eegResult({ ...scene, seed: 8 }).channels).not.toEqual(eegResult(scene).channels)
    expect(eegResult({ ...scene, noise: 0, seed: 8 }).channels).toEqual(eegResult({ ...scene, noise: 0 }).channels)
    const emg = emgResult({ agonist: 0.5, antag: 0, seed: 11, samples: 72 })
    emg.channels.forEach((values, ch) => {
      expect(emg.rms[ch][71]).toBeCloseTo(Math.sqrt(values.slice(8).reduce((sum, v) => sum + v * v, 0) / 64), 12)
    })
    expect(emg.baselineRms).toBeCloseTo(0.02 / Math.sqrt(3), 12)
  })

  it('transports actual signal samples, pulse times and full scans through the module protocol', async () => {
    const recording = parseSignalCsv(readFileSync('public/datasets/mit-bih-100-10s.csv', 'utf8'))
    const inputs: ModuleComputeInput[] = [
      { module: 'ecg', scene: { hr: 75, samples: 16 } },
      { module: 'ecg', scene: { recording, channel: 1 } },
      { module: 'eeg', scene: { state: 1, noise: 0.4, seed: 7, samples: 16 } },
      { module: 'emg', scene: { agonist: 0.5, antag: 0.1, seed: 11, samples: 16 } },
      { module: 'neuron', scene: { current: 0.5, steps: 8, pulses: [0] } },
      { module: 'ultrasound', scene: { atten: 0.02, gain: 1 } },
      { module: 'biopipeline', scene: { source: 'ECG', seed: 7 } },
    ]
    for (const input of inputs) {
      const spec = createModuleJobSpec(input), output = await computeModule(readModuleJobInput(JSON.parse(JSON.stringify(spec))))
      const result = { schemaVersion: 1 as const, summary: { steps: moduleComputeSteps(input), wallTimeMs: 1 }, moduleResult: output }
      expect(readModuleResult(JSON.parse(JSON.stringify(result)), input)).toEqual(output)
      expect(spec.requirements?.precision).toBe(input.module === 'ultrasound' ? 'mixed' : 'float64')
      if (output.module === 'ecg') {
        if (output.result.source === 'recording') {
          expect(output.result.bpm).toBeNull()
          expect(output.result.rr).toBeNull()
          expect(output.result.values).toEqual(recording.channels[1].values)
        }
        output.result.values.pop()
      } else if (output.module === 'eeg' || output.module === 'emg') output.result.channels[0].pop()
      else if (output.module === 'neuron') {
        expect(output.result.voltage).toEqual(simulateNeuron(0.5, 8, NEURON_DT, 8))
        output.result.spikes.push(9)
      } else if (output.module === 'ultrasound') {
        expect(output.result.field.some(v => v > 0)).toBe(true)
        expect(output.result.echoes.every(v => Number.isInteger(v))).toBe(true)
        output.result.field.pop()
      } else if (output.module === 'biopipeline') {
        expect(Math.abs(output.result.series[2].reduce((sum, v) => sum + v, 0) / 600)).toBeLessThan(1e-12)
        output.result.series.pop()
      }
      expect(() => readModuleResult(result, input)).toThrow()
    }
    expect(() => createModuleJobSpec({ module: 'neuron', scene: { current: 0.5, steps: 8, pulses: [0, 0] } })).toThrow()
    expect(() => createModuleJobSpec({ module: 'ecg', scene: { recording, channel: 2 } })).toThrow()
    expect(() => createModuleJobSpec({ module: 'eeg', scene: { state: 1, noise: 0.4, seed: 1.5, samples: 16 } })).toThrow()
  })
})


it('optics yields between real ray batches and honors cancellation before returning a trace', async () => {
  const components = Array.from({ length: 32 }, (_, i) => ({ id: `source-${i}`, kind: 'laser' as const, x: 100, y: 100, rot: 0, length: 40 }))
  const signal = new AbortController(), ticks: number[] = []
  await expect(computeModule({ module: 'optics-lab', components }, signal.signal, p => {
    ticks.push(p.step)
    if (ticks.length === 2) signal.abort()
  })).rejects.toMatchObject({ name: 'AbortError' })
  expect(ticks).toEqual([0, 0])
})


it('rejects optics results with missing or duplicate screen accounting before display', async () => {
  const input = { module: 'optics-lab' as const, components: opticsPreset('beamsplit') }
  const output = await computeModule(input)
  if (output.module !== 'optics-lab') throw new Error('wrong optics output')
  for (const invalid of ['missing-power', 'missing-profile', 'duplicate-profile']) {
    const altered = structuredClone(output)
    if (invalid === 'missing-power') delete altered.trace.screenPower[altered.trace.profiles[0].componentId]
    if (invalid === 'missing-profile') altered.trace.profiles.pop()
    if (invalid === 'duplicate-profile') altered.trace.profiles.push(altered.trace.profiles[0])
    expect(() => readModuleResult({ schemaVersion: 1, summary: { steps: 1, wallTimeMs: 1 }, moduleResult: altered } as any, input)).toThrow(/profile and power IDs/)
  }
})

it('accepts the acoustic intensity implied by admitted inputs and rejects invalid wave results', async () => {
  const input = extremePlaneInputs.find(i => i.module === 'sound')!
  const output = await computeModule(input)
  if (output.module !== 'sound') throw new Error('wrong wave output')
  const result = { schemaVersion: 1 as const, summary: { steps: 1, wallTimeMs: 1 }, moduleResult: output }
  expect(output.observables.intensityWm2).toBe(5e23)
  expect(readModuleResult(result, input)).toEqual(output)
  for (const intensity of [NaN, Infinity, -1, 6e23]) {
    const altered = structuredClone(result); altered.moduleResult.observables.intensityWm2 = intensity
    expect(() => readModuleResult(altered, input)).toThrow(/intensityWm2/)
  }
  const altered = structuredClone(result); altered.moduleResult.velocity.pop()
  expect(() => readModuleResult(altered, input)).toThrow(/sample length/)
})

describe('sw-* native module passthrough', () => {
  const swInput = { module: 'sw-fds-solid-obstruction' as const, backend: 'cuda' as const, method: 'voxelize', params: { grid: [4, 4, 3] } }

  it('accepts sw-* inputs only with an explicit backend and a routing-safe shape', () => {
    expect(() => validateModuleInput(swInput)).not.toThrow()
    expect(() => validateModuleInput({ module: 'sw-gromacs-spc', backend: 'auto', molecules: [{ o: [0, 0, 0] }] })).not.toThrow()
    expect(() => validateModuleInput({ module: 'sw-lbm-solver', backend: 'host', method: 'collide' })).not.toThrow()
    for (const bad of [
      { module: 'sw-fds-solid-obstruction' },
      { module: 'sw-fds-solid-obstruction', backend: 'gpu' },
      { module: 'sw-fds-solid-obstruction', backend: 'cpu' },
      { module: 'sw_fds_solid_obstruction', backend: 'cuda' },
      { module: 'sw-FDS', backend: 'cuda' },
      { module: 'sw-fds', backend: 'cuda', method: 3 },
      { module: 'sw-fds', backend: 'cuda', method: '' },
      { module: 'sw-fds', backend: 'cuda', params: [1, 2] },
    ]) expect(() => validateModuleInput(bad)).toThrow()
  })

  it('builds a cuda-routed JobSpec whose readback restores the sw input', () => {
    const spec = createModuleJobSpec(swInput)
    expect(spec.requirements?.backends).toEqual(['cuda'])
    expect(spec.requirements?.precision).toBeUndefined()
    expect(readModuleJobInput(JSON.parse(JSON.stringify(spec)))).toEqual(swInput)
  })

  it('routes the guided heat-exchanger UA sweep through the existing sw transport', () => {
    const input = {
      module: 'sw-openmodelica-heat-exchanger' as const,
      backend: 'host' as const,
      dynamic: false,
      arrangement: 'counterflow' as const,
      Chot: 100,
      Ccold: 100,
      T_hot_in: 363.15,
      T_cold_in: 293.15,
      sweep_UA: [100, 200, 300],
    }
    const spec = createModuleJobSpec(input)

    expect(spec.requirements?.backends).toEqual(['cuda'])
    expect(spec.run?.maxSteps).toBe(1)
    expect(spec.model?.inline).toEqual(input)
    expect(readModuleJobInput(JSON.parse(JSON.stringify(spec)))).toEqual(input)
  })

  it('rejects sw specs whose backends could fall back to the host path', () => {
    const spec = createModuleJobSpec(swInput)
    for (const backends of [['cpu'], ['cuda', 'cpu'], ['native-cuda'], [], ['webgpu']]) {
      const altered = structuredClone(spec); (altered.requirements as { backends: string[] }).backends = backends
      expect(() => readModuleJobInput(altered)).toThrow(/native w-sim-cuda backend/)
    }
    const both = structuredClone(spec); (both.requirements as { backends: string[] }).backends = ['cuda', 'native-cuda']
    expect(readModuleJobInput(both)).toEqual(swInput)
    const missing = structuredClone(spec); delete (missing as { requirements?: unknown }).requirements
    expect(() => readModuleJobInput(missing)).toThrow(/native w-sim-cuda backend/)
  })

  it('bounds run.maxSteps and inline model size on sw specs', () => {
    const spec = createModuleJobSpec(swInput)
    const big = structuredClone(spec); (big.run as { maxSteps: number }).maxSteps = 1e12
    expect(() => readModuleJobInput(big)).toThrow(/maxSteps/)
    const frac = structuredClone(spec); (frac.run as { maxSteps: number }).maxSteps = 0.5
    expect(() => readModuleJobInput(frac)).toThrow(/maxSteps/)
    const huge = structuredClone(spec); (huge.model as { inline: Record<string, unknown> }).inline.blob = 'x'.repeat(1 << 20)
    expect(() => readModuleJobInput(huge)).toThrow(/1 MiB/)
  })

  it('rejects a parameters.module mismatch on sw specs', () => {
    const spec = structuredClone(createModuleJobSpec(swInput))
    ;(spec.parameters as { module: string }).module = 'sw-other-module'
    expect(() => readModuleJobInput(spec)).toThrow(/parameters\.module/)
  })

  it('refuses to run sw inputs on the host compute path', async () => {
    await expect(computeModule(swInput)).rejects.toThrow(/no host implementation/)
  })

  it('refuses to fabricate a precision for sw inputs — the binary reports it', () => {
    expect(() => moduleComputePrecision(swInput)).toThrow(/w-sim-cuda binary/)
    expect(knownModuleComputePrecision(swInput)).toBeNull()
    expect(moduleComputePrecision({ module: 'sim', scene: { r: 0.2, steps: 1, seeds: [] } })).toBe('mixed')
    expect(knownModuleComputePrecision({ module: 'sim', scene: { r: 0.2, steps: 1, seeds: [] } })).toBe('mixed')
  })

  it('accepts native-shaped results by module id without rechecking steps or fields', () => {
    const input = readModuleJobInput(JSON.parse(JSON.stringify(createModuleJobSpec(swInput))))
    const moduleResult = { ok: true, id: 'sw-fds-solid-obstruction', result: { blocked: 16, gas: 32 }, backend: { id: 'native-cuda-sw-fds-solid-obstruction', deviceName: 'NVIDIA GeForce RTX 5090' }, meta: {} }
    const result = { schemaVersion: 1 as const, summary: { steps: 495, wallTimeMs: 12 }, backend: { id: 'w-sim-cuda', deviceName: 'NVIDIA GeForce RTX 5090' }, moduleResult }
    expect(readModuleResult(result, input)).toEqual(moduleResult)
    const mismatch = structuredClone(result); (mismatch.moduleResult as { id: string }).id = 'sw-other'
    expect(() => readModuleResult(mismatch, input)).toThrow(/does not match/)
    expect(() => readModuleResult({ ...result, schemaVersion: 2 } as never, input)).toThrow(/schemaVersion/)
  })

  it('rejects failed, empty and self-contradictory native result envelopes', () => {
    const input = readModuleJobInput(JSON.parse(JSON.stringify(createModuleJobSpec(swInput))))
    const wrap = (moduleResult: unknown) => ({ schemaVersion: 1 as const, summary: { steps: 1, wallTimeMs: 1 }, backend: { id: 'w-sim-cuda' }, moduleResult })
    const base = { ok: true, id: 'sw-fds-solid-obstruction', result: { blocked: 16 }, backend: { id: 'native-cuda-sw-fds-solid-obstruction' }, meta: {} }
    expect(() => readModuleResult(wrap({ ...base, ok: false, error: 'device lost' }), input)).toThrow(/failure/)
    expect(() => readModuleResult(wrap({ ...base, result: undefined, backend: undefined, meta: undefined }), input)).toThrow(/no payload/)
    expect(() => readModuleResult(wrap({ ...base, module: 'sw-fds-solid-obstruction', id: 'sw-other' }), input)).toThrow(/does not match/)
    expect(() => readModuleResult(wrap({ ok: true, module: 'sw-fds-solid-obstruction', result: {} }), input)).not.toThrow()
    expect(() => readModuleResult(wrap({ ok: true, id: 'sw-fds-solid-obstruction', result: {} }), input)).not.toThrow()
    expect(() => readModuleResult(wrap({ ok: true, result: {} }), input)).toThrow(/does not match/)
    const withError = { ...wrap(base), error: 'partial failure before upload' }
    expect(() => readModuleResult(withError, input)).toThrow(/error message/)
  })

  it('recomputes module aggregates instead of trusting reported values', () => {
    // sim: peak/total must match the returned field.
    const simInput = { module: 'sim' as const, scene: { r: 0.2, steps: 1, seeds: [{ x: 0, y: 0, radius: 2, amount: 8 }] } }
    const simOutput = { module: 'sim' as const, result: { width: HEAT_W, height: HEAT_H, steps: 1, field: new Array(HEAT_W * HEAT_H).fill(0).map((_, i) => (i === 0 ? 3 : 1)), peak: 3, total: HEAT_W * HEAT_H + 2 } }
    const wireFor = (o: unknown, input: ModuleComputeInput) => JSON.parse(JSON.stringify({ schemaVersion: 1, moduleResult: o, backend: { id: 'cpu' }, summary: { steps: moduleComputeSteps(input), wallTimeMs: 1 } }))
    const wire = (o: unknown) => wireFor(o, simInput)
    expect(readModuleResult(wire(simOutput), simInput)).toEqual(simOutput)
    for (const change of [{ peak: 999 }, { total: 1 }]) {
      expect(() => readModuleResult(wire({ module: 'sim', result: { ...simOutput.result, ...change } }), simInput)).toThrow(/aggregates/)
    }
    // neuron: peak must be max(voltage).
    const neuronInput = { module: 'neuron' as const, scene: { current: 0.4, steps: 5, pulses: [] } }
    const neuronOutput = { module: 'neuron' as const, result: { voltage: [0, 0.5, 1.2, 0.3, 0.1, 0.0], spikes: [2], dt: 0.06, peak: 1.2 } }
    expect(readModuleResult(wireFor(neuronOutput, neuronInput), neuronInput)).toEqual(neuronOutput)
    expect(() => readModuleResult(wireFor({ module: 'neuron', result: { ...neuronOutput.result, peak: 9.9 } }, neuronInput), neuronInput)).toThrow(/peak/)
    // biopipeline: rawMean/rawPeak/finalPeak must match series[0] and series[4].
    const bpInput = { module: 'biopipeline' as const, scene: { source: 'ECG' as const, seed: 7 } }
    const raw = new Array(600).fill(0).map((_, i) => Math.sin(i / 10))
    const series = [raw, raw, raw, raw, raw.map(v => v * 2)]
    const bpOutput = { module: 'biopipeline' as const, result: { series, rawMean: raw.reduce((s, v) => s + v, 0) / 600, rawPeak: Math.max(...raw.map(Math.abs)), finalPeak: Math.max(...series[4].map(Math.abs)) } }
    expect(readModuleResult(wireFor(bpOutput, bpInput), bpInput)).toEqual(bpOutput)
    expect(() => readModuleResult(wireFor({ module: 'biopipeline', result: { ...bpOutput.result, rawPeak: 42 } }, bpInput), bpInput)).toThrow(/aggregates/)
  })

  it('rejects sw results whose reported backend violates the requested backend', () => {
    const cudaInput = readModuleJobInput(JSON.parse(JSON.stringify(createModuleJobSpec(swInput))))
    const wrap = (moduleResult: unknown, backendId?: string) => ({ schemaVersion: 1 as const, summary: { steps: 1, wallTimeMs: 1 }, backend: backendId === undefined ? undefined : { id: backendId }, moduleResult })
    const gpuModule = { ok: true, id: 'sw-fds-solid-obstruction', result: {}, backend: { id: 'native-cuda-sw-fds-solid-obstruction' } }
    const hostModule = { ok: true, id: 'sw-fds-solid-obstruction', result: {}, backend: { id: 'w-sim-cuda-host' } }
    // backend:'cuda' 只能以 GPU 系自报结算——模块报 host 数学即违约
    expect(() => readModuleResult(wrap(gpuModule, 'w-sim-cuda'), cudaInput)).not.toThrow()
    expect(() => readModuleResult(wrap(hostModule, 'w-sim-cuda'), cudaInput)).toThrow(/does not satisfy/)
    // 'host' 请求不得以 cuda 结果结算
    const hostInput = { module: 'sw-lbm-solver' as const, backend: 'host' as const }
    expect(() => readModuleResult(wrap({ ...hostModule, id: 'sw-lbm-solver' }, 'w-sim-cuda'), hostInput)).not.toThrow()
    expect(() => readModuleResult(wrap({ ...gpuModule, id: 'sw-lbm-solver' }, 'w-sim-cuda'), hostInput)).toThrow(/does not satisfy/)
    // 'auto' 两者皆可
    const autoInput = { module: 'sw-lbm-solver' as const, backend: 'auto' as const }
    expect(() => readModuleResult(wrap({ ...hostModule, id: 'sw-lbm-solver' }, 'w-sim-cuda'), autoInput)).not.toThrow()
    expect(() => readModuleResult(wrap({ ...gpuModule, id: 'sw-lbm-solver' }, 'w-sim-cuda'), autoInput)).not.toThrow()
    // 模块未自报 backend 时以 envelope id 兜底，皆缺则不可判定（不拒）
    expect(() => readModuleResult(wrap({ ok: true, id: 'sw-fds-solid-obstruction', result: {} }), cudaInput)).not.toThrow()
    // steps 必须是非负整数
    const badSteps = { ...wrap(gpuModule, 'w-sim-cuda'), summary: { steps: -1, wallTimeMs: 1 } }
    expect(() => readModuleResult(badSteps, cudaInput)).toThrow(/steps/)
    const fracSteps = { ...wrap(gpuModule, 'w-sim-cuda'), summary: { steps: 1.5, wallTimeMs: 1 } }
    expect(() => readModuleResult(fracSteps, cudaInput)).toThrow(/steps/)
  })
})

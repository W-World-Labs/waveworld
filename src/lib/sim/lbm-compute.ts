import { AIR_KINEMATIC_VISCOSITY, prepareProductLbmLattice, latticeForceToNewton, forceToCoefficient, decimateField, decimatedCellCount, lbmFieldSampleSteps, type LbmTriangleMesh, type LbmDisplaySnapshot } from '@w-sim/solvers-lbm/d3q19'
import type { JobSpecV1, JobResultV1, JobProgress, LbmThermalRegion, LbmThermalContact } from '@w-sim/contracts'
import { LBM_THERMAL_FEATURES, LBM_GROUND_FEATURE, LBM_FIELD_HISTORY_FEATURE, LBM_GAUGE_FORCE_FEATURE, LBM_NEE_OUTLET_FEATURE, LBM_NEE_INLET_FEATURE, LBM_MASS_BALANCE_FEATURE, LBM_PRESSURE_FIELD_FEATURE, validateLbmGroundBoundary } from '@w-sim/contracts'
import type { ComputeLbmInput } from '../../../apps/host/src/types/compute'
import { WasmLbm } from './wasm-fields'

export function isNativeLbmJob(spec: JobSpecV1): boolean {
  return spec.model?.source === 'artifact' && isNativeLbmCompute(spec)
}

/** Solver eligibility is independent of where the supplied geometry is stored. */
export function isNativeLbmCompute(spec: JobSpecV1): boolean {
  return spec.kind === 'lbm-d3q19' &&
    spec.requirements?.backends?.length === 1 && spec.requirements.backends[0] === 'cpu' &&
    spec.requirements.precision === 'mixed'
}

/** An explicit FP32 GPU request; native/WASM jobs retain their mixed precision. */
export function isGpuLbmJob(spec: JobSpecV1): boolean {
  const { backends, precision } = spec.requirements ?? {}
  return spec.kind === 'lbm-d3q19' && !!backends?.length &&
    backends.every(backend => ['webgpu', 'webgpu-dawn', 'webgpu-browser'].includes(backend)) &&
    (Array.isArray(precision) ? precision : [precision]).includes('float32')
}

export function isBrowserLbmJob(spec: JobSpecV1): boolean {
  return spec.model?.source === 'artifact' && isBrowserLbmCompute(spec)
}

export function isBrowserLbmCompute(spec: JobSpecV1): boolean {
  return isNativeLbmCompute(spec) || (isGpuLbmJob(spec) &&
    spec.requirements!.backends!.some(backend => backend === 'webgpu' || backend === 'webgpu-browser'))
}

export function prepareLbmInput(spec: JobSpecV1, geometry: LbmTriangleMesh): { lbm: ComputeLbmInput; flags: Uint8Array } {
  if (!isNativeLbmCompute(spec)) throw new Error('Rust LBM supports CPU/mixed jobs only')
  validateLbmRun(spec)
  const { flags, units, ...p } = prepareProductLbmLattice(spec, geometry)
  const lbm: ComputeLbmInput = { nx: p.nx, ny: p.ny, nz: p.nz, tau: p.tau, uInlet: p.uInlet,
    smagorinskyCs: p.smagorinskyCs, turbulenceIntensity: p.turbulenceIntensity, freeSlipWalls: p.freeSlipWalls,
    ...(p.groundVelocityLattice !== undefined ? { groundVelocityLattice: p.groundVelocityLattice } : {}),
    density: p.density, inletVelocity: p.inletVelocity, referenceArea: p.referenceArea, solidCells: p.solidCells, units,
    forceScale: latticeForceToNewton(1, p.density, units.dx, units.dt),
    coefficientScale: forceToCoefficient(1, p.density, p.inletVelocity, p.referenceArea),
    ...(p.fan ? { fan: p.fan } : {}), ...(p.thermal ? { thermal: { ...p.thermal.thermal, ambientC: p.thermal.ambientC,
      temperatureScaleC: p.thermal.temperatureScaleC, thermalDiffusivityPhysical: p.thermal.thermalDiffusivityPhysical } } : {}) }
  return { lbm, flags }
}

function validateLbmRun(spec: JobSpecV1) {
  if (!spec.requirements?.features?.includes(LBM_NEE_OUTLET_FEATURE)) throw new Error('LBM requires lbm-nee-outlet-v1');
  if (!spec.requirements?.features?.includes(LBM_GAUGE_FORCE_FEATURE)) throw new Error('LBM requires lbm-gauge-force-v1');
  if (!spec.requirements?.features?.includes(LBM_NEE_INLET_FEATURE)) throw new Error('LBM requires lbm-nee-inlet-v1');
  if (!spec.requirements?.features?.includes(LBM_MASS_BALANCE_FEATURE)) throw new Error('LBM requires lbm-mass-balance-v1');
  if (spec.outputs.fields?.includes('pressure') && !spec.requirements?.features?.includes(LBM_PRESSURE_FIELD_FEATURE)) throw new Error('LBM pressure requires lbm-pressure-field-v1');
  const { run } = spec
  const maxSteps = run.maxSteps, sampleEvery = run.forceSampleEvery ?? 20, warmup = run.warmupSteps ?? 0
  if (![maxSteps, sampleEvery].every(v => Number.isSafeInteger(v) && v >= 1 && v <= 1000000) ||
      !Number.isSafeInteger(warmup) || warmup < 0 || warmup > maxSteps) throw new Error('Invalid LBM step limits')
  const window = run.stopWhen?.window ?? 10, maxVariance = run.stopWhen?.maxCdVariance
  if (!Number.isSafeInteger(window) || window < 2 || window > 1000000 ||
      (maxVariance != null && (!Number.isFinite(maxVariance) || maxVariance < 0 || maxVariance > 1e100))) throw new Error('Invalid LBM convergence criteria')
  if (maxVariance != null && (spec.parameters as Record<string, unknown>).inletVelocity === 0) throw new Error('Cd convergence requires a positive inlet reference velocity')
  const thermal = (spec.parameters as Record<string, unknown>).thermalEnabled === true
  if (spec.requirements?.thermal === true && !thermal) throw new Error('Thermal requirement needs an enabled temperature model')
  if (thermal && maxVariance != null) throw new Error('Thermal jobs cannot stop on drag-coefficient convergence')
  if (spec.outputs.fields?.some(field => field !== 'velocity' && field !== 'vorticity' && field !== 'pressure' && !(thermal && field === 'temperature'))) throw new Error('Unsupported LBM output field')
}

/** Batch orchestration only; voxelization, D3Q19 steps and display all run in Rust/WASM. */
export async function runLbmWasm(
  spec: JobSpecV1, prepared: { lbm: ComputeLbmInput; flags: Uint8Array },
  signal?: AbortSignal, onProgress?: (progress: JobProgress) => void | Promise<void>,
  onDisplaySnapshot?: (snapshot: LbmDisplaySnapshot) => void | Promise<void>,
): Promise<{ result: JobResultV1; snapshot?: LbmDisplaySnapshot; snapshots: LbmDisplaySnapshot[] }> {
  if (!isNativeLbmCompute(spec)) throw new Error('Unsupported Rust/WASM LBM job')
  validateLbmRun(spec)
  const { lbm, flags } = prepared, { run } = spec
  const params = spec.parameters as Record<string, unknown>
  const requestedViscosity = params.fluidViscosity == null ? AIR_KINEMATIC_VISCOSITY : Number(params.fluidViscosity) / Number(params.fluidDensity ?? 1.225)
  const simulatedViscosity = (lbm.tau - 0.5) * lbm.units.dx ** 2 / (3 * lbm.units.dt)
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(Number.MIN_VALUE, Math.max(Math.abs(a), Math.abs(b)) * 1e-9)
  const forceScale = latticeForceToNewton(1, lbm.density, lbm.units.dx, lbm.units.dt)
  const inletLattice = Number(params.inletVelocity) * lbm.units.dt / lbm.units.dx
  if (![forceScale, lbm.forceScale, lbm.referenceArea].every(value => Number.isFinite(value) && value > 0) ||
      !close(forceScale, lbm.forceScale) ||
      !Number.isFinite(inletLattice) || !Number.isFinite(lbm.uInlet) || !close(inletLattice, lbm.uInlet) ||
      (spec.model?.referenceArea !== undefined && spec.model.referenceArea !== lbm.referenceArea)) {
    throw new Error('Prepared inlet, force scale and reference area must match physical units and the submitted model')
  }
  const groundCheck = params.ground === undefined ? undefined : validateLbmGroundBoundary(params.ground)
  if (groundCheck && !groundCheck.ok) throw new Error(groundCheck.message)
  const ground = groundCheck?.ok ? groundCheck.ground : undefined
  const groundVelocityMps = ground?.mode === 'moving' ? Number(params.inletVelocity) : 0
  if (ground ? lbm.groundVelocityLattice === undefined || !Number.isFinite(lbm.groundVelocityLattice) ||
      !close(lbm.groundVelocityLattice, groundVelocityMps * lbm.units.dt / lbm.units.dx) : lbm.groundVelocityLattice !== undefined) {
    throw new Error('Job ground boundary and prepared wall velocity must agree')
  }
  if (lbm.density !== (params.fluidDensity ?? 1.225) || lbm.inletVelocity !== params.inletVelocity ||
      lbm.units.viscosityMode !== (params.viscosityMode ?? 'physical') ||
      (lbm.thermal && lbm.units.viscosityMode !== 'physical') ||
      ![requestedViscosity, simulatedViscosity, lbm.units.requestedViscosityM2s, lbm.units.simulatedViscosityM2s].every(value => Number.isFinite(value) && value > 0) ||
      !close(requestedViscosity, lbm.units.requestedViscosityM2s) || !close(simulatedViscosity, lbm.units.simulatedViscosityM2s) ||
      (lbm.units.viscosityMode === 'physical' && !close(requestedViscosity, simulatedViscosity)) ||
      simulatedViscosity < requestedViscosity * (1 - 1e-9)) throw new Error('Prepared viscosity does not match the requested physical/preview model')
  if (lbm.coefficientScale !== forceToCoefficient(1, lbm.density, lbm.inletVelocity, lbm.referenceArea)) throw new Error('Invalid prepared force coefficient scale')
  if (('fan' in params) !== !!lbm.fan || (params.thermalEnabled === true) !== !!lbm.thermal) {
    throw new Error('Job components and prepared forcing/temperature model must agree')
  }
  if (lbm.thermal) {
    const t = lbm.thermal
    const contacts = (params.thermalContacts ?? []) as LbmThermalContact[]
    if ((t.contacts?.length ?? 0) !== contacts.length || t.contacts?.some((contact, i) =>
      contact.first !== contacts[i].first || contact.second !== contacts[i].second || contact.resistanceM2KW !== contacts[i].resistanceM2KW)) {
      throw new Error('Thermal contacts and prepared contact resistances must agree')
    }
    const regions = (params.thermalRegions ?? []) as LbmThermalRegion[]
    const materials = t.materials ?? []
    if (materials.length !== regions.length || materials.some((material, i) =>
      material.density !== regions[i].solidDensityKgM3 || material.specificHeat !== regions[i].solidSpecificHeatJkgK ||
      material.conductivity !== regions[i].solidConductivityWmK || material.totalPowerW !== regions[i].totalPowerW)) {
      throw new Error('Thermal regions and prepared materials must agree')
    }
    if (t.mode !== (params.thermalMode ?? 'fixed-temperature') || t.ambientC !== (params.ambientTemp ?? 25) ||
        t.dtSeconds !== lbm.units.dt || t.dxMeters !== lbm.units.dx || t.fluidDensity !== lbm.density ||
        (params.dtSeconds !== undefined && t.dtSeconds !== params.dtSeconds) ||
        t.temperatureScaleC !== (t.mode === 'solid-power' ? 1 : t.fixedSurfaceC - t.ambientC) ||
        t.fluidSpecificHeat !== (params.fluidSpecificHeatJkgK ?? 1005) || t.fluidConductivity !== (params.fluidConductivityWmK ?? 0.026) ||
        (t.mode === 'fixed-temperature' ? t.fixedSurfaceC !== (params.heatSourceTemp ?? 60) :
          t.totalPowerW !== params.totalPowerW || t.solidDensity !== params.solidDensityKgM3 ||
          t.solidSpecificHeat !== params.solidSpecificHeatJkgK || t.solidConductivity !== params.solidConductivityWmK ||
          t.dtSeconds !== (params.dtSeconds ?? 0.0001))) throw new Error('Thermal inputs and prepared physical model must agree')
  }
  const maxSteps = run.maxSteps, sampleEvery = run.forceSampleEvery ?? 20, warmup = run.warmupSteps ?? 0
  const window = run.stopWhen?.window ?? 10, maxVariance = run.stopWhen?.maxCdVariance
  if (spec.outputs.fieldFrames !== undefined && !spec.outputs.fields?.length) throw new Error('Recorded LBM frames require output fields')
  const pressureField = spec.outputs.fields?.includes('pressure') === true
  const pressureScalePa = lbm.density * (lbm.units.dx / lbm.units.dt) ** 2
  if (pressureField && (!Number.isFinite(pressureScalePa) || pressureScalePa <= 0)) throw new Error('Invalid LBM pressure units')
  const fieldStride = spec.outputs.fieldStride ?? 1
  if (![1, 2, 4, 8].includes(fieldStride)) throw new Error('Recorded LBM frames require fieldStride of 1, 2, 4 or 8')
  const fieldSteps = spec.outputs.fields?.length ? lbmFieldSampleSteps(maxSteps, spec.outputs.fieldFrames, decimatedCellCount(lbm.nx, lbm.ny, lbm.nz, fieldStride), !!lbm.thermal, pressureField) : []
  signal?.throwIfAborted()
  const start = performance.now(), solver = new WasmLbm({ ...lbm, pressureField }, flags)
  let snapshot: LbmDisplaySnapshot | undefined
  const snapshots: LbmDisplaySnapshot[] = []
  const capture = async (step: number) => {
    signal?.throwIfAborted()
    const displayStride = pressureField ? (lbm.thermal ? 4 : 3) : (lbm.thermal ? 3 : 2)
    const coarse = decimateField(lbm.nx, lbm.ny, lbm.nz, solver.readDisplay(), flags, displayStride, fieldStride)
    snapshot = { nx: coarse.nx, ny: coarse.ny, nz: coarse.nz, step, displayStride,
      ...(pressureField ? { hasPressure: true } : {}), uLattice: lbm.units.uLattice,
      // stride=1 时 decimateField 直接返回 WASM 常驻显示缓冲，必须拷贝，否则后续步会覆写已存帧
      display: fieldStride === 1 ? coarse.display.slice() : coarse.display, flags: coarse.flags }
    if (onDisplaySnapshot) await onDisplaySnapshot(snapshot)
    else snapshots.push(snapshot)
  }
  let steps = 0, forceSteps = 0, fx = 0, fy = 0, fz = 0, dragN = 0, liftN = 0, sideN = 0
  let cd: number | undefined, cl: number | undefined
  const history = { step: [] as number[], cd: [] as number[], cl: [] as number[], dragN: [] as number[], liftN: [] as number[], sideN: [] as number[] }
  let thermal: JobResultV1['thermal']
  // Accumulate lattice mass over every executed step, including force warmup.
  // Convert once at the end so Rust/WASM use the same arithmetic order.
  let initialMass = 0, finalMass = 0, boundaryFinalMass = 0, inletMass = 0, outletMass = 0
  let collisionMass = 0, balanceResidual = 0, maxStepResidual = 0, inletReplacement = 0, outletReplacement = 0
  for (let step = 1; step <= maxSteps; step++) {
    signal?.throwIfAborted()
    const stats = solver.step()
    const m = stats.massBalance
    if (step === 1) initialMass = m.bulkMassBefore
    finalMass = m.bulkMassAfter; boundaryFinalMass = stats.mass - m.bulkMassAfter
    inletMass += m.inletNetMass; outletMass += m.outletNetMass; collisionMass += m.collisionMassChange
    inletReplacement += m.inletReplacementMass; outletReplacement += m.outletReplacementMass
    const stepResidual = m.bulkMassAfter - m.bulkMassBefore - m.inletNetMass + m.outletNetMass - m.collisionMassChange
    balanceResidual += stepResidual; maxStepResidual = Math.max(maxStepResidual, Math.abs(stepResidual))
    if (stats.thermal && lbm.thermal) {
      const t = stats.thermal
      thermal = { ...t, mode: lbm.thermal.mode, solidVolumeM3: lbm.solidCells * lbm.units.dx * lbm.units.dx * lbm.units.dx,
        sourceEnergyJ: (thermal?.sourceEnergyJ ?? 0) + t.sourceEnergyJ,
        boundaryEnergyJ: (thermal?.boundaryEnergyJ ?? 0) + t.boundaryEnergyJ,
        energyResidualJ: (thermal?.energyResidualJ ?? 0) + t.energyResidualJ,
        maxAbsEnergyResidualJ: Math.max(thermal?.maxAbsEnergyResidualJ ?? 0, Math.abs(t.energyResidualJ)),
        thermalSubsteps: Math.max(thermal?.thermalSubsteps ?? 0, t.thermalSubsteps) }
    }
    steps = step; forceSteps++; fx += stats.obstacleForce[0]; fy += stats.obstacleForce[1]; fz += stats.obstacleForce[2]
    if (step % sampleEvery === 0 || step === warmup || step === maxSteps) {
      dragN = (fx / forceSteps) * lbm.forceScale; liftN = (fy / forceSteps) * lbm.forceScale; sideN = (fz / forceSteps) * lbm.forceScale
      cd = lbm.coefficientScale == null ? undefined : dragN * lbm.coefficientScale
      cl = lbm.coefficientScale == null ? undefined : liftN * lbm.coefficientScale
      if (![dragN, liftN, sideN].every(Number.isFinite) || (cd != null && !Number.isFinite(cd)) || (cl != null && !Number.isFinite(cl))) throw new Error('Non-finite LBM force')
      fx = 0; fy = 0; fz = 0; forceSteps = 0
      if (step > warmup && (spec.outputs.history || maxVariance != null)) {
        history.step.push(step); history.dragN.push(dragN); history.liftN.push(liftN); history.sideN.push(sideN)
        if (cd != null && cl != null) { history.cd.push(cd); history.cl.push(cl) }
      }
      if (maxVariance != null && history.cd.length >= window) {
        const values = history.cd.slice(-window), mean = values.reduce((a, b) => a + b, 0) / window
        if (values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / window <= maxVariance) break
      }
    }
    if (step % 4 === 0 || step === maxSteps) {
      await onProgress?.({ step, total: maxSteps, ...(cd != null && cl != null ? { cd, cl } : {}) })
      await new Promise<void>(resolve => setTimeout(resolve, 0))
    }
    if (fieldSteps.includes(step)) await capture(step)
  }
  signal?.throwIfAborted()
  await onProgress?.({ step: steps, total: maxSteps, ...(cd != null && cl != null ? { cd, cl } : {}) })
  if (fieldSteps.length && snapshot?.step !== steps) await capture(steps)
  const massScale = lbm.density * lbm.units.dx * lbm.units.dx * lbm.units.dx
  const lbmMassBalance: NonNullable<JobResultV1['lbmMassBalance']> = {
    scope: 'internal-fluid-x', initialMassKg: initialMass * massScale, finalMassKg: finalMass * massScale,
    inletMassKg: inletMass * massScale, outletMassKg: outletMass * massScale, collisionMassChangeKg: collisionMass * massScale,
    balanceResidualKg: balanceResidual * massScale, maxAbsStepBalanceResidualKg: maxStepResidual * massScale,
    boundaryFinalMassKg: boundaryFinalMass * massScale, inletReconstructionMassKg: inletReplacement * massScale,
    outletReconstructionMassKg: outletReplacement * massScale,
  }
  if (!Number.isFinite(massScale) || massScale <= 0 ||
      Object.entries(lbmMassBalance).some(([key, value]) => key !== 'scope' && !Number.isFinite(value))) throw new Error('Non-finite LBM mass balance')
  return { snapshot, snapshots, result: { schemaVersion: 1,
    lbmMassBalance,
    ...(thermal ? { thermal } : {}),
    summary: { steps, wallTimeMs: performance.now() - start, ...(cd != null && cl != null ? { cd, cl } : {}), dragN, liftN, sideN,
      reynoldsPhysical: lbm.units.reynoldsPhysical, reynoldsLattice: lbm.units.reynoldsLattice,
      solidCells: lbm.solidCells, solverPackage: 'w-sim-kernels', method: 'lbm-d3q19-wasm' },
    derived: { [LBM_MASS_BALANCE_FEATURE]: 1, [LBM_NEE_INLET_FEATURE]: 1, [LBM_NEE_OUTLET_FEATURE]: 1, [LBM_GAUGE_FORCE_FEATURE]: 1, dx: lbm.units.dx, dt: lbm.units.dt, referenceArea: lbm.referenceArea, cellCount: flags.length,
      ...(pressureField ? { [LBM_PRESSURE_FIELD_FEATURE]: 1, pressureScalePa } : {}),
      ...(spec.outputs.fieldFrames !== undefined && spec.outputs.fieldFrames > 1 ? { [LBM_FIELD_HISTORY_FEATURE]: 1 } : {}),
      requestedViscosityM2s: lbm.units.requestedViscosityM2s, simulatedViscosityM2s: lbm.units.simulatedViscosityM2s,
      viscosityMode: lbm.units.viscosityMode,
      ...(ground ? { [LBM_GROUND_FEATURE]: 1, groundMode: ground.mode, groundClearanceM: ground.clearanceM, groundVelocityMps } : {}),
      ...(lbm.thermal ? { ambientC: lbm.thermal.ambientC, temperatureScaleC: lbm.thermal.temperatureScaleC,
        ...Object.fromEntries(LBM_THERMAL_FEATURES.map(feature => [feature, 1])),
        thermalDiffusivityPhysical: lbm.thermal.thermalDiffusivityPhysical } : {}),
      precision: 'mixed', engine: 'rust-wasm', version: '0.1.0' }, backend: { id: 'cpu' },
    ...(spec.outputs.history || maxVariance != null ? { history: { step: history.step, dragN: history.dragN, liftN: history.liftN, sideN: history.sideN,
      ...(lbm.coefficientScale == null ? {} : { cd: history.cd, cl: history.cl }) } } : {}),
  } }
}

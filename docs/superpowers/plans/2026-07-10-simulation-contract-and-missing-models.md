# Simulation Contract and Missing Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the 37-route simulation capability contract, replace the three static spectrum routes with physical models, and make FDTD visibly active on first load.

**Architecture:** Keep each physical solver independent while adding a small shared lifecycle/status layer and a catalog that drives tests. The three missing routes share a presentation shell but use separate electromagnetic, acoustic, and oscillator kernels; FDTD keeps its existing WebGPU/CPU backend and gains a deterministic initial source.

**Tech Stack:** React 18, TypeScript 5.6, Canvas 2D, existing simulation hooks, Vitest 2, Playwright 1.51, Vite 5.

## Global Constraints

- Cover every one of the 37 Sim-domain leaves from `src/nav.ts`; the catalog test must reject missing or extra paths.
- Use a shared simulation runtime with independent physical engines; do not create a universal numerical solver.
- A static reference page is not an accepted simulation mode.
- A stepped model must expose a meaningful initial state, pause/resume, and deterministic reset.
- Preserve page-level lazy loading and Cloudflare Pages static hosting.
- Preserve bilingual Chinese/English controls, state, observables, and errors.
- Do not add a server, worker backend, or new runtime dependency.

---

### Task 1: Simulation Capability Catalog

**Files:**
- Create: `src/data/simulations.ts`
- Create: `src/data/simulations.test.ts`
- Modify: `src/nav.ts:183-196`

**Interfaces:**
- Consumes: `DOMAINS` from `src/nav.ts`.
- Produces: `SimulationMode`, `SimulationRenderer`, `SimulationBackend`, `SimulationProfile`, `SIMULATION_PROFILES`, and `simulationProfile(path)`.

- [ ] **Step 1: Write the failing parity and uniqueness tests**

```ts
import { describe, expect, it } from 'vitest'
import { DOMAINS } from './nav'
import { SIMULATION_PROFILES, simulationProfile } from './simulations'

describe('simulation capability catalog', () => {
  const sim = DOMAINS.find((domain) => domain.key === 'sim')!
  const navPaths = sim.facets.flatMap((facet) => facet.items.map((item) => item.path)).sort()
  const profilePaths = SIMULATION_PROFILES.map((profile) => profile.path).sort()

  it('covers every Sim leaf exactly once', () => {
    expect(navPaths).toHaveLength(37)
    expect(profilePaths).toEqual(navPaths)
    expect(new Set(profilePaths).size).toBe(profilePaths.length)
  })

  it('provides a profile lookup', () => {
    expect(simulationProfile('fdtd')?.backend).toBe('webgpu-cpu')
    expect(simulationProfile('electromagnetic')?.mode).toBe('stepped')
    expect(simulationProfile('matrix')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the catalog test and confirm it fails because the module does not exist**

Run: `npx vitest run src/data/simulations.test.ts`

Expected: FAIL with `Failed to resolve import "./simulations"`.

- [ ] **Step 3: Add the typed catalog with all 37 entries**

```ts
export type SimulationMode = 'stepped' | 'parametric' | 'interactive'
export type SimulationRenderer = 'canvas-2d' | 'three' | 'svg'
export type SimulationBackend = 'cpu' | 'webgpu-cpu'

export type SimulationProfile = {
  path: string
  mode: SimulationMode
  renderer: SimulationRenderer
  backend: SimulationBackend
  engine: string
}

export const SIMULATION_PROFILES: readonly SimulationProfile[] = [
  { path: 'optics-lab', mode: 'interactive', renderer: 'svg', backend: 'cpu', engine: 'lab/optics-lab' },
  { path: 'electromagnetic', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/electromagnetic-wave' },
  { path: 'sound', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/acoustic-wave' },
  { path: 'vibration', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/driven-oscillator' },
  { path: 'ripple', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/wave' },
  { path: 'fdtd', mode: 'stepped', renderer: 'canvas-2d', backend: 'webgpu-cpu', engine: 'webgpu/fdtdSim' },
  { path: 'emwave3d', mode: 'interactive', renderer: 'three', backend: 'cpu', engine: 'sim/emwave3d-field' },
  { path: 'antenna3d', mode: 'interactive', renderer: 'three', backend: 'cpu', engine: 'sim/antenna' },
  { path: 'antennapattern', mode: 'parametric', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/antennalink' },
  { path: 'antennas', mode: 'parametric', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/antennatypes' },
  { path: 'phasedarray', mode: 'parametric', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/phasedarray' },
  { path: 'faraday', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/faraday' },
  { path: 'rlc', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/rlc' },
  { path: 'mutual', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/mutual' },
  { path: 'transient', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/transient' },
  { path: 'md', mode: 'stepped', renderer: 'canvas-2d', backend: 'webgpu-cpu', engine: 'webgpu/mdSim' },
  { path: 'pedotpss', mode: 'stepped', renderer: 'canvas-2d', backend: 'webgpu-cpu', engine: 'webgpu/pedotpssSim' },
  { path: 'ising', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/ising' },
  { path: 'fluid', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/fluid' },
  { path: 'windtunnel', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/fluid' },
  { path: 'convection', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/fluid' },
  { path: 'sim', mode: 'stepped', renderer: 'canvas-2d', backend: 'webgpu-cpu', engine: 'webgpu/heatSim' },
  { path: 'heaterfc', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/heaterfc' },
  { path: 'ecg', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/ecg' },
  { path: 'emg', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/emg' },
  { path: 'eeg', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/eeg' },
  { path: 'neuron', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/neuron' },
  { path: 'biopipeline', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/biodsp' },
  { path: 'ultrasound', mode: 'parametric', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/ultrasound' },
  { path: 'stm', mode: 'parametric', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/stm' },
  { path: 'afm', mode: 'parametric', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/afm' },
  { path: 'radar', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/wave' },
  { path: 'localization', mode: 'parametric', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/trilateration' },
  { path: 'tdoa', mode: 'parametric', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/tdoa' },
  { path: 'nljd', mode: 'parametric', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/nljd' },
  { path: 'laser', mode: 'stepped', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/laser' },
  { path: 'display', mode: 'parametric', renderer: 'canvas-2d', backend: 'cpu', engine: 'sim/display' },
] as const

const PROFILE_BY_PATH = new Map(SIMULATION_PROFILES.map((profile) => [profile.path, profile]))

export function simulationProfile(path: string): SimulationProfile | undefined {
  return PROFILE_BY_PATH.get(path)
}
```

Export `SIMULATION_PROFILES` and its types from `src/nav.ts` next to the existing navigation exports so browser tests can import navigation and capabilities from stable non-React modules.

- [ ] **Step 4: Run the catalog test**

Run: `npx vitest run src/data/simulations.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit the catalog**

```bash
git add src/data/simulations.ts src/data/simulations.test.ts src/nav.ts
git commit -m "feat(sim): catalog simulation capabilities"
```

### Task 2: Shared Runtime Status and Frame Error Path

**Files:**
- Create: `src/lib/simulation/runtime.ts`
- Create: `src/lib/simulation/runtime.test.ts`
- Create: `src/components/SimulationStatus.tsx`
- Modify: `src/lib/hooks/useRafLoop.ts:1-54`
- Modify: `src/lib/hooks/index.ts:1-9`

**Interfaces:**
- Produces: `SimulationPhase`, `SimulationRuntimeState`, `simulationReady`, `simulationFallback`, `simulationFailed`, `asSimulationError`, `RafLoopOptions`, and `SimulationStatus`.
- Existing two-argument `useRafLoop(frame, deps)` calls remain source-compatible; new pages use `useRafLoop(frame, deps, { onError })`.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  asSimulationError,
  simulationFailed,
  simulationFallback,
  simulationReady,
  type SimulationRuntimeState,
} from './runtime'

const initial: SimulationRuntimeState = { phase: 'initializing', backend: null, error: null }

describe('simulation runtime state', () => {
  it('transitions from initialization through CPU fallback', () => {
    expect(simulationReady(initial, 'webgpu')).toEqual({ phase: 'running', backend: 'webgpu', error: null })
    expect(simulationFallback(initial, 'device lost')).toEqual({ phase: 'fallback', backend: 'cpu', error: 'device lost' })
  })

  it('normalizes and exposes frame failures', () => {
    expect(asSimulationError('bad frame').message).toBe('bad frame')
    expect(simulationFailed(initial, new Error('NaN state'))).toEqual({
      phase: 'error', backend: null, error: 'NaN state',
    })
  })
})
```

- [ ] **Step 2: Run the runtime test and confirm the missing-module failure**

Run: `npx vitest run src/lib/simulation/runtime.test.ts`

Expected: FAIL with `Failed to resolve import "./runtime"`.

- [ ] **Step 3: Implement lifecycle types and transitions**

```ts
export type SimulationPhase = 'initializing' | 'running' | 'paused' | 'fallback' | 'error'
export type SimulationBackend = 'webgpu' | 'cpu' | null

export type SimulationRuntimeState = {
  phase: SimulationPhase
  backend: SimulationBackend
  error: string | null
}

export function asSimulationError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

export function simulationReady(
  state: SimulationRuntimeState,
  backend: Exclude<SimulationBackend, null>,
): SimulationRuntimeState {
  return { ...state, phase: 'running', backend, error: null }
}

export function simulationFallback(
  state: SimulationRuntimeState,
  reason: string,
): SimulationRuntimeState {
  return { ...state, phase: 'fallback', backend: 'cpu', error: reason }
}

export function simulationFailed(
  state: SimulationRuntimeState,
  reason: unknown,
): SimulationRuntimeState {
  return { ...state, phase: 'error', error: asSimulationError(reason).message }
}
```

- [ ] **Step 4: Extend `useRafLoop` without breaking existing callers**

Add this exported option type and third parameter:

```ts
export type RafLoopOptions = {
  onError?: (error: Error) => void
}

export function useRafLoop(
  frame: (ctx: RafFrameContext) => void | Promise<void>,
  deps: DependencyList,
  options: RafLoopOptions = {},
): void {
```

Replace direct frame invocation with a guarded invocation. Both synchronous and
asynchronous failures call `onError`, set `disposed`, and prevent rescheduling:

```ts
const fail = (reason: unknown) => {
  if (disposed) return
  disposed = true
  busy = false
  options.onError?.(asSimulationError(reason))
  cancelAnimationFrame(raf)
}

let result: void | Promise<void>
try {
  result = frame(ctx)
} catch (error) {
  fail(error)
  return
}
if (result && typeof result.then === 'function') {
  result.then(
    () => {
      busy = false
      if (!disposed) raf = scheduleRafIfVisible(disposed, loop)
    },
    fail,
  )
} else {
  busy = false
  raf = scheduleRafIfVisible(disposed, loop)
}
```

Import `asSimulationError` from `../simulation/runtime`, and export
`RafLoopOptions` from `src/lib/hooks/index.ts`.

- [ ] **Step 5: Add the compact bilingual status component**

```tsx
import type { SimulationRuntimeState } from '../lib/simulation/runtime'
import { useLocale } from '../lib/i18n'

export function SimulationStatus({ state }: { state: SimulationRuntimeState }) {
  const { locale } = useLocale()
  const zh = locale === 'zh'
  const label = state.phase === 'initializing'
    ? (zh ? '初始化…' : 'Initializing…')
    : state.phase === 'fallback'
      ? (zh ? '已切换本机计算' : 'Using CPU fallback')
      : state.phase === 'error'
        ? (zh ? `仿真错误：${state.error}` : `Simulation error: ${state.error}`)
        : state.phase === 'paused'
          ? (zh ? '已暂停' : 'Paused')
          : state.backend === 'webgpu'
            ? (zh ? '图形加速' : 'GPU')
            : (zh ? '本机计算' : 'CPU')

  return (
    <span
      data-sim-status={state.phase}
      role={state.phase === 'error' ? 'alert' : 'status'}
      className={state.phase === 'error' ? 'text-red-300' : 'text-slate-400'}
    >
      {label}
    </span>
  )
}
```

- [ ] **Step 6: Run focused and full hook/runtime tests**

Run: `npx vitest run src/lib/simulation/runtime.test.ts src/lib/hooks/hooks.test.ts`

Expected: PASS, with all existing two-argument hook users compiling under `npm run build` later.

- [ ] **Step 7: Commit the runtime layer**

```bash
git add src/lib/simulation src/lib/hooks src/components/SimulationStatus.tsx
git commit -m "feat(sim): surface runtime and frame errors"
```

### Task 3: Electromagnetic Traveling-Wave Kernel

**Files:**
- Create: `src/lib/sim/electromagnetic-wave.ts`
- Create: `src/lib/sim/electromagnetic-wave.test.ts`

**Interfaces:**
- Produces: `LIGHT_SPEED`, `VACUUM_IMPEDANCE`, `ElectromagneticMedium`, `emWaveObservables`, and `emWaveSample`.

- [ ] **Step 1: Write equation and limiting-case tests**

```ts
import { describe, expect, it } from 'vitest'
import { LIGHT_SPEED, emWaveObservables, emWaveSample } from './electromagnetic-wave'

describe('electromagnetic traveling wave', () => {
  it('derives speed, wavelength, and impedance from refractive index', () => {
    const out = emWaveObservables(600e12, 1.5, 3)
    expect(out.speed).toBeCloseTo(LIGHT_SPEED / 1.5, 3)
    expect(out.wavelength).toBeCloseTo(out.speed / 600e12, 12)
    expect(out.impedance).toBeCloseTo(376.730313668 / 1.5, 6)
  })

  it('keeps E and B in phase with B = E / v', () => {
    const out = emWaveSample(0.25, 0, { frequencyHz: 1e9, refractiveIndex: 2, electricAmplitude: 4 })
    expect(out.electric).toBeCloseTo(4, 8)
    expect(out.magnetic).toBeCloseTo(out.electric / (LIGHT_SPEED / 2), 12)
  })
})
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run: `npx vitest run src/lib/sim/electromagnetic-wave.test.ts`

Expected: FAIL with `Failed to resolve import "./electromagnetic-wave"`.

- [ ] **Step 3: Implement the pure electromagnetic model**

```ts
export const LIGHT_SPEED = 299_792_458
export const VACUUM_IMPEDANCE = 376.730313668

export type ElectromagneticMedium = {
  frequencyHz: number
  refractiveIndex: number
  electricAmplitude: number
}

export function emWaveObservables(
  frequencyHz: number,
  refractiveIndex: number,
  electricAmplitude: number,
) {
  const speed = LIGHT_SPEED / refractiveIndex
  const wavelength = speed / frequencyHz
  const impedance = VACUUM_IMPEDANCE / refractiveIndex
  const intensity = (electricAmplitude * electricAmplitude) / (2 * impedance)
  return { speed, wavelength, impedance, intensity }
}

export function emWaveSample(
  positionWavelengths: number,
  timePeriods: number,
  medium: ElectromagneticMedium,
) {
  const phase = 2 * Math.PI * (positionWavelengths - timePeriods)
  const electric = medium.electricAmplitude * Math.sin(phase)
  const speed = LIGHT_SPEED / medium.refractiveIndex
  return { electric, magnetic: electric / speed }
}
```

- [ ] **Step 4: Run the kernel test**

Run: `npx vitest run src/lib/sim/electromagnetic-wave.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit the electromagnetic kernel**

```bash
git add src/lib/sim/electromagnetic-wave.ts src/lib/sim/electromagnetic-wave.test.ts
git commit -m "feat(sim): add electromagnetic wave kernel"
```

### Task 4: Acoustic Traveling-Wave Kernel

**Files:**
- Create: `src/lib/sim/acoustic-wave.ts`
- Create: `src/lib/sim/acoustic-wave.test.ts`

**Interfaces:**
- Produces: `ACOUSTIC_MEDIA`, `AcousticMediumId`, `acousticObservables`, and `acousticSample`.

- [ ] **Step 1: Write pressure, wavelength, intensity, and attenuation tests**

```ts
import { describe, expect, it } from 'vitest'
import { acousticObservables, acousticSample } from './acoustic-wave'

describe('acoustic traveling wave', () => {
  it('derives wavelength and plane-wave intensity in air', () => {
    const out = acousticObservables('air', 1000, 2)
    expect(out.wavelength).toBeCloseTo(343 / 1000, 6)
    expect(out.intensity).toBeCloseTo((2 * 2) / (2 * 1.225 * 343), 8)
  })

  it('attenuates pressure while preserving pressure/velocity impedance', () => {
    const near = acousticSample(0.25, 0, { medium: 'water', frequencyHz: 1e6, pressureAmplitude: 1e5, distanceM: 0 })
    const far = acousticSample(0.25, 0, { medium: 'water', frequencyHz: 1e6, pressureAmplitude: 1e5, distanceM: 10 })
    expect(Math.abs(far.pressure)).toBeLessThan(Math.abs(near.pressure))
    expect(near.particleVelocity).toBeCloseTo(near.pressure / (997 * 1480), 10)
  })
})
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run: `npx vitest run src/lib/sim/acoustic-wave.test.ts`

Expected: FAIL with `Failed to resolve import "./acoustic-wave"`.

- [ ] **Step 3: Implement the acoustic model**

```ts
export const ACOUSTIC_MEDIA = {
  air: { speed: 343, density: 1.225, attenuation: 0.0002 },
  water: { speed: 1480, density: 997, attenuation: 0.002 },
  steel: { speed: 5960, density: 7850, attenuation: 0.0005 },
} as const

export type AcousticMediumId = keyof typeof ACOUSTIC_MEDIA
export type AcousticWaveParams = {
  medium: AcousticMediumId
  frequencyHz: number
  pressureAmplitude: number
  distanceM: number
}

export function acousticObservables(
  medium: AcousticMediumId,
  frequencyHz: number,
  pressureAmplitude: number,
) {
  const material = ACOUSTIC_MEDIA[medium]
  const wavelength = material.speed / frequencyHz
  const impedance = material.density * material.speed
  const intensity = (pressureAmplitude * pressureAmplitude) / (2 * impedance)
  return { ...material, wavelength, impedance, intensity }
}

export function acousticSample(
  positionWavelengths: number,
  timePeriods: number,
  params: AcousticWaveParams,
) {
  const material = ACOUSTIC_MEDIA[params.medium]
  const envelope = Math.exp(-material.attenuation * params.distanceM)
  const pressure = params.pressureAmplitude * envelope * Math.sin(2 * Math.PI * (positionWavelengths - timePeriods))
  return { pressure, particleVelocity: pressure / (material.density * material.speed) }
}
```

- [ ] **Step 4: Run the kernel test**

Run: `npx vitest run src/lib/sim/acoustic-wave.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit the acoustic kernel**

```bash
git add src/lib/sim/acoustic-wave.ts src/lib/sim/acoustic-wave.test.ts
git commit -m "feat(sim): add acoustic wave kernel"
```

### Task 5: Driven-Oscillator Kernel

**Files:**
- Create: `src/lib/sim/driven-oscillator.ts`
- Create: `src/lib/sim/driven-oscillator.test.ts`

**Interfaces:**
- Produces: `DrivenOscillatorParams`, `oscillatorObservables`, `oscillatorSample`, and `resonanceCurve`.

- [ ] **Step 1: Write natural-frequency, damping, and resonance tests**

```ts
import { describe, expect, it } from 'vitest'
import { oscillatorObservables, oscillatorSample } from './driven-oscillator'

describe('damped driven oscillator', () => {
  const params = { massKg: 1, stiffnessNpm: 100, dampingNsPm: 1, driveForceN: 2, driveHz: 10 / (2 * Math.PI) }

  it('computes natural frequency and finite resonance amplitude', () => {
    const out = oscillatorObservables(params)
    expect(out.naturalAngularFrequency).toBeCloseTo(10, 10)
    expect(out.naturalFrequencyHz).toBeCloseTo(10 / (2 * Math.PI), 10)
    expect(out.amplitudeM).toBeCloseTo(0.2, 6)
    expect(Number.isFinite(out.phaseRad)).toBe(true)
  })

  it('samples the steady-state displacement within its amplitude', () => {
    const out = oscillatorObservables(params)
    expect(Math.abs(oscillatorSample(0.3, params))).toBeLessThanOrEqual(out.amplitudeM + 1e-12)
  })
})
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run: `npx vitest run src/lib/sim/driven-oscillator.test.ts`

Expected: FAIL with `Failed to resolve import "./driven-oscillator"`.

- [ ] **Step 3: Implement the oscillator model**

```ts
export type DrivenOscillatorParams = {
  massKg: number
  stiffnessNpm: number
  dampingNsPm: number
  driveForceN: number
  driveHz: number
}

export function oscillatorObservables(params: DrivenOscillatorParams) {
  const naturalAngularFrequency = Math.sqrt(params.stiffnessNpm / params.massKg)
  const naturalFrequencyHz = naturalAngularFrequency / (2 * Math.PI)
  const driveAngularFrequency = 2 * Math.PI * params.driveHz
  const elastic = params.stiffnessNpm - params.massKg * driveAngularFrequency ** 2
  const damping = params.dampingNsPm * driveAngularFrequency
  const amplitudeM = params.driveForceN / Math.hypot(elastic, damping)
  const phaseRad = Math.atan2(damping, elastic)
  const dampingRatio = params.dampingNsPm / (2 * Math.sqrt(params.massKg * params.stiffnessNpm))
  return { naturalAngularFrequency, naturalFrequencyHz, driveAngularFrequency, amplitudeM, phaseRad, dampingRatio }
}

export function oscillatorSample(timeSeconds: number, params: DrivenOscillatorParams): number {
  const out = oscillatorObservables(params)
  return out.amplitudeM * Math.sin(out.driveAngularFrequency * timeSeconds - out.phaseRad)
}

export function resonanceCurve(frequencyHz: number, params: DrivenOscillatorParams): number {
  return oscillatorObservables({ ...params, driveHz: frequencyHz }).amplitudeM
}
```

- [ ] **Step 4: Run the kernel test**

Run: `npx vitest run src/lib/sim/driven-oscillator.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit the oscillator kernel**

```bash
git add src/lib/sim/driven-oscillator.ts src/lib/sim/driven-oscillator.test.ts
git commit -m "feat(sim): add driven oscillator kernel"
```

### Task 6: Shared Spectrum Simulation Shell and Three Real Pages

**Files:**
- Create: `src/components/SpectrumSimulation.tsx`
- Modify: `src/components/SpectrumView.tsx:1-60`
- Modify: `src/data/spectrum.ts:1-250`
- Modify: `src/pages/Electromagnetic.tsx:1-6`
- Modify: `src/pages/Sound.tsx:1-6`
- Modify: `src/pages/Vibration.tsx:1-6`

**Interfaces:**
- Consumes: the three kernels from Tasks 3-5 and existing `Spectrum` data.
- Produces: `SpectrumBands` and `SpectrumSimulation`, plus visible stages with `data-sim-stage` and observables with `data-sim-observable`.

- [ ] **Step 1: Extend spectrum data with representative numeric frequencies**

Add `sampleHz: number` to `Band`. Populate the existing bands in order with:

```ts
// electromagnetic
[1e8, 10e9, 30e12, 550e12, 1.5e15, 3e17, 3e19]
// sound
[10, 100, 1000, 10_000, 1e6]
// vibration
[1e13, 5e13, 1000, 10, 1e-4]
```

The values are representative samples for calculations; existing textual
ranges remain unchanged.

- [ ] **Step 2: Extract reusable `SpectrumBands` while preserving `SpectrumView`**

`SpectrumBands({ spectrum })` renders the existing frequency bar and band-card
grid. `SpectrumView({ spectrum })` remains a compatibility wrapper containing
`PageHeader` followed by `SpectrumBands`.

- [ ] **Step 3: Implement `SpectrumSimulation`**

Use this public prop contract:

```tsx
export type SpectrumSimulationProps = {
  spectrum: Spectrum
  controls: ReactNode
  readouts: ReactNode
  note: string
  noteEn: string
  drawFrame: (ctx: CanvasRenderingContext2D, width: number, height: number, time: number) => void
}
```

The component owns `useRunning(true)`, a `timeRef`, reset counter, frame error
state, `PlayPauseButton`, `SpeedControl`, `SimulationStatus`, and a
`640 x 300` canvas. Advance `timeRef.current` by `1 / 120 * playSpeed` per
running frame, call `drawFrame` even while paused so the initial/reset frame is
visible, and expose these stable hooks:

```tsx
<canvas data-sim-stage={spectrum.id} aria-label={`${title} simulation`} />
<button data-sim-reset={spectrum.id}>...</button>
<div data-sim-observable={spectrum.id}>{readouts}</div>
```

On reset, set time to zero and increment the reset counter. On frame error, set
`SimulationRuntimeState.phase` to `error`, stop running, and render
`SimulationStatus` with the error.

- [ ] **Step 4: Replace the electromagnetic static wrapper**

The page keeps the selected spectrum band and controls refractive index
`1..2.5` and electric amplitude `1..10 V/m`. Its `drawFrame` draws transverse
electric and magnetic curves over four wavelengths, a center propagation axis,
and E/B legends. Readouts show numeric frequency, wavelength, phase speed,
impedance, and intensity from `emWaveObservables`.

Use `data-sim-control="electromagnetic-band"` on the band selector and
`data-sim-control="electromagnetic-index"` on the refractive-index range.

- [ ] **Step 5: Replace the sound static wrapper**

The page keeps selected band, acoustic medium (`air`, `water`, `steel`), and
pressure amplitude `0.1..10 Pa`. Its `drawFrame` renders moving compression/
rarefaction particles above a pressure curve over four wavelengths. Readouts
show numeric frequency, wave speed, wavelength, impedance, and intensity from
`acousticObservables`.

Use `data-sim-control="sound-band"` and `data-sim-control="sound-medium"`.

- [ ] **Step 6: Replace the vibration static wrapper**

The page controls mass `0.2..5 kg`, stiffness `10..500 N/m`, damping
`0.1..20 N s/m`, and drive frequency `0.1..10 Hz`. Its `drawFrame` renders a
spring-mass displacement trace in the upper half and a resonance curve in the
lower half. Readouts show natural frequency, drive frequency, damping ratio,
steady amplitude, and phase from `oscillatorObservables`.

Use `data-sim-control="vibration-drive"` on the drive-frequency range.

- [ ] **Step 7: Run kernel tests and compile the pages**

Run: `npx vitest run src/lib/sim/electromagnetic-wave.test.ts src/lib/sim/acoustic-wave.test.ts src/lib/sim/driven-oscillator.test.ts`

Expected: PASS, 6 tests.

Run: `npm run build`

Expected: TypeScript and Vite build succeed; chunk-size warnings are allowed.

- [ ] **Step 8: Commit the three real spectrum pages**

```bash
git add src/components/SpectrumSimulation.tsx src/components/SpectrumView.tsx src/data/spectrum.ts src/pages/Electromagnetic.tsx src/pages/Sound.tsx src/pages/Vibration.tsx
git commit -m "feat(sim): make spectrum routes runnable"
```

### Task 7: FDTD Initial Source and Direct Backend Test

**Files:**
- Create: `src/lib/webgpu/fdtdSim.test.ts`
- Modify: `src/pages/Fdtd.tsx:190-343`

**Interfaces:**
- Consumes: existing `createFdtdSim`, `FdtdSim`, and page emitter representation.
- Produces: a deterministic initial line source on load/reset and a stable `data-sim-stage="fdtd"` selector.

- [ ] **Step 1: Write a failing direct CPU-backend test**

```ts
import { describe, expect, it } from 'vitest'
import { createFdtdSim } from './fdtdSim'

describe('FdtdSim CPU contract', () => {
  it('injects, steps, reads finite non-zero fields, and exposes metadata', async () => {
    const sim = await createFdtdSim({ Nx: 24, Ny: 18, preferCpu: true })
    sim.injectSource(6, 9, 1)
    await sim.step(4)
    const { Ez, meta } = await sim.read()
    expect(meta).toMatchObject({ Nx: 24, Ny: 18, backend: 'cpu' })
    expect(Ez.some((value) => Math.abs(value) > 1e-6)).toBe(true)
    expect(Ez.every(Number.isFinite)).toBe(true)
    sim.destroy()
  })
})
```

- [ ] **Step 2: Run the backend test**

Run: `npx vitest run src/lib/webgpu/fdtdSim.test.ts`

Expected: PASS. If it fails, fix the CPU adapter contract before changing the page.

- [ ] **Step 3: Seed an initial source in the page effect**

Replace the empty emitter reset with this deterministic source before the
solver loop starts:

```ts
const initialShape = shapeRef.current
emittersRef.current = [{
  i: Math.round(NX * 0.18),
  j: Math.round(NY * 0.5),
  born: 0,
  cw: timeRef.current === 'cw',
}]
if (initialShape === 'line') {
  emittersRef.current[0]!.j = Math.round(NY * 0.5)
}
```

Reset continues to rebuild the simulation, which recreates the same source.
Add `data-sim-stage="fdtd"` to the stage canvas and
`data-sim-reset="fdtd"` to the reset button.

- [ ] **Step 4: Run FDTD-focused tests and build**

Run: `npx vitest run src/lib/sim/fdtd.test.ts src/lib/webgpu/fdtdSim.test.ts src/lib/webgpu/gpuFallback.test.ts`

Expected: PASS.

Run: `npm run build`

Expected: TypeScript and Vite build succeed.

- [ ] **Step 5: Commit the FDTD initial state**

```bash
git add src/lib/webgpu/fdtdSim.test.ts src/pages/Fdtd.tsx
git commit -m "fix(sim): seed the FDTD field on load"
```

### Task 8: Browser Contract for the First Four Upgrades

**Files:**
- Create: `e2e/simulation-contract.spec.ts`

**Interfaces:**
- Consumes: `SIMULATION_PROFILES` and the stable `data-sim-*` selectors from Tasks 6-7.
- Produces: headless proof of non-empty initial stages, dynamics, and control response for `electromagnetic`, `sound`, `vibration`, and `fdtd`.

- [ ] **Step 1: Add stage pixel and screenshot-change helpers**

```ts
import { expect, test } from '@playwright/test'

async function colorCount(canvas: import('@playwright/test').Locator): Promise<number> {
  return canvas.evaluate((node) => {
    const c = node as HTMLCanvasElement
    const ctx = c.getContext('2d')
    if (!ctx) return 0
    const data = ctx.getImageData(0, 0, c.width, c.height).data
    const colors = new Set<string>()
    const stride = Math.max(4, Math.floor(data.length / 800 / 4) * 4)
    for (let i = 0; i < data.length; i += stride) {
      colors.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`)
    }
    return colors.size
  })
}

async function expectMoving(stage: import('@playwright/test').Locator) {
  const first = await stage.screenshot()
  await stage.page().waitForTimeout(300)
  const second = await stage.screenshot()
  expect(second.equals(first)).toBe(false)
}
```

- [ ] **Step 2: Add the four route contracts**

```ts
for (const path of ['electromagnetic', 'sound', 'vibration', 'fdtd'] as const) {
  test(`${path} has a non-empty moving initial stage`, async ({ page }) => {
    await page.goto(`/${path}`)
    const stage = page.locator(`[data-sim-stage="${path}"]`)
    await expect(stage).toBeVisible()
    await expect.poll(() => colorCount(stage)).toBeGreaterThan(4)
    await expectMoving(stage)
  })
}

for (const [path, control] of [
  ['electromagnetic', 'electromagnetic-index'],
  ['sound', 'sound-medium'],
  ['vibration', 'vibration-drive'],
] as const) {
  test(`${path} responds to a physical control`, async ({ page }) => {
    await page.goto(`/${path}`)
    const observable = page.locator(`[data-sim-observable="${path}"]`)
    const before = await observable.innerText()
    const input = page.locator(`[data-sim-control="${control}"]`)
    await input.focus()
    await input.press('ArrowRight')
    await expect.poll(() => observable.innerText()).not.toBe(before)
  })
}
```

The FDTD stage check proves the route evolves without a user click.

- [ ] **Step 3: Build and run the focused browser contract**

Run: `npm run build`

Expected: PASS.

Run: `npx playwright test e2e/simulation-contract.spec.ts --workers=1`

Expected: PASS, 7 tests.

- [ ] **Step 4: Run all route smoke tests**

Run: `npm run test:e2e`

Expected: all existing smoke tests plus 7 simulation contract tests pass.

- [ ] **Step 5: Commit the browser contract**

```bash
git add e2e/simulation-contract.spec.ts
git commit -m "test(sim): verify runnable initial stages"
```

### Task 9: Phase Verification and Progress Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-10-simulation-engine-completion-design.md`

**Interfaces:**
- Consumes: results from Tasks 1-8.
- Produces: an accurate progress snapshot that marks only phase-one requirements as complete.

- [ ] **Step 1: Update documentation with verified facts**

Add this subsection to `README.md` after `Current Review`:

```markdown
## Simulation Completion

Simulation work follows the [37-route completion design](docs/superpowers/specs/2026-07-10-simulation-engine-completion-design.md): lifecycle and verification are shared, while each physical domain keeps its own solver. Electromagnetic, sound, and vibration spectrum routes now run physical models, and FDTD starts with a visible deterministic source. The remaining wave/circuit, matter/fluid, and life/sensing route audits stay tracked in that design until their browser contracts pass.
```

Append this exact progress block to the design:

```markdown
## Implementation Progress

Verified on 2026-07-10:

- [x] Catalog parity for all 37 Sim routes
- [x] Shared runtime status and surfaced frame failures
- [x] Electromagnetic traveling-wave model
- [x] Acoustic traveling-wave model
- [x] Driven-vibration model
- [x] Non-empty deterministic FDTD initial field
- [x] Focused browser contract for the four upgraded routes
- [ ] Remaining wave, field, and circuit route contract
- [ ] Matter and fluid route contract
- [ ] Life, sensing, and device route contract
- [ ] Final 37-route completion audit and production release
```

- [ ] **Step 2: Run the complete phase verification**

Run: `npm test`

Expected: all Vitest files and tests pass.

Run: `npm run build`

Expected: TypeScript and Vite build succeed; existing chunk-size warnings are allowed.

Run: `npm run test:e2e`

Expected: all Playwright tests pass.

- [ ] **Step 3: Inspect the final phase diff and worktree**

Run: `git diff --check`

Expected: no output.

Run: `git status --short`

Expected: only the two documentation files are modified after earlier task commits.

- [ ] **Step 4: Commit phase-one documentation**

```bash
git add README.md docs/superpowers/specs/2026-07-10-simulation-engine-completion-design.md
git commit -m "docs: record simulation completion phase one"
```

- [ ] **Step 5: Record the next independent plans**

After this phase is verified, create these plans from the same design before
modifying their route groups:

```text
docs/superpowers/plans/2026-07-10-wave-field-circuit-simulations.md
docs/superpowers/plans/2026-07-10-matter-fluid-simulations.md
docs/superpowers/plans/2026-07-10-life-sensing-device-simulations.md
```

Each plan must retain TDD, per-route browser evidence, and an independently
releasable commit boundary.

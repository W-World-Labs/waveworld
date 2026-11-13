# WaveWorld Simulation Engine Completion Design

**Date:** 2026-07-10

**Status:** Approved for direct implementation

## Goal

Make every route in the Sim domain a real, inspectable browser-side model. Each
route must expose a meaningful physical state, let a user change that state,
and provide enough automated evidence to distinguish a working simulation from
a route that merely renders text or an empty canvas.

The scope is all 37 Sim routes in `src/nav.ts`. Completion means every row in
the inventory below satisfies its target and passes the shared browser checks.

## Architecture Decision

WaveWorld will use a shared simulation runtime with independent physical
engines. It will not use one universal numerical solver.

The shared runtime owns lifecycle concerns:

- initialization, running, paused, fallback, and error states;
- animation-frame scheduling and visibility suspension;
- play speed, deterministic reset, and disposal;
- surfacing asynchronous frame errors instead of swallowing them;
- capability metadata used by route-level browser tests.

The physical engines remain domain-specific:

- explicit wave and field solvers;
- ODE and analytic circuit models;
- particle and Monte Carlo models;
- stable-fluid and diffusion models;
- signal-generation and signal-processing models;
- ray-tracing and Three.js scenes.

This preserves the existing tested kernels in `src/lib/sim/`,
`src/lib/webgpu/`, and `src/lib/lab/` while removing lifecycle and quality
inconsistency at page level.

## Simulation Modes

Every route belongs to one of three modes. A route does not need artificial
motion when its physical result is naturally static.

1. **Stepped model:** advances a physical state over time. It must support
   pause, resume, and deterministic reset.
2. **Parametric model:** evaluates a physical result from controls. At least one
   input change must produce a measurable output and visual change.
3. **Interactive scene:** responds to direct manipulation, camera movement, or
   editing. It must have a deterministic initial scene and a reset or preset.

A static reference page is not an accepted simulation mode.

## Source Structure

The implementation will add or extend these focused units:

- `src/data/simulations.ts`: capability catalog keyed by the 37 Sim routes.
  It records mode, renderer, backend class, engine source, and browser-test
  expectations. A test will require exact parity with the Sim leaves in
  `src/nav.ts`.
- `src/lib/simulation/runtime.ts`: shared status and fault types plus pure
  lifecycle transitions. It does not know any physics.
- `src/lib/hooks/useRafLoop.ts`: accepts an error callback and stops a failed
  frame loop cleanly instead of silently continuing.
- `src/components/SimulationStatus.tsx`: compact initializing/backend/fallback/
  error status for pages that can fail during startup or stepping.
- `src/components/SpectrumSimulation.tsx`: shared layout and rendering shell
  for the new electromagnetic and acoustic spectrum models. The physical
  state functions remain separate.
- `src/lib/sim/electromagnetic-wave.ts`: transverse electric/magnetic traveling
  wave model with medium speed, wavelength, impedance, and field observables.
- `src/lib/sim/acoustic-wave.ts`: acoustic pressure/particle-velocity traveling
  wave model with medium, frequency, amplitude, and attenuation.
- `src/lib/sim/driven-oscillator.ts`: damped driven oscillator used by the
  vibration route, including resonance and time-domain state.
- `e2e/simulation-contract.spec.ts`: catalog-driven route checks for stage,
  initial state, dynamics or control response, pause/reset where applicable,
  and uncaught errors.

Existing page-specific kernels stay in their current files unless calculations
are trapped inside a renderer and need extraction for testing.

## Data Flow

```text
React controls
    -> typed parameters
    -> page-specific engine or evaluator
    -> physical state and observables
    -> Canvas / SVG / Three.js renderer

runtime status <- initialization / frame / backend result
runtime fault  <- thrown error / non-finite state / GPU loss
CPU fallback  <- GPU failure while preserving user parameters
```

React state is used for displayed controls and low-frequency observables. Refs
remain the source for frame-hot values so control changes do not recreate a
solver unless the solver's dimensions or boundary conditions require it.

## Route Inventory

### Waves, Fields, and Circuits

| Route | Current engine | Mode | Required improvement |
| --- | --- | --- | --- |
| `optics-lab` | tested geometric ray tracing in SVG | interactive scene | Add catalog contract and manipulation/reset browser check; preserve benchmark behavior. |
| `electromagnetic` | static spectrum cards | stepped model | Add a transverse E/B wave engine, non-empty animated stage, band/medium/frequency controls, and field observables. |
| `sound` | static spectrum cards | stepped model | Add an acoustic pressure/velocity engine, medium/frequency/amplitude controls, wavelength and intensity observables. |
| `vibration` | static spectrum cards | stepped model | Add a damped driven-oscillator engine, mass/stiffness/damping/drive controls, resonance curve, and displacement trace. |
| `ripple` | tested 2D CPU wave equation | stepped model | Add catalog contract, surfaced loop faults, deterministic reset, and pause/reset browser checks. |
| `fdtd` | WebGPU/CPU Yee FDTD | stepped model | Seed an initial source on load/reset, add direct backend tests, and expose fallback/error state. |
| `emwave3d` | analytic fields embedded in Three.js | interactive scene | Extract field calculations into a tested pure kernel and add deterministic initial/preset checks. |
| `antenna3d` | tested analytic antenna model plus Three.js | interactive scene | Add catalog contract, stable reset, and camera/control browser check. |
| `antennapattern` | tested pattern and link-budget evaluator | parametric model | Add catalog contract and assert that a control changes gain/link observables. |
| `antennas` | tested antenna sizing evaluator | parametric model | Keep it parametric; add explicit result observables and a control-response browser check. |
| `phasedarray` | tested array-factor evaluator | parametric model | Add catalog contract and verify steering/grating-lobe response. |
| `faraday` | tested induction model | stepped model | Add deterministic reset and pause/error contract. |
| `rlc` | tested RLC response model | stepped model | Add deterministic reset and frequency/control response checks. |
| `mutual` | tested coupled-inductor model | stepped model | Add deterministic reset and coupling-response checks. |
| `transient` | tested RC/RL transient model | stepped model | Add deterministic reset and time-constant response checks. |

### Matter and Fluids

| Route | Current engine | Mode | Required improvement |
| --- | --- | --- | --- |
| `md` | tested WebGPU/CPU molecular dynamics | stepped model | Add catalog contract, non-finite guard, fallback status, and deterministic seeded reset check. |
| `pedotpss` | WebGPU/CPU particle/electrostatic model | stepped model | Add direct backend tests, non-finite guard, fallback status, and seeded reset check. |
| `ising` | tested Monte Carlo Ising model | stepped model | Add deterministic seed/reset and temperature-response browser check. |
| `fluid` | tested stable-fluid solver | stepped model | Add deterministic reset, finite-state guard, and pointer-injection check. |
| `windtunnel` | tested stable-fluid solver with obstacle | stepped model | Add deterministic reset, finite-state guard, and flow-speed response check. |
| `convection` | tested stable-fluid advection model | stepped model | Add deterministic reset, finite-state guard, and buoyancy/temperature response check. |
| `sim` | WebGPU/CPU heat diffusion | stepped model | Add direct heat-backend tests, fallback/error status, and deterministic heat-source reset. |
| `heaterfc` | tested analytic heat solution | stepped model | Add deterministic reset and analytic/numeric observable checks. |

### Life, Sensing, and Devices

| Route | Current engine | Mode | Required improvement |
| --- | --- | --- | --- |
| `ecg` | tested synthetic ECG waveform | stepped model | Add deterministic reset and heart-rate response check. |
| `emg` | tested stochastic EMG waveform | stepped model | Seed randomness, add deterministic reset, and verify contraction response. |
| `eeg` | tested stochastic band model | stepped model | Seed randomness, add deterministic reset, and verify band-power response. |
| `neuron` | tested FitzHugh-Nagumo model | stepped model | Add deterministic reset, finite-state guard, and stimulus response check. |
| `biopipeline` | tested bio-signal DSP chain | stepped model | Seed source data, add reset, and verify stage-toggle output response. |
| `ultrasound` | tested A-line/B-mode model | parametric model | Add deterministic phantom, reset, and depth/frequency response check. |
| `stm` | tested tunneling scan model | parametric model | Add deterministic surface/reset and mode/control response check. |
| `afm` | tested force and scan model | parametric model | Add deterministic surface/reset and setpoint response check. |
| `radar` | tested 2D wave field and echo view | stepped model | Seed the first transmission, add deterministic reset, and verify target response. |
| `localization` | tested trilateration evaluator | parametric model | Add reset and verify geometry/range-noise response. |
| `tdoa` | tested hyperbola/TDOA evaluator | parametric model | Add reset and verify source/measurement response. |
| `nljd` | tested diode-harmonic evaluator | parametric model | Add reset and verify junction/harmonic response. |
| `laser` | rate-equation model without direct tests | stepped model | Add kernel tests, finite-state guard, deterministic reset, and threshold response check. |
| `display` | tested emission evaluator and animation | parametric model | Add deterministic reset and technology/control response check. |

## Runtime and Error Handling

The shared status model is:

```text
initializing -> running <-> paused
initializing/running -> fallback -> running
initializing/running/fallback -> error
error -> initializing (reset/retry)
```

Rules:

- An asynchronous frame error is reported to the page and stops further
  stepping until reset. It is never caught and discarded by the scheduler.
- A GPU failure attempts one CPU reinitialization with the current parameters.
  If fallback fails, the page enters `error` with a bilingual message.
- A kernel that emits `NaN`, infinity, or an invalid-sized state enters
  `error`; the last valid frame remains visible for diagnosis.
- Cleanup is idempotent. Unmount, reset, and device loss may all call dispose.
- Reduced-motion mode renders a meaningful initial frame and does not require
  animation to reveal the model.

## Shared Acceptance Contract

Every catalog entry must satisfy all applicable checks:

1. The route mounts without page errors or failed same-origin assets.
2. A visible stage has stable dimensions and a meaningful initial frame within
   two seconds on CPU-only headless Chromium.
3. A stepped model changes after running, freezes after pause, and returns to a
   deterministic initial state after reset.
4. A parametric model changes a documented observable and its stage after a
   control adjustment.
5. An interactive scene responds to its documented manipulation and can return
   to a known preset or reset state.
6. Key displayed observables are finite and include units where physical units
   are meaningful.
7. GPU-capable pages visibly report the active backend and survive forced or
   naturally unavailable WebGPU through CPU fallback.
8. Chinese and English modes retain controls, status, and error meaning.

## Testing Strategy

### Kernel tests

- Add failing tests before each new kernel or bug fix.
- Test equations, limiting cases, stability bounds, deterministic seeds, and
  finite outputs rather than renderer implementation details.
- Add direct tests for `fdtdSim`, `pedotpssSim`, `heatSim`, `laser`, and the
  extracted `EMWave3D` field kernel.

### Runtime tests

- Test lifecycle transitions as pure functions.
- Test that `useRafLoop` reports synchronous and asynchronous frame errors and
  does not reschedule after failure.
- Test exact catalog parity with the Sim-domain navigation leaves.

### Browser tests

- Drive all routes from the catalog.
- Require a visible simulation stage and status/observable content.
- Compare two stage screenshots for stepped models before and after time.
- Exercise a declared control for parametric models and require a changed
  observable or screenshot.
- Verify pause, reset, and initial non-empty FDTD/radar states where applicable.
- Capture page errors, console errors, and failed assets as hard failures.
- Run desktop and mobile smoke checks; run detailed interaction checks at one
  stable desktop viewport.

### Release checks

Run, in order:

```bash
npm test
npm run build
npm run test:e2e
```

Then deploy `dist/` to the `waveworld` Cloudflare Pages project, verify the
production deployment references the final commit, and check that the stable
production URL returns the new asset hashes.

## Phased Delivery

The scope is decomposed because the three simulation groups use independent
physics. Each phase is releasable and keeps the complete objective intact.

1. **Contract and missing models:** capability catalog, runtime error path,
   browser-contract harness, electromagnetic/acoustic/vibration engines, and
   FDTD initial source.
2. **Waves, fields, and circuits:** complete and verify all 15 routes in the
   first inventory group.
3. **Matter and fluids:** complete and verify all eight routes in the second
   group, including GPU direct tests and finite-state guards.
4. **Life, sensing, and devices:** complete and verify all 14 routes in the
   third group, including deterministic stochastic models.
5. **Completion audit and release:** prove all 37 catalog entries satisfy the
   shared contract, run the full suite, update documentation/issues, push, and
   publish Cloudflare Pages.

## Non-Goals

- Replacing every tested solver with one numerical framework.
- Claiming research-grade predictive fidelity for educational browser models.
- Adding animation to a parametric model solely for visual motion.
- Moving computation to a server or adding a Cloudflare Worker backend.
- Refactoring ontology, application, or method data unrelated to simulation
  execution.


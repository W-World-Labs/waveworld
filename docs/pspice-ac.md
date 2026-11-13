# Guided AC analysis and frequency sweep

WaveWorld's guided circuit workflow accepts a structured linear circuit and
either one frequency in hertz or an optional bounded linear/log frequency
sweep. Each frequency is submitted as its own authenticated Host job using the
existing native MNA method `method-algo-mna-ac` (family `method-mna`). The
workflow presents the returned node voltage phasors and can export the results.
The workflow name describes the AC-analysis task; it does not provide PSpice
project compatibility or claim full PSpice parity.

This guided page accepts structured circuit data; it does not import or execute
an AC-analysis directive from a SPICE/PSpice netlist. The released W-Sim pin
`dda2f6f1e1def3d9a49bea48c8766d222b2d8a14` includes the native
`method-algo-mna-ac` method used by the structured workflow, but that does not
add `.ac` netlist support to WaveWorld's `/rlc` importer or provide PSpice
project/model compatibility. The `/rlc` import panel detects `.ac` directives
and stops before submitting them to this pin, with a message directing users to
the structured AC editor. See [the bounded SPICE transient note](spice-transient-workflow.md)
for the separate `/rlc` transient scope and its initial-condition limitation.

## Input and solve

Enter the circuit as structured element data. Node `0` is ground; positive node
numbers identify non-ground nodes. Resistors use ohms, capacitors farads,
inductors henries, voltage sources volts, and current sources amperes. For
example, a 1 V AC source driving a 1 kΩ–1 µF low-pass circuit can be represented
as:

```json
{
  "circuit": {
    "nodes": 2,
    "vSources": [{ "a": 1, "b": 0, "v": 1 }],
    "resistors": [{ "a": 1, "b": 2, "r": 1000 }],
    "capacitors": [{ "a": 2, "b": 0, "c": 0.000001 }],
    "inductors": [],
    "iSources": []
  },
  "frequencyHz": 159.15494309189535
}
```

The guided adapter validates and normalizes this input for the native MNA
module. It converts the requested frequency using `omega = 2πf` (radians per
second), then selects `method-algo-mna-ac`; the native method receives `omega`
and the circuit arrays. The example frequency is the RC corner, approximately
`1/(2πRC)`. Voltage and current source values are real AC amplitudes with zero
phase in this supported subset.

The single-frequency results show frequency in hertz, derived angular frequency
in radians per second, backend provenance, and each named node's voltage
magnitude and phase. The ground reference is included as a zero-voltage row.
Phase is available in radians and degrees from the solver; the table shows
degrees. CSV columns are `frequency_hz`, `omega_rad_per_s`, `node`,
`magnitude_v`, `phase_rad`, and `phase_deg`. A phasor is a steady-state
sinusoidal quantity at the requested frequency, not a time-domain waveform.

## Optional frequency sweep

Enable the sweep controls and choose ascending start and stop frequencies, a
linear or logarithmic spacing, and an integer point count from 2 through 31.
Both endpoints must be within the supported frequency range. The points include
both endpoints and are strictly increasing. A sweep is run sequentially: each
frequency creates a separate authenticated one-point job through the same
`method-algo-mna-ac` method. It is not one solver-side batch job.

Each completed frequency is retained as an immutable capture of its frequency,
normalized input, job specification, node map, native phasor result, job ID,
and backend provenance. The UI plots voltage magnitude and phase against a
logarithmic frequency axis and provides a per-frequency node table. CSV exports
completed phasor rows; JSON records the completed point captures, including
their job IDs and backend information. These exports describe WaveWorld study
results and are not PSpice interchange files.

If a point fails, completed points remain available and later points are not
run; the status reports a partial sweep. Canceling stops the active/requested
work and retains already completed points. Editing the study inputs invalidates
and clears prior results. Results from an older run are discarded if its input
generation has become stale. With sweep disabled, the existing single-frequency
workflow remains the default and continues to submit one job.

## Supported scope

The guided execution is bounded to 1–64 non-ground nodes, at most 512 total
RLC and independent-source elements, and frequencies from `1e-6` through
`1e12` Hz. The network must be linear and use resistors, capacitors, inductors,
and independent voltage or current sources. Diodes and other nonlinear
devices are unsupported; there is no nonlinear operating-point linearization
in this workflow. Invalid or unsupported inputs fail rather than being
partially solved.

The workflow does not load or save PSpice projects, interpret vendor model
libraries, or claim GPU execution. The plot and sweep orchestration are provided
by WaveWorld around separate native single-frequency solves; they do not imply
vendor sweep-engine compatibility.

## Evidence boundary

Cadence's PSpice documentation provides context for the analysis task and the
PSpice interface concepts. Its [simulation examples](https://resources.pcb.cadence.com/pspiceuserguide/02-simulation-examples)
and [AC/DC sweep simulation-profile article](https://resources.pcb.cadence.com/circuit-simulation/2019-defining-an-ac-dc-sweep-simulation-profile)
are scope references only; they are not numerical oracles for this implementation.
No PSpice or other vendor numerical comparison is reported here. The stated
behavior describes WaveWorld's structured-input adapter and the pinned
existing native W-Sim MNA method, not vendor compatibility or validated
cross-tool accuracy.

Static source checks for the sweep passed: WaveWorld `npx tsc -b`, app and test
source compilation with `npx tsc --noEmit -p tsconfig.app.tests.json`, and
focused strict TypeScript compilation of `e2e/pspice-ac-sweep.spec.ts` using
ES2022, bundler resolution, `skipLibCheck`, and Node types. These checks compile
sources only. Authored tests remain unexecuted; no browser, native test, solver,
PSpice, or other vendor run was performed. No vendor numerical comparison or
GPU evidence is reported (`nvcc` was unavailable for the prior native addition).

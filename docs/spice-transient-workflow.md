# SPICE transient workflow

WaveWorld's `/rlc` import panel can submit a bounded, fixed-step transient
analysis for an imported linear RLC deck. The importer produces an MNA
`method-algo-mna-transient-be` input, and the workflow submits that input to the
existing native W-Sim MNA method using the host-f64 backend. The selected
non-ground node is plotted from the returned time samples. This is a narrow
WaveWorld workflow, not general SPICE or PSpice compatibility.

## Supported deck subset

The deck must contain exactly one fixed-step `.tran` directive with timestep
and stop time matching the imported `dt` and `dt × steps`. The analysis accepts
1–2000 steps, linear resistors, capacitors and inductors, and constant
independent voltage or current sources. At least one capacitor or inductor and
one independent source are required. Pulse, sinusoidal, exponential, PWL and
other time-varying source waveforms are not supported. The imported circuit is
limited to 1–64 non-ground nodes and 512 total elements. Unsupported or
non-matching directives fail closed; importing and exporting the MNA input is
separate from submitting a transient job.

## Explicit initial state and `.ic` / `UIC`

The import panel can optionally accept named starting node voltages and named
inductor branch currents. Blank fields preserve the zero-state default. When
any field is supplied, WaveWorld sends full native arrays in the imported
circuit order and fills every unspecified entry with zero. The JSON result
export records those arrays; the first returned waveform sample is at `dt`, so
the initial state itself is not a sample.

Node voltages are measured relative to ground. An inductor's initial current
follows its card's first-node-to-second-node orientation. Capacitor initial
voltage is derived from the difference between its terminal node voltages.
Although the native input schema also has an initial capacitor-current array,
the pinned backward-Euler capacitor companion does not use that value on its
first step, so WaveWorld does not expose it as an effective control. This
initializes the numerical state directly. The first BE step still applies
independent-source constraints. The workflow does not run a separate DC
operating-point solve.

The workflow still rejects `.ic`, `.nodeset`, `.uic`, and `UIC` netlist cards.
The editor accepts explicit numeric starting state, not simulator card syntax
or expressions. Pulse/PWL and other source waveforms remain unsupported.

The released W-Sim pin used by this workflow is
`dda2f6f1e1def3d9a49bea48c8766d222b2d8a14`. Its native MNA transient source has
an optional `initial` object, defaulting to zero state when absent or null. The
accepted fields are:

```json
{
  "initial": {
    "nodeVoltages": [0.0],
    "inductorCurrents": [0.0]
  }
}
```

Each field is optional. If supplied, `nodeVoltages` has one finite value per
non-ground circuit node and `inductorCurrents` has one finite value per
inductor. The node array uses native circuit node ordering and the inductor
array follows the native inductor array. The WaveWorld adapter validates these
arrays, creates the native JobSpec, and preserves the submitted state in the
result capture and JSON export. The fields are compatible with the released
native contract; they do not make `.ic` or `UIC` cards runnable from `/rlc`.

## Result and evidence boundary

The workflow requests backward Euler and validates returned method and backend
provenance, time grid, output node, convergence flag, waveform length, and final
state dimensions before displaying named-node results. Plot samples correspond
to `dt`, `2 × dt`, …, `steps × dt`; the initial state is not included as a
sample. The reported host-f64 backend describes the native calculation path;
it does not establish PSpice numerical parity or vendor validation.

The native contract details above were checked directly in the released W-Sim
pin's `crates/w-sim-cuda/src/module/mna.rs`. No test, solver, browser, or vendor
execution was performed for this documentation update.

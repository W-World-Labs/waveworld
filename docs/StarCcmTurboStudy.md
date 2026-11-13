# STAR-CCM+ turbomachinery study surface

WaveWorld exposes a guided multi-point UI over the already admitted W-Sim
`sw-su2-turbo-metrics` operation. Every point is one authenticated Host job,
with at most 12 points stored in a study and no concurrent submissions from the
page. A completed point retains its submitted input, returned native result,
and Host job ID. Completed points are immutable; copy a point to edit and submit
another operating point.

The input uses `backend: "host"`, `kind: "compressor" | "turbine"`, and finite
positive `p_t1`, `T_t1`, `p_t2`, and `T_t2`. The UI caps JSON input at 64 KiB and
rejects unsupported keys and known invalid optional-input combinations. The
native module remains the authority for full admission and validates again at
execution.

The result table reads returned pressure ratio, corrected mass flow, corrected
shaft speed, and efficiencies. The SVG plot displays returned pressure ratio
against corrected mass flow when both fields exist. Neither view computes new
performance quantities. The CSV contains result rows; the JSON report includes
each exact submitted input, native result, and job ID.

This is an independent ideal-gas Host-f64 performance reduction. It is not a
flow solver, does not connect or interpolate points as a performance map, and
does not read or write STAR-CCM+ `.sim` files or invoke its session, API, or
macros. It establishes no Siemens implementation or numerical equivalence.
The shared static gate passed WaveWorld `npx tsc -b` and
`npx tsc --noEmit -p tsconfig.app.tests.json`; the four study test sources
compiled but were not executed. This change adds no STAR-CCM+ E2E spec or new
native test. No solver, browser, GPU, or vendor execution has been performed.

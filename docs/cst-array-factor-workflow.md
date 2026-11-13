# CST-mapped 3D array-factor workflow

The `/cst` page submits a caller-defined antenna array to the existing W-Sim
native operation `module: "antenna-l2"`, `operation: "cst-array-factor"`.
The request explicitly selects `backend: "host"` and is sent as an
authenticated Host job through the existing job lifecycle. Host owns job
authorization, queueing, execution settlement, and the returned result; the
workflow does not add an API or a native operation. The existing native SHA
`dda2f6f1e1def3d9a49bea48c8766d222b2d8a14` is recorded as provenance only; it
does not change or assert the WaveWorld build's pin.

Inputs are JSON numeric values in SI units: `freqHz` is positive finite Hz;
`positionsM` is a list of element `[x,y,z]` coordinates in metres; `weights`
contains one complex voltage excitation `[real, imag]` per element; and
`directionsRad` contains observation pairs `[theta, phi]` in radians, with
`+z` as boresight. `theta` is constrained to `[0, π]`; `phi` may be any finite
value. The native calculation uses
`AF(u) = Σ wₙ exp(+j k rₙ·u)` and normalizes by `Σ |wₙ|`, so excitation scale
does not represent absolute radiated power.

The input is bounded to 1–256 element positions and 1–4096 observation
directions, with at most 1,048,576 element-direction evaluations. Position
coordinates must be finite and within ±1e6 m; phase arguments above 1e12 rad
are rejected. Position and weight counts must match, all complex weight parts
must be finite, and their total magnitude must be nonzero and finite. Unknown
input keys fail closed. Only the explicit host backend is supported by this
operation; GPU/CUDA execution is not implied.

The result includes normalized complex field components, normalized power,
and power in dB for each requested direction, plus frequency, element and
direction counts and host-f64 backend provenance. The page presents these
samples and offers bounded CSV and JSON exports. The bounded CSV contains the
sampled output rows plus metadata for frequency, element and direction counts,
backend, pin provenance, and model limits. The JSON export contains the exact
submitted input, backend, job identity, and result. Neither export is a CST
project or solver model.

This is an isotropic, uncoupled point-element free-space far-field array-factor
calculation. It does not include element patterns, mutual coupling,
embedded-element effects, feed networks, material environment, losses, or
near-field values. It neither runs the CST full solver nor reads or writes
`.cst` projects, and it makes no CST solver-parity claim.

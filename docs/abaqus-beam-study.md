# Guided Abaqus-mapped B31 beam study

WaveWorld's Abaqus page includes a guided study for one Abaqus-mapped B31
configuration. The calculation is performed by the existing W-Sim native
`sw-calculix-timoshenko-beam` module through a host-f64 job. “Abaqus-mapped”
identifies the element concept and study workflow; this page does not launch
Abaqus or claim Abaqus/CalculiX result parity.

## Study definition

The study models a straight, prismatic, uniform, linear-elastic 2D beam using a
two-node linear Timoshenko B31 element with three degrees of freedom per node
(axial displacement, transverse displacement, and rotation). It uses small
displacements and host f64 arithmetic. The supported boundary is a cantilever
fixed at `x = 0`. The supported load is either one positive transverse point
force at the free end `x = L`, or one positive uniform distributed load (UDL)
over the beam.

Inputs are:

| Input | Meaning | Unit |
| --- | --- | --- |
| `length` (`L`) | Beam length | m |
| `elements` | Number of equal B31 elements | integer, dimensionless |
| `section.E` | Young's modulus | Pa |
| `section.A` | Uniform cross-sectional area | m² |
| `section.I` | Second moment of area for in-plane bending | m⁴ |
| `section.nu` | Poisson's ratio | dimensionless |
| `section.k` | Shear correction factor | dimensionless |
| `boundary` | Fixed value: `cantilever` | — |
| `load.type` | `point` or `udl` | — |
| `load.value` | Positive force for `point`, or positive force per length for `udl` | N or N/m |

The point force acts at `x = L`; the UDL acts along the beam. The native module's
positive transverse direction is used and shown with results. Each numeric
input must be finite and within these inclusive bounds; the element count must
also be an integer. The form does not round, clamp, or coerce invalid values.

| Input | Accepted range |
| --- | --- |
| `length` | 1e-6 to 1e3 m |
| `elements` | 1 to 2048 |
| `section.E` | 1e3 to 1e13 Pa |
| `section.A` | 1e-12 to 1e4 m² |
| `section.I` | 1e-24 to 1e8 m⁴ |
| `section.nu` | -0.99 to 0.499 |
| `section.k` | 1e-6 to 1e3 |
| Point force magnitude | 1e-12 to 1e12 N |
| UDL magnitude | 1e-12 to 1e12 N/m |

The initial draft uses `L = 1 m`, 20 elements, `E = 210 GPa`, `A = 0.005 m²`,
`I = 4.166666666666667 × 10⁻⁶ m⁴`, `nu = 0.3`, `k = 5/6`, and a `1000 N` point
force at the tip. Users can change these values before submitting a study.

## Host job and reported results

On submit, the interface snapshots the entered values and creates one host job
using the W-Sim module input schema:

```json
{
  "module": "sw-calculix-timoshenko-beam",
  "backend": "host",
  "element": "B31",
  "length": 1,
  "elements": 20,
  "section": { "E": 210000000000, "A": 0.005, "I": 4.166666666666667e-6, "nu": 0.3, "k": 0.8333333333333334 },
  "boundary": "cantilever",
  "load": { "type": "point", "value": 1000, "position": 1 }
}
```

The UI builds the job with the existing `createModuleJobSpec(input)` path,
submits it through the authenticated settlement client, and decodes its result
with `readModuleResult(jobResult, input)`. The submitted snapshot stays paired
with its job and report while the job is running or after it completes. The
page provides job status, cancellation, and reset controls; it does not submit
automatically.

Results come from the native module and include the generated node grid,
transverse displacement and rotation probe, maximum deflection and moment,
support reactions, and element end forces. Displayed values retain their
physical units and native sign convention. A downloadable study report
includes the submitted inputs, job identifier, provenance, and native result
fields. Unknown additional fields in a future native response may be tolerated;
the interface must not invent missing values.

The module may also return `closedForm` for its canonical load case. When
present, it is shown only as a native-reported textbook comparison. It is not
an Abaqus oracle, and it may be absent for other load cases.

## Scope and limitations

This is a bounded guided study, not a general finite-element project importer.
It does not create, read, or execute Abaqus `.inp` files and does not invoke an
Abaqus solver. It does not establish full B31, CalculiX, or Abaqus parity, and
it is not a certified design tool. The comparison value is not independent
vendor validation.

The guided study does not cover springs, axial or moment loads, simply
supported beams, B32 elements, 3D frames, nonlinear or dynamic analysis,
tabulated material behavior, or general meshes. It is separate from the
existing Abaqus case catalog and FEM importer; neither is changed into a
general beam-project path by this study.

## Native implementation

The calculation is implemented in the W-Sim source file
[`sw_calculix_timoshenko_beam.rs`](../../20-15-w-sim/crates/w-sim-cuda/src/module/sw_calculix_timoshenko_beam.rs)
(`sw-calculix-timoshenko-beam`). The guided study uses the existing pinned
native module at revision `dda2f6f1`; it does not add or modify the native
implementation. The WaveWorld UI only prepares the supported input, manages
the host job lifecycle, and presents the returned native data.

## Validation evidence

Static TypeScript checks passed for `npx tsc -b` and
`npx tsc --noEmit -p tsconfig.app.tests.json`. The focused E2E spec also
passed a no-emit TypeScript check. The authored frontend unit and E2E tests
were not executed. The combined W-Sim `cargo check --tests --locked` passed
for native test-source compilation; no Rust tests or solver were executed.
The environment had no `nvcc`, so the check used empty CUDA kernel stubs and
does not establish GPU validation. No Abaqus solver run or vendor numerical
comparison was performed.

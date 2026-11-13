# Guided two-degree-of-freedom modal study

The Ansys Mechanical guided study solves a bounded two-degree-of-freedom
generalized eigenproblem using the existing W-Sim `sw-ansys-modal` module on
the Host backend. Enter the independent entries of symmetric stiffness and
mass matrices, a participation direction, and whether to return one or two
modes. The default example is `K = [[1000, 0], [0, 1000]]`,
`M = [[1, 0], [0, 1]]`, direction `[1, 0]`, and two modes.

## Inputs

The UI accepts finite values for `k11`, `k12`, `k22`, `m11`, `m12`, and
`m22`, each with absolute magnitude at most `1e12`. Direction components have
absolute magnitude at most `1e6`. The off-diagonal entries are entered once; the job uses the exact
symmetric matrices:

```json
{
  "module": "sw-ansys-modal",
  "backend": "host",
  "method": "block-lanczos",
  "stiffness": [[1000, 0], [0, 1000]],
  "mass": [[1, 0], [0, 1]],
  "direction": [1, 0],
  "numModes": 2
}
```

Both matrices must be positive definite. For a symmetric 2×2 matrix with
diagonal entries `a`, `b` and off-diagonal entry `c`, this means
`a > 0`, `b > 0`, and `a*b - c*c > 0`. The direction must contain exactly two
finite values and cannot be `[0, 0]`. Choose one or two modes. Values are
submitted as entered; the study does not infer or repair invalid matrices.
Use consistent units for the degrees of freedom and corresponding entries of
`K` and `M`.

## Host job and results

Submitting creates an authenticated Host job through the existing job client.
The native binary transport uses the existing W-Sim executor, while inline
`backend: "host"` selects host-f64 modal arithmetic; the result view reports
that module backend directly. The study tracks its submitted input with job
status and the returned report.
The native Block Lanczos solver reports eigenvalues, natural frequencies in
rad/s and Hz, periods, and mass-normalized mode shapes. It also reports
participation factors and effective mass information for the selected
direction, along with solver convergence details.

## Scope

This guided study handles explicit 2×2 matrices only. It does not import
geometry or meshes, build a finite-element model, or execute ANSYS Mechanical.
It uses the existing native module and release pin unchanged. The mapping to
Mechanical terminology does not imply parity with ANSYS results, and no
measured vendor validation is claimed.

## Source verification

Final source gates passed on 2026-09-23: the production TypeScript build,
app-test source typecheck, focused modal E2E source typecheck with strict
ES2022/Bundle settings, and Ansys inventory JSON parsing. The authored tests
were not executed. No browser workflow, solver computation, vendor comparison,
or GPU validation was performed.

# Guided Abaqus assembled-matrix modal study

This bounded WaveWorld preview imports an Abaqus assembled stiffness `.mtx`
file and mass `.mtx` file, maps their external node/DOF tuple identifiers to a
deterministic local index order, and submits the resulting dense symmetric
matrices to the existing W-Sim `sw-ansys-modal` solver through the Host f64
Block Lanczos path. The module name identifies reused W-Sim solver code. This
workflow is an independent W-Sim solve; it does not operate Ansys or Abaqus and
does not claim parity with either product.

## Matrix input

Abaqus matrix input records use five comma-separated fields:

```text
row node, row DOF, column node, column DOF, coefficient
```

The importer reads the assembled global matrices written as `.mtx` files. It
accepts lower-triangular, upper-triangular, or square symmetric storage, and
expands triangular input into symmetric dense matrices. Square input must have
exactly matching mirrored coefficients. Stiffness and mass must each use one
consistent storage form throughout the file; duplicate coordinates and mixed
storage are rejected. The two files must describe the same structural DOF set,
and every mapped DOF must have a mass diagonal entry.

The preview sorts external `(node label, DOF)` tuples lexicographically by
node then DOF and assigns zero-based dense indices in that order. This map is
included with the preview so the user can relate result vector positions to
Abaqus identifiers. A `.mtx` file carries no unit metadata. Coefficients are passed through
unchanged, with no unit inference or conversion. The workflow assumes the
stiffness and mass matrices use a mutually consistent system of units and a
time base in seconds. Interpret the returned rad/s and Hz frequencies under
that assumption. Entries can have different physical units when translational
and rotational DOFs are combined.

The documented Abaqus format and output options are described in Dassault
Systèmes' [matrix input keyword reference](https://docs.software.vt.edu/abaqusv2025/English/SIMACAEKEYRefMap/simakey-r-matrixinput.htm)
and [matrix output keyword reference](https://docs.software.vt.edu/abaqusv2025/English/SIMACAEKEYRefMap/simakey-r-matrixoutput.htm).
`FORMAT=MATRIX INPUT` is the documented default for matrix output. Abaqus also
describes writing assembled global matrices to `.mtx` in its
[MTX assembly utility reference](https://docs.software.vt.edu/abaqusv2025/English/SIMACAEEXCRefMap/simaexc-c-mtxassemblyutil.htm).

## Solver and results

On submit, WaveWorld packages the imported matrices with `method:
"block-lanczos"` and `backend: "host"` for `sw-ansys-modal`. The existing
W-Sim implementation executes the generalized eigenproblem
`K φ = λ M φ` in host f64 arithmetic. Results include eigenvalues, natural
frequencies in rad/s and Hz, periods, mass-normalized mode shapes,
participation factors, effective mass information for the selected direction,
and solver convergence details, as provided by the native module. The preview
retains the imported tuple-to-index map alongside the result for interpretation.

## Bounded support and exclusions

The importer is limited to at most 16 mapped DOFs. Node labels must be positive
safe integers; negative/internal node identifiers and zero are rejected. Only
structural DOFs 1 through 6 are accepted. Input must be finite, contain exactly
five fields per non-empty record, contain no duplicate entries, and use a
single supported symmetric storage form per matrix. No constraint elimination
or result recovery is performed.

This study does not import geometry or meshes, substructures, or negative
internal DOFs. It does not support nonsymmetric, damped, or complex matrices,
models above the 16-DOF cap, or a full Abaqus input-deck workflow or solve. It
uses the existing independent W-Sim solver and does not establish numerical
parity with Abaqus or Ansys. The generic Abaqus case catalog and the separate
[Abaqus-mapped B31 beam study](./abaqus-beam-study.md) remain distinct workflows.

## Verification

WaveWorld production TypeScript compilation (`npx tsc -b`) and app test-source
typechecking (`npx tsc --noEmit -p tsconfig.app.tests.json`) passed. The Abaqus
inventory JSON parsed successfully. These checks do not execute frontend tests,
the importer, a browser workflow, an Abaqus solver, GPU code, or numerical
comparisons; those remain unrun.

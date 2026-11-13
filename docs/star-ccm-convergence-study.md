# STAR-CCM+ residual-history study

WaveWorld's STAR-CCM+ study accepts a user-imported CSV residual history and
submits the parsed values to the existing host operation
`sw-ansys-report` with `method=convergence`. The operation summarizes the
provided history and evaluates the configured residual and monitor criteria;
it does not run a solver.

## CSV input

The app-defined plain CSV schema is:

```text
iteration,residual:<name>[,monitor:<name> ...]
```

The first column is `iteration`. Include one or more `residual:<name>` columns
and optionally any `monitor:<name>` columns. Names must be non-empty and
column headers must be unique, with series names limited to 64 ASCII letters,
digits, underscores, dots, or hyphens (starting with a letter). Each data row has a positive integer iteration
label, strictly increasing from the previous row. Every series cell must be a
finite number; residual values must also be non-negative. At least one history
row is required. The importer accepts CSV files up to 512 KiB, at most 5,000
data rows, at most 16 residual and monitor series combined, and at most 80,000
numeric CSV cells counting the iteration labels. Malformed rows, invalid
numbers, and unsupported columns are rejected.

Example:

```csv
iteration,residual:continuity,residual:momentum-x,monitor:drag-coefficient
1,1.2,0.8,0.31
2,0.42,0.35,0.29
3,0.0008,0.0011,0.285
```

`monitor:` columns carry finite user-provided values for history reporting and
monitor convergence evaluation. They are not interpreted as residuals.

## Operation and criteria

The parsed history is sent through the native job path as a host-f64
`sw-ansys-report` operation with `method=convergence`. The operation reports
the supplied series and tolerance crossings. Its default residual tolerance
is `1e-3`; its default monitor tolerance is `1e-2`; and its default monitor
window is 10 rows. The native series upper bound is 1,000,000 values, while the
CSV importer applies the smaller study limits above. These criteria assess
imported values only and do not control or stop a solver.

## Scope

This workflow consumes imported user data in an app-defined CSV shape. It is
not a STAR-CCM+ proprietary export format or a claim of vendor-format
compatibility. It does not read STAR-CCM+ project files, invoke STAR-CCM+,
control a solver, or establish STAR-CCM+ numerical or vendor parity. Results
describe only the history supplied by the user and the native operation's
summary of that data.

## Verification

WaveWorld production TypeScript build (`npx tsc -b`) and test-source
typecheck (`npx tsc --noEmit -p tsconfig.app.tests.json`) passed on the frozen
source snapshot. The STAR-CCM+ inventory JSON parsed successfully. Authored
tests, browser runs, standalone parser runs, solver runs, vendor comparisons,
and GPU runs were not executed.

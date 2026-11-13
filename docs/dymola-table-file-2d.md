# Bounded Modelica text-table 2-D lookup

WaveWorld's bounded 2-D table workflow accepts a named numeric matrix from a
Modelica `#1` text table and evaluates selected `(u1, u2)` query pairs through
the existing native W-Sim table operation. The file format follows the
Modelica Standard Library (MSL) `CombiTable2Dv` table layout. This is a limited
table import and bilinear lookup workflow; it does not execute a Modelica
model.

## Matrix layout

For `CombiTable2Dv`, the first column after the corner cell contains the
`u1` grid, the first row after the corner cell contains the `u2` grid, and the
interior cells contain the scalar table values. The row at a given `u1` and
column at a given `u2` intersect at that coordinate's value. MSL requires both
grid axes to be strictly increasing.

For example, the following matrix describes one scalar surface:

```text
#1
double surface(3,4) # rows are u1, columns are u2
0  1  2  3
1  1  3  5
2  2  4  6
```

The first row is the corner value followed by `u2 = [1, 2, 3]`. The first
column of the remaining rows gives `u1 = [1, 2]`. Thus the value at
`(u1=2, u2=2)` is `4`. MSL allows a 2-D table to be supplied as a parameter
matrix or selected by name from a file; WaveWorld's current text workflow
selects a named matrix from a `#1` file.

## Queries and evaluation

Each query is an explicit ordered pair `[u1, u2]`; for example,
`[[1.5, 2.0], [2.0, 1.5]]` asks for the surface at those two coordinate pairs.
The coordinate order matters: `u1` selects/interpolates along the first-column
axis, and `u2` selects/interpolates along the first-row axis. Do not transpose
the table or swap the query components.

The selected matrix and query pairs are sent to W-Sim's existing native
`sw-openmodelica-table` operation with `operation: "bilinear2d"`. W-Sim owns
the interpolation and result calculation. The WaveWorld `#1` reader is the
existing bounded text-table parser reused by this workflow; it reads numeric
matrix data and does not implement interpolation.

The current operation is deliberately narrower than MSL `CombiTable2Dv`:

- It supports one scalar output over a rectilinear matrix, bilinear
  interpolation, strictly ascending axes, and explicit `linear`, `hold`, or
  `error` boundary modes.
- It accepts at most 128 grid points on each axis, 16,384 interior grid cells,
  and 4,096 query pairs. The shared text reader also applies its file, line,
  matrix, dimension, and total-cell limits.
- It does not support vector outputs, bivariate Akima or other smoothness
  modes, periodic extrapolation, or file-backed table loading inside a
  Modelica runtime. The existing parser currently accepts `double` matrix
  declarations; although the MSL text specification also documents `float`,
  that declaration is outside this reader's accepted subset.

Outside the axis ranges, `linear` extends the edge-cell bilinear surface,
`hold` clamps the lookup to the table boundary, and `error` rejects an
out-of-range query. MSL documents additional behavior, including periodic
repetition and its own extrapolation parameter choices; those options are not
implemented by this bounded workflow. Select a boundary mode explicitly for
the intended data.

## Scope

The `CombiTable2Dv` layout and documented MSL behavior below describe the
reference format and feature being mapped. WaveWorld's implementation is a
native W-Sim calculation over parsed numeric data. It does not invoke Dymola,
compile Modelica, import or execute an FMU, or establish numerical,
solver, or vendor parity with Dymola or any other Modelica tool.

## Sources

- [MSL 4.0.0 `Modelica.Blocks.Tables.CombiTable2Dv`](https://doc.modelica.org/Modelica%204.0.0/Resources/helpWSM/Modelica/Modelica.Blocks.Tables.CombiTable2Dv.html) — table axes and cell layout, text-file format, increasing-grid requirement, interpolation smoothness choices, and extrapolation behaviors.
- [WaveWorld's 1-D `#1` text-table format note](dymola-table-file.md) — shared bounded parser's file-format context and documented subset.

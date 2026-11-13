# STAR-CCM+ directional local CFL estimate

WaveWorld's **Directional local CFL estimate** panel accepts caller-prepared cell data and submits the existing W-Sim `sw-su2-cfl` operation with `method: "method-algo-su2-cfl-directional-local"` and the Host-f64 backend. It returns an estimate for each supplied Cartesian cell and a ratio relative to the largest estimated local timestep. This workflow is inspired by common CFL and local-time-step concepts; Siemens describes Courant-number-based timestep behavior in STAR-CCM+, while SU2's paper describes cell-local timestep estimation from convective and viscous spectral radii. Those references provide context only: this app operation does not reproduce either product's solver internals. ([Siemens: VOF simulation and Courant number](https://blogs.sw.siemens.com/simcenter/vof-simulation-speed-up-with-implicit-multistep/), [SU2 AIAA paper, local time stepping](https://su2code.github.io/documents/SU2_AIAA_ASM2013.pdf))

## Workflow

1. Export or prepare the cell values yourself and provide them as the app-defined CSV. WaveWorld does not extract a mesh or flow state from a STAR-CCM+ project.
2. Choose a positive CFL scale. The initial value is a convenience only; choose a value appropriate to the intended estimate.
3. Review the accepted cell count and inputs, then submit the operation. Computation runs through the existing W-Sim Host-f64 operation.
4. Inspect each returned `dt`, the `dtRef` reference timestep, and `localRatio`. The reference is the maximum returned cell timestep; each ratio is `dt / dtRef`.

## Cell CSV and units

The CSV is an app-defined table with one row per cell and these columns in this exact order:

```csv
cellId,hx_m,hy_m,hz_m,ux_m_s,uy_m_s,uz_m_s,soundSpeed_m_s
```

`cellId` is a unique positive safe integer identifying the row. `hx_m`, `hy_m`, and `hz_m` are positive Cartesian cell extents in metres. `ux_m_s`, `uy_m_s`, and `uz_m_s` are signed velocity components in metres per second. `soundSpeed_m_s` is the cell's scalar speed of sound in metres per second. The scalar `cfl` setting is dimensionless.

The app accepts UTF-8 CSV text up to 512 KiB, with one to 5,000 data rows and at most 35,000 numerical cell values. The header must match the spelling, order, and column count shown above exactly. Every data row must have eight cells and seven finite numerical values after its ID. IDs must be unique positive safe integers; extents must be greater than zero; sound speed must be nonnegative; velocity components may have either sign. Empty input, malformed quoting, extra or missing cells, and non-finite numbers are rejected. The app requires finite `cfl` in `(0, 1,000,000]`. The W-Sim operation itself accepts one to 100,000 cells and any finite positive CFL, but the app's lower row and CFL limits apply to this workflow. Inputs that produce a zero or non-finite directional spectral rate, or a non-positive or non-finite timestep, are rejected. The operation accepts the `host` or `auto` backend selection; other backend requests are rejected.

For each row, WaveWorld uses the directional acoustic-plus-advective rate

\[
\lambda_i = \frac{|u_x|+a}{h_x} + \frac{|u_y|+a}{h_y} + \frac{|u_z|+a}{h_z},
\qquad
\Delta t_i = \frac{\mathrm{CFL}}{\lambda_i}.
\]

The aggregate `dtRef` is `max(Δt_i)`, and `localRatio` is `Δt_i / dtRef`. A larger ratio therefore means the estimate for that row is closer to the largest local timestep in this input set.

## Host response integrity

At the application boundary, WaveWorld saves, displays, and exports a result only when the returned module and method match the submitted `sw-su2-cfl` operation and `method-algo-su2-cfl-directional-local` method. The Host response must contain exactly one response row for every submitted cell. Each row's `dt`, directional rate, and `dtRef` must be finite and positive; `localRatio` must be finite, positive, no greater than 1, and consistent with `dt / dtRef`.

Malformed or incomplete Host results are reported as errors and do not produce a successful report or export. This is structural response validation: the frontend checks the response shape and numeric invariants, but does not recompute the timestep or validate the underlying physics. Vendor validation and the stability, convergence, and accuracy caveats below remain unchanged.

## Input provenance and limits

You are responsible for exporting or deriving the cell values, mapping them into the column order, and checking their units, coordinate axes, and consistency. The CSV parser does not infer units, transform coordinate systems, validate mesh quality, or establish that the values came from STAR-CCM+. Keep the source simulation and export settings with your own records when traceability matters.

This is a Cartesian extents approximation with one scalar sound speed per cell. It has no unstructured face metrics, face-normal wave speeds, viscous or thermal solver limits, or other physics-specific timestep restrictions. It estimates a directional convective CFL timescale; it is not an automatic solver timestep or control, and it does not guarantee stability, convergence, or accuracy for a solver using the result.

The operation runs independently through W-Sim Host-f64. It has no `.sim` file, STAR-CCM+ API, macro, or session interoperability, and has not undergone Siemens or STAR-CCM+ numerical validation. SU2-related naming and the cited SU2 reference describe the broader method context, not equivalence to a STAR-CCM+ implementation.

# Guided PEMFC polarization study

WaveWorld's `/comsol` page adds a guided, zero-dimensional PEMFC polarization study using the existing `sw-comsol-pemfc` native operation. The form submits a bounded host-f64 calculation and displays the returned scalar operating point and sampled polarization curve. It is an algebraic model; it does not solve spatial fields or run COMSOL.

## Model and inputs

The study fixes the electron count at `n = 2` and reference voltage at `E0 = 1.229 V`. Temperature and hydrogen, oxygen, and water-vapor partial pressures are prescribed constants for the full curve. The Nernst voltage uses the temperature-corrected reference voltage and pressure ratio:

`E0(T) = E0 - 0.00085 (T - 298.15 K)`

`E_Nernst = E0(T) + (R_g T / (n F)) ln(pH2 sqrt(pO2) / pH2O)`

Here `R_g` is the universal gas constant and `F` is Faraday's constant; pressure inputs are in atm. At current density `j`, the model combines Tafel activation, prescribed area-specific ohmic resistance, and concentration losses:

`eta_act = (R_g T / (alpha n F)) ln(j / j0)` for `j > 0`, and zero at `j = 0`

`eta_ohm = j R_area`

`eta_conc = -(R_g T / (n F)) ln(1 - j / jLim)`

`V = max(0, E_Nernst - eta_act - eta_ohm - eta_conc)`

`power density = j V`; the reported voltage efficiency is `V / E_Nernst`. Voltage efficiency is a cell-voltage ratio, not fuel efficiency or system efficiency.

The guided form exposes a separate scalar operating current `j` and curve settings `imax` and `points`. The native curve samples `j = k imax/(points - 1)` from zero through `imax`, inclusive; the scalar operating point need not coincide with one of those samples. The guided input bounds are stricter than native admission: `T` 273.15–393.15 K; each partial pressure 0.01–10 atm; `j0` 1e-8–0.1 A/cm²; `alpha` 0.1–1; `R_area` 0–5 ohm·cm²; `jLim` 0.01–10 A/cm²; `imax` 0.001–10 A/cm² with `imax < jLim`; `j` 0–`imax`; and 2–201 integer points. To keep the positive-current Tafel expression in its nonnegative-loss range, the form accepts only `j = 0` or `j >= j0`, and requires the first positive curve sample to be at least `j0`. Invalid values are rejected without coercion, rounding, or clamping.

## Results and interpretation

The plot and table use the native sampled current, voltage, and power arrays. A voltage of zero is retained and labeled as the model's zero-voltage floor. The displayed maximum power is only the largest value among the returned samples; it is not a continuous or optimized maximum. Operating-point loss terms come from the native scalar result and are not inferred for individual curve samples.

The study report and CSV downloads preserve the submitted conditions and returned snapshot. The JSON report is a WaveWorld study format, not a COMSOL file or interchange format. The execution label is host-f64 and does not imply GPU execution.

## Scope and limits

This is a bounded algebraic 0D polarization illustration with constant prescribed temperature, gas partial pressures, and area-specific resistance. It does not calculate membrane properties or fit parameters. It has no PDE, spatial current or species distributions, gas-channel or porous-media flow, water transport or phase management, thermal coupling, transient behavior, electrolyzer mode, or material certification. A sampled curve is not a validated stack prediction.

COMSOL's PEMFC tutorial describes a broader coupled multiphysics model with spatial species transport and heat transfer. That reference gives context for the guided workflow; it does not mean WaveWorld runs COMSOL or reproduces its field solution: [COMSOL Fuel Cell interface overview](https://doc.comsol.com/6.4/doc/com.comsol.help.fce/fce_introduction.02.11.html) and [COMSOL PEM fuel cell tutorial](https://doc.comsol.com/6.4/doc/com.comsol.help.models.fce.ht_pem/ht_pem.html).

## Verification status

Static gates passed: `npx tsc -b`, `npx tsc --noEmit -p tsconfig.app.tests.json`, focused strict TypeScript checking for all four PEMFC E2E specs, Host `npm run typecheck --prefix apps/host`, and W-Sim `cargo check --tests --locked`. These checks compile sources; no tests, browser, solver, numerical run, or vendor comparison was executed. `nvcc` was unavailable and CUDA fatbin stubs were empty, so this is not GPU validation.

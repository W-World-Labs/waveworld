# Generalized-Newtonian rheology table

WaveWorld's COMSOL study page provides a bounded table of effective viscosity and shear stress against shear rate, evaluated by the existing W-Sim native operation `sw-comsol-nonnewtonian-b` using `method-algo-rheology-viscosity`. This is a COMSOL-style constitutive-property workflow. It does not open or execute a COMSOL model and makes no claim of matching COMSOL numerically.

## Constitutive models and inputs

The study samples a user-selected generalized-Newtonian model at explicitly supplied nonnegative shear rates. The app provides a small default sample set and accepts an app-defined one-column `shearRate` CSV. It limits a submitted table to 1–256 samples. The native operation also accepts explicit `shearRate` or `shearRates` values (one of these is required; they cannot both be supplied); its native array limit is 10,000. App requests use the app's stricter 256-sample limit.

The five supported models and native parameter names are:

| Model | Required parameters | Effective viscosity |
| --- | --- | --- |
| Newtonian | `viscosity` | `mu` |
| Power law (Ostwald–de Waele) | `K`, `n` | `K * shearRate^(n - 1)` |
| Carreau | `mu0`, `lambda`; `muInf` defaults to 0 and `n` defaults to 0.5 | `muInf + (mu0 - muInf) * (1 + (lambda * shearRate)^2)^((n - 1)/2)` |
| Bingham | `muP`, `tauY`; `regularizationM` defaults to 1000 | `muP + tauY * (1 - exp(-m * shearRate)) / shearRate` |
| Herschel–Bulkley | `K`, `tauY`; `n` defaults to 1 and `regularizationM` defaults to 1000 | `K * shearRate^(n - 1) + tauY * (1 - exp(-m * shearRate)) / shearRate` |

Here `m` is `regularizationM`. Bingham and Herschel–Bulkley use Papanastasiou regularization; the displayed expressions at zero shear are evaluated using their finite limit, not by dividing by zero. The native result reports apparent viscosity and shear stress `tau = mu_eff * shearRate` for each sample, along with zero- and infinite-shear viscosity limits and flags for unbounded limits.

Native input admission requires finite, nonnegative shear-rate values and finite model parameters in the model's stated domain. Required viscosity/consistency/time/yield parameters are positive; power-law and Herschel–Bulkley `n` is positive; Carreau requires `0 < n <= 1`, `mu0 > muInf >= 0`, and positive `lambda`; `regularizationM` must be positive. Unsupported fields and unknown model names are rejected. These native positivity and finiteness requirements are not a claim of a universal physical calibration range; the guided app additionally limits its sample count to 256.

For shear-thinning power-law or Herschel–Bulkley input (`n < 1`), apparent viscosity is unbounded at exactly zero shear. That sample is returned with `effectiveViscosity: null`, `shearStress: null`, and `singular: true`; the operation does not invent a finite viscosity. Stress itself has a zero limit, but the native table marks both values null for the singular apparent-viscosity sample. At nonzero shear, the native method computes both finite values when they lie in the numeric domain.

## Host job and result provenance

Each submission captures the selected constitutive model, its parameters, the requested shear-rate points, and the generated native input as one study snapshot. The app creates a W-Sim `JobSpecV1` for module `sw-comsol-nonnewtonian-b`, method `method-algo-rheology-viscosity`, and backend `host`. It sends the job through WaveWorld's existing authenticated W-Sim Host settlement path; the returned result is checked against the submitted module/method/backend identity and remains associated with that input snapshot and Host job ID.

The native implementation is [`sw_comsol_nonnewtonian_b.rs`](../../20-15-w-sim/crates/w-sim-cuda/src/module/sw_comsol_nonnewtonian_b.rs). WaveWorld app provenance is represented by [`ComsolRheologyStudyPanel.tsx`](../src/components/comsol/ComsolRheologyStudyPanel.tsx), [`ComsolRheologyEditor.tsx`](../src/components/comsol/ComsolRheologyEditor.tsx), [`ComsolRheologyResults.tsx`](../src/components/comsol/ComsolRheologyResults.tsx), and [`comsol-rheology-input.ts`](../src/lib/sim/comsol-rheology-input.ts). The native result identifies backend `w-sim-cuda-host` with kind `host-f64`; GPU/CUDA requests fail closed because this operation has no GPU implementation.

## Scope and limits

This workflow evaluates a scalar constitutive law over a finite set of shear-rate samples. It does not read `.mph` files, solve a CFD PDE, compute a full velocity or pressure field, or perform a general flow simulation. The W-Sim module contains other analytic rheology operations, but this guided table uses only the viscosity method. It does not invoke COMSOL or establish vendor parity.

## Verification status

The app/native tests for this workflow have been authored but have not been run. This document makes no PASS claim and reports no COMSOL or vendor comparison.

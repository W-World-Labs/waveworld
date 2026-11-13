# #47-B Numerical rationale for preregistration v2 draft

Status: **draft rationale only**. Does **not** register v2. Does **not** amend `preregistration.json` (v1) or the failed v1 CPU/GPU gate (#43).

Companion file: `../preregistration-v2.draft.json` (`status: draft-not-registered`).

## 1. What is being bounded

| Gate | Compares | Question |
|------|----------|----------|
| **Implementation equivalence** | GPU f32 vs **CPU f32 proxy** | Same equation / coefficients / update order? |
| **Scientific equivalence** | GPU f32 (or CPU f32) vs **CPU f64** | Same model-fit / hypothesis decision as the scientific reference? |
| **Refinement** | factors 1× / 2× / 4× at fixed final time | Does step-size-driven f32 accumulation flip the scientific decision? |

v1 only had a single state-level GPU-vs-f64 gate with `1e-9` abs / `1e-7` rel — tighter than sustainable f32 RK4 error after O(10²)–O(10³) steps.

## 2. Dimensions and scales

- **State**: normalized populations / intensities; dominant components O(1). Early `singletO2` (and similar) can be near zero.
- **Time**: fitted trajectory uses `dt = 0.01`, `steps = 922` at factor 1× ⇒ final time `9.22` on the normalized log-pulse axis (not physical seconds of the laser pulse).
- **Scientific RMSE**: dimensionless normalized intensity residual; v1 fit threshold **0.08**. Observed failed-fit RMSE stays **> 0.55**; f32 vs f64 RMSE delta ≈ **1.27e-7**.

### Binary32 ULP at unit scale

\[
\mathrm{ulp}(1.0_{f32}) = 2^{-23} \approx 1.1920928955078125\times 10^{-7}.
\]

Four ULPs:

\[
4\cdot\mathrm{ulp}(1) \approx 4.76837158203125\times 10^{-7}.
\]

This is the draft **maximumAbsoluteStateError** for implementation equivalence. Production GPU−CPU32 residuals were **≤ ~1 ULP** (Air) and **≤ ~0.5 ULP** (N2) in the #47-A diagnosis — so 4 ULP is headroom, not a rewrite of the physics.

### Relative error floor

Denominator floor **1e-4**:

- Prevents near-zero species from dominating relative error (observed near-zero max abs ≤ ~1e-12, not the overall max abs ~1e-6–1e-7).
- Floored relative bound at the floor: \(4.768\times 10^{-7} / 10^{-4} \approx 4.768\times 10^{-3}\), matching `maximumFlooredRelativeStateError`.

## 3. Step-size accumulation

RK4 with fixed coefficients: global floating-point drift between f32 and f64 tends to grow with **step count** when the continuous problem is the same.

| Factor | dt | steps (fixed \(T=9.22\)) | Expectation |
|--------|-----|---------------------------|-------------|
| 1 | 0.01 | 922 | baseline f32–f64 drift |
| 2 | 0.005 | 1844 | more f32 updates ⇒ drift non-decreasing |
| 4 | 0.0025 | 3688 | further accumulation |

**Scientific requirement:** model-fit fail / hypothesis decision must stay stable across factors (still “does not meet 0.08 RMSE”). Refinement is a **stability** check, not a way to pass v1’s impossible f32≈f64 state gate.

First crossing of **v1** abs/rel state thresholds occurs at **step 6** (Air: S0; N2: T1) — evidence that the v1 gate fires early under correct f32 arithmetic.

## 4. Scientific delta bound (1e-5 RMSE)

- Observed max |RMSE_f32 − RMSE_f64| ≈ **1.27e-7**.
- Proposed max delta **1e-5** ≈ **79×** observed delta, yet only **0.0125%** of the 0.08 fit threshold width.
- Purpose: catch implementation bugs that move calibration error meaningfully without pretending f32 matches f64 state trajectories to 1e-9.

## 5. Explicit non-goals

- **Not** rescinding the v1 failed GPU gate.
- **Not** claiming clinical or absolute concentration accuracy.
- **Not** registering this draft until independent review + manifest digests + registration timestamp (see `freezeRequirements` in the JSON draft).

## 6. Reproduction

```bash
npm run golden:gpu:diagnose:cpu
npm run test:golden
```

See also `results/47a-precision-attribution-first-cut.md`.

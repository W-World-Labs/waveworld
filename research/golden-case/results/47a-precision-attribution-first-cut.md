# #47-A GPU precision attribution — first cut

Status: complete for workstream A. **Does not amend** `preregistration.json`, the v1 CPU/GPU gate failure (#43), or any prior formal decision.

## Provenance structure

Every automated run of `npm run golden:gpu:diagnose` / `golden:gpu:diagnose:cpu` emits:

| Field | Source |
|---|---|
| `provenance.sourceCommit` | `git rev-parse HEAD` |
| `provenance.executedAt` | ISO-8601 wall clock |
| `provenance.runtime.{node,platform,arch}` | Node process |
| `provenance.hardware.deviceName` | live Dawn adapter **or** frozen fixture `intel-r-hd-graphics-p630-kbl-gt2-` |
| `provenance.mode` | `live-physical-gpu` \| `cpu-only-with-production-fixture` |
| `provenance.productionFixture` | embedded `#43` / `f996712` numbers |

Reproduction (CI-safe, no physical GPU required):

```bash
npm run golden:gpu:diagnose:cpu
npm run test:golden
```

Physical GPU (production render identity):

```bash
npm run golden:gpu:diagnose
```

## Three-way comparison entry

| Backend | Precision | Role |
|---|---|---|
| CPU RK4 (`rk4Step`) | f64 | scientific reference |
| CPU f32 proxy (`integratePhotoF32`) | explicitly rounded binary32 | same-precision implementation reference |
| Physical WebGPU WGSL | f32 | production adapter (or frozen fixture summary) |

Commands:

- `npm run golden:gpu` — GPU f32 vs CPU f64 only (v1 gate; remains failed)
- `npm run golden:gpu:diagnose` — full live three-way + 1/2/4× refinement
- `npm run golden:gpu:diagnose:cpu` — CPU f64 vs CPU f32 + production GPU fixture ratios

## Key numbers (factor 1×, fitted golden params)

Fitted RK4 params for both conditions: `k_exc=2`, `k_q=8`, `dt=0.01`, `steps=922`. O2 = 1 (air) / 0.02 (N2).

### Overall max abs / relative

| Pair | Condition | max abs | max rel (raw, floor 1e-12) | max rel (floored, 1e-4) |
|---|---|---:|---:|---:|
| **CPU32 − CPU64** | Air | **3.731e-7** | 1.394e-6 | 1.394e-6 |
| **GPU − CPU64** (prod fixture) | Air | **3.042e-7** | 1.293e-6 | — |
| **CPU32 − CPU64** | N2 | **9.169177409562579e-7** | 3.134774991978644e-6 | 3.135e-6 |
| **GPU − CPU64** (prod fixture) | N2 | **9.169177409562579e-7** | 3.134774991978644e-6 | — |
| **GPU − CPU32** (prod ae33888) | Air | 1.192e-7 | 2.079e-7 | — |
| **GPU − CPU32** (prod ae33888) | N2 | 5.960e-8 | 2.093e-7 | — |

**N2 smoking gun:** local CPU f32 versus CPU f64 max absolute **and** max relative errors are **bit-identical** to the production physical-GPU versus CPU f64 bounds recorded in `production-gpu-f996712.summary.json`. The GPU trajectory therefore cannot implement a different ODE or state update; it is the same f32 RK4 family as the CPU proxy.

Air ratio `GPU/CPU32_vs_CPU64 ≈ 0.82` (same order; residual GPU–CPU32 ≤ 1 unit-scale ULP).

### Near-zero relative error separation

Denominator floor `1e-4` (v2 draft). On both conditions, samples with `|expected| < 1e-4` are confined to early `singletO2` (and similar) and contribute:

| Condition | near-zero max abs | dominates overall max abs? |
|---|---:|---|
| Air | ~5.8e-13 | **no** (overall 3.7e-7) |
| N2 | ~2.3e-12 | **no** (overall 9.2e-7) |

Raw relative error is **not** driven by near-zero blow-up. Floored relative ≈ raw relative for the worst states (unit-scale `S0`/`T1`).

### First significant divergence (vs v1 thresholds 1e-9 abs **and** 1e-7 rel)

| Condition | step | field | abs | rel | expected |
|---|---:|---|---:|---:|---:|
| Air CPU32−CPU64 | **6** | S0 | 9.73e-8 | 1.09e-7 | 0.894 |
| N2 CPU32−CPU64 | **6** | T1 | 1.07e-9 | 1.15e-7 | 0.0093 |

Divergence appears within the first few RK4 steps at **unit-scale** states — consistent with per-step f32 rounding, not late accumulation of a wrong term.

### Error growth (CPU32 − CPU64 max abs over fields)

**Air:** 1.7e-8 (step 1) → ~1e-7 (10) → plateaus ~2.1e-7 after step 200.

**N2:** 9.3e-9 (step 1) → grows roughly with step count to **9.17e-7** at step 922 (same terminal as production GPU).

Production refinement study (GPU−CPU64, ae33888): 1× → 2× → 4× **increases** max abs as f32 update count rises despite smaller `dt`. Dominant source is **accumulated precision**, not RK4 truncation.

## Scientific decision impact

All CPU64 / CPU32 (and production GPU) RMSE values remain **> 0.55** (air) / **> 0.65** (N2) against frozen limit **0.08**. Hypothesis decision **fail** is stable. Precision does not rescue model fit.

## Conclusion

| Hypothesis | Verdict |
|---|---|
| Implementation defect (wrong equation / indexing / update) | **Rejected** — GPU−CPU32 ≤ ~1 ULP; N2 GPU−CPU64 bound **equals** CPU32−CPU64 bound |
| Pure RK4 discretization error | **Rejected** — refining `dt` worsens f32−f64 gap |
| Accumulated binary32 rounding vs f64 scientific core | **Supported** |
| v1 gate should be rewritten as pass | **Forbidden** — keep failed record; next contract is v2 draft only |

## v2 draft

`preregistration-v2.draft.json` remains `draft-not-registered`. Rationale strengthened by #47-A:

- Backend equivalence: GPU f32 vs **CPU f32 proxy**, abs ≤ 4 ulp, floored rel with floor 1e-4
- Scientific equivalence: RMSE delta vs CPU f64 ≤ 1e-5 and **same** hypothesis decision
- Never modifies v1 thresholds (`cpuGpuAbsoluteTolerance: 1e-9`, `cpuGpuRelativeTolerance: 1e-7`)

## Next (out of #47-A)

1. Independent numerical review of v2 draft rationale
2. Register v2 (timestamp + manifest digests) only after review
3. Optional live multi-adapter GPU recheck beyond Intel P630
4. Do **not** close #47 until v2 registration path is agreed; #46 independent review remains unblocked

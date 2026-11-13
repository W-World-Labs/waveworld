# Production GPU precision diagnosis

Status: complete, with the prior CPU/GPU gate remaining failed. This report does not amend `preregistration.json` or its decision.

## Provenance

- Case: `mb-pbs-oxygen-transient-2026`
- Frozen preregistration SHA-256: `6c7a37fb359ced55721a6aac79aea7181b56733815f1e10bee9c99c66a3b7c81`
- Diagnostic source commit: `ae33888`
- Execution environment: production host, transient systemd unit using `waveworld:waveworld` with the same supplementary `render` group as the Agent service
- Physical adapter: Intel HD Graphics P630 `[8086:591d]`, i915, Dawn device `intel-r-hd-graphics-p630-kbl-gt2-`
- Runtime: Linux 6.12.95+deb13-amd64, Mesa Vulkan 25.0.7, libvulkan 1.4.309, Node 20.19.2, tsx 4.23.1
- Raw stdout SHA-256: `5f42ff0e73c58d1efc0e14b83f271ebaea2e099f5cc88b537f5076fc73dd7f00`
- Reproduction: `npm run golden:gpu:diagnose` under an identity with access to the physical render device

## Three-way result

Each row preserves the same total integration time. “GPU–CPU32” compares the WGSL f32 kernel with an explicitly rounded CPU f32 proxy; “GPU–CPU64” compares it with the scientific CPU implementation.

| Condition | refinement | dt | GPU–CPU32 max abs | GPU–CPU32 max rel | GPU–CPU64 max abs | GPU–CPU64 max rel | GPU–CPU64 RMSE delta |
|---|---:|---:|---:|---:|---:|---:|---:|
| Air | 1× | 0.01 | 1.1921e-7 | 2.0792e-7 | 3.0423e-7 | 1.2925e-6 | -2.7197e-8 |
| Air | 2× | 0.005 | 5.9605e-8 | 1.7076e-7 | 5.2807e-7 | 2.3468e-6 | -1.7315e-8 |
| Air | 4× | 0.0025 | 5.9605e-8 | 2.0334e-7 | 8.8570e-7 | 5.4779e-6 | -1.2700e-7 |
| N2 | 1× | 0.01 | 5.9605e-8 | 2.0933e-7 | 9.1692e-7 | 3.1348e-6 | 5.0064e-9 |
| N2 | 2× | 0.005 | 5.9605e-8 | 2.2074e-7 | 1.7492e-6 | 6.7314e-6 | 1.3288e-8 |
| N2 | 4× | 0.0025 | 8.9407e-8 | 2.3975e-7 | 5.0892e-6 | 1.3045e-5 | 7.8719e-8 |

The CPU32 proxy is deterministic in CI. Its small residual against GPU (at most one unit-scale f32 ULP in this run) is consistent with permitted shader arithmetic contraction/evaluation differences. The growing GPU–CPU64 difference as the number of f32 updates increases, despite a smaller integration step, identifies accumulated precision rounding rather than RK4 discretization as the dominant source. No evidence of a different ODE or state-update implementation was found.

## Scientific metric impact

| Condition | refinement | CPU64 RMSE | CPU32 RMSE | GPU RMSE | frozen limit |
|---|---:|---:|---:|---:|---:|
| Air | 1× | 0.5523075721 | 0.5523075332 | 0.5523075449 | 0.08 |
| Air | 2× | 0.5523069944 | 0.5523069889 | 0.5523069771 | 0.08 |
| Air | 4× | 0.5523033527 | 0.5523032493 | 0.5523032257 | 0.08 |
| N2 | 1× | 0.6526689124 | 0.6526689174 | 0.6526689174 | 0.08 |
| N2 | 2× | 0.6526688499 | 0.6526688634 | 0.6526688632 | 0.08 |
| N2 | 4× | 0.6526689881 | 0.6526690653 | 0.6526690668 | 0.08 |

All CPU64, CPU32 and physical-GPU runs preserve the preregistered model-fit failure by a wide margin. Numerical precision does not change the hypothesis decision.

## Decision

The original state-level gate remains failed because it compared f32 with f64 using `1e-9` absolute / `1e-7` relative tolerances. A future contract should separately test backend implementation equivalence against a same-precision proxy and scientific-decision equivalence against the f64 reference. The proposed contract is recorded only in `preregistration-v2.draft.json`; it cannot retroactively pass this run.

# #47 residual — draft contract evaluation (auto-only)

Status: **draft evaluation tooling only**. Does **not** register v2. Does **not** close formal peer review on #47 / #53 residual.

## Purpose

Give reviewers a single CI-safe command that checks the unregistered
`preregistration-v2.draft.json` against:

1. Frozen v1 digests and failed v1 CPU/GPU gate (must remain failed).
2. Scientific RMSE delta bound (`1e-5`) and model-fit decision stability.
3. Refinement factors `1/2/4` with non-decreasing CPU32–CPU64 abs drift.
4. Production GPU–CPU32 fixture within the draft 4×ULP implementation bound.

## Commands

```bash
npm run golden:draft:eval
npm run golden:draft:write-summary
npm run golden:draft:check
npm run test:golden
```

`--write-summary` rewrites the frozen peer-review snapshot
`47c-draft-contract-evaluation.summary.json` (stable fields only; no
`executedAt`). `--check-frozen` (via `golden:draft:check`) re-runs live
evaluation and exits non-zero if frozen drifts — without writing or
registering v2. Live and frozen must stay in sync; `test:golden` asserts that
gate. The snapshot always carries `formalReviewStillRequired: true` and
`registered: false`.

Machine-readable companion: `47c-draft-contract-evaluation.summary.json`.

## Explicit non-goals

- Not a substitute for independent numerical review of ULP / step-size rationale.
- Not a registration timestamp or manifest freeze.
- Not a rewrite of `preregistration.json` or the #43 failure record.
- Not a close of #47 formal peer review (Blocked residual remains human).

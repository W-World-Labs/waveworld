# #47 residual — peer-review packet (auto draft tools only)

Status: **draft peer-review packaging only**. Does **not** register v2. Does **not**
close formal peer review on #47 / #53 residual. Checklist items below are always
unchecked when this file is produced by auto tooling.

## Purpose

Give an independent numerical reviewer a single machine-readable packet plus this
brief that collect:

1. Frozen v1 + draft digests (from 47c).
2. On-disk artifact file digests (verify files were not swapped after freeze).
3. Draft contract bounds (ULP abs / floored rel / RMSE delta / refinement factors).
4. `freezeRequirements` from `preregistration-v2.draft.json`.
5. Separation-from-v1 statements (v1 failure preserved).
6. An undone reviewer checklist (human must attest outside this tooling).

## Machine-readable packet

`results/47d-peer-review-packet.summary.json`

Flags: `registered=false` · `formalReviewStillRequired=true` · `v1GateRemainsFailed=true` · caseId=`mb-pbs-oxygen-transient-2026-v2`

## Commands

```bash
npm run golden:draft:peer-packet
npm run golden:draft:check-peer-packet
npm run test:golden
```

`--write-peer-packet` rewrites the JSON packet **and** this markdown brief.
`--check-peer-packet` rebuilds the packet from live digests + draft freezeRequirements,
requires 47c frozen sync first, verifies on-disk artifact file digests, and exits
non-zero on drift — without writing or registering v2.

## Digests (from frozen 47c)

- v1 preregistration: `6c7a37fb359ced55721a6aac79aea7181b56733815f1e10bee9c99c66a3b7c81`
- draft preregistration: `486f263f47f1b6b94d4e552b12e337c0c0881e8345d310d9134f12355ed5b36a`
- draft pins v1: `true`

## Artifact file digests (SHA-256)

- `research/golden-case/preregistration-v2.draft.json` → `486f263f47f1b6b94d4e552b12e337c0c0881e8345d310d9134f12355ed5b36a`
- `research/golden-case/preregistration.json` → `6c7a37fb359ced55721a6aac79aea7181b56733815f1e10bee9c99c66a3b7c81`
- `research/golden-case/results/47c-draft-contract-evaluation.summary.json` → `e1fe44d5875b4b1fddb470b69d6824724282f89227775de52bad41822cb74c1a`
- `results/47a-precision-attribution-first-cut.md` → `4a8aef03e27aa5d1b5f3d4a26a9bda8cc5cc48e1d4f23a0a8eca89b077f3ffd9`
- `results/47b-numerical-rationale.md` → `6a44110531975a5d8b0e3d0dfb9010ad1a37f2dd3fa4389d53e8164a1f6c79cf`
- `results/47c-draft-contract-evaluation.md` → `bffb1d77281665f73847a4ee2936110e8f9f1e3728f3e23de417fc8690c69864`

## Contract bounds

- max abs state error: `4.76837158203125e-7`
- rel denominator floor: `0.0001`
- max floored rel state error: `0.00476837158203125`
- max calibration RMSE delta: `0.00001`
- refinement factors: `1, 2, 4`

## Evaluation summary (frozen 47c)

- allPassed: `true`
- scientificConclusionStable: `true`
- implementationDefectSuspected: `false`
- v1GateRemainsFailed: `true`
- failedIds: `(none)`

## freezeRequirements (from draft)

1. Review the numerical rationale independently (dimensions, ULP derivation, step accumulation).
2. Add the draft and diagnostic report digests to the versioned manifest.
3. Assign a registration timestamp before the first v2 formal run.
4. Never modify or reinterpret the v1 preregistration or its failed CPU/GPU result.
5. Confirm immutablePriorPreregistrationSha256 still matches research/golden-case/preregistration.json.

## Separation from v1

- v1 CPU/GPU abs tol: `1e-9`
- v1 CPU/GPU rel tol: `1e-7`
- v2DoesNotRescindV1: `true`
- whyV1Failed: v1 compared GPU f32 trajectories to CPU f64 with tolerances tighter than binary32 accumulation over hundreds of steps; failure is expected under correct f32 RK4 and is preserved as a frozen negative result.

## Reviewer checklist (auto: all undone)

1. [ ] `freeze-requirement-1` — Review the numerical rationale independently (dimensions, ULP derivation, step accumulation). **(required)**
2. [ ] `freeze-requirement-2` — Add the draft and diagnostic report digests to the versioned manifest. **(required)**
3. [ ] `freeze-requirement-3` — Assign a registration timestamp before the first v2 formal run. **(required)**
4. [ ] `freeze-requirement-4` — Never modify or reinterpret the v1 preregistration or its failed CPU/GPU result. **(required)**
5. [ ] `freeze-requirement-5` — Confirm immutablePriorPreregistrationSha256 still matches research/golden-case/preregistration.json. **(required)**
6. [ ] `confirm-ci-draft-eval-green` — Confirm npm run golden:draft:check and npm run test:golden are green on the reviewed commit (draft tools only). **(required)**
7. [ ] `do-not-auto-register` — Do not flip draft.status away from draft-not-registered or claim formal v2 registration without human attestation + manifest digests + timestamp. **(required)**

## Explicit non-goals

- Not a formal registration or manifest freeze.
- Not a human attestation record (checklist stays undone in CI).
- Not a close of #47 formal peer review (**Blocked** residual remains human).

## Note

Draft-only peer-review packet for independent numerical review of preregistration-v2.draft.json. Re-run: npm run golden:draft:peer-packet | golden:draft:check-peer-packet. Does not register v2. Does not close formal #47.

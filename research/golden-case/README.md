# WaveWorld golden research case R1

**Status:** workflow + retained negative kinetic result. Independent human
review (`INDEPENDENT_REVIEW.md` / 47d) is **not** complete — this is not a
peer-reviewed publication and v2 must not be registered until 47d is attested
outside this tooling (#82).

This case freezes a small, paired slice of real experimental data from Sandberg
et al., “Local Monitoring of Photosensitizer Transient States Provides Feedback
for Enhanced Efficiency and Targeting Selectivity in Photodynamic Therapy.” The
source record is [Zenodo 7469900](https://doi.org/10.5281/zenodo.7469900), released
under CC BY 4.0.

The selected curves are Figure 1C measurements at pH 3.5 and 431 W cm^-2 in
air-saturated and nitrogen-saturated PBS. The committed CSV files are
line-ending-normalized, header-normalized snapshots of those two source entries;
the numeric tokens are unchanged. The manifest records both upstream entry
hashes and committed snapshot hashes so acquisition and repository integrity are
separate, explicit claims.

This benchmark asks whether declared kinetic models can reproduce the paired
curve shapes and whether oxygenation changes fitted kinetics. Intensity is used
only as a dimensionless empirical transient-state proxy after the registered
normalization. It is not presented as an absolute chemical concentration,
singlet-oxygen yield, treatment efficacy, or causal clinical evidence.

Run the offline integrity and reconstruction gate from the repository root:

```bash
node scripts/research/golden-case.mjs verify
```

The verifier performs no network requests. Acquisition is documented separately
and must verify the upstream archive and entry hashes before replacing a frozen
snapshot.

Run the preregistered models and reproduce the recorded scientific decision:

```bash
npm run golden:run
npm run test:golden
```

The first formal result is intentionally retained in
`results/formal-local-v1.summary.json`. It rejects the preregistered model-fit
hypothesis: both RK4 fits miss the RMSE gate and their fitted `k_q` values hit the
upper bound. This is a valid negative scientific result, not a workflow failure;
the registered thresholds have not been relaxed after observing it.

CPU/GPU numerical attribution (#47) is separate from the scientific decision. The
v1 state-level CPU f64 vs GPU f32 gate remains **failed** as recorded. Reproduce
the three-way comparison (CPU f64 / CPU f32 proxy / GPU or production fixture):

```bash
npm run golden:gpu:diagnose:cpu   # CI-safe; embeds production GPU fixture
npm run golden:gpu:diagnose       # live physical WebGPU when available
```

See `results/47a-precision-attribution-first-cut.md`, the draft-only
`preregistration-v2.draft.json` (does not amend frozen v1 thresholds),
`results/47b-numerical-rationale.md` (ULP / step-size rationale for the draft),
and the CI-safe draft contract evaluator (does **not** register v2):

```bash
npm run golden:draft:eval              # live draft contract evaluation (registered:false)
npm run golden:draft:write-summary     # refresh frozen 47c peer-review snapshot
npm run golden:draft:check             # assert frozen 47c matches live (no write; no register)
npm run golden:draft:peer-packet       # refresh frozen 47d human peer-review packet
npm run golden:draft:check-peer-packet # assert frozen 47d matches digests/freezeRequirements
```

Machine-readable draft evaluation evidence: `results/47c-draft-contract-evaluation.summary.json`
(`formalReviewStillRequired: true`; `test:golden` / `golden:draft:check` keep it in sync with the live evaluator).
Human peer-review packet (checklist always `done:false` until a reviewer attests outside this tooling):
`results/47d-peer-review-packet.summary.json` — packages freezeRequirements, contract bounds, digests, artifact paths, and **on-disk artifact file digests** without registering v2.
Human-readable brief (auto-rendered from the packet; re-run `golden:draft:peer-packet` to refresh):
`results/47d-peer-review-packet.md`.
Formal v2 registration still requires independent numerical review (#47 / #53 residual; **Blocked**).
A final publication must embed the preregistration and machine-readable decision
artifacts. The golden verifier then reconstructs observations from the embedded
CSV evidence, recalculates calibration RMSE and the registered decision, and
rejects a re-signed but scientifically altered result:

```bash
node scripts/research/verify-golden-publication.mjs golden.wwpub.json
```

The final non-implementer acceptance must follow `INDEPENDENT_REVIEW.md` and
submit a completed `independent-review.template.json`. A template or an
implementer-run check is not evidence of independent review.

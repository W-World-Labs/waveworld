# WaveWorld source edition

WaveWorld owns the Atlas presentation, Host execution adapters, mounted Lab and
Agent lifecycle. W-Sim owns numerical methods, capability/runtime contracts and
shared kernels. Reuse its reviewed public packages; never copy a parallel solver
or depend on an adjacent checkout. Keep changes small and reuse existing types.

Preserve OIDC identity, stable issuer/subject mapping, session/tenant/owner checks,
job leases, cancellation/settlement, artifact ownership and independent scientific
review. Publishing code never makes anonymous users tenant members or links
accounts by email. Provider discovery grants neither health nor authorization.

## Source and dependencies

- Atlas is at `src/`, Host at `apps/host`, Lab at `apps/lab`, Agent at
  `apps/lab/agent`. `apps/host/openapi-simulation.yaml` owns the HTTP contract.
- `vendor/w-sim/manifest.json` owns exact dependency source/artifact identities.
  Retain the source/closure checks and original notices; update its complete
  dependency set together. Public source availability and runtime activation are
  separate. Never describe an unpublished local source hash as public-reachable.
- The public xradar source pack is documented in `vendor/README.md`. Preserve
  Host/Agent telemetry APIs and bounded failure behavior; do not remove telemetry
  or authentication to avoid a private dependency.
- `LICENSE` covers W-owned source only. `THIRD-PARTY-NOTICES.md` and original
  notices cover third-party source/data/models. Never include private evidence,
  real user uploads, environments, credentials, databases, operational inventories
  or unreviewed benchmark data. Do not silently install engines/models at runtime.

## Configuration and checks

Use Node22 and the locked dependencies. Formal installation/build/test/packaging
for this source workspace runs on standard public GitHub-hosted runners, never
a private action service or production host. Do not keep dependency/build caches
here. Do not add unnecessary unit/integration tests. Preserve meaningful existing
auth, isolation, error, contract and numerical checks without weakening assertions.

Explicit `node scripts/prepare-source-assets.mjs` restores hash-checked lossless
source assets, reuses the authored procedural Ahmed fallback and generates the
actual model manifest. Root and Lab prebuild call it; runtime imports do not.
The held upstream Ahmed/PR2 and raw oversized X57 reference are not distributed.
All21 registered preset paths and generic model import remain; generated teaching
geometry is not a validated reference mesh. Read the original model rights first.

Operator-specific OIDC, storage and provider addresses stay server configured.
`review-configuration.md` explains required `WAVEWORLD_REVIEW_ISSUE_URL` and the
legacy compatible payload name. Missing/invalid trusted review configuration
fails closed503; retain exact origin/repository/issue/comment checks, authenticated
non-owner rules, semantic verification and tamper rejection. Keep OpenAPI and
configuration descriptions aligned. Real review comments never belong in source.

For HTML/CSS/browser JS work first use modern-web-guidance and the project's
existing framework. Before changing Lab Next.js APIs, read its installed version's
`node_modules/next/dist/docs/` guides. Keep same-origin browser routes, request
nonces/CSP and secure server session cookies. Never import server databases or
credentials into client components. No new web service or analytics system.

Source/CI success does not prove engineering accuracy, hardware acceptance, Lab
full usability or deployment. Keep source blobs below10MiB and source trees
below100MiB. Scan exact current source and complete history/objects, review
actual source archives, and wait for exact-commit public CI before release.

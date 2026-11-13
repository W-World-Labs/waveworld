# WaveWorld

WaveWorld is an interactive simulation presentation and execution-adapter
source distribution: a Vite Atlas (React/Three.js), authenticated Host jobs/artifacts
API, mounted Next.js wind-tunnel Lab and worker Agent. W-Sim owns numerical
methods, solver/runtime contracts and shared kernels; WaveWorld assembles valid
requests and presents provider capabilities, progress and saved results.

Host sessions, tenant/owner authorization, durable jobs, artifact permissions,
lease/cancel/settlement and scientific publication/independent-review mechanisms
are retained. Public source is not public access to any deployed tenant, stored
data, credentials, provider account or production service.

## Source boundaries

| Source | Responsibility |
| --- | --- |
| `src/` | Atlas simulation controls, knowledge views and adapters |
| `apps/host/` | Authenticated jobs, storage, artifacts and research adapters |
| `apps/lab/` | Mounted Lab/model UI and local experiment presentation |
| `apps/lab/agent/` | Existing worker claim/lease/settlement/backend adapters |
| `vendor/w-sim/manifest.json` | Immutable reviewed W-Sim package closure |
| `vendor/README.md` | Reviewed public xradar source dependency |

This edition excludes private deployment/CI control files, environment values,
operational notes, real review bodies and private runtime databases. It does not
activate or deploy a service, publish a formal CPU/GPU executable, certify
engineering validity or claim the Lab's existing usability blocker is closed.

## Explicit preparation and development

Use Node22. Dependency installation is an explicit operator action, not library
behavior. The four lockfiles select root, Host, Lab and Agent dependencies.
Formal source builds/tests run in public GitHub CI; do not copy installed
dependencies or build caches between workspaces.

```sh
node scripts/prepare-source-assets.mjs
npm ci
npm ci --prefix apps/host --legacy-peer-deps
npm ci --prefix apps/lab --legacy-peer-deps
npm ci --prefix apps/lab/agent --legacy-peer-deps
npm run build
npm run build:host
npm run build --prefix apps/lab
```

Source assets are intentionally separate from solver ownership. Explicit
preparation restores three lossless gzip inputs with both archive and decoded
SHA-256/size checks, reuses the existing authored Ahmed generator, and writes
the actual model manifest. It never fetches a model, installs software or
executes a native solver. The21 preset paths and generic upload functionality
remain; the authored Ahmed teaching approximation is not the unlicensed original
reference mesh. Optional raw X57 and unverified PR2 references are excluded.

OIDC issuer/client/session settings and durable storage paths must be supplied
for the selected deployment. Production auth never falls back to development
login. See `review-configuration.md` for operator-selected evidence source and
its503 fail-closed prerequisite. The legacy payload field is retained, and
independent reviewers still require OIDC identity, non-ownership, valid immutable
publication digests, semantic verification and a genuine mutation-rejection check.

Numerical packages and optional native executors must come from their owning
reviewed source/release with exact identities and hashes. The W-Sim bundle
manifest is authoritative; no sibling checkout, floating revision, silent engine
installation or fake claim of an unpublished dependency's availability is allowed.
Runtime/hardware/native binary acceptance is separate from this source CI.
These presentation and execution adapters are not complete engineering engines.

## Rights and evidence

The root MIT license covers W-owned source/documentation/authored synthetic
examples. [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) preserves original
source/data/model terms, including Sony SCEA for Duck, CC0 for ToyCar, Cesium
CC-BY/mark terms, OCP OWFa and NASA attribution. They are not all MIT. Original
software-case and public dataset notices remain adjacent to their inputs.

Scientific snapshots and current numerical modes carry explicit assumptions and
limits in their source/docs. A short reference or smoke check does not establish
convergence, accuracy for real equipment, medical validity or complete format
compatibility. API/DTO contract remains in `apps/host/openapi-simulation.yaml`.
Public builds retain meaningful auth/isolation/contract gates and never use
production secrets or publish user input/review reports as artifacts.
Private forge/deployment metadata cases are explicitly reported as skipped;
source authentication, nonce, ownership and tenant-isolation checks remain active.

Dependency security review (2026-11-14): the Vite/Vitest development toolchain
uses6.4.6/4.1.12, removing the former three critical advisories and obsolete
Tinypool/vite-node chain. Existing tests and production dependencies are retained.
Known high/moderate/low findings remain in the root, Host and Lab dependency
trees; their production reachability and fixes are still pending. CI checks all
four locks and rejects critical findings while reporting every severity. Passing
this source gate does not establish complete runtime security or engineering acceptance.

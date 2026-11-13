# Source and runtime boundary

## Topology

The Vite Atlas presents simulations and knowledge views. Host owns authenticated
jobs, storage, artifacts and scientific publication; the mounted Lab presents
experiments, and Agent implements the existing claim/lease/settlement adapters.
Preserve same-origin routes, OIDC identity, tenant/owner checks and durable data.

`../config/Caddyfile.example` is a source example with a reserved hostname and
local example upstreams. It retains the existing CSP/HSTS/no-store rules; it is
not live edge configuration or evidence of TLS, routing, authentication or
regional acceptance. Operators must explicitly configure their own edge, trusted
proxies, issuer, storage and providers. See the root README and
`../review-configuration.md` for the source/configuration prerequisites.

Public source CI produces an exact-commit source archive, not a deployable
application release. A runtime deployment requires a separately verified single
CI-built release package and its own source identity, hashes, dependency notices,
installation conditions and acceptance. The private forge/deployment metadata
cases are explicitly outside this public source acceptance. No private release
packager, actual deployment values or operational review bodies are included.

Generic backup/restore implementations remain under `scripts/deploy/`. Their
presence does not authorize a runtime operation or certify a backup. The original
private checkout, production pin and existing deployment are not changed by this
publication. Source CI does not establish complete engineering, GPU, Lab usability
or independent human-review acceptance.

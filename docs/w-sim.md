# W-Sim dependency contract

W-Sim owns numerical methods, shared runtime/contracts, capability matching and
kernel source. WaveWorld owns the presentation plus current Host/Agent execution
adapters until compatible transfers preserve data and service behavior. No
duplicate solver source or adjacent-checkout dependency is introduced here.

The complete immutable package/artifact identities, source revision and integrity
values are recorded in `vendor/w-sim/manifest.json`; published availability must
be verified independently of a local candidate. Its preinstall/source-closure
gate remains mandatory. Public source, produced package artifacts, native CPU/GPU
releases and production activation are distinct states.

Consumers keep the0.3 package/API family, JobSpecV1 lifecycle, fileProtocol1 and
shared WASM ABI11. Existing Host auth, tenant/owner filters, artifact binding,
leases, terminal receipts and cancellation remain. Do not widen capability or
kind admission to compensate for a missing backend. Public source CI does not
claim a new formal native executable or GPU/engineering acceptance.

Use the existing `@w-sim/contracts`, `@w-sim/kit`, `@w-sim/runtime` and selected
solver/importer public interfaces. Browser calls stay same-origin; required
server providers are configured explicitly and fail clearly when unavailable.
Runtime discovery grants neither authorization nor proof of numerical accuracy.
Teaching/legacy modes and unresolved Lab honesty markers remain in source.

# Thermal temperature artifacts

## Native3D steady field delivery (OpenAPI1.56.7)

The explicit dimension=3 `thermal-3d-steady` path uses the existing artifact
upload/store/read APIs. Native writes a `thermal-temperature-field` f64 file
and `thermal-kpi-summary` JSON file. Agent preflight verifies both regular
files and the exact JSON/summary match before uploading, validates each Host
acknowledgement and maps only artifact references. There is no added
`kpiArtifactId`; the unique KPI-kind descriptor identifies that artifact.
A native delivery failure propagates instead of silently returning a CPU
result whose descriptors have no saved files.

Host completion requires both uploaded files to belong to the current job,
owner and project. Byte counts/SHA, grid, C/K units, finite values, field
extrema, 32-hex inputDigest shape and exact KPI JSON/summary are checked.
InputDigest shape and agreement do not recompute the solver's normalized
input hash. At most256 cells require finite decimal CSV equal to every
x-fastest f64 value; signed zeros compare equal. Larger fields forbid CSV.
Rejected completion leaves the active lease available for a corrected retry.
Old completed records and the1D/2D legacy descriptor paths remain readable.

The job result card reads Host-saved field and KPI files, verifies server and
local SHA, and exports their original bytes with spec/result/manifest.

Scoped clean-source regression in W-Sim
`benchmarks/perf/thermal-steady-product-20261015-200111/` replays all18 saved
native3D steady cases (16 inline/two larger) and eight prior transient fields
through the real authenticated in-process route handlers and TaskApiClient.
Their exported field/KPI bytes are exact. Host/OpenAPI routes pass15 tests
with no skips, Agent file/registry tests14, field reader4 and result card7;
clean Host and SPA typechecks pass. This uses installed dependency support
and directory-handle surrogates, with no physical solving or new CUDA build.

The existing browser executor admission is unchanged: this is browser result
reading/export for backend-computed jobs. General steady materials, real
browser filesystem acceptance and coordinated deployed release remain separate.

[CONTRACT IMPACT] New3D steady completion requires matching native producer,
Agent, Host and result readers. Descriptor-only results are rejected. No
HTTP route/envelope or numerical-method/input-digest change is introduced.

## Native steady input contract (OpenAPI 1.56.8)

The existing `thermal-3d-steady` JobSpec can explicitly select
`dimension: 1 | 2 | 3`. Positive geometry lengths, when supplied, are in metres;
`lengthM` is a legacy alias for `lengthX`. Active lengths default to 1 m,
including all three lengths when `dimension: 3` is explicit.
Active grid counts default to 32, `gridN` is the fallback count, and each axis
is capped at 128 nodes. For 3D each active axis requires at least 2 nodes.
The normalized 3D input includes `lengthZ` and `nz`; the established 1D/2D
normalized keys remain unchanged.

The uniform path accepts one positive conductivity (`conductivity`, `k`, or
`thermalConductivity`) and one uniform volumetric source. A finite signed
`volumetricHeatWPerM3` takes precedence; otherwise finite nonnegative `powerW`
is divided by the active domain volume. The contract also describes optional
`materials` and `regions` lists for steady 1D/2D/3D bounded material/source
regions. Bounds use three finite physical coordinates; inactive axes do not
participate in membership. Each region can set conductivity aliases and either
a finite signed `volumetricHeatWPerM3` or finite nonnegative `powerW`, but not
both. Regional `powerW` is distributed over selected nodes' dual volume. Later
regions override supplied conductivity per field; regional sources add to the
uniform base source and to overlapping regions. `materials` is primary and
`regions` is its alias; a present `materials: null` does not fall through to
`regions`. Empty or absent lists retain the uniform method and normalized
input digest. The existing base-level qv-over-power precedence is unchanged.
Density and specific-heat fields are unsupported for steady regions.

Nonempty regional requests use method `thermal-steady-fv-regions-v1`, with
local finite-volume conductivity interfaces and dual-volume source weighting.
This OpenAPI update specifies the wire contract. Matching TS/native regional
solvers passed the bounded independent checks recorded in W-Sim PR113;
broader engineering and deployed release acceptance remain separate.
Schema validity alone does not establish solver support. The required `units`
object has five labels: `length=m`,
`temperature=C|K`, the supported conductivity label, `power=W`, and the
supported heat-flux label.

Explicit face boundaries require `left`/`right`, add `bottom`/`top` in 2D and
3D, and add `front`/`back` in 3D (`front` is z=0 and `back` is z=max). Faces
support `dirichlet`, `neumann`, `insulated`, and `robin`. Without a boundaries
object, finite `ambientTemp`/`heatSourceTemp` (or `tLeft`/`tRight`) create the
x-direction Dirichlet pair and other active faces are insulated. At least one
Dirichlet face or positive-h Robin face must anchor absolute temperature;
conflicting face fields and unequal temperatures at intersecting Dirichlet
faces fail solver admission. `residualTol` must be positive (default `1e-8`);
`maxIterations` is an integer from 1 to 50,000 (default 20,000).

The OpenAPI schema describes the request shape. It does not make the generic
Host intake validate steady solver-domain rules. Regional execution requires
at least two nodes on every active axis and the matching producer. The 3D steady request
schema does not establish that 3D field artifacts, Host/Agent delivery, browser
UI or release-version coordination have passed end-to-end verification; those
remain separate acceptance work.

## IGBT spatial-chip float64 normalization compatibility (OpenAPI 1.56.11)

The native spatial-chip consumer must round-trip JSON numeric values through
IEEE-754 binary64 before it creates the normalized summary and digest. Decimal
coordinate tails that exceed binary64 precision can consequently normalize
differently, changing summaries and artifact identifiers when those inputs are
recomputed. Previously saved field/KPI files remain readable from their stored
artifact IDs and bytes without rewriting or re-hashing. HTTP paths, request/response
envelopes and artifact endpoints are unchanged.

Validation evidence and exact producer provenance belong in the [IGBT boundary
benchmark record](../benchmarks/perf/igbt-boundary-20261016-004538/) and Issue92.
This note makes no native-validation or release claim.

A native abort before artifact upload must not return a successful result. If
cancellation arrives after the field upload is acknowledged but before the KPI
summary upload, the saved field is only a partial diagnostic artifact and the job
still cannot settle successfully. This path does not invent a rollback endpoint.

The traceable CRMicro loss table contains 25°C and 125°C samples at its specified
electrical operating-point conditions. Those points are not a thermal package
calibration and do not establish a general device-temperature model. The source
proof is official retrieval text; raw datasheet PDF bytes were not downloaded.

[CONTRACT IMPACT] Native consumers must preserve binary64 input semantics when
normalizing spatial-chip summaries and digests. Existing stored attachments remain
readable without rewriting. No HTTP path or envelope changes.

## IGBT spatial-chip input and settlement (OpenAPI 1.56.10)

The existing `electro-thermal-igbt` kind adds one exact opt-in value,
`parameters.mode: "spatial-chip"`. Its `JobSpecV1` kind, route, and envelope do
not change; all legacy IGBT parameter modes retain their existing shape and
behavior. The new mode requires an explicit 3D box, three lengths in metres,
2–128 nodes per axis, positive base conductivity, the existing five thermal
unit labels, six existing steady boundary records, a case face, up to 64
conductivity-only material regions, 1–16 dies, and an electrical/thermal
coupling configuration. The selected case face must be Dirichlet or positive-h
Robin. Native admission additionally checks finite values, closed-node bounds,
nonempty and non-overlapping die selections, and material/die limits.
The OpenAPI document is a canonical, non-null shape rather than a complete
description of every native parser tolerance: spatial-chip requires base
`conductivity`, rejects non-null `k` and `thermalConductivity` aliases, and
ignores null values for its known forbidden controls. The published shape is
canonical and does not encode all native null-skipping behavior. It also
does not encode cross-field geometry, selected-face type, loss-table matching,
or node-overlap checks. Do not read schema validity as native admission.

Each die has a fixed operating point and a loss table with 2–64 strictly
ascending Celsius samples. The table's current, voltage and on/off gate
resistances must exactly match the die operating point. Piecewise-linear
interpolation is only across temperature within that table: there is no
temperature, current, voltage or gate-resistance extrapolation or scaling, and
no invented device defaults. `source` is provenance text only; a table may be
synthetic validation data and is not manufacturer calibration. Provenance belongs
at `die.lossTable.source` (up to 512 characters); a non-null die-level `source`
or top-level `initialJunctionTempC` is rejected. If switching
frequency is positive, duty cycle must be strictly between zero and one.
Frequency denotes completed on/off pairs per second.

The declared electrical losses are `Pcond = I × duty × Vce(T)` and
`Psw = fs × (Eon(T) + Eoff(T))`; switching loss receives no extra duty factor.
Each die's resulting power is distributed uniformly across its selected nodal
dual volumes. Dies share the spatial finite-volume field and therefore heat
each other. Junction feedback uses the die-volume-weighted mean while reporting
die minimum and maximum separately. The calculation does not claim reverse
diode loss, bus or circuit dynamics, or a broader transport model. Known
uniform source, density, heat-capacity, transient and lumped-model controls are
not inputs to this mode. Outer and inner iteration exhaustion is failure; a
relaxed update cannot substitute for the stated temperature and relative-power
convergence tests. The fixed total runtime budget remains five seconds, and
cancellation must reach the inner solves.

For this mode, the native Agent path now uploads exactly the full 3D temperature
field (`thermal-temperature-field`, binary64 little-endian, x-fastest) and KPI
summary (`thermal-kpi-summary`, JSON) before cleaning its temporary directory.
The existing 256-cell inline CSV limit and field format apply. Host completion
binds both artifacts to the current job, owner and project and verifies stored
bytes/SHA, grid/units, field extrema, exact KPI JSON, method and input-digest
shape, ordered JSON-string die IDs, finite global/per-die KPIs, and convergence
metrics against the submitted tolerances. It does not recompute normalized input
digests or re-run physical admission. The W-Sim producer must bind its digest to
geometry, materials, loss tables, operating points and coupling controls, and
keep the actually used losses distinct from the losses re-evaluated at the final
mean temperature. The summary includes finite field extrema, case-face
mean and (only for Robin case faces) ambient temperature, die count and coupling
convergence metrics, total/source/conduction/switching power, residual and
iteration status, six face heat flows, and per-die junction mean/min/max,
loss-evaluation temperature and used/re-evaluated loss components. Ordered die
IDs are carried in `derived.igbtDieIds` (or its contract-prescribed JSON string
encoding); this version requires the JSON string form. The WaveWorld source tree
connects the saved-result reader and result card to download and display these
IGBT artifacts. Validation evidence and exact producer provenance belong in the
[IGBT boundary benchmark record](../benchmarks/perf/igbt-boundary-20261016-004538/)
and Issue92; this documentation makes no release claim or engineering-validity
claim.

Settlement requires 1–16 unique ASCII die IDs in submitted order, positive
safe-integer outer/inner iteration counts, `steps` equal to the outer count,
finite nonnegative convergence changes, and a residual below
`parameters.residualTol` (default `1e-12`). Runtime must be finite and
nonnegative; iteration counts cannot exceed their submitted limits.

[CONTRACT IMPACT] The schema, Host/Agent settlement path, and saved-result reader
describe the spatial-chip branch while preserving the legacy IGBT kind and
envelope. Release the matching W-Sim producer with WaveWorld Host/Agent and UI.

For steady heat KPIs, smooth interior nodes on 3D Dirichlet faces now use the
discrete PDE-curvature estimate: a four-point normal stencil with symmetric
Simpson tangential weights. Nodes shared by intersecting Dirichlet faces retain
the prior face-gradient estimate and do not contribute face heat. Other boundary
types and the legacy 1D/2D calculations are unchanged. Temperature fields, input
digests, method ID, heat units and the energy definition are unchanged.

Replay probes on the retained GPU fields measured total closure errors of
12.8993%/4.54737%/1.49245% and worst per-face errors of
14.4936%/4.73557%/1.60012% on 5³/9³/17³ grids; the minimum refinement ratio
2.28529 passed its gate. Fresh OBS-003 evidence in W-Sim
`benchmarks/perf/thermal-flux-20261015-193005/` confirms the gates with 26 native
CUDA and 26 TS captures plus nine expected admission failures per backend;
887 saved numerical checks passed. All six isolated face cases passed, with
maximum analytic-field error 7.582e-11°C. Prior 20 fields/iterations/digests and
eight legacy non-time summaries were preserved exactly. Historical failed
probes and the original 12 closure failures remain retained. These numerical checks are separate from the saved-byte delivery replay
described above. Real browser filesystem and coordinated deployed release
acceptance remain pending.

[CONTRACT IMPACT] Recompute old 3D heat KPIs with the updated boundary estimate.
Temperature fields, their digests, method ID, energy definition and units do not
change. Consumers still need matching versions; product delivery and release
acceptance have not been completed.

[CONTRACT IMPACT] The matching consumers are the W-Sim native solver,
TypeScript thermal runner, API clients and WaveWorld Agent. Publish matching
contract versions together before release. This schema change does not add
material regions or change browser admission.

`thermal-3d-transient` uses the existing Host artifact store and endpoints.
The native CLI writes `artifacts/<artifactId>` beside `--result`, using a fresh
directory per run. The field is headerless IEEE-754 float64 little-endian,
x-fastest: `(k*ny+j)*nx+i`. Its byte length is exactly `8*nx*ny*nz`; C/K units,
dimensions and physical lengths belong to the submitted spec and saved result.
`derived.fieldFormat` is `float64-le-x-fastest-v1`. The second artifact is the
exact `history` object serialized as JSON, with its actual byte length.

The Agent validates both local descriptors/files before uploading. It uses
`TaskApiClient.uploadArtifact`, retaining bounded retries, lease heartbeats,
timeouts and cancellation. JSON history uses the existing JSON/base64 upload
envelope; the temperature body uses raw octet-stream. Upload responses must
match type, byte count and SHA-256. Only then are both local IDs replaced with
Host IDs, including `derived.fieldArtifactId` and `historyArtifactId`.
Native process failure, absent uploader/files, invalid bytes, failed upload or
cancelled execution cannot produce a successful artifact result. Temporary
native directories are cleaned after the uploader finishes.

Host completion checks that saved records belong to this job, owner and
project, have matching metadata and SHA-256, decode to the submitted grid,
contain finite temperatures with the reported extrema, and reproduce history.
For at most 256 cells, `derived.temperatureCsv` is required. It must contain
exactly one finite decimal or exponent token per cell in the same x-fastest order
as the saved binary64 field, and each parsed value must be numerically equal.
There is no tolerance; signed zero compares equal because the native formatter
serializes both as `0`. Empty tokens, hex/binary numbers, non-finite values,
missing values and reordered or altered fields are rejected. Above 256 cells,
inline CSV remains forbidden. This check is independent of stored-field SHA and
extrema: a valid file cannot make a contradictory inline result valid.

Missing/corrupt/foreign references return 400 before settlement. Generic stored
result and artifact GETs retain their existing authorization and integrity
checks. Historical completed rows remain readable.

The task result view reads persisted bytes without recomputing. It binds the
saved artifact metadata SHA to the response header and local digest, decodes
the full field, and exports `temperature.f64le`, `spec.json`, `result.json` and
`manifest.json` to a user-selected directory. The manifest records byte count,
SHA, dimensions, units and layout. Directory export uses the product's existing
File System Access pattern; it adds no ZIP or storage dependency.

The default artifact limit is 32 MiB. Native transient currently permits at
most 128 nodes per active axis and 1,048,576 cells. Dimension inference, gridN
aliases and defaults remain compatible with native validation. More than 256
temperatures are never inlined in the result. One-dimensional 257-node input
is rejected by the existing scale limit; large-field acceptance uses legal
2D/3D grids.

[CONTRACT IMPACT] New transient settlements require the matching native writer
and Agent/Host versions. Descriptor-only results from older binaries fail
closed. JobResult/HTTP envelope shapes and input-digest semantics are unchanged;
OpenAPI 1.56.4 documents the saved payloads, inline consistency and existing
native transient request parameters; OpenAPI 1.56.5 adds the separate steady
request shape. Typed callers can use the shared
`ThermalTransientJobSpecV1` and `isThermalTransientJobSpec`; aliases, materials,
initial fields, probes and implicit controls no longer need an untyped parameter
bag. These types describe inputs, not successful solver-domain admission.
Generic Host intake still checks the envelope; the native executor enforces
geometry, source, boundary and stability rules. Browser thermal execution is
not provided by the native request schema.
WaveWorld's W-Sim pin and production runtime are not changed by this patch.


Steady region evidence is retained by W-Sim PR113 at
`benchmarks/perf/thermal-steady-material-20261015-205428/`:66 new positives plus 14
exact legacy comparisons on native CUDA/TS,16 expected domain failures per backend,
and 1584 independent numerical checks. The region field/KPI format uses the same
3D artifacts as the uniform path; per-face region heat values are numeric summary
scalars describing local discrete reactions. The numerical checks are separate from the
saved-byte consumer acceptance below and coordinated deployment.


## Saved regional result acceptance

W-Sim `benchmarks/perf/thermal-steady-edge-20261015-214520/` contains four new
signed-sink/intersecting-Dirichlet captures with 134 independent OBS-003 checks,
plus a clean-source consumer replay of 43 native 3D field/KPI pairs. The replay
covers 37 regional and six uniform results, including a real 343-value regional
field without CSV. TaskApiClient upload, authenticated temporary Host completion,
idempotence/read, field/KPI download and directory-handle export preserve every
original field/KPI byte and complete summary, including all six face scalars.

After saved KPI SHA/digest/summary verification, the thermal card displays the
regional or uniform method in readable language and the available finite face
powers in W. Positive values enter the domain; negative values leave it. The
card reads persisted results and does not recompute. Three exact native fixtures
exercise small/large regional and uniform mounted cards and export arguments.

Host helper/routes pass 12 tests with two conditional old replay skips, cards
pass 10 and readers pass four. Host/SPA app typechecks and a fresh scoped W-Sim
contracts build pass. The first consumer proof mixed contracts dependency trees;
its nine dist-manifest mismatches and original logs/exports are preserved. Final
r2 validation uses a private contracts source/dist with all four consumers bound
to it, and repeats the entire focused suite. Installed tools/dependencies remain
support; no full suite, actual browser filesystem or deployed HTTP/GPU Agent
acceptance is claimed. HTTP/OpenAPI paths and envelopes, solver source, production
pins and environment are unchanged. Thermal stays 95%; release/version acceptance
remains component21 and the next local improvement is component6 IGBT.

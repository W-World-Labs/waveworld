# Evidence import API

Path experiments may reference an immutable evidence record through
`source.evidenceId` and `source.sha256`, with optional `locator` and `transform`.
The two reference fields must be supplied together. The digest is SHA-256 over
the exact uploaded measured bytes or the canonical literature metadata JSON.

Evidence is either personal (`projectId` omitted) or project-scoped. To create
project evidence, include `"projectId": "…"`; the caller must be that
project's owner or editor. The evidence artifact receives the same project
scope, so project viewers may inspect it but cannot import or bind it in a new
job. A project job may use personal evidence owned by its submitter and
evidence from that same project, but never evidence from another project.

## Import measured data

`POST /api/v1/evidence/import` with JSON:

```json
{
  "kind": "measured",
  "title": "Ir oxygen assay",
  "format": "csv",
  "contentBase64": "c2FtcGxlLE8yCklyLTEsMC4yMQo=",
  "metadata": { "instrument": "oxygen probe" }
}
```

`format` is `csv` or `json`. The original bytes are stored as an artifact.

## Register literature

```json
{
  "kind": "literature",
  "title": "Triplet ROS kinetics",
  "doi": "10.1000/example",
  "metadata": { "page": 7, "table": 2 }
}
```

At least one of `doi`, `url`, or `citation` is required. Canonically sorted
metadata JSON is stored as the source artifact. Fetch the audit record with
`GET /api/v1/evidence/:id`; the response includes its artifact ID, SHA-256,
content type, byte count, metadata, owner, and import time.

`GET /api/v1/evidence?limit=100` lists the authenticated user's personal
evidence together with evidence from all non-deleted projects they can read,
ordered newest first. This endpoint is intended to restore an experiment page
after reload; it never returns another user's private evidence.

## Completion audit manifest

When a `path-experiment` job is durably marked `succeeded`, Host creates a
`path-experiment-audit-manifest` artifact. Its canonical JSON contains the full
job specification and result, specification fingerprint, agent/backend,
model/engine versions, every evidence reference (including locator and
transform), the evidence artifact digest, and digests recalculated from all
other job artifacts. The envelope has `manifestSha256`, the SHA-256 of the
canonical manifest payload; the artifact record separately hashes the complete
envelope bytes.

Completion uses two explicit states: the compute result is committed first;
audit materialization is then recorded in `job_audits` as `ready` or `failed`.
An audit write failure never changes a successfully computed job to `failed`.
`createAuditManifestArtifact(job)` is idempotent and is the compensation entry
point for retrying a `failed` audit later. Verification recalculates the
manifest, evidence-artifact, and job-artifact hashes and rejects tampering.

For production path jobs, the compute section also contains three mandatory
execution identities: `agentBuildId`, `modelImplementationSha256`, and
`dependencyLockSha256`. The Agent derives the model digest from the actual path
runner/model source bytes and the dependency digest from its lockfile, advertises
them in its registered capability, and repeats them in `JobResult.backend` and
the experiment engine provenance. The Host cross-checks all copies before
materializing the audit artifact. Missing, malformed, or mismatched production
provenance leaves the audit in `failed`, so the durable result cannot be
published. Development jobs remain runnable and are explicitly marked
`development-unverified` in their audit rather than pretending to have a
production build identity.

Production Agent units must set one immutable deployment identifier through
`WAVEWORLD_BUILD_ID`, `BUILD_ID`, or `GIT_SHA`. Source deployments must retain
`agent/src/path-experiment-runner.ts`, `src/lib/sim/photosensitization.ts`, and
`agent/package-lock.json`; packaged deployments must generate and ship the same
digests as build metadata.
